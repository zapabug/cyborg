import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { CapabilityResult } from '@cyborg/core';
import { ScriptedModel } from '@cyborg/core/testing';
import { addPartner, createCompany, createTestChat, decideBooking, isPartner, listBookings, listPartners, loadCompanyConfig, partnerAccount, removePartner, seedProfile } from '../src/index.ts';

// feat-wazaa-port W7, WZP-61: partner chats. Made-up partner and guests; the scripted model drives the model's side only.

const AT = '2026-11-05T09:00:00.000Z';
const capability: CapabilityResult = { baseUrl: 'http://127.0.0.1:1/v1', model: 'm', level: 'strict_schema', requestShape: 'json_schema_wrapped', logprobs: false, testedAt: AT, attempts: [] };
const FACTS = { profile: { 'business.name': 'T', 'tone.style': 'x', 'offer.items': [{ name: 'East Tour', price: 45, capacity: 20, keywords: ['east'] }], 'offer.availability': { days: [0, 1, 2, 3, 4, 5, 6], closedDates: [] }, 'rules.commitments': ['x'], 'faq.entries': [{ q: 'a', a: 'b' }] } };
const BOOKINGS = { confirmWords: ['yes'], cancelWords: ['cancel'], lastMinuteDays: 1, lastMinuteNote: 'Last minute.', alternativeDaysAhead: 14, maxGroup: 200, currency: 'EUR' };
const cfg = { id: 'pt', name: 'Pt', language: 'en', store: { path: 's.sqlite', vaultPath: 'v.sqlite' }, inference: { baseUrl: 'http://127.0.0.1:1/v1', model: 'm' }, chat: { authorisedSenders: ['owner'], originChannel: 'origin', roles: {} },
  modules: { sales: { enquiryFields: [{ name: 'service', description: 'x' }], conversationContext: true }, bookings: BOOKINGS, enabledHandlers: { sales: ['sales.enquiry.intake', 'sales.enquiry.reply_draft', 'sales.handoff.card'] } } };

function inTemp<T>(work: (file: string) => Promise<T> | T): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'cyborg-partners-'));
  const file = join(dir, 'c.json');
  writeFileSync(file, JSON.stringify(cfg));
  return Promise.resolve(work(file)).finally(() => rmSync(dir, { recursive: true }));
}
let n = 0;
async function book(company: ReturnType<typeof createCompany>, chat: string, date: string, people: number, confirm: boolean) {
  const o = await company.runner.handle({ id: `p${++n}`, source: 'test', kind: 'booking.request', at: AT, payload: { chat, service: 'East Tour', partySize: people, date, perPerson: 45, total: 45 * people, currency: 'EUR' } });
  const p = o.flatMap((x) => (x.outcome === 'proposal' ? [x.proposal] : []))[0]!;
  if (confirm) decideBooking(company, p.id, 'approve', 'office');
  return p.id;
}

test('WZP-61: partners are added with a name and a default pick-up, listed by name and removed; bad input is refused', async () => {
  await inTemp(async (file) => {
    const company = createCompany(loadCompanyConfig(file), { ack: { channel: 'x', send: async () => undefined }, review: { channel: 'y', send: async () => undefined } }, { model: new ScriptedModel([]), capabilities: [capability], now: () => new Date(AT), beforeLoad: (s) => void seedProfile(s, FACTS, AT) });
    try {
      addPartner(company, 'p2', 'Hotel Zeta - reception', null, 'dashboard:Ana');
      addPartner(company, 'p1', 'Agency Alfa', ' Hotel Alfa lobby ', 'dashboard:Ana');
      assert.deepEqual(listPartners(company).map((p) => [p.chat, p.name, p.pickup]), [['p1', 'Agency Alfa', 'Hotel Alfa lobby'], ['p2', 'Hotel Zeta - reception', null]]);
      assert.equal(isPartner(company, 'p1'), true);
      assert.equal(isPartner(company, 'p9'), false);
      assert.throws(() => addPartner(company, 'p3', '  ', null, 'x'), /give the partner a name/);
      assert.throws(() => addPartner(company, '', 'N', null, 'x'), /which chat/);
      removePartner(company, 'p2', 'dashboard:Ana');
      assert.deepEqual(listPartners(company).map((p) => p.chat), ['p1']);
      assert.throws(() => removePartner(company, 'p2', 'x'), /not a partner/);
      assert.ok(company.store.listAudit().some((r) => r.kind === 'module_state' && r.actor === 'dashboard:Ana'), 'who changed it is in the log');
    } finally {
      company.close();
    }
  });
});

