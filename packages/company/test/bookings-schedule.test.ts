import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { CapabilityResult } from '@cyborg/core';
import { ScriptedModel } from '@cyborg/core/testing';
import { confirmCancelDay, createCompany, decideBooking, listBookings, loadCompanyConfig, previewCancelDay, runReminders, seedProfile, type Company } from '../src/index.ts';

// feat-wazaa-port W7, WZP-63: the evening-before reminder and cancelling a tour day, as drafts. No model anywhere. Today is Thursday 2026-11-05, 19:00 UTC.

const AT = '2026-11-05T19:00:00.000Z';
const capability: CapabilityResult = { baseUrl: 'http://127.0.0.1:1/v1', model: 'm', level: 'strict_schema', requestShape: 'json_schema_wrapped', logprobs: false, testedAt: AT, attempts: [] };
const BOOKINGS = {
  confirmWords: ['yes'], cancelWords: ['cancel'], lastMinuteDays: 1, lastMinuteNote: 'Last minute.', alternativeDaysAhead: 14, maxGroup: 200, currency: 'EUR',
  reminders: { sendAt: '18:00', message: 'A reminder from Test Tours about your tour tomorrow.' },
  cancellations: { previewMinutes: 30, message: 'We are sorry: your tour is cancelled.' },
};
const FACTS = { profile: { 'business.name': 'T', 'tone.style': 'x', 'offer.items': [{ name: 'West Tour', price: 35 }, { name: 'East Tour', price: 45 }], 'offer.availability': { days: [0, 1, 2, 3, 4, 5, 6], closedDates: [] }, 'rules.commitments': ['x'], 'faq.entries': [{ q: 'a', a: 'b' }] } };

async function withCompany<T>(work: (company: Company, config: typeof BOOKINGS) => Promise<T>, cfg: unknown = BOOKINGS): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'cyborg-sch-'));
  const file = join(dir, 'c.json');
  writeFileSync(file, JSON.stringify({
    id: 'sch', name: 'Sch', language: 'en', store: { path: 's.sqlite', vaultPath: 'v.sqlite' }, inference: { baseUrl: 'http://127.0.0.1:1/v1', model: 'm' },
    chat: { authorisedSenders: ['owner'], originChannel: 'origin', roles: { a: 'reply', b: 'reply', c: 'reply', 'ops-1': 'ops' } },
    modules: { sales: { enquiryFields: [{ name: 'service', description: 'x' }], conversationContext: true }, bookings: cfg, enabledHandlers: { sales: ['sales.enquiry.intake', 'sales.enquiry.reply_draft', 'sales.handoff.card'] } },
  }));
  const sink = (channel: string) => ({ channel, send: async () => undefined });
  const model = new ScriptedModel([]);
  const company = createCompany(loadCompanyConfig(file), { ack: sink('gate-ack'), review: sink('gate-review') }, { model, capabilities: [capability], now: () => new Date(AT), beforeLoad: (s) => void seedProfile(s, FACTS, AT) });
  try {
    const out = await work(company, BOOKINGS);
    assert.equal(model.calls.length, 0, 'no model call anywhere in this path');
    return out;
  } finally {
    company.close();
    rmSync(dir, { recursive: true });
  }
}

let n = 0;
/** A booking request the way the funnel records it, optionally confirmed by the office with a note. */
async function book(company: Company, chat: string, service: string, date: string, people: number, confirm?: string | true): Promise<string> {
  const outcomes = await company.runner.handle({ id: `b${++n}`, source: 'test', kind: 'booking.request', at: AT, payload: { chat, service, partySize: people, date, perPerson: 35, total: 35 * people, currency: 'EUR' } });
  const proposal = outcomes.flatMap((o) => (o.outcome === 'proposal' ? [o.proposal] : []))[0]!;
  if (confirm !== undefined) decideBooking(company, proposal.id, 'approve', 'office', confirm === true ? undefined : confirm);
  return proposal.id;
}
const notices = (company: Company) => company.store.list({ handlerId: 'bookings.notice.draft' });
const at = (time: string) => () => new Date(`2026-11-05T${time}:00.000Z`);

