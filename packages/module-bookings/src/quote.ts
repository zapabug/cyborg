import { addDays, daysBetween, isIso, monthDay, weekdayOf } from './dates.ts';
import type { BookingsConfig } from './config.ts';

// feat WZP-51: the code's side of the funnel: which service, how many, which day, and what it costs. Prices, totals, running days, closed dates and
// capacity are computed here from the business profile and handed to the writer as facts; the model may not change them (the brain spec: "Code owns").

export interface ServiceItem {
  name: string;
  price?: number;
  /** The most people on one departure. */
  capacity?: number;
  /** The fewest people the service runs for. */
  minGroup?: number;
  /** Weekdays it runs (0 = Sunday). Empty: any day. Absent: the business-wide days apply. */
  days?: number[];
  keywords?: string[];
}

export interface Availability {
  days?: number[];
  closedDates?: string[];
}

export interface Fields {
  service?: string;
  partySize?: number;
  date?: string;
}

export type Missing = 'service' | 'party_size' | 'date';
export type Refusal = 'past' | 'closed' | 'not_running' | 'full' | 'under_min' | 'over_max' | 'no_price';

export type Quote =
  | { kind: 'need'; missing: Missing[] }
  | { kind: 'refused'; reason: Refusal; service: string; partySize: number; date: string; alternatives: string[]; detail?: number }
  | { kind: 'ok'; service: string; partySize: number; date: string; perPerson: number; total: number; lastMinute: boolean };

const wordIn = (text: string, word: string): boolean => new RegExp(`(^|[^\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'iu').test(text);

/** The item a name or a keyword in `text` points at; the first match in the order of the profile. Null when none. */
export function resolveService(text: string, items: readonly ServiceItem[]): ServiceItem | null {
  return items.find((i) => [i.name, ...(i.keywords ?? [])].some((w) => w.trim() !== '' && wordIn(text, w.trim()))) ?? null;
}

const runsOn = (item: ServiceItem, availability: Availability, date: string): boolean => {
  const days = item.days ?? availability.days ?? null;
  return days === null || days.length === 0 || days.includes(weekdayOf(date));
};
const isClosed = (availability: Availability, date: string): boolean => (availability.closedDates ?? []).includes(monthDay(date));

export interface QuoteContext {
  items: readonly ServiceItem[];
  availability: Availability;
  today: string;
  /** How many people are already requested or confirmed on that service and day (the bot's own count; it has no availability data, docs/03). */
  taken: (service: string, date: string) => number;
  config: Pick<BookingsConfig, 'lastMinuteDays' | 'alternativeDaysAhead' | 'maxGroup'>;
}

/**
 * Open days to offer: the days from tomorrow within the look-ahead window that the service runs, are not closed and have room for the group, the three
 * closest to the day the customer asked for (nearer first, the earlier one on a tie), in date order.
 */
function alternatives(item: ServiceItem, size: number, asked: string, ctx: QuoteContext): string[] {
  const open: string[] = [];
  for (let i = 1; i <= ctx.config.alternativeDaysAhead; i++) {
    const day = addDays(ctx.today, i);
    if (runsOn(item, ctx.availability, day) && !isClosed(ctx.availability, day) && (item.capacity === undefined || ctx.taken(item.name, day) + size <= item.capacity)) open.push(day);
  }
  return open
    .sort((a, b) => Math.abs(daysBetween(asked, a)) - Math.abs(daysBetween(asked, b)) || a.localeCompare(b))
    .slice(0, 3)
    .sort();
}

export function computeQuote(fields: Fields, ctx: QuoteContext): Quote {
  const missing: Missing[] = [];
  const item = fields.service === undefined ? null : ctx.items.find((i) => i.name === fields.service) ?? null;
  if (!item) missing.push('service');
  if (fields.partySize === undefined) missing.push('party_size');
  if (fields.date === undefined) missing.push('date');
  if (missing.length > 0 || !item || fields.partySize === undefined || fields.date === undefined) return { kind: 'need', missing };

  const { partySize: size, date } = fields;
  const base = { service: item.name, partySize: size, date };
  const refuse = (reason: Refusal, detail?: number): Quote => ({ kind: 'refused', reason, ...base, alternatives: alternatives(item, size, date, ctx), ...(detail !== undefined ? { detail } : {}) });
  if (!isIso(date) || date < ctx.today) return refuse('past');
  if (size > ctx.config.maxGroup) return { kind: 'refused', reason: 'over_max', ...base, alternatives: [], detail: ctx.config.maxGroup };
  if (item.minGroup !== undefined && size < item.minGroup) return { kind: 'refused', reason: 'under_min', ...base, alternatives: [], detail: item.minGroup };
  if (isClosed(ctx.availability, date)) return refuse('closed');
  if (!runsOn(item, ctx.availability, date)) return refuse('not_running');
  if (item.capacity !== undefined && ctx.taken(item.name, date) + size > item.capacity) return refuse('full', item.capacity);
  if (typeof item.price !== 'number') return { kind: 'refused', reason: 'no_price', ...base, alternatives: [] };
  return { kind: 'ok', ...base, perPerson: item.price, total: item.price * size, lastMinute: daysBetween(ctx.today, date) <= ctx.config.lastMinuteDays };
}