test('WZP-61: a partner\'s account is what went ahead in a month: confirmed bookings, not cancelled or only requested, with the people and totals', async () => {
  await inTemp(async (file) => {
    const company = createCompany(loadCompanyConfig(file), { ack: { channel: 'x', send: async () => undefined }, review: { channel: 'y', send: async () => undefined } }, { model: new ScriptedModel([]), capabilities: [capability], now: () => new Date(AT), beforeLoad: (s) => void seedProfile(s, FACTS, AT) });
    try {
      addPartner(company, 'p1', 'Agency Alfa', null, 'x');
      await book(company, 'p1', '2026-11-20', 2, true);
      await book(company, 'p1', '2026-11-03', 3, true);
      await book(company, 'p1', '2026-11-25', 5, false);
      const gone = await book(company, 'p1', '2026-11-22', 4, true);
      company.store.transition(gone, 'applied', { actor: 'x', at: AT });
      company.store.transition(gone, 'reverted', { actor: 'x', at: AT });
      await book(company, 'p1', '2026-12-01', 6, true);
      await book(company, 'other', '2026-11-10', 8, true);
      const acc = partnerAccount(company, 'p1', '2026-11');
      assert.deepEqual(acc.rows.map((r) => [r.date, r.people]), [['2026-11-03', 3], ['2026-11-20', 2]], 'oldest first, no cancelled, no unconfirmed, no other month, no other chat');
      assert.deepEqual([acc.bookings, acc.people], [2, 5]);
      assert.deepEqual(partnerAccount(company, 'p1', '2026-12').people, 6);
      assert.throws(() => partnerAccount(company, 'p1', 'november'), /YYYY-MM/);
      assert.throws(() => partnerAccount(company, 'other', '2026-11'), /not a partner/);
      assert.equal(listBookings(company).length, 6);
    } finally {
      company.close();
    }
  });
});

test('WZP-61: in a partner chat the writer is told who it is, no total is put in front of it, and any price in a draft is blocked in code', async () => {
  await inTemp(async (file) => {
    const read = (...items: [string, string, string][]) => JSON.stringify({ items: items.map(([field, value, sourcePhrase]) => ({ field, value, sourcePhrase })) });
    const draft = (d: string) => JSON.stringify({ draft: d });
    const empty = JSON.stringify({ items: [] });
    const model = new ScriptedModel([
      read(['service', 'east', 'east'], ['party_size', '4', '4 people'], ['date', 'thursday', 'thursday']), empty, draft('Noted: 4 people for the East Tour on Thursday. The office will confirm.'),
      read(), empty, draft('It is 180 EUR in total for the group.'),
    ]);
    const chat = createTestChat(loadCompanyConfig(file), { company: FACTS as never, now: () => new Date(AT), paths: { store: ':memory:', vault: ':memory:' }, deps: { model, capabilities: [capability] } });
    try {
      addPartner(chat.company, 'test-p1-0', 'Hotel Savoy - reception', null, 'x');
      const t1 = await chat.customer('p1', 'east tour for 4 people on thursday');
      assert.deepEqual(t1.problems, []);
      const prompt = model.calls.filter((c) => c.handlerId === 'sales.enquiry.reply_draft')[0]!.prompt;
      assert.match(prompt, /This chat is the partner "Hotel Savoy - reception"/);
      assert.ok(!/Total for the group/.test(prompt) && !/180/.test(prompt), 'no total is put in front of the writer');
      assert.match(prompt, /Service: East Tour/);
      const t2 = await chat.customer('p1', 'and the price?');
      assert.equal(t2.needsOffice, true);
      assert.match(t2.problems.join(), /states a price before the group size is known/);
      assert.equal(t2.replies.find((r) => r.handler === 'reply_draft')!.draft, null, 'no draft with a price in it');
    } finally {
      chat.close();
    }
  });
});

test('WZP-48, WZP-61: the office lists partners and shows a month\'s account with .partners and .account (.parceiros, .conta)', async () => {
  const { withDeskCommands } = await import('../src/index.ts');
  const dir = mkdtempSync(join(tmpdir(), 'cyborg-pcmd-'));
  const file = join(dir, 'c.json');
  writeFileSync(file, JSON.stringify({ ...cfg, chat: { ...cfg.chat, roles: { 'ops-1': 'ops' } } }));
  const company = createCompany(loadCompanyConfig(file), { ack: { channel: 'gate-ack', send: async () => undefined }, review: { channel: 'gate-review', send: async () => undefined } }, { model: new ScriptedModel([]), capabilities: [capability], now: () => new Date(AT), beforeLoad: (s) => void seedProfile(s, FACTS, AT) });
  try {
    const acks: string[] = [];
    const commands = withDeskCommands(company, { commandPrefix: '.', authorisedSenders: ['owner'], ack: { channel: 'ops-ack', send: async (m) => void acks.push(m.text) } });
    const office = async (text: string) => { await commands.process({ id: `o${acks.length}`, source: 'test', kind: 'message.received', at: AT, payload: { chat: 'ops-1', isGroup: false, addressed: true, sender: 'owner', text } }); return acks.at(-1)!; };
    await office('.lang en');
    assert.equal(await office('.partners'), 'No partners yet.');
    addPartner(company, 'p1', 'Agency Alfa', 'Hotel Alfa lobby', 'x');
    await book(company, 'p1', '2026-11-20', 2, true);
    await book(company, 'p1', '2026-11-21', 3, true);
    assert.equal(await office('.partners'), 'Agency Alfa (Hotel Alfa lobby)');
    assert.equal(await office('.account agency alfa 2026-11'), 'Agency Alfa, 2026-11: 2 booking(s), 5 people.');
    assert.equal(await office('.account Agency Alfa 2026-12'), 'Agency Alfa, 2026-12: 0 booking(s), 0 people.');
    assert.equal(await office('.account Nobody'), 'That partner does not exist.');
    await office('.lang pt');
    assert.equal(await office('.conta Agency Alfa 2026-11'), 'Agency Alfa, 2026-11: 2 reserva(s), 5 pessoa(s).');
    assert.equal(await office('.parceiros'), 'Agency Alfa (Hotel Alfa lobby)');
  } finally {
    company.close();
    rmSync(dir, { recursive: true });
  }
});
