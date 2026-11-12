import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createCompany, loadCompanyConfig } from '@cyborg/company';
import type { CapabilityResult } from '@cyborg/core';
import { ScriptedModel } from '@cyborg/core/testing';
import { checkChoices, configureTab, startDashboard, validateTabs, type ChatDirectory, type DirectoryChat, type DirectoryChoice } from '../src/index.ts';

// feat-wazaa-port W4, WZP-31..39: the Configurar tab and the rules every channel's directory gets. The directory here is a structural stand-in
// for a channel adapter (the way ScriptedModel stands in for the model); the real one is tested in the adapter's repository.

const AT = '2026-11-02T09:00:00.000Z';
const capability: CapabilityResult = { baseUrl: 'http://127.0.0.1:1/v1', model: 'm', level: 'strict_schema', requestShape: 'json_schema_wrapped', logprobs: false, testedAt: AT, attempts: [] };

const CHATS: DirectoryChat[] = [
  { ref: 'wa-aaaaaaaaaaaa', name: 'Ana (tours)', kind: 'person', role: 'ignored' },
  { ref: 'wa-bbbbbbbbbbbb', name: 'Equipa frota', kind: 'group', members: 9, role: 'ignored' },
  { ref: 'wa-cccccccccccc', name: null, kind: 'person', role: 'ignored' },
];

function stub(over: Partial<{ ready: boolean }> = {}) {
  const saved: { choices: DirectoryChoice[]; by: string }[] = [];
  const directory: ChatDirectory = {
    chats: async () => ({ ready: over.ready ?? true, chats: over.ready === false ? [] : CHATS }),
    save: async (choices, by) => { saved.push({ choices, by }); return { watching: choices.filter((c) => c.role !== 'ignored').length }; },
  };
  return { directory, saved };
}

async function withTab<T>(directory: ChatDirectory, work: (c: { url: string; token: string }) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'cyborg-cfg-'));
  const file = join(dir, 'c.json');
  writeFileSync(file, JSON.stringify({ id: 'cfg', name: 'Cfg', language: 'en', store: { path: 's.sqlite', vaultPath: 'v.sqlite' }, inference: { baseUrl: 'http://127.0.0.1:1/v1', model: 'm' }, modules: { feedback: {} } }));
  const sink = (channel: string) => ({ channel, send: async () => undefined });
  const company = createCompany(loadCompanyConfig(file), { ack: sink('a'), review: sink('r') }, { model: new ScriptedModel([]), capabilities: [capability] });
  const dash = await startDashboard(company, { token: 'tok', tabs: [configureTab(directory)] });
  try {
    return await work({ url: dash.url, token: dash.token });
  } finally {
    await dash.close();
    company.close();
    rmSync(dir, { recursive: true });
  }
}
const h = (token: string) => ({ 'x-cyborg-token': token, 'x-cyborg-operator': encodeURIComponent('Ana Costa'), 'content-type': 'application/json' });

test('WZP-36, WZP-38: the rules every channel gets: a known role, one office chat, no chat twice, something to save', () => {
  assert.deepEqual(checkChoices({ choices: [{ ref: 'a', role: 'reply' }, { ref: 'b', role: 'ops' }] }), [{ ref: 'a', role: 'reply' }, { ref: 'b', role: 'ops' }]);
  assert.throws(() => checkChoices({}), /nothing to save/);
  assert.throws(() => checkChoices({ choices: [] }), /nothing to save/);
  assert.throws(() => checkChoices({ choices: [{ ref: 'a', role: 'boss' }] }), /not something the bot can do/);
  assert.throws(() => checkChoices({ choices: [{ ref: '', role: 'reply' }] }), /no chat/);
  assert.throws(() => checkChoices({ choices: [{ ref: 'a', role: 'reply' }, { ref: 'a', role: 'monitor' }] }), /twice/);
  assert.throws(() => checkChoices({ choices: [{ ref: 'a', role: 'ops' }, { ref: 'b', role: 'ops' }] }), /only one chat can be the office/);
  assert.throws(() => checkChoices({ choices: Array.from({ length: 501 }, (_, i) => ({ ref: `c${i}`, role: 'reply' })) }), /more than 500/);
});

