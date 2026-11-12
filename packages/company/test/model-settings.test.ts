import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import type { CapabilityResult } from '@cyborg/core';
import { MODEL_KEY_ENV, ModelControl, applyModelSettings, createCompany, loadCompanyConfig, readModelSettings, verdictOf, writeModelSettings } from '../src/index.ts';
import { enforcing, startServer, type FakeServer } from '../../gateway/test/fake-server.ts';

// feat-model MD1: the AI service saved in the install's data folder, applied at start and to the running company, the key kept in the file only.

const servers: FakeServer[] = [];
afterEach(async () => { while (servers.length) await servers.pop()!.close(); });
const answer = JSON.stringify({ value: 'x', phrase: 'x' });
const attempt = (httpStatus: number | null, error?: string) => ({ shape: 'json_schema_wrapped' as const, httpStatus, trials: 1, validJson: 0, conforming: 0, ...(error ? { error } : {}) });
const result = (level: CapabilityResult['level'], attempts: ReturnType<typeof attempt>[]): CapabilityResult => ({ baseUrl: 'u', model: 'm', level, requestShape: null, logprobs: false, testedAt: '2026-11-06T00:00:00.000Z', attempts });

function install(baseUrl: string, apiKeyEnv?: string) {
  const dir = mkdtempSync(join(tmpdir(), 'cyborg-model-'));
  const file = join(dir, 'company.config.json');
  writeFileSync(file, JSON.stringify({ id: 'm', name: 'M', language: 'en', store: { path: 'data/s.sqlite', vaultPath: 'data/v.sqlite' }, inference: { baseUrl, model: 'first', ...(apiKeyEnv ? { apiKeyEnv } : {}) }, modules: { feedback: {} } }));
  return { dir, file, data: join(dir, 'data') };
}

test('MDL-4: the capability result is put in words: works, key refused, unreachable, model not found, busy, or no structured output', () => {
  assert.equal(verdictOf(result('strict_schema', [attempt(200)])).kind, 'works');
  assert.equal(verdictOf(result('none', [attempt(401)])).kind, 'key_refused');
  assert.equal(verdictOf(result('none', [attempt(402)])).kind, 'key_refused');
  assert.equal(verdictOf(result('none', [attempt(null, 'request failed')])).kind, 'unreachable');
  assert.equal(verdictOf(result('none', [attempt(404)])).kind, 'model_not_found');
  assert.equal(verdictOf(result('none', [attempt(503)])).kind, 'busy');
  assert.equal(verdictOf(result('none', [attempt(200)])).kind, 'no_structured');
  assert.equal(verdictOf(result('json_object', [attempt(200)])).ok, true);
});

