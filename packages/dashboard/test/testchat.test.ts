import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createCompany, createTestChat, loadCompanyConfig } from '@cyborg/company';
import type { CapabilityResult } from '@cyborg/core';
import { ScriptedModel } from '@cyborg/core/testing';
import { PAGE, startDashboard } from '../src/index.ts';

// feat-wazaa-port W1, WZP-10..14: the Test tab and its routes.

const AT = '2026-11-02T09:00:00.000Z';
const capability: CapabilityResult = { baseUrl: 'http://127.0.0.1:1/v1', model: 'm', level: 'strict_schema', requestShape: 'json_schema_wrapped', logprobs: false, testedAt: AT, attempts: [] };
const COMPANY = {
  profile: {
    'business.name': 'Simulated desk', 'tone.style': 'friendly', 'offer.items': [{ name: 'East Tour', price: 35, unit: 'per person', capacity: 8 }],
    'offer.availability': { days: [1, 3, 5], closedDates: [] }, 'rules.commitments': ['never confirm a booking'], 'faq.entries': [{ q: 'Is it good for kids?', a: 'Yes.' }],
  },
};
const INTAKE = JSON.stringify({ items: [{ field: 'service', value: 'East Tour', sourcePhrase: 'east tour' }] });
const DRAFT = JSON.stringify({ draft: 'The East Tour is 35 per person.' });

const auth = (token: string) => ({ 'x-cyborg-token': token, 'x-cyborg-operator': encodeURIComponent('Ana Costa'), 'content-type': 'application/json' });
const post = (url: string, path: string, token: string | null, body: unknown) =>
  fetch(new URL(path, url), { method: 'POST', headers: token ? auth(token) : { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function withTestChat<T>(work: (c: { url: string; token: string; install: ReturnType<typeof createCompany>; chat: ReturnType<typeof createTestChat> }) => Promise<T>, demo: string | null = null): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'cyborg-tc-'));
  const file = join(dir, 'company.config.json');
  writeFileSync(file, JSON.stringify({
    id: 'tc', name: 'TC', language: 'en', store: { path: 'store.sqlite', vaultPath: 'vault.sqlite' }, inference: { baseUrl: 'http://127.0.0.1:1/v1', model: 'm' },
    chat: { authorisedSenders: ['owner-ref'], originChannel: 'origin', roles: { 'chat-1': 'reply', 'ops-1': 'ops' } },
    modules: { sales: { enquiryFields: [{ name: 'service', description: 'which tour' }] }, enabledHandlers: { sales: ['sales.enquiry.intake', 'sales.enquiry.reply_draft', 'sales.handoff.card'] } },
  }));
  const loaded = loadCompanyConfig(file);
  const sink = (channel: string) => ({ channel, send: async () => undefined });
  const install = createCompany(loaded, { ack: sink('a'), review: sink('r') }, { model: new ScriptedModel([]), capabilities: [capability] });
  const chat = createTestChat(loaded, { company: COMPANY, demo, deps: { model: new ScriptedModel([INTAKE, DRAFT]), capabilities: [capability] } });
  const dash = await startDashboard(install, { token: 'test-token', testChat: chat });
  try {
    return await work({ url: dash.url, token: dash.token, install, chat });
  } finally {
    await dash.close();
    chat.close();
    install.close();
    rmSync(dir, { recursive: true });
  }
}

test('WZP-10: a line typed in the test chat is answered through the test company, and the install\'s own store is not touched', async () => {
  await withTestChat(async ({ url, token, install }) => {
    const res = await post(url, '/api/tab/test/turn', token, { chat: 't1', text: 'how much is the east tour' });
    assert.equal(res.status, 200);
    const turn = (await res.json()) as { kind: string; replies: { handler: string; draft: string | null }[] };
    assert.equal(turn.kind, 'reply');
    assert.match(turn.replies.find((r) => r.handler === 'reply_draft')!.draft ?? '', /35 per person/);
    assert.equal(install.store.list().length, 0, 'nothing from the test chat reached the install\'s proposals');
  });
});

