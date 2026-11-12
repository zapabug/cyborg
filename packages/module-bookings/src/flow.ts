import type { BookingsConfig } from './config.ts';
import { parseDate, weekdayOf } from './dates.ts';
import { computeQuote, resolveService, type Fields, type Quote, type QuoteContext, type ServiceItem } from './quote.ts';

// feat WZP-50..55: one customer turn of the booking funnel, as pure code. The model's read of the message comes in as unchecked fields;
// what the code makes of them, the quote and whether a booking request may be recorded come out. The stage is kept by the caller (module state).

export type Stage = 'collecting' | 'confirming' | 'requested';
export interface BookingState extends Fields {
  stage: Stage;
  /** The request's reference once it is recorded (B-000001). */
  ref?: string;
}

/** What the read step found in the customer's message. Nothing here is trusted: the code resolves the service, bounds the group and parses the date again. */
export interface ReadFields {
  service?: string;
  partySize?: number;
  date?: string;
}

export interface Turn {
  /** The state to keep, or null when the funnel is not running. */
  state: BookingState | null;
  quote: Quote | null;
  /** WZP-53: the customer gave an explicit yes to a quote they were shown, nothing changed, and the slot is still open. A request may be recorded. */
  request: boolean;
  cancelled: boolean;
}

const wordIn = (text: string, word: string): boolean => new RegExp(`(^|[^\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'iu').test(text);
const anyWord = (text: string, words: readonly string[]): boolean => words.some((w) => w.trim() !== '' && wordIn(text, w.trim()));

const PEOPLE = '(?:people|persons?|pax|guests?|adults?|pessoas?|personas?|personen|personnes?)';
/** "4 people", "for 4", "somos 4": the group size the message states, as a whole number. */
export function parsePartySize(text: string): number | null {
  const m = new RegExp(`\\b(\\d{1,3})\\s*${PEOPLE}\\b`, 'iu').exec(text) ?? /\b(?:for|para|pour|für|somos|we are|we're)\s+(\d{1,3})\b/iu.exec(text);
  return m ? Number(m[1]) : null;
}

export type FlowContext = QuoteContext & { config: BookingsConfig };

/** One turn. `prev` is the chat's stored state (null before the funnel starts); `read` is the read step's fields (empty when it found none or failed). */
export function step(prev: BookingState | null, read: ReadFields, text: string, ctx: FlowContext): Turn {
  // The brain spec clears a booking on a cancel word at the confirm stage; before a quote only the whole message being a cancel word does, so "no pets allowed?"
  // in the middle of a booking is a question. A request that was sent is the office's to cancel, never the funnel's.
  const out = prev?.stage === 'confirming' ? anyWord(text, ctx.config.cancelWords) : prev?.stage === 'collecting' && ctx.config.cancelWords.some((w) => text.trim().toLowerCase() === w.trim().toLowerCase());
  if (out) return { state: null, quote: null, request: false, cancelled: true };

  const service = resolveService(text, ctx.items) ?? (read.service !== undefined ? resolveService(read.service, ctx.items) : null);
  const partySize = parsePartySize(text) ?? (read.partySize !== undefined && Number.isInteger(read.partySize) && read.partySize >= 1 ? read.partySize : null);
  const date = parseDate(text, ctx.today) ?? (read.date !== undefined ? parseDate(read.date, ctx.today) : null);
  const named: Fields = { ...(service ? { service: service.name } : {}), ...(partySize !== null ? { partySize } : {}), ...(date ? { date } : {}) };
  const hasNew = Object.keys(named).length > 0;

  // A request that was sent stays as it is until the customer starts a new one by naming something.
  if (prev?.stage === 'requested' && !hasNew) return { state: prev, quote: null, request: false, cancelled: false };
  const base = prev && prev.stage !== 'requested' ? prev : null;
  const merged: Fields = {
    ...(named.service ?? base?.service ? { service: (named.service ?? base?.service)! } : {}),
    ...(named.partySize ?? base?.partySize ? { partySize: (named.partySize ?? base?.partySize)! } : {}),
    ...(named.date ?? base?.date ? { date: (named.date ?? base?.date)! } : {}),
  };
  if (Object.keys(merged).length === 0) return { state: prev, quote: null, request: false, cancelled: false };

  const quote = computeQuote(merged, ctx);
  const changed = (['service', 'partySize', 'date'] as const).some((k) => named[k] !== undefined && named[k] !== base?.[k]);
  const request = prev?.stage === 'confirming' && !changed && quote.kind === 'ok' && anyWord(text, ctx.config.confirmWords);
  const stage: Stage = request ? 'requested' : quote.kind === 'ok' ? 'confirming' : 'collecting';
  return { state: { stage, ...merged }, quote, request, cancelled: false };
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const money = (n: number, currency: string) => `${n} ${currency}`;
const dateLine = (iso: string) => `${iso} (${DAY_NAMES[weekdayOf(iso)]})`;

const REASONS: Record<string, (q: Extract<Quote, { kind: 'refused' }>) => string> = {
  past: () => 'that date has already passed',
  closed: () => 'that date is a closed date',
  not_running: (q) => `${q.service} does not run on that weekday`,
  full: (q) => `${q.service} is full that day (at most ${q.detail} people go)`,
  under_min: (q) => `${q.service} runs for at least ${q.detail} people`,
  over_max: (q) => `a booking request can have at most ${q.detail} people; for a larger group the team has to arrange it`,
  no_price: (q) => `the price of ${q.service} is not known to the bot, so the team has to quote it`,
};

/**
 * The facts the writer is given for this turn (docs/03 "the code's next step"): what is known, what the code computed, and what to do next. The
 * writer phrases them in the customer's language and may not change a figure. A per-person price is only ever given together with the total, and
 * the bot never says a day is available: the team confirms (docs/03). Empty when the funnel is not running, so an ordinary question is answered as before.
 */
export function conversationFacts(turn: Turn, ctx: FlowContext, ref?: string): string {
  const s = turn.state;
  if (turn.cancelled) return 'The customer cancelled the booking they were making: acknowledge briefly. Nothing was sent to the team.';
  if (!s) return '';
  const cur = ctx.config.currency;
  const lines: string[] = ['Booking in progress for this customer. These are computed by code: state them exactly and change none of them.'];
  if (s.service) lines.push(`- Service: ${s.service}`);
  if (s.partySize !== undefined) lines.push(`- People: ${s.partySize}`);
  if (s.date) lines.push(`- Date: ${dateLine(s.date)}`);
  const q = turn.quote;
  if (s.stage === 'requested') {
    lines.push(`- Request ${ref ?? s.ref ?? ''} was sent to the team for review.`);
    lines.push('Next: tell the customer the request was sent and that the team will confirm it. Say the reference. Never say the trip is booked, confirmed or reserved, and never say a day is available.');
    return lines.join('\n');
  }
  if (!q) return lines.join('\n');
  if (q.kind === 'need') {
    const asks = q.missing.map((m) => (m === 'service' ? 'which service (the services are in the offer)' : m === 'party_size' ? 'how many people (give no price until you know)' : 'which day they want it'));
    if (q.missing.includes('party_size')) lines.push('Rule: state no price yet.');
    lines.push(`Next: ask the customer ${asks.join(', then ')}. One question at a time.`);
  } else if (q.kind === 'refused') {
    lines.push(`- Not possible: ${REASONS[q.reason]!(q)}.`);
    lines.push(q.alternatives.length ? `Next: say so kindly and offer these dates, which the code checked run and are not closed: ${q.alternatives.map(dateLine).join(', ')}. The team confirms any day.` : 'Next: say so kindly and tell the customer the team will look for another option.');
  } else {
    lines.push(`- Total for the group: ${money(q.total, cur)} (${money(q.perPerson, cur)} per person × ${q.partySize}). Give the per-person price only together with this total.`);
    lines.push(`Rule: state the total ${q.total} whenever you state a per-person price.`);
    if (q.lastMinute) lines.push(`- Last minute: ${ctx.config.lastMinuteNote}`);
    lines.push('Next: give the total and ask whether they want the request sent to the team. The team confirms the day and the booking; never say it is booked, confirmed, reserved or available.');
  }
  return lines.join('\n');
}
