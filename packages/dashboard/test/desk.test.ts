import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createCompany, loadCompanyConfig, seedProfile } from '@cyborg/company';
import type { CapabilityResult } from '@cyborg/core';
import { ScriptedModel } from '@cyborg/core/testing';
import { businessTab, startDashboard } from '../src/index.ts';

// feat-wazaa-port W5, WZP-41..46: the chat desk's tabs.

const AT = '2026-11-02T09:00:00.000Z';
const capability: CapabilityResult = { baseUrl: 'http://127.0.0.1:1/v1', model: 'm', level: 'strict_schema', requestShape: 'json_schema_wrapped', logprobs: false, testedAt: AT, attempts: [] };
const FACTS = {
  profile: {
    'business.name': 'Desk', 'tone.style': 'friendly', 'offer.items': [{ name: 'East Tour', price: 35, unit: 'per person', capacity: 8 }],
    'offer.availability': { days: [1, 3, 5], closedDates: [] }, 'rules.commitments': ['never confirm a booking'], 'faq.entries': [{ q: 'Is it good for kids?', a: 'Yes.' }],
  },
};
const h = (token: string) => ({ 'x-cyborg-token': token, 'x-cyborg-operator': encodeURIComponent('Ana Costa'), 'content-type': 'application/json' });

async function withDesk<T>(work: (c: { url: string; token: string; company: ReturnType<typeof createCompany>; get: (p: string) => Promise<any>; post: (p: string, b: unknown) => Promise<Response> }) => Promise<T>, modules: Record<string, unknown> = { sales: { enquiryFields: [{ name: 'service', description: 'which tour' }] }, enabledHandlers: { sales: ['sales.enquiry.intake', 'sales.enquiry.reply_draft', 'sales.handoff.card'] } }, script: string[] = [], extraFacts: Record<string, unknown> = {}, roles: Record<string, string> = {}): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'cyborg-desk-'));
  const file = join(dir, 'c.json');
  writeFileSync(file, JSON.stringify({ id: 'desk', name: 'Desk', language: 'en', store: { path: 's.sqlite', vaultPath: 'v.sqlite' }, inference: { baseUrl: 'http://127.0.0.1:1/v1', model: 'm' }, chat: { authorisedSenders: ['owner'], originChannel: 'origin', roles: { 'chat-1': 'reply', 'ops-1': 'ops', ...roles } }, modules }));
  const sink = (channel: string) => ({ channel, send: async () => undefined });
  const company = createCompany(loadCompanyConfig(file), { ack: sink('a'), review: sink('r') }, { model: new ScriptedModel(script), capabilities: [capability], beforeLoad: (st) => void seedProfile(st, { profile: { ...FACTS.profile, ...extraFacts } }, AT) });
  const dash = await startDashboard(company, { token: 'tok' });
  const get = async (p: string) => (await fetch(new URL(p, dash.url), { headers: h('tok') })).json();
  const post = (p: string, b: unknown) => fetch(new URL(p, dash.url), { method: 'POST', headers: h('tok'), body: JSON.stringify(b) });
  try {
    return await work({ url: dash.url, token: 'tok', company, get, post });
  } finally {
    await dash.close();
    company.close();
    rmSync(dir, { recursive: true });
  }
}

test('DSH-2, DSH-4: a company with the sales module has the Lessons tab, and one without it does not', async () => {
  await withDesk(async ({ get }) => {
    assert.ok(((await get('/api/state')) as { tabs: { id: string }[] }).tabs.some((t) => t.id === 'lessons'));
  });
  await withDesk(async ({ get }) => {
    assert.ok(!((await get('/api/state')) as { tabs: { id: string }[] }).tabs.some((t) => t.id === 'lessons'));
  }, { feedback: {} });
});