test('WZP-63: a confirmed booking for tomorrow gets one reminder draft from the set time, with the office\'s note as written; once, and never before the time or for an unconfirmed one', async () => {
  await withCompany(async (company, config) => {
    await book(company, 'a', 'West Tour', '2026-11-06', 4, 'pick-up 08:50 at the hotel');
    await book(company, 'b', 'East Tour', '2026-11-06', 2);
    await book(company, 'c', 'East Tour', '2026-11-07', 2, true);
    assert.deepEqual((await runReminders(company, { config, now: at('17:59') })).drafted, [], 'not before 18:00');
    const run = await runReminders(company, { config, now: at('18:00') });
    assert.deepEqual(run.drafted, ['B-000001'], 'only the confirmed booking for tomorrow');
    const [draft] = notices(company);
    assert.equal(draft!.subject, 'a');
    assert.equal(draft!.draft, 'A reminder from Test Tours about your tour tomorrow.\nB-000001: West Tour, 2026-11-06, 4 people.\npick-up 08:50 at the hotel');
    assert.deepEqual((await runReminders(company, { config, now: at('18:15') })).drafted, [], 'at most once per booking');
    assert.equal(notices(company).length, 1);
    assert.equal(listBookings(company).find((b) => b.ref === 'B-000001')!.status, 'approved', 'a reminder changes nothing about the booking');
  });
});

test('WZP-63: back-to-back days: a customer on a tour today gets no reminder for tomorrow, and the first of several days names the next', async () => {
  await withCompany(async (company, config) => {
    await book(company, 'a', 'West Tour', '2026-11-05', 2, true);
    await book(company, 'a', 'East Tour', '2026-11-06', 2, true);
    await book(company, 'b', 'West Tour', '2026-11-06', 3, true);
    await book(company, 'b', 'East Tour', '2026-11-07', 3, true);
    const run = await runReminders(company, { config, now: at('18:30') });
    assert.deepEqual(run.covered, ['B-000002']);
    assert.deepEqual(run.drafted, ['B-000003']);
    const text = notices(company).find((p) => p.subject === 'b')!.draft!;
    assert.match(text, /B-000003: West Tour, 2026-11-06, 3 people\./);
    assert.match(text, /Then: East Tour, 2026-11-07 \(B-000004\)\./);
    assert.equal(notices(company).filter((p) => p.subject === 'a').length, 0);
  });
});

test('WZP-63: a chat a person holds, or a bot stopped everywhere, is not reminded; the next run tries again', async () => {
  await withCompany(async (company, config) => {
    await book(company, 'a', 'West Tour', '2026-11-06', 2, true);
    company.store.setChatState('a', 'handoff', 'office', AT);
    const first = await runReminders(company, { config, now: at('18:30') });
    assert.deepEqual([first.drafted, first.blocked], [[], [{ ref: 'B-000001', why: 'the chat is with a person' }]]);
    company.store.setChatState('a', 'bot', 'office', AT);
    company.store.setGlobalStop(true, 'office', AT);
    assert.equal((await runReminders(company, { config, now: at('18:40') })).blocked[0]!.why, 'the bot is stopped everywhere');
    company.store.setGlobalStop(false, 'office', AT);
    assert.deepEqual((await runReminders(company, { config, now: at('18:50') })).drafted, ['B-000001']);
  });
});

test('WZP-63: cancelling a tour day is two steps: a preview with a code, then the code within the time; the booking states, the notices and the capacity follow', async () => {
  await withCompany(async (company, config) => {
    await book(company, 'a', 'West Tour', '2026-11-12', 4, true);
    await book(company, 'b', 'West Tour', '2026-11-12', 2);
    await book(company, 'c', 'East Tour', '2026-11-12', 2, true);
    const opts = { config, now: at('10:00'), code: () => '4821' };
    await assert.rejects(confirmCancelDay(company, { code: '4821', by: 'office' }, opts), /nothing to confirm/);
    const preview = previewCancelDay(company, { date: '12/11', service: 'west tour', reason: 'road closed by civil protection', by: 'office' }, opts);
    assert.deepEqual([preview.code, preview.date, preview.refs], ['4821', '2026-11-12', ['B-000001', 'B-000002']], 'only the West Tour that day');
    assert.equal(notices(company).length, 0, 'a preview sends and changes nothing');
    await assert.rejects(confirmCancelDay(company, { code: '0000', by: 'office' }, opts), /not the code of the preview/);
    await assert.rejects(confirmCancelDay(company, { code: '4821', by: 'office' }, { ...opts, now: at('10:31') }), /expired/);
    previewCancelDay(company, { date: '2026-11-12', service: 'West Tour', reason: 'road closed', by: 'office' }, opts);
    company.store.setChatState('b', 'stopped', 'office', AT);
    const run = await confirmCancelDay(company, { code: '4821', by: 'office' }, opts);
    assert.deepEqual(run.cancelled, ['B-000001', 'B-000002']);
    assert.deepEqual(run.notTold, [{ ref: 'B-000002', why: 'the chat is stopped' }]);
    const status = Object.fromEntries(listBookings(company).map((b) => [b.ref, b.status]));
    assert.deepEqual(status, { 'B-000001': 'reverted', 'B-000002': 'declined', 'B-000003': 'approved' }, 'a confirmed one is reverted, a requested one declined, the other tour untouched');
    const [a] = notices(company);
    assert.equal(a!.subject, 'a');
    assert.equal(a!.draft, 'We are sorry: your tour is cancelled.\nB-000001: West Tour, 2026-11-12, 4 people is cancelled.\nReason: road closed');
    assert.equal(notices(company).length, 1, 'the stopped chat is not told');
    await assert.rejects(confirmCancelDay(company, { code: '4821', by: 'office' }, opts), /nothing to confirm/);
  });
});

