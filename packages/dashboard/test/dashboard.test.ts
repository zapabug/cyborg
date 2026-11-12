import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Script } from 'node:vm';
import { createCompany, loadCompanyConfig, seedProfile, type Company } from '@cyborg/company';
import type { AttentionItem, AttentionSource, CapabilityResult } from '@cyborg/core';
import { ScriptedModel } from '@cyborg/core/testing';
import { PAGE, SERVICE_WORKER, startDashboard, type LinkStatus } from '../src/index.ts';

const AT = '2026-11-02T09:00:00.000Z';
const capability: CapabilityResult = { baseUrl: 'http://127.0.0.1:1/v1', model: 'm', level: 'strict_schema', requestShape: 'json_schema_wrapped', logprobs: false, testedAt: AT, attempts: [] };
const COMPANY = {
  profile: {
    'business.name': 'Simulated desk', 'tone.style': 'friendly', 'offer.items': [{ name: 'East Tour', price: 35, unit: 'per person', capacity: 8 }],
    'offer.availability': { days: [1, 3, 5], closedDates: [] }, 'rules.commitments': ['never confirm a booking'], 'faq.entries': [{ q: 'Is it good for kids?', a: 'Yes.' }],
  },
};
const INTAKE = JSON.stringify({ items: [{ field: 'tour', value: 'East Tour', sourcePhrase: 'east tour' }] });
const DRAFT = JSON.stringify({ draft: 'A colleague will follow up.' });
const CARD = JSON.stringify({ wants: [{ note: 'the price of the east tour', sourcePhrase: 'how much is the east tour' }], collected: [], needs: [], botSaid: [], open: ['Is Thursday free for 6?'] });

async function withDashboard<T>(work: (c: { company: Company; url: string; port: number; token: string; say: (chat: string, text?: string, extra?: Record<string, unknown>) => Promise<unknown> }) => Promise<T>, script: string[] = [], opts: { feedback?: boolean; sources?: AttentionSource[]; link?: () => LinkStatus | null } = {}): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'cyborg-dash-'));
  const file = join(dir, 'company.config.json');
  writeFileSync(file, JSON.stringify({
    id: 'dash', name: 'Dash', language: 'en', store: { path: 'store.sqlite', vaultPath: 'vault.sqlite' }, inference: { baseUrl: 'http://127.0.0.1:1/v1', model: 'm' },
    chat: { authorisedSenders: ['owner-ref'], originChannel: 'origin', roles: { 'chat-1': 'reply', 'chat-2': 'reply', 'ops-1': 'ops' } },
    modules: { sales: { enquiryFields: [{ name: 'tour', description: 'which tour' }] }, ...(opts.feedback ? { feedback: {} } : {}), enabledHandlers: { sales: ['sales.enquiry.intake', 'sales.enquiry.reply_draft', 'sales.handoff.card'] } },
  }));
  const sink = (channel: string) => ({ channel, send: async () => undefined });
  const company = createCompany(loadCompanyConfig(file), { ack: sink('a'), review: sink('r'), ops: sink('o') }, { model: new ScriptedModel(script), capabilities: [capability], beforeLoad: (s) => void seedProfile(s, COMPANY, AT), now: () => new Date(AT), ...(opts.sources ? { attentionSources: opts.sources } : {}) });
  const dash = await startDashboard(company, { token: 'test-token', streamEveryMs: 20, ...(opts.link ? { link: opts.link } : {}) });
  const say = (chat: string, text = 'how much is the east tour', extra: Record<string, unknown> = {}) =>
    company.process({ id: `e-${chat}-${Math.random()}`, source: 'chat', kind: 'message.received', at: AT, payload: { chat, isGroup: false, addressed: true, sender: `${chat}-customer`, text, ...extra } });
  try {
    return await work({ company, url: dash.url, port: dash.port, token: dash.token, say });
  } finally {
    await dash.close();
    company.close();
    rmSync(dir, { recursive: true });
  }
}

