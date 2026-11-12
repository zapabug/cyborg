import { randomInt } from 'node:crypto';
import { cancellationText, NOTICE_EVENT, NOTICE_HANDLER_ID, parseDate, reminderText, type BookingsConfig } from '@cyborg/module-bookings';
import { listBookings, type BookingRequest } from './bookings.ts';
import type { Company } from './runtime.ts';

// feat WZP-63: the booking records' own schedule: the evening-before reminder and cancelling a service day. Both make drafts for a person to send; nothing is sent from
// here (HR-8). The adapter calls `runReminders` on a timer; cancelling a day is a person's two-step command.

const MODULE = 'bookings';
const day = (iso: string, n: number): string => new Date(new Date(`${iso}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const localDate = (now: Date, tz?: string): string => new Intl.DateTimeFormat('en-CA', { timeZone: tz ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const localTime = (now: Date, tz?: string): string => new Intl.DateTimeFormat('en-GB', { timeZone: tz ?? 'UTC', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);

export interface ScheduleOptions {
  config: BookingsConfig;
  timezone?: string;
  now?: () => Date;
}

const noticeFor = async (company: Company, chat: string, kind: 'reminder' | 'cancellation', text: string, id: string, at: string): Promise<boolean> => {
  company.store.linkEvent('bookings', id, chat, at);
  const outcomes = await company.runner.handle({ id, source: 'bookings', kind: NOTICE_EVENT, at, payload: { chat, kind, text } });
  return outcomes.some((o) => o.handlerId === NOTICE_HANDLER_ID && o.outcome === 'proposal');
};

/** The note the office gave when it confirmed the booking, as written (wazaa's `team_note`). */
function confirmNote(company: Company, id: string): string | undefined {
  const row = company.store.listAudit(id).filter((r) => r.toStatus === 'approved').at(-1);
  const note = (row?.detail as { note?: unknown } | undefined)?.note;
  return typeof note === 'string' ? note : undefined;
}

export interface ReminderRun {
  /** Booking references a reminder draft was made for. */
  drafted: string[];
  /** Left out because the customer has a booking today: tomorrow's is covered (back-to-back days). */
  covered: string[];
  /** Not made: the chat is stopped or the bot is stopped everywhere. Tried again at the next run. */
  blocked: { ref: string; why: string }[];
}

/**
 * WZP-63: one reminder draft for each confirmed booking whose service is tomorrow, from the configured time until midnight, at most once per booking and across
 * restarts. A customer with a booking today gets none for tomorrow's; the reminder before the first of several consecutive days names the following days.
 */
export async function runReminders(company: Company, options: ScheduleOptions): Promise<ReminderRun> {
  const out: ReminderRun = { drafted: [], covered: [], blocked: [] };
  const reminders = options.config.reminders;
  if (!reminders) return out;
  const now = (options.now ?? (() => new Date()))();
  if (localTime(now, options.timezone) < reminders.sendAt) return out;
  const today = localDate(now, options.timezone);
  const tomorrow = day(today, 1);
  const confirmed = listBookings(company).filter((b) => b.status === 'approved');
  const at = now.toISOString();
  for (const b of confirmed.filter((x) => x.date === tomorrow).reverse()) {
    if (company.store.getModuleState(MODULE, `reminded:${b.id}`)) continue;
    if (confirmed.some((x) => x.chat === b.chat && x.date === today)) {
      company.store.setModuleState(MODULE, `reminded:${b.id}`, { covered: true }, 'bookings:reminders', at);
      out.covered.push(b.ref);
      continue;
    }
    if (company.store.getGlobalStop()) { out.blocked.push({ ref: b.ref, why: 'the bot is stopped everywhere' }); continue; }
    const state = company.store.getChatState(b.chat);
    if (state !== 'bot') { out.blocked.push({ ref: b.ref, why: `the chat is ${state === 'handoff' ? 'with a person' : state}` }); continue; }
    const following: BookingRequest[] = [];
    for (let d = day(tomorrow, 1); ; d = day(d, 1)) {
      const next = confirmed.find((x) => x.chat === b.chat && x.date === d);
      if (!next) break;
      following.push(next);
      company.store.setModuleState(MODULE, `reminded:${next.id}`, { coveredBy: b.ref }, 'bookings:reminders', at);
    }
    const note = confirmNote(company, b.id);
    const text = reminderText(reminders.message, b, { ...(note ? { note } : {}), following });
    if (await noticeFor(company, b.chat, 'reminder', text, `reminder-${b.id}`, at)) {
      company.store.setModuleState(MODULE, `reminded:${b.id}`, { at }, 'bookings:reminders', at);
      out.drafted.push(b.ref);
    }
  }
  return out;
}

interface Pending {
  code: string;
  date: string;
  service: string | null;
  reason: string;
  ids: string[];
  expiresAt: string;
}

export interface CancelPreview {
  code: string;
  date: string;
  refs: string[];
  expiresAt: string;
}

/**
 * WZP-63: step one of cancelling a service day: which bookings (requested and confirmed) would be cancelled, and a code. Nothing happens until the code is given
 * back within the preview's time, so a typo never messages customers. `service` null is every service that day.
 */
export function previewCancelDay(company: Company, input: { date: string; service: string | null; reason: string; by: string }, options: ScheduleOptions & { code?: () => string }): CancelPreview {
  const cancellations = options.config.cancellations;
  if (!cancellations) throw new Error('cancelling a day is not switched on for this company');
  const now = (options.now ?? (() => new Date()))();
  const date = parseDate(input.date, localDate(now, options.timezone));
  if (!date) throw new Error('give the day as YYYY-MM-DD or DD/MM, not in the past');
  if (input.reason.trim() === '') throw new Error('give the reason');
  const serviceName = input.service === null ? null : listBookings(company).find((b) => b.service.toLowerCase() === input.service!.toLowerCase())?.service ?? input.service;
  const hit = listBookings(company).filter((b) => b.date === date && (b.status === 'proposed' || b.status === 'approved') && (serviceName === null || b.service.toLowerCase() === serviceName.toLowerCase()));
  if (hit.length === 0) throw new Error('there are no bookings that day');
  const code = options.code ? options.code() : String(randomInt(1000, 10_000)) /* N-24 */;
  const expiresAt = new Date(now.getTime() + cancellations.previewMinutes * 60_000).toISOString();
  const pending: Pending = { code, date, service: serviceName, reason: input.reason.trim(), ids: hit.map((b) => b.id).reverse(), expiresAt };
  company.store.setModuleState(MODULE, 'cancel-pending', pending, input.by, now.toISOString());
  return { code, date, refs: hit.map((b) => b.ref).reverse(), expiresAt };
}

export interface CancelRun {
  cancelled: string[];
  /** Cancelled, but no notice was drafted: the chat is stopped, or the bot is stopped everywhere. */
  notTold: { ref: string; why: string }[];
}

/** WZP-63: step two. A confirmed booking is applied and then reverted (cancelled); a requested one is declined; each customer gets a notice draft. */
export async function confirmCancelDay(company: Company, input: { code: string; by: string }, options: ScheduleOptions): Promise<CancelRun> {
  const cancellations = options.config.cancellations;
  if (!cancellations) throw new Error('cancelling a day is not switched on for this company');
  const now = (options.now ?? (() => new Date()))();
  const pending = company.store.getModuleState<Pending | null>(MODULE, 'cancel-pending')?.value ?? null;
  if (!pending) throw new Error('there is nothing to confirm: start with the day, the service and the reason');
  if (pending.expiresAt < now.toISOString()) {
    company.store.setModuleState(MODULE, 'cancel-pending', null, input.by, now.toISOString());
    throw new Error('that preview has expired: start again');
  }
  if (pending.code !== input.code.trim()) throw new Error('that is not the code of the preview');
  const at = now.toISOString();
  const out: CancelRun = { cancelled: [], notTold: [] };
  const byId = new Map(listBookings(company).map((b) => [b.id, b]));
  for (const id of pending.ids) {
    const b = byId.get(id);
    if (!b || (b.status !== 'proposed' && b.status !== 'approved')) continue;
    if (b.status === 'proposed') company.decide(id, 'decline', input.by, { note: `day cancelled: ${pending.reason}`.slice(0, 200) });
    else {
      company.store.transition(id, 'applied', { actor: input.by, at, detail: { why: 'day cancelled' } });
      company.store.transition(id, 'reverted', { actor: input.by, at, detail: { why: pending.reason } });
    }
    out.cancelled.push(b.ref);
    if (company.store.getGlobalStop()) { out.notTold.push({ ref: b.ref, why: 'the bot is stopped everywhere' }); continue; }
    if (company.store.getChatState(b.chat) === 'stopped') { out.notTold.push({ ref: b.ref, why: 'the chat is stopped' }); continue; }
    await noticeFor(company, b.chat, 'cancellation', cancellationText(cancellations.message, b, pending.reason), `cancel-${b.id}`, at);
  }
  company.store.setModuleState(MODULE, 'cancel-pending', null, input.by, at);
  return out;
}
