import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { CapabilityResult } from '@cyborg/core';
import { ScriptedModel } from '@cyborg/core/testing';
import { bookingRef, checkCompanyConfig, createTestChat, decideBooking, listBookings, loadCompanyConfig, type CompanyModelFile } from '../src/index.ts';

// feat-wazaa-port W6, WZP-50..56: the booking funnel through the company: a read, the code's quote, the reply with what the code computed, an explicit yes
// making a request, and a person confirming it. Today is Thursday 2026-11-05. The scripted model drives the model's side only (HR-4).

const AT = '2026-11-05T09:00:00.000Z';
const capability: CapabilityResult = { baseUrl: 'http://127.0.0.1:1/v1', model: 'm', level: 'strict_schema', requestShape: 'json_schema_wrapped', logprobs: false, testedAt: AT, attempts: [] };
const FACTS: CompanyModelFile = {
  profile: {
    'business.name': 'Test desk', 'tone.style': 'friendly and short',
    'offer.items': [{ name: 'East Tour', price: 45, unit: 'per person', capacity: 8, days: [2, 4], keywords: ['east'] }],
    'offer.availability': { days: [2, 4], closedDates: ['12-25'] }, 'rules.commitments': ['never confirm a booking'], 'faq.entries': [{ q: 'Is it good for kids?', a: 'Yes, from 6 years old.' }],
  },
};
const BOOKINGS = {
  confirmWords: ['yes', 'sim', 'ok'], cancelWords: ['cancel', 'cancelar'], lastMinuteDays: 1, lastMinuteNote: 'It is last minute: the team can try but it may not happen.', alternativeDaysAhead: 14, maxGroup: 200, currency: 'EUR',
};
const config = (over: Record<string, unknown> = {}) => ({
  id: 'bk', name: 'Bk', language: 'en', store: { path: 's.sqlite', vaultPath: 'v.sqlite' }, inference: { baseUrl: 'http://127.0.0.1:1/v1', model: 'm' },
  chat: { authorisedSenders: ['owner-ref'], originChannel: 'origin', roles: {} },
  modules: {
    sales: { enquiryFields: [{ name: 'service', description: 'which tour' }], conversationContext: true },
    bookings: BOOKINGS,
    enabledHandlers: { sales: ['sales.enquiry.intake', 'sales.enquiry.reply_draft', 'sales.handoff.card'] },
  },
  ...over,
});

const read = (...items: [string, string, string][]) => JSON.stringify({ items: items.map(([field, value, sourcePhrase]) => ({ field, value, sourcePhrase })) });
const EMPTY = JSON.stringify({ items: [] });
const draft = (text: string) => JSON.stringify({ draft: text });

async function withBookings<T>(script: string[], work: (chat: ReturnType<typeof createTestChat>, model: ScriptedModel) => Promise<T>, cfg: unknown = config()): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'cyborg-bk-'));
  const file = join(dir, 'c.json');
  writeFileSync(file, JSON.stringify(cfg));
  const model = new ScriptedModel(script);
  const chat = createTestChat(loadCompanyConfig(file), { company: FACTS, now: () => new Date(AT), paths: { store: ':memory:', vault: ':memory:' }, deps: { model, capabilities: [capability] } });
  try {
    return await work(chat, model);
  } finally {
    chat.close();
    rmSync(dir, { recursive: true });
  }
}
const prompts = (model: ScriptedModel, handler: string) => model.calls.filter((c) => c.handlerId === handler).map((c) => c.prompt);