test('WZP-63: cancelling a day needs a real day with bookings and a reason, every tour with no tour named, and the feature switched on', async () => {
  await withCompany(async (company, config) => {
    await book(company, 'a', 'West Tour', '2026-11-12', 1, true);
    await book(company, 'b', 'East Tour', '2026-11-12', 1, true);
    const opts = { config, now: at('10:00'), code: () => '1111' };
    assert.throws(() => previewCancelDay(company, { date: 'someday', service: null, reason: 'x', by: 'o' }, opts), /YYYY-MM-DD or DD\/MM/);
    assert.throws(() => previewCancelDay(company, { date: '2026-11-13', service: null, reason: 'x', by: 'o' }, opts), /no bookings that day/);
    assert.throws(() => previewCancelDay(company, { date: '2026-11-12', service: null, reason: ' ', by: 'o' }, opts), /give the reason/);
    assert.deepEqual(previewCancelDay(company, { date: '2026-11-12', service: null, reason: 'storm', by: 'o' }, opts).refs, ['B-000001', 'B-000002']);
    const { reminders: _r, cancellations: _c, ...plain } = config;
    assert.throws(() => previewCancelDay(company, { date: '2026-11-12', service: null, reason: 'x', by: 'o' }, { ...opts, config: plain }), /not switched on/);
    assert.deepEqual(await runReminders(company, { config: plain, now: at('19:00') }), { drafted: [], covered: [], blocked: [] });
  });
});

test('WZP-48, WZP-63: the office cancels a day with .cancel <day> <tour>: <reason> and then .cancel ok <code> (.cancelar in Portuguese); it is off when not switched on', async () => {
  const { withDeskCommands } = await import('../src/index.ts');
  await withCompany(async (company, config) => {
    await book(company, 'a', 'West Tour', '2026-11-12', 4, true);
    await book(company, 'b', 'East Tour', '2026-11-12', 2, true);
    const acks: string[] = [];
    const commands = withDeskCommands(company, { commandPrefix: '.', authorisedSenders: ['owner'], ack: { channel: 'ops-ack', send: async (m) => void acks.push(m.text) }, bookings: { config, now: at('10:00') } });
    const office = async (text: string) => { await commands.process({ id: `o${acks.length}`, source: 'test', kind: 'message.received', at: AT, payload: { chat: 'ops-1', isGroup: false, addressed: true, sender: 'owner', text } }); return acks.at(-1)!; };
    await office('.lang en');
    assert.match(await office('.cancel'), /Use: \.cancel <day/);
    assert.match(await office('.cancel 13/11 all: storm'), /There are no bookings that day|no bookings that day/);
    const preview = await office('.cancel 12/11 west tour: storm');
    const code = /\.cancel ok (\d{4})/.exec(preview)![1]!;
    assert.match(preview, /Cancel 2026-11-12: 1 booking\(s\): B-000001\. To go ahead: \.cancel ok \d{4} \(valid until 10:30\)\./);
    assert.match(await office('.cancel ok 0000'), /not the code of the preview/);
    assert.match(await office(`.cancel ok ${code}`), /^Cancelled: B-000001\. Notices drafted for a person to send\.$/);
    assert.equal(listBookings(company).find((b) => b.ref === 'B-000001')!.status, 'reverted');
    assert.equal(listBookings(company).find((b) => b.ref === 'B-000002')!.status, 'approved', 'the other tour is untouched');
    assert.equal(notices(company).length, 1);
    await office('.lang pt');
    assert.match(await office('.cancelar 12/11 todos: tempestade'), /Para enviar: \.cancelar ok \d{4}/);
    const off = withDeskCommands(company, { commandPrefix: '.', authorisedSenders: ['owner'], ack: { channel: 'x', send: async (m) => void acks.push(m.text) } });
    const before = acks.length;
    await off.process({ id: 'z', source: 'test', kind: 'message.received', at: AT, payload: { chat: 'ops-1', isGroup: false, addressed: true, sender: 'owner', text: '.cancel 12/11 all: x' } });
    assert.equal(acks.length, before, 'without the booking settings the word is not ours');
  });
});