test('WZP-10, ADM-87: the test routes need the token, refuse an empty line, and do not exist without a test chat', async () => {
  await withTestChat(async ({ url, token }) => {
    assert.equal((await post(url, '/api/tab/test/turn', null, { chat: 't1', text: 'hi' })).status, 403);
    const empty = await post(url, '/api/tab/test/turn', token, { chat: 't1', text: '  ' });
    assert.equal(empty.status, 400);
    assert.match(((await empty.json()) as { error: string }).error, /empty/);
    assert.equal((await post(url, '/api/tab/test/elsewhere', token, { text: 'x' })).status, 404);
  });
  const dir = mkdtempSync(join(tmpdir(), 'cyborg-tc-'));
  try {
    const file = join(dir, 'c.json');
    writeFileSync(file, JSON.stringify({ id: 'p', name: 'P', language: 'en', store: { path: 's.sqlite', vaultPath: 'v.sqlite' }, inference: { baseUrl: 'http://127.0.0.1:1/v1', model: 'm' }, modules: { feedback: {} } }));
    const sink = (channel: string) => ({ channel, send: async () => undefined });
    const company = createCompany(loadCompanyConfig(file), { ack: sink('a'), review: sink('r') }, { model: new ScriptedModel([]), capabilities: [capability] });
    const dash = await startDashboard(company, { token: 'tok' });
    assert.equal((await post(dash.url, '/api/tab/test/turn', 'tok', { chat: 't1', text: 'hi' })).status, 404, 'no test chat attached, no route');
    const state = (await (await fetch(new URL('/api/state', dash.url), { headers: auth('tok') })).json()) as { tabs: unknown[] };
    assert.deepEqual(state.tabs, [], 'DSH-4: no test chat, no Test tab');
    await dash.close();
    company.close();
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('WZP-13, WZP-14: the office box and an owner command work through the routes', async () => {
  await withTestChat(async ({ url, token }) => {
    const office = (await (await post(url, '/api/tab/test/office', token, { text: 'ooo back 09:00 Monday' })).json()) as { kind: string; note: string };
    assert.equal(office.kind, 'command');
    const help = (await (await post(url, '/api/tab/test/turn', token, { chat: 't1', text: '.help' })).json()) as { kind: string; note: string };
    assert.equal(help.kind, 'help');
    assert.match(help.note, /\.stop/);
  });
});

test('WZP-19: the script route returns what was typed so far', async () => {
  await withTestChat(async ({ url, token }) => {
    await post(url, '/api/tab/test/turn', token, { chat: 't1', text: 'how much is the east tour' });
    const script = (await (await post(url, '/api/tab/test/script', token, {})).json()) as { steps: { do: string; text: string }[] };
    assert.deepEqual(script.steps, [{ do: 'customer', chat: 't1', text: 'how much is the east tour' }]);
  });
});

test('WZP-16: the state tells the page a test chat is there, and the demo label to show in the header', async () => {
  await withTestChat(async ({ url, token }) => {
    const state = (await (await fetch(new URL('/api/state', url), { headers: auth(token) })).json()) as { tabs: { id: string; chip: string | null }[] };
    assert.deepEqual(state.tabs.filter((t) => t.id === 'test'), [{ id: 'test', chip: 'DEMO · Demo Tours (made-up facts)' }]);
  }, 'Demo Tours (made-up facts)');
});

test('DSH-7: a live update redraws the header, the alerts and the board list only; a tab is drawn when opened, never by a live frame', () => {
  const onFrame = /function onFrame\(s\) \{([\s\S]*?)\n  \}\n/.exec(PAGE)![1]!;
  assert.ok(!onFrame.includes('d.view') && !onFrame.includes('TAB_DEFS'), 'onFrame never draws a tab');
  assert.match(onFrame, /!homePanel\.contains\(document\.activeElement\)/, 'the open chat is left alone while someone is typing in it');
  assert.ok(!PAGE.includes('innerHTML'));
});