const get = (url: string, path: string, headers: Record<string, string> = {}) => fetch(new URL(path, url), { headers });
const post = (url: string, path: string, headers: Record<string, string> = {}, body?: unknown) =>
  fetch(new URL(path, url), { method: 'POST', headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
const auth = (token: string) => ({ 'x-cyborg-token': token, 'x-cyborg-operator': encodeURIComponent('Ana Costa') });

test('ADM-87: the page and the service worker need no token; the page is served with one and loads nothing from outside', async () => {
  await withDashboard(async ({ url, token }) => {
    const page = await get(url, '/');
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy') ?? '', /default-src 'self'/);
    assert.match(page.headers.get('cache-control') ?? '', /no-store/);
    assert.ok(html.includes(`var TOKEN = '${token}'`));
    assert.doesNotMatch(html.replace(/http:\/\/www\.w3\.org/g, ''), /(?:src|href)=["']https?:/, 'no external script, style or font');
    assert.ok(!html.includes('innerHTML'), 'text from customers is put on the page as text, never as markup');
    const sw = await get(url, '/sw.js');
    assert.equal(sw.status, 200);
    assert.match(sw.headers.get('content-type') ?? '', /javascript/);
    assert.equal(sw.headers.get('service-worker-allowed'), '/');
  });
});

test('ADM-87: the page script and the service worker are valid JavaScript', () => {
  const script = /<script>([\s\S]*)<\/script>/.exec(PAGE)![1]!;
  assert.doesNotThrow(() => new Script(script.replace('__TOKEN__', 't').replace('__LANG__', 'pt')));
  assert.doesNotThrow(() => new Script(SERVICE_WORKER));
});

test('ADM-87: every API call needs the token, a wrong Host or Origin is refused, and a change needs the token too', async () => {
  await withDashboard(async ({ url, token, port }) => {
    assert.equal((await get(url, '/api/state')).status, 403);
    assert.equal((await get(url, '/api/state', { 'x-cyborg-token': 'wrong' })).status, 403);
    assert.equal((await get(url, '/api/state', auth(token))).status, 200);
    assert.equal((await post(url, '/api/chat/chat-1/take-over')).status, 403);
    assert.equal((await get(url, '/api/state', { ...auth(token), origin: 'https://evil.example' })).status, 403);
    assert.equal((await get(url, '/api/state', { ...auth(token), origin: `http://127.0.0.1:${port}` })).status, 200);
    // A rebinding page reaches the port under another name: the Host header gives it away.
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path: '/api/state', headers: { host: `evil.example:${port}`, ...auth(token) } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 403);
  });
});

test('ADM-86: the state lists the board with a toast for each row, the open alerts and the language', async () => {
  await withDashboard(async ({ company, url, token, say }) => {
    company.takeOver('chat-1', 'staff-1');
    await say('chat-1', 'I would like to speak to someone please', { contactName: 'Maria Silva' });
    const state = (await (await get(url, '/api/state', auth(token))).json()) as { language: string; items: { key: string; source: string; kind: string; colour: string; title: string; toast: { title: string; body: string; open: string } }[]; alerts: unknown[] };
    assert.equal(state.language, 'en');
    assert.deepEqual(state.items.map((r) => [r.key, r.source, r.kind, r.colour, r.title]), [['desk:chat-1', 'desk', 'chat', 'red', 'Maria Silva']]);
    assert.deepEqual([state.items[0]!.toast.title, state.items[0]!.toast.body, state.items[0]!.toast.open], ['Maria Silva', 'Waiting for a person', '#/chat/chat-1']);
    assert.ok(!JSON.stringify(state).includes('351'), 'only the name WhatsApp shows leaves the vault, never a number');
  });
});

test('ADM-84, ADM-86: the chat view has the card, the replies waiting and the history; take over and hand back change the bot\'s state and are audited as the operator', async () => {
  await withDashboard(async ({ company, url, token, say }) => {
    await say('chat-2');
    await company.handoff('chat-2', 'customer: how much is the east tour');
    const view = (await (await get(url, '/api/chat/chat-2', auth(token))).json()) as { name: null; state: string; colour: string; card: string; pending: { draft: string }[]; history: { from: string; text: string }[] };
    assert.equal(view.colour, 'yellow');
    assert.match(view.card, /^Handoff: chat-2\n─+\nSpec: wants\nState: the price of the east tour/);
    assert.match(view.card, /Spec: office to check\nState: Is Thursday free for 6\?/);
    assert.equal(view.pending.some((p) => p.draft?.endsWith('A colleague will follow up.')), true, 'the reply waiting for a person is shown to staff, not sent');
    assert.deepEqual(view.history, [{ from: 'customer', text: 'how much is the east tour' }]);

    assert.equal((await post(url, '/api/chat/chat-2/take-over', auth(token))).status, 200);
    assert.equal(company.store.getChatState('chat-2'), 'handoff');
    assert.equal((await post(url, '/api/chat/chat-2/hand-back', auth(token))).status, 200);
    assert.equal(company.store.getChatState('chat-2'), 'bot');
    assert.deepEqual(company.board(), [], 'handed back and settled');
    const actors = company.store.listAudit().filter((a) => a.kind === 'chat_state').map((a) => a.actor);
    assert.ok(actors.includes('dashboard:Ana Costa'));
    assert.equal((await post(url, '/api/chat/chat-2/explode', auth(token))).status, 404);
  }, [INTAKE, DRAFT, CARD]);
});

test('ADM-84: leave-to-bot hands back a chat a person holds, and only dismisses one the bot already has', async () => {
  await withDashboard(async ({ company, url, token, say }) => {
    await say('chat-1');
    await post(url, '/api/chat/chat-1/leave-to-bot', auth(token));
    assert.equal(company.board().length, 1, 'a chat the bot has is only dismissed: its reply still waits');
    assert.ok(company.store.listAudit().some((a) => a.kind === 'board_dismissed'));
    company.takeOver('chat-1', 'staff-1');
    await post(url, '/api/chat/chat-1/leave-to-bot', auth(token));
    assert.equal(company.store.getChatState('chat-1'), 'bot');
  }, [INTAKE, DRAFT]);
});

test('ADM-86: the live stream sends the board when it changes, the morning sheet is served, a seen alert is recorded, and the language toggle works', async () => {
  await withDashboard(async ({ company, url, token, say }) => {
    const controller = new AbortController();
    const stream = await fetch(new URL(`/api/stream?token=${token}`, url), { signal: controller.signal });
    assert.match(stream.headers.get('content-type') ?? '', /text\/event-stream/);
    const reader = stream.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.match(first, /^data: \{"language":"en","items":\[\]/);
    company.takeOver('chat-1', 'staff-1');
    await say('chat-1', 'I would like to speak to someone please');
    let next = '';
    while (!next.includes('"colour":"red"')) next += new TextDecoder().decode((await reader.read()).value);
    controller.abort();

    const sheet = (await (await get(url, '/api/sheet', auth(token))).json()) as { text: string };
    assert.match(sheet.text, /^Morning: 2026-11-02 · Waiting on the office: 0 · Waiting for a person: 1/);

    company.store.raiseAlert({ kind: 'inference_key', ref: '', detail: 'The key was rejected.', at: AT });
    const id = company.store.listOpenAlerts()[0]!.id;
    assert.equal((await post(url, `/api/alerts/${id}/seen`, auth(token))).status, 200);
    assert.equal(company.store.listOpenAlerts()[0]!.seenBy, 'dashboard:Ana Costa');

    assert.equal((await post(url, '/api/language', auth(token), { language: 'pt' })).status, 200);
    assert.equal(company.store.getLanguage(), 'pt');
    assert.equal((await post(url, '/api/language', auth(token), { language: 'fr' })).status, 400);
    const state = (await (await get(url, '/api/state', auth(token))).json()) as { language: string };
    assert.equal(state.language, 'pt');
  });
});

// ADM-91
test('ADM-91: a person approves or declines a waiting reply with a reason and a note, and the choice is kept for the upgrade review', async () => {
  await withDashboard(async ({ company, url, token, say }) => {
    await say('chat-1');
    const reply = company.store.list().find((p) => p.handlerId === 'sales.enquiry.reply_draft')!;
    const bad = await post(url, `/api/proposal/${reply.id}/decide`, auth(token), { decision: 'decline', reason: 'nonsense', note: '' });
    assert.equal(bad.status, 400, 'a reason outside the tags is refused');
    const noPhone = await post(url, `/api/proposal/${reply.id}/decide`, auth(token), { decision: 'decline', reason: 'wrong_tone', note: 'call him on +351 912 000 111' });
    assert.equal(noPhone.status, 400, 'a note with personal data is refused (PRV-6)');
    const ok = await post(url, `/api/proposal/${reply.id}/decide`, auth(token), { decision: 'decline', reason: 'wrong_tone', note: 'too stiff for this customer' });
    assert.equal(ok.status, 200);
    const after = company.store.get(reply.id)!;
    assert.deepEqual([after.status, after.decidedBy], ['declined', 'dashboard:Ana Costa']);
    const row = company.store.listAudit().find((a) => a.proposalId === reply.id && a.toStatus === 'declined')!;
    assert.deepEqual(row.detail, { reason: 'wrong_tone', note: 'too stiff for this customer' });
    assert.equal((await post(url, `/api/proposal/${reply.id}/decide`, auth(token), { decision: 'maybe' })).status, 400);
  }, [INTAKE, DRAFT]);
});

test('ADM-91: the audit queue shows what the customer wrote, what the bot drafted and what the human did; marking is per version with no single score', async () => {
  await withDashboard(async ({ company, url, token, say }) => {
    await say('chat-1', 'how much is the east tour', { contactName: 'Maria Silva' });
    company.personReplied('chat-1', 'staff-2', { eventId: company.store.listEntries()[0]!.eventId, source: 'chat', text: 'The east tour is 35 per person.' });
    const queue = (await (await get(url, '/api/audit', auth(token))).json()) as { rows: { id: string; chat: string; name: string; customerText: string; draft: string; humanReply: string; marking: null; handlerId: string; factKeys: string[] }[]; counts: { counts: Record<string, number> }[] };
    const row = queue.rows.find((r) => r.handlerId === 'sales.enquiry.reply_draft')!;
    assert.deepEqual([row.chat, row.name, row.customerText, row.humanReply], ['chat-1', 'Maria', 'how much is the east tour', 'The east tour is 35 per person.']);
    assert.ok(row.draft.endsWith('A colleague will follow up.'));
    assert.ok(!row.factKeys.includes('presence.status'), 'the on-duty sentence is not a profile fact that can be wrong');
    assert.equal((await post(url, `/api/audit/${row.id}/mark`, auth(token), { marking: 'worse' })).status, 200);
    assert.equal(company.store.getEntry(row.id)!.marking, 'worse');
    assert.equal((await post(url, `/api/audit/${row.id}/mark`, auth(token), { marking: 'excellent' })).status, 400);
    const after = (await (await get(url, '/api/audit', auth(token))).json()) as typeof queue;
    assert.equal(after.rows.at(-1)!.id, row.id, 'marked entries go below the unmarked ones');
    const counts = after.counts.find((c) => (c as unknown as { handlerId: string }).handlerId === 'sales.enquiry.reply_draft')!;
    assert.equal(counts.counts['worse'], 1);
    assert.ok(!JSON.stringify(counts).includes('score'));
  }, [INTAKE, DRAFT]);
});

test('ADM-91: a wrong-fact mark names the fact, contradicts it and opens a discrepancy', async () => {
  await withDashboard(async ({ company, url, token, say }) => {
    await say('chat-1');
    const row = company.auditQueue().find((r) => r.handlerId === 'sales.enquiry.reply_draft')!;
    assert.ok(row.factKeys.length > 1);
    assert.equal((await post(url, `/api/audit/${row.id}/mark`, auth(token), { marking: 'wrong_fact' })).status, 400, 'with several facts the person must say which');
    assert.equal((await post(url, `/api/audit/${row.id}/mark`, auth(token), { marking: 'wrong_fact', factKeys: ['offer.items'] })).status, 200);
    assert.equal(company.store.getFact('offer.items')!.status, 'contradicted');
    assert.equal(company.store.listDiscrepancies().length, 1);
  }, [INTAKE, DRAFT]);
});

test('ADM-91: the page has the audit tab and the approve and decline controls, in both languages, and still parses', () => {
  const script = /<script>([\s\S]*)<\/script>/.exec(PAGE)![1]!;
  assert.doesNotThrow(() => new Script(script));
  for (const word of ['Auditoria', 'Audit', 'Aprovar', 'Approve', 'prometeu algo', 'promised something']) assert.ok(PAGE.includes(word), word);
  assert.ok(!PAGE.includes('innerHTML'));
});


// ADM-92: the dashboard and the toast plug in to any module
const COMPLAINTS = JSON.stringify({ complaints: [{ topic: 'late pickup', sourcePhrase: 'the pickup was 40 minutes late' }] });

/** A plug-in written the way a fleet module's adapter would: no chat, no customer, dates from the company's own records. */
const inspections: AttentionSource & { booked: string[] } = {
  id: 'fleet',
  booked: [],
  items() {
    const all: AttentionItem[] = [
      { key: 'fleet:van-2', source: 'fleet', kind: 'inspection', colour: 'red', title: 'Van 2', summary: 'Inspection due in 3 days; not booked', reference: 'van-2', reasonText: 'An inspection is due soon', since: '2026-11-01T08:00:00.000Z', reasons: ['due_soon'], actions: [{ id: 'booked', label: 'Booked' }] },
      { key: 'fleet:van-5', source: 'fleet', kind: 'inspection', colour: 'yellow', title: 'Van 5', summary: 'Inspection due in 24 days', reference: 'van-5', reasonText: 'An inspection is coming up', since: '2026-11-01T08:00:00.000Z', reasons: ['coming_up'], actions: [] },
    ];
    return all.filter((i) => !this.booked.includes(i.key));
  },
  act(key, action) {
    if (action !== 'booked') throw new Error(`"${action}" is not an action of an inspection`);
    this.booked.push(key);
  },
  async detail(key) {
    return key === 'fleet:van-2' ? { title: 'Van 2', text: 'Due 2026-11-04 (the company\'s own record)' } : null;
  },
};

test('ADM-92: one board, one toast and one set of buttons for the desk, the feedback module and a plug-in that has nothing to do with chats', async () => {
  inspections.booked.length = 0;
  await withDashboard(async ({ company, url, token, say }) => {
    company.takeOver('chat-1', 'staff-1');
    await say('chat-1', 'I would like to speak to someone please', { contactName: 'Maria Silva' });
    await company.review('site-a', 'Lovely guide but the pickup was 40 minutes late and nobody told us.', 'r1');

    const state = (await (await get(url, '/api/state', auth(token))).json()) as { items: { key: string; source: string; kind: string; colour: string; title: string; actions: { id: string }[]; toast: { title: string; body: string; open: string; actions: { id: string }[] } }[] };
    // Red before yellow, and within a colour the oldest need first: the van's dates are from the day before the chat and the review.
    assert.deepEqual(state.items.map((i) => [i.key, i.kind, i.colour]), [
      ['fleet:van-2', 'inspection', 'red'],
      ['desk:chat-1', 'chat', 'red'],
      ['fleet:van-5', 'inspection', 'yellow'],
      ['feedback:' + company.store.list({ handlerId: 'feedback.review.complaints' })[0]!.id, 'complaint', 'yellow'],
    ]);
    const van = state.items.find((i) => i.key === 'fleet:van-2')!;
    assert.deepEqual([van.toast.title, van.toast.body, van.toast.open], ['Van 2', 'Inspection due in 3 days; not booked', '#/item/fleet%3Avan-2']);
    const complaint = state.items.find((i) => i.kind === 'complaint')!;
    assert.deepEqual([complaint.toast.title, complaint.toast.body, complaint.toast.actions.map((a) => a.id)], ['site-a:r1', 'late pickup', ['handled', 'not_a_complaint']]);

    // The item view: the plug-in's own detail text, and nothing for an item it has none for.
    const view = (await (await get(url, `/api/item/${encodeURIComponent('fleet:van-2')}`, auth(token))).json()) as { item: { title: string }; detail: { text: string } };
    assert.equal(view.item.title, 'Van 2');
    assert.match(view.detail.text, /Due 2026-11-04/);

    // Buttons go to the plug-in that made the item.
    assert.equal((await post(url, `/api/item/${encodeURIComponent('fleet:van-2')}/act/booked`, auth(token))).status, 200);
    assert.deepEqual(inspections.booked, ['fleet:van-2']);
    assert.equal((await post(url, `/api/item/${encodeURIComponent('fleet:van-2')}/act/explode`, auth(token))).status, 400);
    assert.equal((await post(url, `/api/item/${encodeURIComponent('nobody:1')}/act/booked`, auth(token))).status, 400);
    assert.equal((await post(url, `/api/item/${encodeURIComponent(complaint.key)}/act/handled`, auth(token))).status, 200);
    assert.equal(company.store.get(complaint.key.replace('feedback:', ''))!.status, 'approved');
    assert.deepEqual(company.attention().map((i) => i.key), ['desk:chat-1', 'fleet:van-5']);
    assert.equal((await post(url, `/api/item/${encodeURIComponent('desk:chat-1')}/act/leave_to_bot`, auth(token))).status, 200);
    assert.equal(company.store.getChatState('chat-1'), 'bot');
  }, [COMPLAINTS], { feedback: true, sources: [inspections] });
});

test('ADM-92: reference_only hides the title and the summary of every plug-in\'s toast, not only the desk\'s', async () => {
  const { toastForItem } = await import('@cyborg/core');
  inspections.booked.length = 0;
  const item = inspections.items()[0]!;
  assert.deepEqual(toastForItem(item, 'reference_only'), { key: 'fleet:van-2', title: 'van-2', body: 'An inspection is due soon', colour: 'red', open: '#/item/fleet%3Avan-2', actions: item.actions });
});

// ADM-97
test('ADM-97: the audit tab and the green rows carry the track record, and the page words the candidate flag as a person\'s decision', async () => {
  await withDashboard(async ({ company, url, token, say }) => {
    await say('chat-1');
    const entry = company.auditQueue().find((r) => r.handlerId === 'sales.enquiry.reply_draft')!;
    await post(url, `/api/audit/${entry.id}/mark`, auth(token), { marking: 'match' });
    const audit = (await (await get(url, '/api/audit', auth(token))).json()) as { records: { handlerId: string; right: number; considered: number; of: number; candidate: boolean }[] };
    assert.deepEqual(audit.records.map((r) => [r.handlerId, r.right, r.considered, r.of, r.candidate]), [['sales.enquiry.reply_draft', 1, 1, 10, false]]);
  }, [INTAKE, DRAFT]);
  for (const word of ['Histórico de acertos', 'Track record per kind of reply', 'só uma pessoa a pode ligar', 'only a person can switch it on']) assert.ok(PAGE.includes(word), word);
});

test('ADM-111: a channel being linked is in the state with its code; without a link() or once it returns null there is none', async () => {
  let link: LinkStatus | null = { channel: 'WhatsApp', state: 'waiting', qr: ['101', '010', '101'] };
  await withDashboard(async ({ url, token }) => {
    const first = (await (await get(url, '/api/state', auth(token))).json()) as { link: LinkStatus | null };
    assert.deepEqual(first.link, { channel: 'WhatsApp', state: 'waiting', qr: ['101', '010', '101'] });
    link = null;
    assert.equal(((await (await get(url, '/api/state', auth(token))).json()) as { link: unknown }).link, null);
  }, [], { link: () => link });
  await withDashboard(async ({ url, token }) => {
    assert.equal(((await (await get(url, '/api/state', auth(token))).json()) as { link: unknown }).link, null);
  });
  assert.ok(PAGE.includes("getElementById('link')") && PAGE.includes('createElementNS'), 'the page draws the code itself');
});
