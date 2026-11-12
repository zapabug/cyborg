// docs/06 PRF-39..53, 77..79: staff flags, tickets, the false-confidence review and the supplier heads-up.
import type { AutoReplyPolicy, ReviewEntry } from './calibration.ts';
import type { ShadowLog } from './shadow-types.ts';
import type { Band } from './confidence.ts';
import { N12_HEADSUP_FLAGS, N17_TICKET_MESSAGES } from './numbers.ts';
import { scrub } from './scrubber.ts';
import type { ProposalStore, Proposal, PromptLedger } from './types.ts';

export const FLAG_REASONS = ['wrong_fact', 'promised_something', 'missed_question', 'wrong_tone', 'too_long', 'unclear', 'other'] as const;
export type FlagReason = (typeof FLAG_REASONS)[number];

export interface Flag {
  id: string;
  proposalId: string;
  handlerId: string;
  /** Effective handler version at the time (PRF-46). */
  handlerVersion: string;
  model: string | null;
  endpoint: string | null;
  band: Band | null;
  reason: FlagReason;
  note: string | null;
  flaggedBy: string;
  flaggedAt: string;
  status: 'open' | 'closed';
  ticketId: string;
  autoReplied: boolean;
}

export interface Ticket {
  id: string;
  flagId: string;
  note: string | null;
  /** The last messages of the conversation, until the ticket is fixed (PRF-77). */
  transcript: string[] | null;
  transcriptClearedAt: string | null;
  /** The bot trace: what the handler read, its checks, grounding, band and signals, the ledger call id. No customer text. */
  trace: unknown;
  status: 'open' | 'fixed';
  createdAt: string;
  closedAt: string | null;
}

export interface FlagStore {
  addFlag(flag: Omit<Flag, 'id' | 'ticketId'>, ticket: Omit<Ticket, 'id' | 'flagId'>): { flag: Flag; ticket: Ticket };
  getFlag(id: string): Flag | null;
  listFlags(filter?: { handlerId?: string; handlerVersion?: string; status?: 'open' | 'closed' }): Flag[];
  getTicket(id: string): Ticket | null;
  /** Closing as fixed wipes the transcript and keeps the note and the trace. */
  fixTicket(id: string, at: string): Ticket;
  lastHeadsUp(handlerId: string, handlerVersion: string): { openFlagsAtAlert: number; at: string } | null;
  recordHeadsUp(handlerId: string, handlerVersion: string, openFlagsAtAlert: number, at: string): void;
}

export interface FlagDeps {
  flags: FlagStore;
  proposals: ProposalStore;
  ledger: PromptLedger;
  policy?: AutoReplyPolicy;
  monitor?: HeadsUpMonitor;
  now?: () => Date;
}

/**
 * PRF-39, 45, 47: any reply can be flagged at any time. `lastMessages` come from the adapter, which holds the conversation.
 * A `wrong_fact` or `promised_something` flag on an auto-replied entry suspends auto-reply at once.
 */
export async function flagReply(
  deps: FlagDeps,
  request: { proposalId: string; reason: FlagReason; note?: string; actor: string; lastMessages: readonly string[]; autoReplied: boolean },
): Promise<{ flag: Flag; ticket: Ticket }> {
  if (!FLAG_REASONS.includes(request.reason)) throw new Error(`"${request.reason}" is not a flag reason`);
  const proposal = deps.proposals.get(request.proposalId);
  if (!proposal) throw new Error(`no proposal ${request.proposalId}`);
  const at = (deps.now ?? (() => new Date()))().toISOString();
  const call = proposal.modelCallId ? deps.ledger.read(proposal.modelCallId) : null;

  const created = deps.flags.addFlag(
    {
      proposalId: proposal.id, handlerId: proposal.handlerId, handlerVersion: proposal.handlerVersion,
      model: call?.model ?? null, endpoint: call?.endpoint ?? null, band: proposal.confidence?.band ?? null,
      reason: request.reason, note: request.note ?? null, flaggedBy: request.actor, flaggedAt: at, status: 'open', autoReplied: request.autoReplied,
    },
    {
      note: request.note ?? null,
      transcript: request.lastMessages.slice(-N17_TICKET_MESSAGES),
      transcriptClearedAt: null,
      trace: botTrace(proposal),
      status: 'open', createdAt: at, closedAt: null,
    },
  );
  deps.proposals.appendAudit({ at, proposalId: proposal.id, kind: 'flag', fromStatus: null, toStatus: null, actor: request.actor, detail: { flag: created.flag.id, reason: request.reason, band: created.flag.band } });

  if (request.autoReplied && (request.reason === 'wrong_fact' || request.reason === 'promised_something')) {
    deps.policy?.suspend(proposal.handlerId, `a staff flag (${request.reason}) on an auto-reply; pending review (PRF-45)`);
  }
  await deps.monitor?.check(proposal.handlerId, proposal.handlerVersion);
  return created;
}

/** The bot trace stored in a ticket: structure and results only, no draft and no customer text (PRF-47). */
function botTrace(p: Proposal): unknown {
  return {
    handlerId: p.handlerId,
    handlerVersion: p.handlerVersion,
    ledgerCallId: p.modelCallId,
    status: p.status,
    changedFields: p.changes.map((c) => c.field),
    findings: p.findings.length,
    questions: p.questions.length,
    confidence: p.confidence ? { band: p.confidence.band, rule: p.confidence.rule, signals: p.confidence.signals.map(({ detail: _d, ...rest }) => rest) } : null,
  };
}

