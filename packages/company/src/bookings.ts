import type { CyborgEvent, Proposal } from '@cyborg/core';
import { conversationFacts, READ_EVENT, READ_HANDLER_ID, RECORD_HANDLER_ID, REQUEST_EVENT, step, type BookingState, type BookingsConfig, type FlowContext, type ReadFields, type ServiceItem } from '@cyborg/module-bookings';
import { isPartner, listPartners, partnerFacts } from './partners.ts';
import type { Company } from './runtime.ts';

// feat WZP-50..56: the booking step of a customer turn, in the company layer where events are ordered. The handlers each make one call and know nothing of each
// other, so the order the brain spec asks for (read the message, let the code check and quote, then write the reply) is kept here: a read on its own event, the
// code's turn, a booking request when the customer said an explicit yes, and only then the ordinary message event with the computed facts attached.

const MODULE = 'bookings';
const LIVE: Proposal['status'][] = ['proposed', 'approved', 'applied'];

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const numbers = (v: unknown): number[] | undefined => (Array.isArray(v) && v.every(isNumber) ? (v as number[]) : undefined);

/** The offer's items as the booking code reads them, from the profile fact `offer.items`. */
function itemsOf(company: Company): ServiceItem[] {
  const value = company.store.getFact('offer.items')?.value;
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): ServiceItem[] => {
    const i = raw as Record<string, unknown>;
    if (typeof i['name'] !== 'string' || i['name'].trim() === '') return [];
    const days = numbers(i['days']);
    return [{
      name: i['name'],
      ...(isNumber(i['price']) ? { price: i['price'] } : {}),
      ...(isNumber(i['capacity']) ? { capacity: i['capacity'] } : {}),
      ...(isNumber(i['minGroup']) ? { minGroup: i['minGroup'] } : {}),
      ...(days ? { days } : {}),
      ...(Array.isArray(i['keywords']) ? { keywords: (i['keywords'] as unknown[]).filter((k): k is string => typeof k === 'string') } : {}),
    }];
  });
}

const field = (p: Proposal, name: string): unknown => p.changes.find((c) => c.field === name)?.newValue;
const requests = (company: Company): Proposal[] => company.store.list({ handlerId: RECORD_HANDLER_ID }).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

/** The reference a booking request goes by, from its place among all the requests ever made: B-000001. */
export function bookingRef(company: Company, proposalId: string): string {
  const n = requests(company).findIndex((p) => p.id === proposalId) + 1;
  return `B-${String(n).padStart(6, '0')}`;
}

export interface BookingRequest {
  id: string;
  ref: string;
  chat: string;
  name: string | null;
  service: string;
  partySize: number;
  date: string;
  total: string;
  status: Proposal['status'];
  createdAt: string;
}

/** WZP-54: every booking request, newest first. */
export function listBookings(company: Company): BookingRequest[] {
  return requests(company)
    .map((p, i) => {
      const code = company.store.getContact(p.subject);
      const full = code ? company.vault.get(code)?.value ?? null : null;
      return {
        id: p.id, ref: `B-${String(i + 1).padStart(6, '0')}`, chat: p.subject, name: full ? (full.trim().split(/\s+/)[0] ?? null) : null,
        service: String(field(p, 'service') ?? ''), partySize: Number(field(p, 'party_size') ?? 0), date: String(field(p, 'date') ?? ''), total: String(field(p, 'total') ?? ''),
        status: p.status, createdAt: p.createdAt,
      };
    })
    .reverse();
}

/**
 * WZP-52: a person confirms or declines a booking request. Nothing is booked until they approve it (HR-1), and nothing is sent to the customer from here:
 * in shadow mode the status message is the office's to send as always.
 */
export function decideBooking(company: Company, id: string, decision: 'approve' | 'decline', by: string, note?: string): Proposal {
  if (!requests(company).some((p) => p.id === id)) throw new Error('that is not a booking request');
  return company.decide(id, decision, by, note ? { note } : {});
}

export interface BookingOptions {
  config: BookingsConfig;
  commandPrefix: string;
  /** The business's timezone, so "today" is the business's day. UTC when absent. */
  timezone?: string;
  now?: () => Date;
}

