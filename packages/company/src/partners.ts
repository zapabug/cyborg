import type { Company } from './runtime.ts';
import { listBookings } from './bookings.ts';

// feat WZP-61: partner chats (hotel desks, agencies, resellers): a chat that writes again and again, each time for a different guest. The registry says which chats are
// partners and what their name and default pick-up are; the account says what went ahead for each, per month. In a partner chat the bot never quotes a price: the
// office confirms rates, commission and money (wazaa docs/16 §4), and the code holds it to that.

const MODULE = 'partners';

export interface Partner {
  chat: string;
  name: string;
  pickup: string | null;
  addedAt: string;
}

type Stored = { name: string; pickup: string | null; addedAt: string } | null;

export function addPartner(company: Company, chat: string, name: string, pickup: string | null, by: string): Partner {
  const n = name.trim();
  if (chat.trim() === '') throw new Error('which chat?');
  if (n === '' || n.length > 80) throw new Error('give the partner a name of up to 80 characters');
  const p = pickup?.trim() ?? '';
  if (p.length > 120) throw new Error('the default pick-up is at most 120 characters');
  const addedAt = new Date().toISOString();
  company.store.setModuleState(MODULE, chat, { name: n, pickup: p === '' ? null : p, addedAt } satisfies Stored, by, addedAt);
  return { chat, name: n, pickup: p === '' ? null : p, addedAt };
}

export function removePartner(company: Company, chat: string, by: string): void {
  if (!isPartner(company, chat)) throw new Error('that chat is not a partner');
  company.store.setModuleState(MODULE, chat, null, by, new Date().toISOString());
}

export function isPartner(company: Company, chat: string): boolean {
  return company.store.getModuleState<Stored>(MODULE, chat)?.value != null;
}

export function listPartners(company: Company): Partner[] {
  return company.store
    .listModuleState<Stored>(MODULE)
    .flatMap(({ key, record }) => (record.value ? [{ chat: key, ...record.value }] : []))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface PartnerAccount {
  month: string;
  rows: { ref: string; service: string; date: string; people: number }[];
  bookings: number;
  people: number;
}

/** The bookings that went ahead (confirmed, not cancelled) for a partner in a month (YYYY-MM): each one's service, day and people, and the totals. */
export function partnerAccount(company: Company, chat: string, month: string): PartnerAccount {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('give the month as YYYY-MM');
  if (!isPartner(company, chat)) throw new Error('that chat is not a partner');
  const rows = listBookings(company)
    .filter((b) => b.chat === chat && (b.status === 'approved' || b.status === 'applied') && b.date.startsWith(month))
    .map((b) => ({ ref: b.ref, service: b.service, date: b.date, people: b.partySize }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { month, rows, bookings: rows.length, people: rows.reduce((n, r) => n + r.people, 0) };
}

/** What the writer is told in a partner chat: who it is talking to, and the rule that no price is ever stated (the code blocks any amount that appears). */
export function partnerFacts(name: string, computed: string): string {
  const kept = computed.split('\n').filter((l) => !/Total for the group|^Rule: state the total|Last minute:|per-person price/.test(l));
  return [
    `This chat is the partner "${name}": a desk that writes for guests of its own, one after another. Keep it short. Never state a price, a rate, a commission or a payment policy; say the office will confirm. Count the people and pass the request on.`,
    'Rule: state no price yet.',
    ...kept,
  ].join('\n');
}