/** PRF-47: closing as fixed replaces the transcript with a marker and keeps the note and the trace. */
export function closeTicketFixed(deps: Pick<FlagDeps, 'flags' | 'proposals' | 'now'>, ticketId: string, actor: string): Ticket {
  const at = (deps.now ?? (() => new Date()))().toISOString();
  const ticket = deps.flags.fixTicket(ticketId, at);
  deps.proposals.appendAudit({ at, proposalId: null, kind: 'ticket_fixed', fromStatus: null, toStatus: null, actor, detail: { ticket: ticketId } });
  return ticket;
}

// ---- the supplier heads-up (PRF-48..53, PRF-79) -----------------------------------------------------------

export interface HeadsUp {
  businessId: string;
  handlerId: string;
  handlerVersion: string;
  model: string | null;
  endpoint: string | null;
  openFlags: number;
  byReason: Record<string, number>;
  flagByBand: Record<string, number>;
  tickets: { ref: string; reason: FlagReason; band: Band | null; trace: unknown; note?: string }[];
}

/** PRF-50: outbound only. There is no method to receive, read or obey anything from the supplier channel. */
export interface DevReportSink {
  send(report: HeadsUp): Promise<void>;
}

export interface HeadsUpDeps {
  businessId: string;
  flags: FlagStore;
  sink: DevReportSink;
  audit: Pick<ProposalStore, 'appendAudit'>;
  /** PRF-49: notes go in only if the business turned this on; each must pass the scrubber. */
  includeNotes?: boolean;
  threshold?: number;
  now?: () => Date;
}

export class HeadsUpMonitor {
  constructor(private readonly deps: HeadsUpDeps) {}

  /** PRF-48, PRF-51: once at N-12 open flags, and again only after N-12 more. Best effort; a failed send is logged. */
  async check(handlerId: string, handlerVersion: string): Promise<HeadsUp | null> {
    const threshold = this.deps.threshold ?? N12_HEADSUP_FLAGS;
    const open = this.deps.flags.listFlags({ handlerId, handlerVersion, status: 'open' });
    const last = this.deps.flags.lastHeadsUp(handlerId, handlerVersion);
    if (open.length < threshold || (last && open.length < last.openFlagsAtAlert + threshold)) return null;

    const tickets = open.map((f) => {
      const t = this.deps.flags.getTicket(f.ticketId)!;
      const item: HeadsUp['tickets'][number] = { ref: t.id, reason: f.reason, band: f.band, trace: t.trace };
      if (this.deps.includeNotes && t.note) item.note = scrub(t.note).length > 0 ? 'note withheld' : t.note; // never the transcript
      return item;
    });
    const count = <K extends string>(keys: K[]) => keys.reduce<Record<string, number>>((acc, k) => ({ ...acc, [k]: (acc[k] ?? 0) + 1 }), {});
    const report: HeadsUp = {
      businessId: this.deps.businessId, handlerId, handlerVersion, model: open[0]?.model ?? null, endpoint: open[0]?.endpoint ?? null,
      openFlags: open.length, byReason: count(open.map((f) => f.reason)), flagByBand: count(open.map((f) => f.band ?? 'none')), tickets,
    };
    const at = (this.deps.now ?? (() => new Date()))().toISOString();
    this.deps.flags.recordHeadsUp(handlerId, handlerVersion, open.length, at);
    try {
      await this.deps.sink.send(report);
      this.deps.audit.appendAudit({ at, proposalId: null, kind: 'heads_up_sent', fromStatus: null, toStatus: null, actor: 'heads-up', detail: { handlerId, handlerVersion, openFlags: open.length } });
    } catch (error) {
      this.deps.audit.appendAudit({ at, proposalId: null, kind: 'heads_up_failed', fromStatus: null, toStatus: null, actor: 'heads-up', detail: { handlerId, handlerVersion, error: (error as Error).message } });
    }
    return report;
  }
}

/**
 * Builds the review entries from stored data only (HR-4): the shadow log joined with each proposal's confidence,
 * the ledger's model and endpoint, and the flags. `isAutoReply` is the adapter's knowledge of which handlers auto-reply.
 */
export function collectReviewEntries(deps: {
  log: ShadowLog;
  proposals: ProposalStore;
  ledger: PromptLedger;
  flags: FlagStore;
  isAutoReply: (handlerId: string) => boolean;
  filter?: { handlerId?: string; handlerVersion?: string };
}): ReviewEntry[] {
  const flagged = new Set(deps.flags.listFlags().map((f) => f.proposalId));
  return deps.log.listEntries(deps.filter).map((entry) => {
    const proposal = entry.proposalId ? deps.proposals.get(entry.proposalId) : null;
    const call = proposal?.modelCallId ? deps.ledger.read(proposal.modelCallId) : null;
    return {
      entry,
      band: proposal?.confidence?.band ?? null,
      signals: proposal?.confidence?.signals ?? [],
      model: call?.model ?? null,
      endpoint: call?.endpoint ?? null,
      autoReply: deps.isAutoReply(entry.handlerId),
      flagged: proposal ? flagged.has(proposal.id) : false,
    };
  });
}