test('WZP-34: a choice may carry the intake tasks done in that chat; they are checked, and a chat the bot ignores has none', () => {
  assert.deepEqual(checkChoices({ choices: [{ ref: 'a', role: 'reply', tasks: ['Answering customer questions'] }] }), [{ ref: 'a', role: 'reply', tasks: ['Answering customer questions'] }]);
  assert.deepEqual(checkChoices({ choices: [{ ref: 'a', role: 'reply', tasks: [] }] })[0]!.tasks, [], 'none ticked is a choice too');
  assert.throws(() => checkChoices({ choices: [{ ref: 'a', role: 'ignored', tasks: ['x'] }] }), /ignores has no tasks/);
  assert.throws(() => checkChoices({ choices: [{ ref: 'a', role: 'reply', tasks: [''] }] }), /short list of names/);
  assert.throws(() => checkChoices({ choices: [{ ref: 'a', role: 'reply', tasks: 'x' }] }), /short list of names/);
  assert.throws(() => checkChoices({ choices: [{ ref: 'a', role: 'reply', tasks: Array.from({ length: 41 }, () => 't') }] }), /short list of names/);
});

test('WZP-34: the tab offers the client\'s intake tasks to the chats of their kind, and the page lists the ones that fit the chat\'s role', async () => {
  const { directory } = stub();
  const tasks = [{ title: 'Answering customer questions', roles: ['reply' as const] }, { title: 'Due dates and maintenance', roles: ['monitor' as const, 'ops' as const] }];
  const dir = mkdtempSync(join(tmpdir(), 'cyborg-cfg-'));
  const file = join(dir, 'c.json');
  writeFileSync(file, JSON.stringify({ id: 'cfg', name: 'Cfg', language: 'en', store: { path: 's.sqlite', vaultPath: 'v.sqlite' }, inference: { baseUrl: 'http://127.0.0.1:1/v1', model: 'm' }, modules: { feedback: {} } }));
  const sink = (channel: string) => ({ channel, send: async () => undefined });
  const company = createCompany(loadCompanyConfig(file), { ack: sink('a'), review: sink('r') }, { model: new ScriptedModel([]), capabilities: [capability] });
  const dash = await startDashboard(company, { token: 'tok', tabs: [configureTab(directory, { tasks })] });
  try {
    const listing = (await (await fetch(new URL('/api/tab/configure/chats', dash.url), { headers: h('tok') })).json()) as { tasks: unknown };
    assert.deepEqual(listing.tasks, tasks);
    const html = await (await fetch(dash.url)).text();
    assert.ok(html.includes('Tarefas do cliente nesta conversa') && /tasks in this chat/.test(html), 'the words for tasks are in the page in both languages');
  } finally {
    await dash.close();
    company.close();
    rmSync(dir, { recursive: true });
  }
});

test('WZP-31: the Configurar tab lists chats by name and kind with the reference only; the page gets no number or address', async () => {
  const { directory } = stub();
  await withTab(directory, async ({ url, token }) => {
    const raw = await (await fetch(new URL('/api/tab/configure/chats', url), { headers: h(token) })).text();
    const listing = JSON.parse(raw) as { ready: boolean; chats: Record<string, unknown>[] };
    assert.equal(listing.ready, true);
    assert.deepEqual(listing.chats.map((c) => c['name']), ['Ana (tours)', 'Equipa frota', null], 'a chat that is only a number has no name for the page to show');
    for (const c of listing.chats) assert.deepEqual(Object.keys(c).filter((k) => !['ref', 'name', 'kind', 'members', 'lastAt', 'role'].includes(k)), [], 'only the contract\'s fields');
    assert.ok(!/@c\.us|@g\.us|@lid/.test(raw), 'no WhatsApp address');
    assert.ok(listing.chats.every((c) => c['role'] === 'ignored'), 'WZP-32: nothing is read until a person chooses');
  });
});

