import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createCompany, loadCompanyConfig } from '@cyborg/company';
import type { CapabilityResult } from '@cyborg/core';
import { ScriptedModel } from '@cyborg/core/testing';
import { modelTab, startDashboard, validateTabs, type ModelPanel, type ModelPanelView } from '../src/index.ts';

// feat-model MD2: the AI service tab. A structural stand-in for the company's ModelControl.

const capability: CapabilityResult = { baseUrl: 'http://127.0.0.1:1/v1', model: 'm', level: 'strict_schema', requestShape: 'json_schema_wrapped', logprobs: false, testedAt: '2026-11-06T00:00:00.000Z', attempts: [] };
const PRESETS = [{ id: 'openrouter', label: { pt: 'OpenRouter', en: 'OpenRouter' }, baseUrl: 'https://openrouter.ai/api/v1', local: false }, { id: 'custom', label: { pt: 'Outro endereço', en: 'Another address' }, baseUrl: '', local: false }];

function panel() {
  const calls: { op: string; input: unknown; by?: string }[] = [];
  let view: ModelPanelView = { baseUrl: 'https://openrouter.ai/api/v1', model: 'vendor/model', keySet: false, local: false, presets: PRESETS, needsRestart: false };
  const p: ModelPanel = {
    view: () => view,
    test: async (input) => { calls.push({ op: 'test', input }); return input.apiKey === 'bad' ? { ok: false, kind: 'key_refused', level: 'none' } : { ok: true, kind: 'works', level: 'strict_schema' }; },
    save: async (input, by) => { calls.push({ op: 'save', input, by }); view = { ...view, baseUrl: input.baseUrl, model: input.model, keySet: true }; return view; },
  };
  return { p, calls };
}

async function withTab<T>(p: ModelPanel, work: (c: { url: string; token: string }) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'cyborg-mdl-'));
  const file = join(dir, 'c.json');
  writeFileSync(file, JSON.stringify({ id: 'cfg', name: 'Cfg', language: 'en', store: { path: 's.sqlite', vaultPath: 'v.sqlite' }, inference: { baseUrl: 'http://127.0.0.1:1/v1', model: 'm' }, modules: { feedback: {} } }));
  const sink = (channel: string) => ({ channel, send: async () => undefined });
  const company = createCompany(loadCompanyConfig(file), { ack: sink('a'), review: sink('r') }, { model: new ScriptedModel([]), capabilities: [capability] });
  const dash = await startDashboard(company, { token: 'tok', tabs: [modelTab(p)] });
  try {
    return await work({ url: dash.url, token: dash.token });
  } finally {
    await dash.close();
    company.close();
    rmSync(dir, { recursive: true });
  }
}
const h = (token: string) => ({ 'x-cyborg-token': token, 'x-cyborg-operator': encodeURIComponent('Ana Costa'), 'content-type': 'application/json' });

test('MDL-1: the tab is valid, in both languages, and carries the words for the verdicts', async () => {
  const { p } = panel();
  validateTabs([modelTab(p)]);
  await withTab(p, async ({ url }) => {
    const html = await (await fetch(url)).text();
    assert.ok(html.includes('Serviço de IA') && html.includes('AI service'));
    for (const w of ['O serviço recusou a chave', 'The service refused the key', 'Experimente primeiro', 'Test first']) assert.ok(html.includes(w), w);
  });
});

test('MDL-2, MDL-10: the routes need the token; the view carries no key; Test and Save pass what was typed and the operator on', async () => {
  const { p, calls } = panel();
  await withTab(p, async ({ url, token }) => {
    assert.equal((await fetch(new URL('/api/tab/model/view', url))).ok, false, 'no token, no view');
    const view = (await (await fetch(new URL('/api/tab/model/view', url), { headers: h(token) })).json()) as object;
    assert.deepEqual(Object.keys(view).sort(), ['baseUrl', 'keySet', 'local', 'model', 'needsRestart', 'presets']);
    const t = (await (await fetch(new URL('/api/tab/model/test', url), { method: 'POST', headers: h(token), body: JSON.stringify({ baseUrl: 'https://x.test/v1', model: 'm1', apiKey: 'sk-typed' }) })).json()) as { ok: boolean };
    assert.equal(t.ok, true);
    const bad = (await (await fetch(new URL('/api/tab/model/test', url), { method: 'POST', headers: h(token), body: JSON.stringify({ baseUrl: 'https://x.test/v1', model: 'm1', apiKey: 'bad' }) })).json()) as { kind: string };
    assert.equal(bad.kind, 'key_refused');
    const saved = (await (await fetch(new URL('/api/tab/model/save', url), { method: 'POST', headers: h(token), body: JSON.stringify({ baseUrl: 'https://x.test/v1', model: 'm1', apiKey: 'sk-typed' }) })).json()) as { keySet: boolean };
    assert.equal(saved.keySet, true);
    assert.ok(!JSON.stringify(saved).includes('sk-typed'), 'the key never comes back');
    assert.deepEqual(calls.map((c) => c.op), ['test', 'test', 'save']);
    assert.equal(calls[2]!.by, 'dashboard:Ana Costa');
    assert.deepEqual(calls[2]!.input, { baseUrl: 'https://x.test/v1', model: 'm1', apiKey: 'sk-typed' });
  });
});