test('WZP-46: a lesson is added by a person, listed, used in the next draft\'s lessons, retired, and edited as retire-and-add; every change names the operator', async () => {
  await withDesk(async ({ get, post, company }) => {
    const empty = await get('/api/tab/lessons/list');
    assert.deepEqual(empty.lessons, []);
    assert.ok(empty.handlers.includes('sales.enquiry.reply_draft'));
    const add = await post('/api/tab/lessons/add', { text: 'When you give a price, say pick-up is included.', handler: '' });
    assert.equal(add.status, 200);
    const lesson = (await add.json()) as { id: string; handlerId: string | null };
    assert.equal(lesson.handlerId, null, 'the whole business');
    assert.deepEqual(company.store.activeLessonsFor('sales.enquiry.reply_draft').map((l) => l.text), ['When you give a price, say pick-up is included.'], 'the next draft is given it');
    const edited = await post('/api/tab/lessons/add', { text: 'When you give a price, say pick-up from the hotel is included.', handler: 'sales.enquiry.reply_draft', replaces: lesson.id });
    assert.equal(edited.status, 200);
    const listed = (await get('/api/tab/lessons/list')).lessons as { text: string; handlerId: string | null }[];
    assert.deepEqual(listed.map((l) => [l.text, l.handlerId]), [['When you give a price, say pick-up from the hotel is included.', 'sales.enquiry.reply_draft']], 'the old one is retired');
    const id = ((await get('/api/tab/lessons/list')).lessons as { id: string }[])[0]!.id;
    assert.equal((await post('/api/tab/lessons/retire', { id })).status, 200);
    assert.deepEqual((await get('/api/tab/lessons/list')).lessons, []);
    const by = company.store.listAudit().filter((r) => r.kind === 'lesson_by');
    assert.ok(by.length === 3 && by.every((r) => r.actor === 'dashboard:Ana Costa'), 'added, edited and retired by the operator');
  });
});

test('WZP-46: a lesson that is empty, too long, for a step that does not exist, or that retires nothing is refused with a plain message', async () => {
  await withDesk(async ({ post }) => {
    const err = async (body: unknown, path = 'add') => ((await (await post(`/api/tab/lessons/${path}`, body)).json()) as { error: string }).error;
    assert.match(await err({ text: 'no' }), /short sentence/);
    assert.match(await err({ text: 'x'.repeat(301) }), /at most 300/);
    assert.match(await err({ text: 'A fine rule for the bot.', handler: 'sales.nothing' }), /not a step of the bot/);
    assert.match(await err({}, 'retire'), /which lesson/);
    assert.match(await err({ id: 'missing' }, 'retire'), /no lesson/);
  });
});

const CARD = JSON.stringify({
  wants: [{ note: 'the price of the east tour', sourcePhrase: 'how much is the east tour' }],
  collected: [{ field: 'service', value: 'East Tour', sourcePhrase: 'east tour' }],
  needs: [], botSaid: [], open: ['Which day, and is there room for more people?'],
});
const TRANSCRIPT = 'customer: how much is the east tour';

test('WZP-45: an open question is answered by the office: recorded as the office\'s reply, the chat is settled, and with "remember" it goes into the FAQ as an unconfirmed statement', async () => {
  await withDesk(async ({ get, post, company }) => {
    company.store.linkEvent('chat', 'e1', 'chat-1', AT);
    assert.ok((await company.handoff('chat-1', TRANSCRIPT, { post: false })).card);
    const listed = await get('/api/tab/questions/list');
    assert.equal(listed.questions.length, 1);
    assert.match(listed.questions[0].card, /Which day, and is there room for more people\?/);
    assert.deepEqual(listed.questions[0].questions, ['Which day, and is there room for more people?']);
    assert.equal((await post('/api/tab/questions/answer', { chat: 'chat-1', answer: '   ' })).status, 400);
    const ok = await post('/api/tab/questions/answer', { chat: 'chat-1', answer: 'It is 35 per person and Thursday has room.', remember: 'How much is the east tour?' });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { remembered: true });
    const after = await get('/api/tab/questions/list');
    assert.deepEqual(after.questions, [], 'a person answering settles it');
    assert.equal(after.answered.length, 1);
    assert.deepEqual([after.answered[0].by, after.answered[0].remembered], ['dashboard:Ana Costa', true]);
    const faq = company.store.getFact('faq.entries')!;
    assert.deepEqual((faq.value as { q: string; a: string }[]).at(-1), { q: 'How much is the east tour?', a: 'It is 35 per person and Thursday has room.' });
    assert.equal(faq.status, 'unconfirmed', 'a changed fact goes back to the client to confirm');
    assert.ok(company.store.listAudit().some((r) => r.kind === 'fact_replaced'), 'the audit keeps what it replaced');
    const kept = (await get('/api/tab/questions/list')).learned as { id: string; q: string; a: string; by: string }[];
    assert.deepEqual(kept.map((l) => [l.q, l.a, l.by]), [['How much is the east tour?', 'It is 35 per person and Thursday has room.', 'dashboard:Ana Costa']], 'the kept answer is listed');
    const before = (company.store.getFact('faq.entries')!.value as unknown[]).length;
    assert.equal((await post('/api/tab/questions/forget', { id: 'nothing' })).status, 400);
    assert.equal((await post('/api/tab/questions/forget', { id: kept[0]!.id })).status, 200);
    assert.equal((company.store.getFact('faq.entries')!.value as unknown[]).length, before - 1, 'the entry is taken out of the FAQ');
    assert.deepEqual((await get('/api/tab/questions/list')).learned, []);
    assert.equal(company.store.getFact('faq.entries')!.status, 'unconfirmed', 'a changed fact goes back to the client to confirm');
    const again = await post('/api/tab/questions/answer', { chat: 'chat-1', answer: 'x' });
    assert.equal(again.status, 400);
    assert.match(((await again.json()) as { error: string }).error, /answered or is not open/);
  }, undefined, [CARD]);
});