test('WZP-35, WZP-38: saving hands the checked choices and the operator\'s name to the directory; a broken rule is a 400 with its message and nothing is saved', async () => {
  const { directory, saved } = stub();
  await withTab(directory, async ({ url, token }) => {
    const post = (body: unknown) => fetch(new URL('/api/tab/configure/save', url), { method: 'POST', headers: h(token), body: JSON.stringify(body) });
    const ok = await post({ choices: [{ ref: 'wa-aaaaaaaaaaaa', role: 'reply' }, { ref: 'wa-bbbbbbbbbbbb', role: 'monitor' }] });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { watching: 2 });
    assert.deepEqual(saved, [{ choices: [{ ref: 'wa-aaaaaaaaaaaa', role: 'reply' }, { ref: 'wa-bbbbbbbbbbbb', role: 'monitor' }], by: 'dashboard:Ana Costa' }]);
    const bad = await post({ choices: [{ ref: 'wa-aaaaaaaaaaaa', role: 'ops' }, { ref: 'wa-bbbbbbbbbbbb', role: 'ops' }] });
    assert.equal(bad.status, 400);
    assert.match(((await bad.json()) as { error: string }).error, /only one chat can be the office/);
    assert.equal(saved.length, 1, 'the refused save never reached the directory');
    assert.equal((await fetch(new URL('/api/tab/configure/save', url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 403, 'it needs the token');
  });
});

test('WZP-30: before the channel is linked the tab says so and lists nothing', async () => {
  const { directory } = stub({ ready: false });
  await withTab(directory, async ({ url, token }) => {
    assert.deepEqual(await (await fetch(new URL('/api/tab/configure/chats', url), { headers: h(token) })).json(), { ready: false, chats: [], tasks: [] });
  });
});

test('WZP-40, DSH-7: the Configurar tab is a valid tab, in both languages, with its words in the staff language and text put on the page as text', () => {
  const tab = configureTab(stub().directory);
  assert.doesNotThrow(() => validateTabs([tab]));
  assert.deepEqual([tab.label.pt, tab.label.en], ['Configurar', 'Configure']);
  assert.equal(tab.level, 'simple');
  for (const lang of ['pt', 'en'] as const) {
    assert.deepEqual(Object.keys(tab.text![lang]['roles'] as Record<string, string>).sort(), ['ignored', 'monitor', 'ops', 'reply']);
    assert.ok(Object.keys(tab.text!.pt).every((k) => k in tab.text!.en) && Object.keys(tab.text!.en).every((k) => k in tab.text!.pt), 'the two languages have the same keys');
  }
  assert.ok(!tab.script.includes('innerHTML'));
  assert.ok(tab.script.includes('el(') && !tab.script.includes('document.write'), 'built with the shell\'s el()');
});

test('WZP-5: while the agreement is not recorded the tab gets the fine print and no chats; agreeing goes through the channel and a refusal is shown', async () => {
  let recorded: { at: string } | null = null;
  const agreement = () => ({ text: { pt: ['Letra pequena.'], en: ['Fine print.'] }, terms: null, version: 'v1', recorded });
  const agreed: { version: string; by: string }[] = [];
  const directory: ChatDirectory = {
    chats: async () => (recorded ? { ready: true, chats: CHATS, agreement: agreement() } : { ready: true, chats: [], agreement: agreement() }),
    save: async () => ({ watching: 0 }),
    agree: async (version, by) => {
      if (version !== 'v1') throw new Error('the fine print has changed: read it again');
      agreed.push({ version, by });
      recorded = { at: AT };
    },
  };
  await withTab(directory, async ({ url, token }) => {
    const before = (await (await fetch(new URL('/api/tab/configure/chats', url), { headers: h(token) })).json()) as { chats: unknown[]; agreement: { recorded: unknown } };
    assert.deepEqual(before.chats, []);
    assert.equal(before.agreement.recorded, null);
    const bad = await fetch(new URL('/api/tab/configure/agree', url), { method: 'POST', headers: h(token), body: JSON.stringify({ version: 'old' }) });
    assert.ok(!bad.ok);
    assert.match(await bad.text(), /has changed/);
    assert.equal((await fetch(new URL('/api/tab/configure/agree', url), { method: 'POST', headers: h(token), body: JSON.stringify({}) })).ok, false, 'no version');
    const ok = await fetch(new URL('/api/tab/configure/agree', url), { method: 'POST', headers: h(token), body: JSON.stringify({ version: 'v1' }) });
    assert.ok(ok.ok);
    assert.deepEqual(agreed, [{ version: 'v1', by: 'dashboard:Ana Costa' }]);
    const after = (await (await fetch(new URL('/api/tab/configure/chats', url), { headers: h(token) })).json()) as { chats: unknown[] };
    assert.equal(after.chats.length, 3);
    const html = await (await fetch(url)).text();
    assert.ok(html.includes('Antes de começar: letra pequena') && html.includes('Before we start: the fine print'), 'the words are in the page in both languages');
  });
});

test('WZP-5: a channel that needs no agreement refuses the route', async () => {
  const { directory } = stub();
  await withTab(directory, async ({ url, token }) => {
    const r = await fetch(new URL('/api/tab/configure/agree', url), { method: 'POST', headers: h(token), body: JSON.stringify({ version: 'v1' }) });
    assert.ok(!r.ok);
    assert.match(await r.text(), /needs no agreement/);
  });
});

// feat-wazaa-port WZP-85: Unlink. The directory here stands in for the channel; the channel's own unlink is tested in its package.
test('WZP-85: the tab shows the linked account and Unlink works behind the dashboard token, with the operator\'s label', async () => {
  const unlinked: string[] = [];
  const { directory } = stub();
  directory.account = () => '+351912345678';
  directory.unlink = async (by) => { unlinked.push(by); return { loggedOut: true }; };
  await withTab(directory, async ({ url, token }) => {
    const listing = (await (await fetch(new URL('/api/tab/configure/chats', url), { headers: h(token) })).json()) as { link?: { account: string | null } };
    assert.deepEqual(listing.link, { account: '+351912345678' });
    assert.equal((await fetch(new URL('/api/tab/configure/unlink', url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 403, 'it needs the token');
    assert.deepEqual(unlinked, [], 'nothing happened without the token');
    const done = await fetch(new URL('/api/tab/configure/unlink', url), { method: 'POST', headers: h(token), body: '{}' });
    assert.equal(done.status, 200);
    assert.deepEqual(await done.json(), { loggedOut: true });
    assert.deepEqual(unlinked, ['dashboard:Ana Costa']);
  });
});

test('WZP-85: a channel that cannot unlink shows no Unlink and the route says so', async () => {
  const { directory } = stub();
  await withTab(directory, async ({ url, token }) => {
    const listing = (await (await fetch(new URL('/api/tab/configure/chats', url), { headers: h(token) })).json()) as Record<string, unknown>;
    assert.ok(!('link' in listing));
    const res = await fetch(new URL('/api/tab/configure/unlink', url), { method: 'POST', headers: h(token), body: '{}' });
    assert.notEqual(res.status, 200);
    assert.match(JSON.stringify(await res.json()), /cannot be unlinked/);
  });
});

test('WZP-85: the page asks first and only the second press unlinks', async () => {
  const { directory } = stub();
  directory.unlink = async () => ({ loggedOut: true });
  await withTab(directory, async ({ url }) => {
    const html = await (await fetch(url)).text();
    assert.ok(html.includes('Unlink WhatsApp') && html.includes('Desligar o WhatsApp'), 'the button is in the page in both languages');
    assert.ok(html.includes('This logs the account out of this computer. Chats stay on the phone.'));
    // the first press only shows the question and the yes/cancel buttons; the call to the unlink route is inside the yes button's handler
    const script = html.slice(html.indexOf("t('lkAsk')"));
    assert.ok(script.indexOf("api('POST', 'unlink'") > script.indexOf("t('lkYes')"), 'the unlink call comes after the Yes button, not on the first press');
  });
});