test('WZP-50..53, WZP-56: a booking is read, quoted by the code, requested only on an explicit yes and shown with a reference; a person confirms it', async () => {
  const script = [
    read(['service', 'east tour', 'east tour']), EMPTY, draft('Happy to help! How many people, and which day would you like?'),
    read(['party_size', '4', '4 people'], ['date', 'thursday', 'thursday']), EMPTY, draft('The East Tour for 4 people on Thursday 2026-11-12 is 180 EUR in total (45 EUR per person). Shall I send the request to our team?'),
    EMPTY, EMPTY, draft('Done: I sent your request B-000001 to our team, who will confirm it with you shortly.'),
  ];
  await withBookings(script, async (chat, model) => {
    const t1 = await chat.customer('t1', 'how much is the east tour');
    assert.deepEqual(t1.problems, []);
    assert.match(prompts(model, 'sales.enquiry.reply_draft')[0]!, /Service: East Tour/);
    assert.match(prompts(model, 'sales.enquiry.reply_draft')[0]!, /ask the customer how many people \(give no price until you know\), then which day/);
    assert.ok(!/ EUR/.test(prompts(model, 'sales.enquiry.reply_draft')[0]!.split('This chat so far, recorded by the business')[1]!.split('Lessons')[0]!), 'no price is given before the group size is known');

    const t2 = await chat.customer('t1', 'we are 4 people on thursday');
    const quoteFacts = prompts(model, 'sales.enquiry.reply_draft')[1]!;
    assert.match(quoteFacts, /Date: 2026-11-12 \(Thursday\)/, 'the code\'s reading of "thursday"');
    assert.match(quoteFacts, /Total for the group: 180 EUR \(45 EUR per person × 4\)/);
    const d2 = t2.replies.find((r) => r.handler === 'reply_draft')!;
    assert.match(d2.draft ?? '', /180 EUR in total/, 'the computed total passes the checks that block any other amount');
    assert.deepEqual(listBookings(chat.company), [], 'a quote is not a request');

    const t3 = await chat.customer('t1', 'yes please');
    assert.match(prompts(model, 'sales.enquiry.reply_draft')[2]!, /Request B-000001 was sent to the team for review\./);
    assert.match(t3.replies.find((r) => r.handler === 'reply_draft')!.draft ?? '', /B-000001/);
    const [booking] = listBookings(chat.company);
    assert.deepEqual([booking!.ref, booking!.service, booking!.partySize, booking!.date, booking!.total, booking!.status], ['B-000001', 'East Tour', 4, '2026-11-12', '180 EUR', 'proposed']);
    assert.equal(bookingRef(chat.company, booking!.id), 'B-000001');

    const approved = decideBooking(chat.company, booking!.id, 'approve', 'dashboard:Ana', 'confirmed by phone');
    assert.equal(approved.status, 'approved');
    assert.equal(listBookings(chat.company)[0]!.status, 'approved');
    assert.throws(() => decideBooking(chat.company, 'nothing', 'approve', 'dashboard:Ana'), /not a booking request/);
    assert.deepEqual(chat.company.store.listModuleState('bookings').map((r) => (r.record.value as { stage: string }).stage), ['requested']);
  });
});

test('WZP-51: the read settles itself so it never waits for a person, and the people already requested count against the day\'s capacity', async () => {
  const script = [
    read(['service', 'east', 'east'], ['party_size', '6', '6 people'], ['date', 'thursday', 'thursday']), EMPTY, draft('Let me pass this on.'),
    EMPTY, EMPTY, draft('I sent it.'),
    read(['service', 'east', 'east'], ['party_size', '4', '4 people'], ['date', 'thursday', 'thursday']), EMPTY, draft('I am sorry, that day is full. Could Tuesday 2026-11-10, 2026-11-17 or Thursday 2026-11-19 work?'),
  ];
  await withBookings(script, async (chat, model) => {
    await chat.customer('a', 'east for 6 people thursday');
    await chat.customer('a', 'yes');
    assert.equal(listBookings(chat.company).length, 1);
    assert.equal(chat.company.store.list({ handlerId: 'bookings.request.read', status: 'proposed' }).length, 0, 'no read is left waiting for a person');
    const full = await chat.customer('b', 'east for 4 people thursday');
    const facts = prompts(model, 'sales.enquiry.reply_draft')[2]!;
    assert.match(facts, /Not possible: East Tour is full that day \(at most 8 people go\)/);
    assert.match(facts, /2026-11-10 \(Tuesday\), 2026-11-12 \(Thursday\)|2026-11-10 \(Tuesday\), 2026-11-17 \(Tuesday\), 2026-11-19 \(Thursday\)/, 'the nearest open days, which the code checked');
    assert.deepEqual(full.problems, []);
  });
});

test('WZP-53: a model\'s "yes" is never enough: without the customer\'s own yes word, or with a change in the same message, nothing is requested', async () => {
  const script = [
    read(['service', 'east', 'east'], ['party_size', '4', '4 people'], ['date', 'thursday', 'thursday']), EMPTY, draft('That is 180 EUR in total. Shall I send the request?'),
    read(), EMPTY, draft('Take your time.'),
    read(['party_size', '5', '5 people']), EMPTY, draft('For 5 people it is 225 EUR in total. Shall I send it?'),
  ];
  await withBookings(script, async (chat) => {
    await chat.customer('t', 'east, 4 people, thursday');
    await chat.customer('t', 'let me think about it');
    assert.deepEqual(listBookings(chat.company), []);
    await chat.customer('t', 'yes but make it 5 people');
    assert.deepEqual(listBookings(chat.company), [], 'a changed group is a new quote, not an agreement');
  });
});

test('WZP-4, WZP-52: a chat that a person has taken or the bot may not answer gets no booking step and no model call for it', async () => {
  await withBookings([], async (chat, model) => {
    chat.company.store.setRole('quiet', 'ignored', 'test', AT);
    const r = await chat.company.process({ id: 'q1', source: 'test', kind: 'message.received', at: AT, payload: { chat: 'quiet', isGroup: false, addressed: true, sender: 's', text: 'east for 4 people thursday' } });
    assert.equal(r.ran, false);
    assert.equal(model.calls.length, 0);
    assert.deepEqual(listBookings(chat.company), []);
  });
});