test('WZP-44: a note is kept as a save, a bug or an idea with its author; a bad kind, an empty note and a long one are refused; a ticket that does not exist cannot be fixed', async () => {
  await withDesk(async ({ get, post }) => {
    assert.equal((await post('/api/tab/saved/note', { kind: 'bug', note: 'The price was wrong for 4 people' })).status, 200);
    assert.equal((await post('/api/tab/saved/note', { kind: 'idea', note: 'Ask for the hotel name' })).status, 200);
    const list = await get('/api/tab/saved/list');
    assert.deepEqual(list.notes.map((n: { kind: string; note: string; by: string }) => [n.kind, n.note, n.by]), [['idea', 'Ask for the hotel name', 'dashboard:Ana Costa'], ['bug', 'The price was wrong for 4 people', 'dashboard:Ana Costa']], 'newest first');
    assert.deepEqual(list.tickets, []);
    const err = async (path: string, body: unknown) => ((await (await post(`/api/tab/saved/${path}`, body)).json()) as { error: string }).error;
    assert.match(await err('note', { kind: 'rant', note: 'x' }), /save, a bug or an idea/);
    assert.match(await err('note', { kind: 'bug', note: ' ' }), /write the note/);
    assert.match(await err('note', { kind: 'bug', note: 'x'.repeat(501) }), /at most 500/);
    assert.ok((await err('fix', { id: 'nope' })).length > 0);
  });
});

test('WZP-41: the Chats tab lists every chat by name, shows one, and take over, hand back and done change who has it; an unknown chat is refused', async () => {
  await withDesk(async ({ get, post, company }) => {
    company.store.linkEvent('chat', 'e1', 'chat-1', AT);
    await company.handoff('chat-1', TRANSCRIPT, { post: false });
    const rows = (await get('/api/tab/chats/list')).rows as { chat: string; state: string }[];
    assert.deepEqual(rows.map((r) => [r.chat, r.state]), [['chat-1', 'bot']]);
    const view = (await (await post('/api/tab/chats/view', { chat: 'chat-1' })).json()) as { state: string; card: string };
    assert.equal(view.state, 'bot');
    assert.match(view.card, /Handoff/);
    assert.equal((await post('/api/tab/chats/take', { chat: 'chat-1' })).status, 200);
    assert.equal(company.store.getChatState('chat-1'), 'handoff');
    assert.equal((await post('/api/tab/chats/hand', { chat: 'chat-1' })).status, 200);
    assert.equal(company.store.getChatState('chat-1'), 'bot');
    assert.equal((await post('/api/tab/chats/done', { chat: 'chat-1' })).status, 200);
    const bad = await post('/api/tab/chats/take', { chat: 'nobody' });
    assert.equal(bad.status, 400);
    assert.match(((await bad.json()) as { error: string }).error, /not known/);
    const audit = company.store.listAudit().filter((r) => r.actor === 'dashboard:Ana Costa');
    assert.ok(audit.length >= 2, 'take over and hand back name the operator');
  }, undefined, [CARD]);
});

