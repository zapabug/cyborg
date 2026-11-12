import { closeTicketFixed, redact, scrub, type Flag, type Ticket } from '@cyborg/core';
import { pendingChats, renderHandoffCard } from '@cyborg/module-sales';
import type { Company } from './runtime.ts';

// feat-wazaa-port W5, WZP-41..46: what the chat desk's tabs sit on, in the company layer so the dashboard holds no rule. A person answers a question the
// bot could not (wazaa's ANSWER and LEARN), keeps a note for later (wazaa's save, bug and idea), and closes a ticket.

export interface OpenQuestion {
  chat: string;
  name: string | null;
  since: string;
  /** The handoff card as staff read it. */
  card: string;
  /** What the office has to answer, from the card. */
  questions: string[];
}

const language = (company: Company) => () => company.store.getLanguage() ?? company.defaultLanguage;

/** WZP-45: the chats whose latest card still has a question only the office can answer and nobody has answered since (ADM-57). */
export function openQuestions(company: Company): OpenQuestion[] {
  return pendingChats({ proposals: company.store, vault: company.vault, control: company.store }).map(({ chat, proposal }) => {
    const code = company.store.getContact(chat);
    const full = code ? company.vault.get(code)?.value ?? null : null;
    return {
      chat,
      name: full ? (full.trim().split(/\s+/)[0] ?? null) : null,
      since: proposal.createdAt,
      card: renderHandoffCard(proposal, { chat, waitingSince: proposal.createdAt, language: language(company) }),
      questions: [...proposal.questions],
    };
  });
}

/** N-21 (docs/02). */
const ANSWER_MAX = 1000;

/**
 * WZP-45: the office answers a customer's question. The answer is the person's own reply: the chat is settled and, in shadow mode, it is recorded
 * beside the customer's last message (ADM-107), so the audit sees what the office said and the bot's draft. With `remember`, the question and the answer
 * are added to the FAQ as an unconfirmed client statement for the next customer (wazaa's LEARN): the fact goes back to unconfirmed until the client
 * confirms it again, and the audit keeps what it replaced. Nothing is sent to the customer from here (HR-8).
 */
export function answerQuestion(company: Company, chat: string, answer: string, by: string, options: { remember?: string } = {}): { remembered: boolean } {
  const text = answer.trim();
  if (text === '') throw new Error('write the answer first');
  if (text.length > ANSWER_MAX) throw new Error(`an answer is at most ${ANSWER_MAX} characters`);
  if (!openQuestions(company).some((q) => q.chat === chat)) throw new Error('that question has been answered or is not open any more');
  // WZP-45b: what is learned is told to the next customer, so it holds no phone, email or other number the scrubber would replace.
  if ((options.remember ?? '').trim() !== '' && (scrub(text).length > 0 || scrub(options.remember!).length > 0)) throw new Error('the question or the answer has a phone, email or other number, so it is not kept in the FAQ. Answer this customer without learn, and put the business\'s own numbers in the business sheet');
  const at = new Date().toISOString();
  const last = company.store.listEntries().filter((e) => company.store.chatOfEvent(e.eventSource, e.eventId) === chat).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  company.personReplied(chat, by, last ? { eventId: last.eventId, source: last.eventSource, text } : undefined);
  const question = (options.remember ?? '').trim();
  company.store.appendAudit({ at, proposalId: null, kind: 'office_answer', fromStatus: null, toStatus: null, actor: by, detail: { chat, remembered: question !== '' } });
  if (question !== '') {
    const faq = company.store.getFact('faq.entries')?.value;
    const entries = Array.isArray(faq) ? (faq as unknown[]) : [];
    company.store.putFact({ key: 'faq.entries', value: [...entries, { q: question, a: text }], class: 'public', source: 'client_statement', sourceRef: 'office-answer' }, by, at);
    const known = company.store.getModuleState<Learned[]>(LEARNED_MODULE, 'answers')?.value ?? [];
    company.store.setModuleState(LEARNED_MODULE, 'answers', [...known, { id: `L${known.length + 1}-${Date.parse(at).toString(36)}`, q: question, a: text, at, by }], by, at);
  }
  return { remembered: question !== '' };
}

export interface AnsweredQuestion {
  at: string;
  by: string;
  name: string | null;
  remembered: boolean;
}

/** The latest office answers, newest first: when, by whom, for which customer, and whether it was kept for the next one. The answer's text is not in the log. */
export function recentAnswers(company: Company, limit = 20): AnsweredQuestion[] {
  return company.store
    .listAudit()
    .filter((r) => r.kind === 'office_answer')
    .slice(-limit)
    .reverse()
    .map((r) => {
      const d = r.detail as { chat?: string; remembered?: boolean };
      const code = d.chat ? company.store.getContact(d.chat) : null;
      const full = code ? company.vault.get(code)?.value ?? null : null;
      return { at: r.at, by: r.actor, name: full ? (full.trim().split(/\s+/)[0] ?? null) : null, remembered: d.remembered === true };
    });
}