test('CMP-4: a company with the booking module and without the reply\'s conversation context is refused: the reply could not state the quote', () => {
  const noContext = loadCompanyConfig((() => {
    const dir = mkdtempSync(join(tmpdir(), 'cyborg-bkc-'));
    const file = join(dir, 'c.json');
    writeFileSync(file, JSON.stringify(config({ modules: { sales: { enquiryFields: [{ name: 'service', description: 'x' }] }, bookings: BOOKINGS } })));
    return file;
  })());
  assert.match(checkCompanyConfig(noContext.config, {}).errors.join(), /modules\.bookings: needs modules\.sales with conversationContext: true/);
});

test('WZP-48: the office confirms or declines a request by its reference with .confirm and .decline (.confirmar, .recusar), and lists what waits with .bookings', async () => {
  const script = [
    read(['service', 'east', 'east'], ['party_size', '4', '4 people'], ['date', 'thursday', 'thursday']), EMPTY, draft('That is 180 EUR in total. Shall I send the request?'),
    EMPTY, EMPTY, draft('Done: your request B-000001 was sent to our team.'),
    read(['service', 'east', 'east'], ['party_size', '2', '2 people'], ['date', 'tuesday', 'tuesday']), EMPTY, draft('That is 90 EUR in total. Shall I send the request?'),
    EMPTY, EMPTY, draft('Done: your request B-000002 was sent to our team.'),
  ];
  await withBookings(script, async (chat) => {
    assert.match((await chat.office('bookings')).note ?? '', /No booking request is waiting\./);
    await chat.customer('a', 'east, 4 people, thursday');
    await chat.customer('a', 'yes');
    await chat.customer('b', 'east, 2 people, tuesday');
    await chat.customer('b', 'yes');
    const waiting = (await chat.office('bookings')).note ?? '';
    assert.match(waiting, /^B-000001 · customer with no name · East Tour × 4, 2026-11-12, 180 EUR · proposed\nB-000002 .* × 2, 2026-11-10, 90 EUR/);
    assert.match((await chat.office('confirm')).note ?? '', /Use: \.confirm <reference/);
    assert.match((await chat.office('confirm B-000009')).note ?? '', /does not exist or has already been decided/);
    assert.match((await chat.office('confirm B-000001 confirmed by phone')).note ?? '', /^B-000001 confirmed\. Nothing was sent to the customer/);
    assert.equal(listBookings(chat.company).find((b) => b.ref === 'B-000001')!.status, 'approved');
    assert.match((await chat.office('confirm 1')).note ?? '', /does not exist or has already been decided/, 'it cannot be decided twice');
    await chat.office('lang pt');
    assert.match((await chat.office('recusar B-000002 sem lugar')).note ?? '', /^B-000002 recusada\./);
    assert.equal(listBookings(chat.company).find((b) => b.ref === 'B-000002')!.status, 'declined');
    assert.match((await chat.office('reservas')).note ?? '', /Nenhum pedido de reserva à espera\./);
  });
});

test('WZP-51: a draft that gives a price before the group size is known is blocked in code, whatever the model was told', async () => {
  await withBookings([read(['service', 'east', 'east']), EMPTY, draft('The East Tour is 45 per person. How many people are you?')], async (chat) => {
    const turn = await chat.customer('t', 'how much is the east tour');
    assert.equal(turn.needsOffice, true);
    assert.match(turn.problems.join(), /states a price before the group size is known/);
    assert.equal(turn.replies.find((r) => r.handler === 'reply_draft')!.draft, null, 'no draft is offered');
  });
});

test('a question about a topic the business listed as unknown is passed to the office, whatever the model wrote', async () => {
  const cfg = config({ modules: { sales: { enquiryFields: [{ name: 'service', description: 'which tour' }], conversationContext: true, officeTopics: [{ label: 'pets and dogs', words: ['dog', 'dogs', 'pet', 'pets'] }] }, bookings: BOOKINGS, enabledHandlers: { sales: ['sales.enquiry.intake', 'sales.enquiry.reply_draft', 'sales.handoff.card'] } } });
  await withBookings([EMPTY, EMPTY, draft('Of course you can bring your dog!')], async (chat, model) => {
    const turn = await chat.customer('t', 'Can I bring my dog?');
    assert.equal(turn.needsOffice, true);
    assert.match(turn.problems.join(), /the customer asks about pets and dogs, which the business's facts do not cover/);
    assert.equal(turn.replies.find((r) => r.handler === 'reply_draft')!.draft, null);
    assert.match(prompts(model, 'sales.enquiry.reply_draft')[0]!, /YOU DO NOT KNOW the following, so pass them to the office and never answer them yourself:\n- pets and dogs/, 'the model is told as well');
  }, cfg);
});