test('WZP-40, DSH-7: the desk tabs are valid, in both languages, with the same words in each, and the Chats tab says the reply box is off in shadow mode', async () => {
  const { conversationsTab, questionsTab, savedTab, lessonsTab, validateTabs } = await import('../src/index.ts');
  await withDesk(async ({ company }) => {
    const tabs = [conversationsTab(company), questionsTab(company), savedTab(company), lessonsTab(company)];
    assert.doesNotThrow(() => validateTabs(tabs));
    for (const tab of tabs) {
      assert.deepEqual(Object.keys(tab.text!.pt).sort(), Object.keys(tab.text!.en).sort(), `${tab.id}: the two languages have the same keys`);
      assert.ok(!tab.script.includes('innerHTML'));
    }
    assert.match(tabs[0]!.text!.pt['cvReplyOff'] as string, /nada é enviado ao cliente/);
    assert.match(tabs[0]!.text!.en['cvReplyOff'] as string, /nothing is sent to the customer/);
  });
});

test('WZP-54, WZP-52: the Bookings tab lists the requests with their reference and a person confirms or declines them; it exists only with the booking module', async () => {
  const { bookingsTab, validateTabs } = await import('../src/index.ts');
  await withDesk(async ({ get, company }) => {
    assert.ok(!((await get('/api/state')) as { tabs: { id: string }[] }).tabs.some((t) => t.id === 'bookings'), 'no booking module, no Bookings tab');
    const tab = bookingsTab(company);
    assert.doesNotThrow(() => validateTabs([tab]));
    assert.deepEqual(Object.keys(tab.text!.pt).sort(), Object.keys(tab.text!.en).sort());
    assert.equal(tab.label.pt, 'Reservas');
  });
});

test('WZP-54, WZP-52: through the routes, a request is listed with its reference and total, a person confirms it once, and a bad choice is refused', async () => {
  const modules = {
    sales: { enquiryFields: [{ name: 'service', description: 'which tour' }], conversationContext: true },
    bookings: { confirmWords: ['yes'], cancelWords: ['cancel'], lastMinuteDays: 1, lastMinuteNote: 'Last minute.', alternativeDaysAhead: 14, maxGroup: 200, currency: 'EUR' },
    enabledHandlers: { sales: ['sales.enquiry.intake', 'sales.enquiry.reply_draft', 'sales.handoff.card'] },
  };
  await withDesk(async ({ get, post, company }) => {
    assert.ok(((await get('/api/state')) as { tabs: { id: string }[] }).tabs.some((t) => t.id === 'bookings'));
    await company.runner.handle({ id: 'r1', source: 'test', kind: 'booking.request', at: AT, payload: { chat: 'chat-1', service: 'East Tour', partySize: 4, date: '2026-11-12', perPerson: 45, total: 180, currency: 'EUR' } });
    const list = (await get('/api/tab/bookings/list')).bookings as { id: string; ref: string; service: string; partySize: number; total: string; status: string }[];
    assert.deepEqual(list.map((b) => [b.ref, b.service, b.partySize, b.total, b.status]), [['B-000001', 'East Tour', 4, '180 EUR', 'proposed']]);
    assert.equal((await post('/api/tab/bookings/decide', { id: list[0]!.id, decision: 'maybe' })).status, 400);
    assert.equal((await post('/api/tab/bookings/decide', { id: 'nothing', decision: 'approve' })).status, 400);
    const ok = await post('/api/tab/bookings/decide', { id: list[0]!.id, decision: 'approve', note: 'confirmed by phone' });
    assert.equal(ok.status, 200);
    assert.equal(((await get('/api/tab/bookings/list')).bookings as { status: string }[])[0]!.status, 'approved');
    assert.equal((await post('/api/tab/bookings/decide', { id: list[0]!.id, decision: 'decline' })).status, 400, 'a confirmed request cannot be declined');
    assert.ok(company.store.listAudit().some((r) => r.actor === 'dashboard:Ana Costa' && r.toStatus === 'approved'), 'the confirmation names the operator');
  }, modules);
});