const localDate = (now: Date, timezone?: string): string => new Intl.DateTimeFormat('en-CA', { timeZone: timezone ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function withBookings(company: Company, options: BookingOptions): Company {
  if (!company.registry.get(READ_HANDLER_ID)) return company;
  const now = options.now ?? (() => new Date());

  const context = (today: string): FlowContext => {
    const availability = (company.store.getFact('offer.availability')?.value ?? {}) as { days?: unknown; closedDates?: unknown };
    const live = requests(company).filter((p) => LIVE.includes(p.status));
    return {
      items: itemsOf(company),
      availability: { ...(numbers(availability.days) ? { days: numbers(availability.days)! } : {}), ...(Array.isArray(availability.closedDates) ? { closedDates: (availability.closedDates as unknown[]).filter((d): d is string => typeof d === 'string') } : {}) },
      today,
      taken: (service, date) => live.filter((p) => field(p, 'service') === service && field(p, 'date') === date).reduce((n, p) => n + Number(field(p, 'party_size') ?? 0), 0),
      config: options.config,
    };
  };

  return {
    ...company,
    async process(event: CyborgEvent) {
      const p = event.payload;
      const text = typeof p['text'] === 'string' ? p['text'] : '';
      const chat = typeof p['chat'] === 'string' ? p['chat'] : '';
      const eligible =
        event.kind === 'message.received' && text.trim() !== '' && p['media'] === undefined && p['addressed'] !== false && !text.startsWith(options.commandPrefix) &&
        company.store.getRole(chat) === 'reply' && company.store.getChatState(chat) === 'bot' && !company.store.getGlobalStop();
      if (!eligible) return company.process(event);

      const at = now();
      const today = localDate(at, options.timezone);
      const ctx = context(today);
      const prev = company.store.getModuleState<BookingState | null>(MODULE, chat)?.value ?? null;

      // 1. The read: what the message says about the booking. A refusal (call cap, credential) or an invalid answer leaves it empty: the code still reads the dates and group sizes itself.
      const known = prev ? [prev.service && `service ${prev.service}`, prev.partySize !== undefined && `people ${prev.partySize}`, prev.date && `date ${prev.date}`].filter(Boolean).join('; ') : '';
      const outcomes = await company.runner.handle({
        id: `${event.id}~read`, source: event.source, kind: READ_EVENT, at: event.at,
        payload: { chat, text, sender: p['sender'], today: `${today} (${WEEKDAY[new Date(`${today}T12:00:00Z`).getUTCDay()]})`, known: known || 'nothing yet' },
      });
      const read: ReadFields = {};
      for (const o of outcomes) {
        if (o.outcome !== 'proposal' || o.handlerId !== READ_HANDLER_ID || o.proposal.status !== 'proposed') continue;
        for (const c of o.proposal.changes) {
          if (c.field === 'service') read.service = String(c.newValue);
          else if (c.field === 'party_size') read.partySize = Number(c.newValue);
          else if (c.field === 'date') read.date = String(c.newValue);
        }
        // The read is the bot's working note, not a business record: it is settled at once so it never waits for a person.
        try { company.decide(o.proposal.id, 'approve', 'bookings:read'); } catch { /* already settled */ }
      }

      // 2. The code's turn: merge, check, quote, and whether the customer made an explicit yes.
      const turn = step(prev, read, text, ctx);
      let ref: string | undefined;
      if (turn.request && turn.quote?.kind === 'ok') {
        const q = turn.quote;
        const made = await company.runner.handle({
          id: `${event.id}~request`, source: event.source, kind: REQUEST_EVENT, at: event.at,
          payload: { chat, service: q.service, partySize: q.partySize, date: q.date, perPerson: q.perPerson, total: q.total, currency: options.config.currency },
        });
        const proposal = made.flatMap((o) => (o.outcome === 'proposal' && o.handlerId === RECORD_HANDLER_ID ? [o.proposal] : []))[0];
        if (proposal) ref = bookingRef(company, proposal.id);
        if (turn.state && ref) turn.state.ref = ref;
      }
      if (JSON.stringify(turn.state) !== JSON.stringify(prev)) company.store.setModuleState(MODULE, chat, turn.state, 'bookings:state', at.toISOString());

      // 3. The reply, with what the code computed.
      // A partner chat is never quoted a price: the code states the rule and the reply check blocks any amount (WZP-61).
      const computed = conversationFacts(turn, ctx, ref);
      const partner = isPartner(company, chat) ? listPartners(company).find((x) => x.chat === chat) : undefined;
      const conversation = partner ? partnerFacts(partner.name, computed) : computed;
      return company.process({ ...event, payload: { ...p, conversation } });
    },
  };
}