test('MDL-6, MDL-7: the saved settings are owner-only, replace the config\'s address and model at start, and hand the key to the gateway through the environment only', () => {
  const { dir, file, data } = install('http://127.0.0.1:1/v1', 'MY_OLD_KEY');
  try {
    const env: NodeJS.ProcessEnv = {};
    assert.equal(applyModelSettings(loadCompanyConfig(file), data, env), null, 'no file, nothing applied');
    writeModelSettings(data, { baseUrl: 'https://api.example.test/v1', model: 'big', apiKey: 'sk-secret-value-123456' });
    assert.equal(statSync(join(data, 'model.json')).mode & 0o777, 0o600);
    const loaded = loadCompanyConfig(file);
    const applied = applyModelSettings(loaded, data, env);
    assert.equal(applied?.model, 'big');
    assert.equal(loaded.config.inference.baseUrl, 'https://api.example.test/v1');
    assert.equal(loaded.config.inference.model, 'big');
    assert.equal(loaded.config.inference.apiKeyEnv, MODEL_KEY_ENV, 'a key saved in the dashboard wins over the variable the config names');
    assert.equal(env[MODEL_KEY_ENV], 'sk-secret-value-123456');
    assert.ok(!readFileSync(file, 'utf8').includes('sk-secret'), 'the customer\'s config file is not rewritten');
    writeModelSettings(data, { baseUrl: 'http://127.0.0.1:8081/v1', model: 'local' });
    const local = loadCompanyConfig(file);
    applyModelSettings(local, data, {});
    assert.equal(local.config.inference.apiKeyEnv, 'MY_OLD_KEY', 'no saved key: the config\'s own variable stays');
    assert.deepEqual(readModelSettings(data), { baseUrl: 'http://127.0.0.1:8081/v1', model: 'local' });
    writeFileSync(join(data, 'model.json'), '{broken');
    assert.equal(readModelSettings(data), null, 'a damaged file is no file');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

async function control() {
  const a = await startServer(enforcing('wrapped', answer));
  const b = await startServer(enforcing('wrapped', answer));
  servers.push(a, b);
  const { dir, file, data } = install(a.baseUrl);
  const loaded = loadCompanyConfig(file);
  const sink = (channel: string) => ({ channel, send: async () => undefined });
  const company = createCompany(loaded, { ack: sink('a'), review: sink('r') }, {});
  const env: NodeJS.ProcessEnv = {};
  const ctl = new ModelControl({ company, loaded, dataDir: data, env });
  return { a, b, dir, data, loaded, company, env, ctl, done: () => { company.close(); rmSync(dir, { recursive: true }); } };
}

test('MDL-1, MDL-2, MDL-3: the view is the preconfigured address and model, whether a key is set, and presets that fill the address only', async () => {
  const r = await control();
  try {
    const v = r.ctl.view();
    assert.equal(v.baseUrl, r.a.baseUrl);
    assert.equal(v.model, 'first');
    assert.equal(v.keySet, false);
    assert.equal(v.local, true);
    assert.ok(v.presets.some((p) => p.id === 'openrouter') && v.presets.some((p) => p.id === 'custom'));
    assert.ok(v.presets.every((p) => !('model' in p)), 'a preset never names a model');
  } finally { r.done(); }
});

test('MDL-4, MDL-5: Save needs a Test of exactly those values; then the file, the config, the live gateway and the audit row carry them and the key stays out of the view and the audit', async () => {
  const r = await control();
  try {
    await assert.rejects(r.ctl.save({ baseUrl: r.b.baseUrl, model: 'second', apiKey: 'sk-abc123456789' }, 'dashboard:Ana'), /press Test first/);
    const t = await r.ctl.test({ baseUrl: r.b.baseUrl, model: 'second', apiKey: 'sk-abc123456789' });
    assert.equal(t.ok, true);
    assert.equal(r.b.requests[0]!.headers['authorization'], 'Bearer sk-abc123456789', 'the key typed is the one sent');
    assert.equal(readModelSettings(r.data), null, 'a Test saves nothing');
    await assert.rejects(r.ctl.save({ baseUrl: r.b.baseUrl, model: 'other-model', apiKey: 'sk-abc123456789' }, 'x'), /press Test first/, 'a different model was not tested');
    await assert.rejects(r.ctl.save({ baseUrl: r.b.baseUrl, model: 'second', apiKey: 'sk-different-9999' }, 'x'), /press Test first/, 'a different key was not tested');
    const v = await r.ctl.save({ baseUrl: r.b.baseUrl, model: 'second', apiKey: 'sk-abc123456789' }, 'dashboard:Ana');
    assert.equal(v.baseUrl, r.b.baseUrl);
    assert.equal(v.model, 'second');
    assert.equal(v.keySet, true);
    assert.ok(!JSON.stringify(v).includes('sk-abc'), 'the page never gets the key');
    assert.deepEqual(readModelSettings(r.data), { baseUrl: r.b.baseUrl, model: 'second', apiKey: 'sk-abc123456789' });
    assert.equal(statSync(join(r.data, 'model.json')).mode & 0o777, 0o600);
    assert.equal(r.loaded.config.inference.model, 'second');
    assert.equal(r.env[MODEL_KEY_ENV], 'sk-abc123456789');
    assert.equal(r.company.store.latestCapability(r.b.baseUrl, 'second')?.level, 'strict_schema', 'the tested result is stored (GWY-10)');
    const audit = r.company.store.listAudit().filter((x) => x.kind === 'model_changed');
    assert.equal(audit.length, 1);
    assert.equal(audit[0]!.actor, 'dashboard:Ana');
    assert.ok(!JSON.stringify(audit[0]).includes('sk-abc'), 'MDL-8: no key in the audit');
    await assert.rejects(r.ctl.save({ baseUrl: r.b.baseUrl, model: 'second', apiKey: 'sk-abc123456789' }, 'x'), /press Test first/, 'a Save uses up its Test');
  } finally { r.done(); }
});

test('MDL-4, MDL-5: a refused key or an unreachable address is said plainly and cannot be saved; bad input is refused before any call', async () => {
  const r = await control();
  try {
    const refusing = await startServer(() => ({ status: 401 }));
    servers.push(refusing);
    const t = await r.ctl.test({ baseUrl: refusing.baseUrl, model: 'm', apiKey: 'sk-nope1234567' });
    assert.equal(t.kind, 'key_refused');
    await assert.rejects(r.ctl.save({ baseUrl: refusing.baseUrl, model: 'm', apiKey: 'sk-nope1234567' }, 'x'), /press Test first/);
    const gone = await r.ctl.test({ baseUrl: 'http://127.0.0.1:1/v1', model: 'm' });
    assert.equal(gone.kind, 'unreachable');
    await assert.rejects(r.ctl.test({ baseUrl: 'not an address', model: 'm' }), /http/);
    await assert.rejects(r.ctl.test({ baseUrl: r.b.baseUrl, model: '  ' }), /name of the model/);
    await assert.rejects(r.ctl.test({ baseUrl: r.b.baseUrl, model: 'm', apiKey: 'two words' }), /does not look like a key/);
    assert.equal(r.b.requests.length, 0, 'nothing was sent for bad input');
  } finally { r.done(); }
});

test('MDL-2: an empty key box keeps the key already in use for the same address', async () => {
  const r = await control();
  try {
    r.loaded.config.inference.apiKeyEnv = 'ALREADY_SET';
    (r.env as Record<string, string>)['ALREADY_SET'] = 'sk-existing-key-1';
    const t = await r.ctl.test({ baseUrl: r.a.baseUrl, model: 'again' });
    assert.equal(t.ok, true);
    assert.equal(r.a.requests.at(-1)!.headers['authorization'], 'Bearer sk-existing-key-1');
    const v = await r.ctl.save({ baseUrl: r.a.baseUrl, model: 'again' }, 'x');
    assert.equal(v.keySet, true);
    assert.equal(readModelSettings(r.data)?.apiKey, 'sk-existing-key-1');
  } finally { r.done(); }
});