export type NoteKind = 'save' | 'bug' | 'idea';
export const NOTE_KINDS: readonly NoteKind[] = ['save', 'bug', 'idea'];

export interface SavedNote {
  id: number;
  at: string;
  by: string;
  kind: NoteKind;
  note: string;
  name: string | null;
}

/** N-21 (docs/02). */
const NOTE_MAX = 500;

/**
 * WZP-44: a note kept for later (wazaa's `save`, `bug` and `idea`): something to look at again, a failure for fixing, a question or request for the
 * developer. It is a row of the audit log, so nothing about the customer is kept with it but the chat's reference; the conversation itself is not copied.
 */
export function saveNote(company: Company, kind: NoteKind, note: string, by: string, chat?: string): SavedNote {
  if (!NOTE_KINDS.includes(kind)) throw new Error('a note is a save, a bug or an idea');
  const text = note.trim();
  if (text === '') throw new Error('write the note first');
  if (text.length > NOTE_MAX) throw new Error(`a note is at most ${NOTE_MAX} characters`);
  const at = new Date().toISOString();
  // WZP-44b: scrubbed before it is written, like every other saved text (PRV-6a); the original is not kept.
  company.store.appendAudit({ at, proposalId: null, kind: 'saved_note', fromStatus: null, toStatus: null, actor: by, detail: { kind, note: redact(text).text, ...(chat ? { chat } : {}) } });
  return listNotes(company)[0]!;
}

export function listNotes(company: Company): SavedNote[] {
  return company.store
    .listAudit()
    .filter((r) => r.kind === 'saved_note')
    .reverse()
    .map((r) => {
      const d = r.detail as { kind: NoteKind; note: string; chat?: string };
      const code = d.chat ? company.store.getContact(d.chat) : null;
      const full = code ? company.vault.get(code)?.value ?? null : null;
      return { id: r.id, at: r.at, by: r.actor, kind: d.kind, note: d.note, name: full ? (full.trim().split(/\s+/)[0] ?? null) : null };
    });
}

export interface OpenTicket {
  id: string;
  flag: Pick<Flag, 'reason' | 'note' | 'handlerId' | 'band' | 'flaggedBy' | 'flaggedAt'>;
  ticket: Pick<Ticket, 'createdAt' | 'status'>;
}

/** WZP-44: the tickets staff opened by flagging a reply, open ones first. */
export function listTickets(company: Company): OpenTicket[] {
  return company.store
    .listFlags()
    .map((f) => ({ f, t: company.store.getTicket(f.ticketId) }))
    .filter((x): x is { f: Flag; t: Ticket } => x.t !== null)
    .sort((a, b) => Number(a.t.status !== 'open') - Number(b.t.status !== 'open') || b.t.createdAt.localeCompare(a.t.createdAt))
    .map(({ f, t }) => ({ id: t.id, flag: { reason: f.reason, note: f.note, handlerId: f.handlerId, band: f.band, flaggedBy: f.flaggedBy, flaggedAt: f.flaggedAt }, ticket: { createdAt: t.createdAt, status: t.status } }));
}

/** PRF-77: closing a ticket as fixed wipes the transcript it held and keeps the note and the trace. */
export function fixTicket(company: Company, ticketId: string, by: string): void {
  closeTicketFixed({ flags: company.store, proposals: company.store, now: () => new Date() }, ticketId, by);
}

const LEARNED_MODULE = 'desk';

export interface Learned {
  id: string;
  q: string;
  a: string;
  at: string;
  by: string;
}

/** WZP-45: the answers the office chose to keep for the next customers (wazaa's learned answers), newest first. */
export function listLearned(company: Company): Learned[] {
  return [...(company.store.getModuleState<Learned[]>(LEARNED_MODULE, 'answers')?.value ?? [])].reverse();
}

/**
 * Takes a kept answer back out of the FAQ. The FAQ fact is replaced (it goes back to unconfirmed and the audit keeps the old list), so a person has made a change
 * to what customers are told and it is theirs on the record.
 */
export function forgetLearned(company: Company, id: string, by: string): void {
  const all = company.store.getModuleState<Learned[]>(LEARNED_MODULE, 'answers')?.value ?? [];
  const found = all.find((l) => l.id === id);
  if (!found) throw new Error('that kept answer does not exist any more');
  const at = new Date().toISOString();
  const faq = company.store.getFact('faq.entries')?.value;
  const entries = Array.isArray(faq) ? (faq as { q?: unknown; a?: unknown }[]) : [];
  const index = entries.findIndex((e) => e.q === found.q && e.a === found.a);
  if (index >= 0) company.store.putFact({ key: 'faq.entries', value: entries.filter((_, i) => i !== index), class: 'public', source: 'client_statement', sourceRef: 'office-answer' }, by, at);
  company.store.setModuleState(LEARNED_MODULE, 'answers', all.filter((l) => l.id !== id), by, at);
}
