import { staffMessages, type AttentionItem, type AttentionSource, type ChatIndex, type ChatState, type ControlStore, type IdentityVault, type LanguageSource, type Proposal, type ProposalStore } from '@cyborg/core';

// docs/10 ADM-81..86: the chats that need a person, coloured by how soon, and the toast that says so.

export type BoardColour = 'red' | 'yellow' | 'green';
/** `none` is a complete chat: nothing waits for a person. */
export type BoardStatus = BoardColour | 'none';
export type BoardReason = 'waiting' | 'blocked' | 'low_confidence' | 'office_to_check' | 'handoff' | 'stale' | 'draft_pending';

export interface BoardRow {
  chat: string;
  /** The customer's first name, read back from the vault for staff only. Null when the adapter gave none. */
  name: string | null;
  colour: BoardStatus;
  /** Every reason that applies, most urgent first. */
  reasons: BoardReason[];
  /** One line of what the customer wants (from the handoff card) or, failing that, why the chat is on the board. */
  summary: string | null;
  /** When the oldest thing that needs a person began. */
  since: string;
  state: ChatState;
  /** ADM-97: the first clean reply waiting on this chat, so the record of its kind can be shown. */
  reply: { handlerId: string; handlerVersion: string; modelCallId: string | null } | null;
  /** ADM-97: how often that kind of reply has been right (filled in by the company layer). */
  record?: { right: number; considered: number; of: number; candidate: boolean };
}

export interface BoardDeps {
  proposals: Pick<ProposalStore, 'list'>;
  index: ChatIndex;
  control: Pick<ControlStore, 'listOpenWaiting' | 'getChatState' | 'lastSettledAt'>;
  vault: Pick<IdentityVault, 'get'>;
  language?: LanguageSource;
  /** N-19: a chat nobody has answered or settled since the customer's last message, for longer than this, is stale. Unset: nothing is stale. */
  staleAfterMs?: number | undefined;
  now?: () => Date;
}

const CARD = 'sales.handoff.card';
const OPEN: Proposal['status'][] = ['proposed', 'approved', 'applied'];
const RANK: Record<BoardStatus, number> = { red: 0, yellow: 1, green: 2, none: 3 };

/**
 * ADM-82 (zapa, 2026-11-01). The colours, from stored state only:
 *  red    needs action now: a customer waits for a person, the bot could not answer safely, or it is not sure of its own reply (low band);
 *  yellow the morning handoff (a handoff card nobody has settled, with or without a question for the office) and stale chats;
 *  green  the bot did its job without a hiccup: its reply (or another proposal) passed every check and only waits for a person to accept it;
 *  none   nothing waits: the chat is complete and is left off the board unless asked for.
 * Anything a person settled (a reply in the chat, or `.done`) after it was made no longer counts. Red beats yellow beats green.
 */
export function buildChatBoard(deps: BoardDeps, options: { includeComplete?: boolean } = {}): BoardRow[] {
  const now = (deps.now ?? (() => new Date()))().getTime();
  const waiting = new Map(deps.control.listOpenWaiting().map((w) => [w.chat, w]));
  const byChat = new Map<string, Proposal[]>();
  for (const p of deps.proposals.list()) {
    if (p.eventSource === null || p.eventId === null) continue;
    const chat = deps.index.chatOfEvent(p.eventSource, p.eventId);
    if (chat) byChat.set(chat, [...(byChat.get(chat) ?? []), p]);
  }
  const rows: BoardRow[] = [];
  for (const { chat, lastAt } of deps.index.listChats()) {
    const settled = deps.control.lastSettledAt(chat);
    const recent = (byChat.get(chat) ?? []).filter((p) => settled === null || p.createdAt > settled);
    const unsettled = recent.filter((p) => OPEN.includes(p.status));
    // audit F-8 / ADM-82: a reply the model failed twice (invalid_output) is not an open status, but the customer is still unanswered
    const failedReply = recent.filter((p) => p.status === 'invalid_output' && p.handlerId.endsWith('reply_draft'));
    const reasons: BoardReason[] = [];
    const since: string[] = [];

    const wait = waiting.get(chat);
    if (wait) { reasons.push('waiting'); since.push(wait.since); }
    const proposed = unsettled.filter((p) => p.status === 'proposed' && p.handlerId !== CARD);
    const blocked = proposed.filter((p) => p.reason?.startsWith('manual_handling') || (p.draft == null && p.handlerId.endsWith('reply_draft') && p.questions.length > 0));
    if (blocked.length || failedReply.length) { reasons.push('blocked'); since.push((blocked[0] ?? failedReply[0])!.createdAt); }
    const unsure = proposed.filter((p) => !blocked.includes(p) && p.confidence?.band === 'low');
    if (unsure.length) { reasons.push('low_confidence'); since.push(unsure[0]!.createdAt); }

    const card = [...unsettled].filter((p) => p.handlerId === CARD).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
    if (card) { reasons.push(card.questions.length > 0 ? 'office_to_check' : 'handoff'); since.push(card.createdAt); }
    const quiet = deps.staleAfterMs !== undefined && (settled === null || lastAt > settled) && now - new Date(lastAt).getTime() > deps.staleAfterMs;
    if (quiet) { reasons.push('stale'); since.push(lastAt); }

    const clean = proposed.filter((p) => !blocked.includes(p) && !unsure.includes(p));
    if (clean.length) { reasons.push('draft_pending'); since.push(clean[0]!.createdAt); }

    const red = reasons.includes('waiting') || reasons.includes('blocked') || reasons.includes('low_confidence');
    const yellow = reasons.includes('office_to_check') || reasons.includes('handoff') || reasons.includes('stale');
    const colour: BoardStatus = red ? 'red' : yellow ? 'yellow' : reasons.includes('draft_pending') ? 'green' : 'none';
    if (colour === 'none' && !options.includeComplete) continue;

    const code = deps.index.getContact(chat);
    const full = code ? deps.vault.get(code)?.value ?? null : null;
    const m = staffMessages(deps.language).board.reason;
    const wants = card?.findings.find((f) => f.statement.startsWith('wants: '))?.statement.slice('wants: '.length) ?? null;
    const first = reasons[0];
    const fallback = first ? m[REASON_TEXT[first]] : null;
    rows.push({
      chat,
      // ADM-83: the WhatsApp name as shown on the office PC, cut at 40 characters.
      name: full ? (full.trim().replace(/\s+/g, ' ').slice(0, 40) || null) : null,
      colour,
      reasons,
      summary: wants ?? fallback,
      since: since.sort()[0] ?? '',
      state: deps.control.getChatState(chat),
      reply: ((r) => (r ? { handlerId: r.handlerId, handlerVersion: r.handlerVersion, modelCallId: r.modelCallId } : null))(clean.find((p) => p.draft != null)),
    });
  }
  return rows.sort((a, b) => RANK[a.colour] - RANK[b.colour] || a.since.localeCompare(b.since));
}

