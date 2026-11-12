import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { createCompany, loadCompanyConfig } from '@cyborg/company';
import type { CapabilityResult } from '@cyborg/core';
import { ScriptedModel } from '@cyborg/core/testing';
import { PAGE, startDashboard, validateTabs, type DashboardTab } from '../src/index.ts';

// feat-wazaa-port W2, WZP-40, 43, 47; docs/14 DSH-1..7: the shell and the tab contract.

const AT = '2026-11-02T09:00:00.000Z';
const capability: CapabilityResult = { baseUrl: 'http://127.0.0.1:1/v1', model: 'm', level: 'strict_schema', requestShape: 'json_schema_wrapped', logprobs: false, testedAt: AT, attempts: [] };

const tab = (over: Partial<DashboardTab> = {}): DashboardTab => ({
  id: 'bookings', label: { pt: 'Reservas', en: 'Bookings' }, level: 'simple', order: 25,
  text: { pt: { hello: 'Olá' }, en: { hello: 'Hello' } },
  routes: {
    list: ({ operator }) => ({ rows: ['a'], operator }),
    echo: ({ body }) => body,
    boom: () => { throw new Error('the office said no'); },
  },
  script: "return { draw: function (box) { box.appendChild(ctx.el('div', 'empty', ctx.t('hello'))); } };",
  ...over,
});

async function withShell<T>(options: { tabs?: DashboardTab[]; name?: string }, work: (c: { url: string; token: string; company: ReturnType<typeof createCompany> }) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'cyborg-shell-'));
  const file = join(dir, 'c.json');
  writeFileSync(file, JSON.stringify({ id: 'shell', name: 'Shell', language: 'en', store: { path: 's.sqlite', vaultPath: 'v.sqlite' }, inference: { baseUrl: 'http://127.0.0.1:1/v1', model: 'm' }, modules: { feedback: {} } }));
  const sink = (channel: string) => ({ channel, send: async () => undefined });
  const company = createCompany(loadCompanyConfig(file), { ack: sink('a'), review: sink('r') }, { model: new ScriptedModel([]), capabilities: [capability] });
  const dash = await startDashboard(company, { token: 'tok', ...options });
  try {
    return await work({ url: dash.url, token: dash.token, company });
  } finally {
    await dash.close();
    company.close();
    rmSync(dir, { recursive: true });
  }
}
const headers = (token: string) => ({ 'x-cyborg-token': token, 'x-cyborg-operator': encodeURIComponent('Ana Costa'), 'content-type': 'application/json' });
const state = async (url: string, token: string) => (await (await fetch(new URL('/api/state', url), { headers: headers(token) })).json()) as { tabs: { id: string }[] };

test('WZP-40, DSH-1, DSH-4: a tab a module contributes is in the page and the state, and a tab that is not turned on is not', async () => {
  await withShell({ tabs: [tab()] }, async ({ url, token }) => {
    const html = await (await fetch(url)).text();
    assert.ok(html.includes('"id":"bookings"') && html.includes('Reservas') && html.includes('Bookings'), 'the contributed tab and its labels reach the page');
    assert.ok(!html.includes('__TABS__') && !html.includes('__NAME__'), 'no placeholder is left in the page');
    assert.deepEqual((await state(url, token)).tabs.map((t) => t.id), ['bookings']);
  });
  await withShell({}, async ({ url, token }) => {
    const html = await (await fetch(url)).text();
    assert.ok(!html.includes('bookings') && !html.includes('Reservas'), 'no tab, no trace of one in the page');
    assert.deepEqual((await state(url, token)).tabs, []);
  });
  assert.match(PAGE, /var TAB_DEFS = \/\*__TABS__\*\/\[\];/, 'the shell itself names no tab');
});