test('WZP-60, WZP-62: the Maintenance tab exists only with the maintenance module, lists records and each asset\'s track record, and a person schedules, finishes or dismisses', async () => {
  const modules = { maintenance: { issues: { high: ['avariou'], medium: [], low: [] }, dedupHours: 24, contextWindowMsgs: 3, contextWindowMinutes: 10 }, feedback: {} };
  const { withMaintenance } = await import('@cyborg/company');
  await withDesk(async ({ get, post, company }) => {
    assert.ok(((await get('/api/state')) as { tabs: { id: string }[] }).tabs.some((t) => t.id === 'maintenance'));
    const watching = withMaintenance(company, { config: modules.maintenance, now: () => new Date(AT) });
    await watching.process({ id: 'm1', source: 'test', kind: 'message.received', at: AT, payload: { chat: 'team-1', isGroup: true, addressed: false, sender: 'd', text: 'van 1 avariou' } });
    const listed = (await get('/api/tab/maintenance/list')) as { records: { id: string; ref: string; status: string }[]; assets: { id: string; open: number }[] };
    assert.deepEqual(listed.records.map((r) => [r.ref, r.status]), [['MNT-000001', 'open']]);
    assert.deepEqual(listed.assets.map((a) => [a.id, a.open]), [['van-01', 1]]);
    const id = listed.records[0]!.id;
    assert.equal((await post('/api/tab/maintenance/schedule', { id, date: 'soon' })).status, 400);
    assert.equal((await post('/api/tab/maintenance/schedule', { id, date: '2026-11-09' })).status, 200);
    assert.equal((await post('/api/tab/maintenance/done', { id })).status, 200);
    assert.equal(((await get('/api/tab/maintenance/list')) as { records: { status: string }[] }).records[0]!.status, 'done');
    assert.equal((await post('/api/tab/maintenance/dismiss', { id })).status, 400, 'a closed record cannot be dismissed');
  }, modules, [], { 'fleet.assets': [{ id: 'van-01', label: 'Minibus 01', identifiers: ['AA 12 BB'], aliases: ['van 1'] }] }, { 'team-1': 'monitor' });
  await withDesk(async ({ get }) => {
    assert.ok(!((await get('/api/state')) as { tabs: { id: string }[] }).tabs.some((t) => t.id === 'maintenance'));
  });
});

test('WZP-61: the Partners tab exists with the booking module, adds and removes partners naming the operator, and shows a month\'s account; bad input is a plain 400', async () => {
  const modules = {
    sales: { enquiryFields: [{ name: 'service', description: 'which tour' }], conversationContext: true },
    bookings: { confirmWords: ['yes'], cancelWords: ['cancel'], lastMinuteDays: 1, lastMinuteNote: 'Last minute.', alternativeDaysAhead: 14, maxGroup: 200, currency: 'EUR' },
    enabledHandlers: { sales: ['sales.enquiry.intake', 'sales.enquiry.reply_draft', 'sales.handoff.card'] },
  };
  await withDesk(async ({ get, post, company }) => {
    assert.ok(((await get('/api/state')) as { tabs: { id: string }[] }).tabs.some((t) => t.id === 'partners'));
    company.store.linkEvent('chat', 'e1', 'chat-1', AT);
    assert.equal((await post('/api/tab/partners/add', { chat: 'chat-1', name: ' ' })).status, 400);
    assert.equal((await post('/api/tab/partners/add', { chat: 'chat-1', name: 'Hotel Alfa - reception', pickup: 'Hotel Alfa lobby' })).status, 200);
    const listed = (await get('/api/tab/partners/list')) as { partners: { chat: string; name: string }[]; chats: { chat: string }[] };
    assert.deepEqual(listed.partners.map((p) => [p.chat, p.name]), [['chat-1', 'Hotel Alfa - reception']]);
    assert.deepEqual(listed.chats.map((c) => c.chat), ['chat-1']);
    await company.runner.handle({ id: 'r1', source: 'test', kind: 'booking.request', at: AT, payload: { chat: 'chat-1', service: 'East Tour', partySize: 3, date: '2026-11-20', perPerson: 35, total: 105, currency: 'EUR' } });
    const id = (await get('/api/tab/bookings/list')).bookings[0].id as string;
    assert.equal((await post('/api/tab/bookings/decide', { id, decision: 'approve' })).status, 200);
    const account = (await (await post('/api/tab/partners/account', { chat: 'chat-1', month: '2026-11' })).json()) as { bookings: number; people: number };
    assert.deepEqual([account.bookings, account.people], [1, 3]);
    assert.equal((await post('/api/tab/partners/account', { chat: 'chat-1', month: 'nov' })).status, 400);
    assert.equal((await post('/api/tab/partners/remove', { chat: 'chat-1' })).status, 200);
    assert.deepEqual(((await get('/api/tab/partners/list')) as { partners: unknown[] }).partners, []);
    assert.ok(company.store.listAudit().some((r) => r.kind === 'module_state' && r.actor === 'dashboard:Ana Costa'));
  }, modules);
});