/** Which fixed sentence stands for each reason (the neutral line a hidden toast shows). */
export const REASON_TEXT: Record<BoardReason, 'waiting' | 'blocked' | 'lowConfidence' | 'officeToCheck' | 'handoff' | 'stale' | 'draftPending'> = {
  waiting: 'waiting', blocked: 'blocked', low_confidence: 'lowConfidence', office_to_check: 'officeToCheck', handoff: 'handoff', stale: 'stale', draft_pending: 'draftPending',
};

export interface Toast {
  title: string;
  body: string;
  colour: BoardStatus;
  /** Where a click goes: the chat on the dashboard (ADM-84). */
  open: string;
  /** Offered where the browser can show buttons; a click on the toast itself always opens the chat. */
  actions: { id: 'take_over' | 'leave_to_bot'; label: string }[];
}

export const TOAST_DETAILS = ['name_and_summary', 'reference_only'] as const;
export type ToastDetail = (typeof TOAST_DETAILS)[number];
const MAX_BODY = 120;

/**
 * ADM-83. The toast for a row that needs a person: the customer's first name and one line of what they want. A toast is visible to
 * anyone near the screen, so a company can choose `reference_only` (the chat reference and the reason, no name and no summary).
 */
export function toastFor(row: BoardRow, options: { detail?: ToastDetail; language?: LanguageSource } = {}): Toast {
  const m = staffMessages(options.language).board;
  const detail = options.detail ?? 'name_and_summary';
  const body = detail === 'name_and_summary' ? (row.summary ?? m.reason.waiting) : m.reason[row.reasons[0] ? REASON_TEXT[row.reasons[0]] : 'waiting'];
  return {
    title: detail === 'name_and_summary' ? (row.name ?? row.chat) : row.chat,
    body: body.length > MAX_BODY ? `${body.slice(0, MAX_BODY - 1)}…` : body,
    colour: row.colour,
    open: `#/chat/${encodeURIComponent(row.chat)}`,
    actions: [
      { id: 'take_over', label: m.action.takeOver },
      { id: 'leave_to_bot', label: m.action.leaveToBot },
    ],
  };
}

/** ADM-86: what the chat view shows of the chat's proposals: the card and the replies waiting for a person. */
export function proposalsOfChat(deps: Pick<BoardDeps, 'proposals' | 'index'>, chat: string): Proposal[] {
  return deps.proposals.list().filter((p) => p.eventSource !== null && p.eventId !== null && deps.index.chatOfEvent(p.eventSource, p.eventId) === chat);
}

/**
 * ADM-92: the chat desk as an attention source. A row on the board becomes an item with the desk's two buttons; a click opens the
 * chat view. The desk is one plug-in of the dashboard, like any other (ARC-14).
 */
export function deskAttention(options: {
  board: () => BoardRow[];
  language?: LanguageSource;
  takeOver: (chat: string, by: string) => void;
  leaveToBot: (chat: string, by: string) => void;
}): AttentionSource {
  const prefix = 'desk:';
  return {
    id: 'desk',
    items: (): AttentionItem[] => {
      const m = staffMessages(options.language).board;
      return options.board().filter((r): r is BoardRow & { colour: BoardColour } => r.colour !== 'none').map((r) => ({
        key: `${prefix}${r.chat}`,
        source: 'desk',
        kind: 'chat',
        colour: r.colour,
        title: r.name ?? r.chat,
        summary: r.summary,
        reference: r.chat,
        reasonText: m.reason[r.reasons[0] ? REASON_TEXT[r.reasons[0]] : 'waiting'],
        since: r.since,
        reasons: r.reasons,
        actions: [
          { id: 'take_over', label: m.action.takeOver },
          { id: 'leave_to_bot', label: m.action.leaveToBot },
        ],
        ...(r.record ? { record: r.record } : {}),
        open: `#/chat/${encodeURIComponent(r.chat)}`,
      }));
    },
    act: (key, action, by) => {
      const chat = key.slice(prefix.length);
      if (action === 'take_over') options.takeOver(chat, by);
      else if (action === 'leave_to_bot') options.leaveToBot(chat, by);
      else throw new Error(`"${action}" is not an action of a chat`);
    },
  };
}