test('WZP-40, DSH-3: a tab\'s routes are behind the token and the operator\'s name; an unknown route is 404 and a thrown error is a 400 with its message', async () => {
  await withShell({ tabs: [tab()] }, async ({ url, token }) => {
    const get = (path: string, h: Record<string, string> = headers(token)) => fetch(new URL(path, url), { headers: h });
    assert.equal((await get('/api/tab/bookings/list', {})).status, 403, 'no token, no route');
    const ok = (await (await get('/api/tab/bookings/list')).json()) as { rows: string[]; operator: string };
    assert.equal(ok.operator, 'dashboard:Ana Costa');
    const echoed = await fetch(new URL('/api/tab/bookings/echo', url), { method: 'POST', headers: headers(token), body: JSON.stringify({ a: 1 }) });
    assert.deepEqual(await echoed.json(), { a: 1 });
    assert.equal((await get('/api/tab/bookings/nothing')).status, 404);
    assert.equal((await get('/api/tab/other/list')).status, 404, 'a tab that is not on has no routes');
    const boom = await get('/api/tab/bookings/boom');
    assert.equal(boom.status, 400);
    assert.equal(((await boom.json()) as { error: string }).error, 'the office said no');
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(new URL('/api/tab/bookings/list', url), { headers: { ...headers(token), host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 403, 'the shell\'s host check covers a tab\'s routes too');
  });
});

test('WZP-40: a tab the page could not run safely is refused when the dashboard starts', () => {
  assert.throws(() => validateTabs([tab({ id: 'Bad Id' })]), /lower-case/);
  assert.throws(() => validateTabs([tab({ id: 'audit' })]), /belongs to the shell/);
  assert.throws(() => validateTabs([tab(), tab()]), /two tabs have this id/);
  assert.throws(() => validateTabs([tab({ label: { pt: 'Reservas', en: ' ' } })]), /label in en/);
  assert.throws(() => validateTabs([tab({ routes: { 'Bad Route': () => 1 } })]), /not a plain name/);
  assert.throws(() => validateTabs([tab({ script: "ctx.x = '</script><b>';" })]), /closing script tag/);
  assert.throws(() => validateTabs([tab({ script: 'return {{ broken' })]), /does not parse/);
  assert.deepEqual(validateTabs([tab({ id: 'b', order: 50 }), tab({ id: 'a', order: 5 })]).map((t) => t.id), ['a', 'b'], 'sorted by order');
});

test('WZP-40: text that could close the script block cannot, and a name with markup is escaped', async () => {
  await withShell({ tabs: [tab({ label: { pt: 'a</script><b>', en: 'x' } })], name: 'Cafe <b>"Sol"</b>' }, async ({ url }) => {
    const html = await (await fetch(url)).text();
    assert.ok(!/a<\/script><b>/.test(html), 'a closing tag in a label never reaches the page as markup');
    assert.ok(html.includes('\\u003c/script'), 'it is escaped in the script');
    assert.ok(!html.includes('<b>"Sol"</b>') && html.includes('Cafe &#60;b&#62;&#34;Sol&#34;&#60;/b&#62;'), 'the company name is escaped in the brand and the title');
  });
});

test('DSH-6, ADM-87: the three Levada fonts are bundled and served from the dashboard; nothing is fetched from outside', async () => {
  await withShell({}, async ({ url }) => {
    for (const f of ['figtree-latin-wght-normal.woff2', 'figtree-latin-ext-wght-normal.woff2', 'unbounded-latin-wght-normal.woff2', 'unbounded-latin-ext-wght-normal.woff2', 'jetbrains-mono-latin-400-normal.woff2']) {
      const res = await fetch(new URL(`/assets/fonts/${f}`, url));
      assert.equal(res.status, 200, f);
      assert.equal(res.headers.get('content-type'), 'font/woff2');
      assert.ok((await res.arrayBuffer()).byteLength > 1000);
    }
    assert.equal((await fetch(new URL('/assets/fonts/nothing.woff2', url))).status, 403, 'a name that is not a bundled font is not served and falls to the token check');
    assert.equal((await fetch(new URL('/assets/fonts/..%2Fsrc%2Fserver.ts', url))).status, 403, 'only the bundled fonts are served');
    const html = await (await fetch(url)).text();
    assert.ok(!/(?:src|href)=["']https?:/.test(html.replace(/http:\/\/www\.w3\.org/g, '')), 'no external script or style');
    assert.ok(!/url\((?:["']?)https?:/.test(html), 'no external font');
  });
});

test('DSH-6, DSH-2, DSH-7: the page is in the Levada tokens with the contour band once, has the shell tabs and the Simple and Advanced switch, and the brand is the company\'s', async () => {
  for (const colour of ['#1c211b', '#eef2e8', '#a9b6a2', '#2c342a', '#a9c48a', '#14190f', '#e9ede3', '#f7f9f3', '#e3e9da', '#5e6a58', '#b9c4b0', '#3f6a3a', '#f3f8ee', '#c4472f', '#d39b3a', '#4f8a49']) {
    assert.ok(PAGE.includes(colour), `Levada ${colour}`);
  }
  assert.equal(PAGE.split('class="contour"').length - 1, 1, 'the contour lines are the one pattern, once');
  for (const word of ['Início', 'Registo', 'Simples', 'Avançado', 'Home', 'Log', 'Simple', 'Advanced', 'urgente', 'urgent']) assert.ok(PAGE.includes(word), word);
  assert.match(PAGE, /<a class="brand" href="#\/">__NAME__<\/a>/);
  assert.ok(!PAGE.includes('Cyborg</a>') && !/<title>Cyborg/.test(PAGE), 'the framework\'s name is not the brand');
  assert.match(PAGE, /min-height:44px/, 'pill buttons are at least 44 px tall');
});

test('DSH-7: staff never see handler ids, bands or states as the system names them, and a failed action says so plainly', () => {
  assert.match(PAGE, /function handlerName\(id\)/);
  assert.ok(!/r\.handlerId \+ ' ' \+ r\.handlerVersion/.test(PAGE) && !/c\.handlerId \+ ' ' \+ c\.handlerVersion/.test(PAGE), 'the audit shows words, not ids and versions');
  assert.match(PAGE, /t\('states'\)\[v\.state\]/);
  assert.match(PAGE, /t\('bands'\)\[p\.band\]/);
  assert.match(PAGE, /function act\(btn, fn\)[\s\S]*btn\.disabled = true[\s\S]*btn\.disabled = false/, 'a button is disabled while its action runs');
  assert.match(PAGE, /Não foi possível concluir\. Tente outra vez\./);
  assert.ok(!/\.then\(refresh\)\.catch\(function \(\) \{ note\.value/.test(PAGE), 'no silent failure on the decision buttons');
});

test('DSH-2: the log tab lists the store\'s audit rows, newest first', async () => {
  await withShell({}, async ({ url, token, company }) => {
    company.store.setChatState('chat-1', 'handoff', 'dashboard:Ana', AT, 'taken over');
    company.store.setLanguage('en', 'dashboard:Ana', AT);
    const rows = ((await (await fetch(new URL('/api/log', url), { headers: headers(token) })).json()) as { rows: { id: number }[] }).rows;
    assert.ok(Array.isArray(rows));
    for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1]!.id > rows[i]!.id, 'newest first');
    assert.equal((await fetch(new URL('/api/log', url))).status, 403, 'the log needs the token');
  });
});