test('TLR-10, TLR-12, TLR-13: the Business tab reads the client\'s words without writing, applies them as unconfirmed facts naming the operator, and keeps the words', async () => {
  await withDesk(async ({ get, post, company }) => {
    assert.ok(((await get('/api/state')) as { tabs: { id: string }[] }).tabs.some((t) => t.id === 'business'));
    assert.deepEqual(await get('/api/tab/business/load'), { text: '' });
    const sheet = 'Name: Example Co\nloose words\nTone: warm\nServices:\n- Item one | 25 EUR\nQuestions:\n- Cards? | Yes.\nNever:\n- give a discount\n';
    const before = JSON.stringify(company.store.getFact('offer.items'));
    const read = await (await post('/api/tab/business/read', { text: sheet })).json() as { notes: string[]; unread: { line: number }[]; asks: string[] };
    assert.deepEqual(read.unread.map((u) => u.line), [2]);
    assert.deepEqual(read.asks, []);
    assert.equal(JSON.stringify(company.store.getFact('offer.items')), before, 'reading changes nothing');

    let kept: string | null = null;
    const tab = businessTab(company, { read: () => kept, write: (t) => void (kept = t) });
    const done = tab.routes!['apply']!({ body: { text: sheet }, operator: 'dashboard:Ana Costa' } as never) as { applied: string[] };
    assert.deepEqual(done.applied.sort(), ['business.name', 'faq.entries', 'offer.availability', 'offer.items', 'rules.commitments', 'tone.style']);
    assert.equal(kept, sheet, 'the client\'s words are kept as written');
    assert.deepEqual(company.store.getFact('offer.items')!.value, [{ name: 'Item one', price: 25, currency: 'EUR' }]);
    assert.equal(company.store.getFact('offer.items')!.status, 'unconfirmed');
    assert.ok(company.store.listAudit().some((r) => r.actor === 'dashboard:Ana Costa'), 'the operator is in the log');
    assert.equal((tab.routes!['load']!({ body: {}, operator: 'x' } as never) as { text: string }).text, sheet);
    assert.equal((await post('/api/tab/business/read', { text: 'x'.repeat(20_001) })).status, 400);
    assert.doesNotThrow(() => new Function('ctx', tab.script!), 'the page script is well formed');
  });
});

test('WZP-44b, WZP-45b (audit 2026-11-10): a note is saved with its phone and email replaced by placeholders, and LEARN refuses a question or answer that holds one, before anything is done', async () => {
  await withDesk(async ({ get, post, company }) => {
    const ok = await post('/api/tab/saved/note', { kind: 'bug', note: 'Customer anna@example.com on +351 913 000 222 got the wrong price' });
    assert.equal(ok.status, 200);
    const note = (await get('/api/tab/saved/list')).notes[0].note as string;
    assert.doesNotMatch(note, /anna@example\.com|913 000 222/);
    assert.match(note, /\[EMAIL_1\].*\[PHONE_1\]|\[PHONE_1\].*\[EMAIL_1\]/);
    assert.doesNotMatch(JSON.stringify(company.store.listAudit()), /anna@example\.com|913 000 222/, 'the audit row holds no original');

    company.store.linkEvent('chat', 'e1', 'chat-1', AT);
    assert.ok((await company.handoff('chat-1', TRANSCRIPT, { post: false })).card);
    const faqBefore = JSON.stringify(company.store.getFact('faq.entries'));
    const refused = await post('/api/tab/questions/answer', { chat: 'chat-1', answer: 'Call Maria on 912 345 678', remember: 'Who do I call?' });
    assert.equal(refused.status, 400);
    assert.match(((await refused.json()) as { error: string }).error, /phone, email or other number/);
    assert.equal((await get('/api/tab/questions/list')).questions.length, 1, 'nothing was done: the question is still open');
    assert.equal(JSON.stringify(company.store.getFact('faq.entries')), faqBefore, 'the FAQ is unchanged');
    // the same answer without learn is the person's own reply: it goes through, and the stored copy is scrubbed at save (PRV-6a)
    assert.equal((await post('/api/tab/questions/answer', { chat: 'chat-1', answer: 'Call Maria on 912 345 678' })).status, 200);
  }, undefined, [CARD]);
});
