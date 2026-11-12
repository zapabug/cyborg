import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { HandlerRegistry, Runner, StoreNotifier, type AdminNotifier } from '@cyborg/core';
import { echoHandler, textEvent } from '@cyborg/core/testing';
import { SqliteStore } from '@cyborg/store-sqlite';
import { classifyFailure, OpenAIGateway } from '../src/index.ts';
import { enforcing, startServer, type FakeServer, type Reply } from './fake-server.ts';

const answer = JSON.stringify({ value: 'beta', phrase: 'beta' });
const servers: FakeServer[] = [];
afterEach(async () => {
  while (servers.length) await servers.pop()!.close();
});

test('GWY-24: a rejected key or an empty account is a credential failure; a plain rate limit or server error is not', () => {
  for (const status of [401, 402, 403]) assert.equal(classifyFailure(status, '{}'), 'credential', String(status));
  assert.equal(classifyFailure(429, '{"error":{"message":"You exceeded your current quota, check billing"}}'), 'credential');
  assert.equal(classifyFailure(429, '{"error":{"message":"Key limit exceeded (total limit)"}}'), 'credential');
  assert.equal(classifyFailure(429, '{"error":{"message":"temporarily rate-limited upstream"}}'), 'other');
  assert.equal(classifyFailure(500, 'boom'), 'other');
  assert.equal(classifyFailure(400, 'bad request'), 'other');
});

async function rig(after: () => Reply | null) {
  let mode: 'ok' | 'bad' = 'ok';
  const handlerCalls = { n: 0 };
  const server = await startServer((body, nth) => {
    if (nth <= 4) return enforcing('wrapped', answer)(body, nth); // the capability test
    handlerCalls.n++;
    return mode === 'bad' ? (after() ?? { status: 403 }) : enforcing('wrapped', answer)(body, nth);
  });
  servers.push(server);
  const store = new SqliteStore(':memory:');
  const gateway = new OpenAIGateway({ endpoint: { baseUrl: server.baseUrl, apiKeyEnv: 'TEST_KEY' } }, { capabilities: store, ledger: store, env: { TEST_KEY: 'sk-test-secret-123' } });
  await gateway.runCapabilityTest('m1');
  const alerts: { kind: string; detail: string }[] = [];
  const store_ = new StoreNotifier(store);
  const notifier: Pick<AdminNotifier, 'alert' | 'resolved'> = {
    alert: async (a) => { alerts.push(a); await store_.alert(a); },
    resolved: (what) => store_.resolved(what),
  };
  const registry = new HandlerRegistry({ autoReplyHandlers: [] });
  registry.registerHandler(echoHandler({ model: { level: 'json_object', name: 'm1' } }));
  const runner = new Runner({ businessId: 'b', registry, store, ledger: store, model: gateway, notifier, now: () => new Date('2026-10-31T10:00:00.000Z') });
  return { server, store, runner, alerts, handlerCalls, setMode: (m: 'ok' | 'bad') => (mode = m) };
}

test('ADM-44, GWY-24: a rejected key stops inference, keeps the message for later, alerts the admin once, and a person clears it', async () => {
  const env = await rig(() => ({ status: 403 }));
  env.setMode('bad');
  const first = (await env.runner.handle(textEvent('e1')))[0]!;
  assert.equal(first.outcome, 'refused');
  assert.match((first as { reason: string }).reason, /rejected the key or reports no credit \(HTTP 403\)/);
  assert.equal(env.handlerCalls.n, 1, 'one request, no retry');
  assert.equal(env.store.hasRun({ source: 'test-source', eventId: 'e1', handlerId: 'test.echo' }), false, 'the customer message is not used up');
  assert.equal(env.store.list().length, 0, 'no invalid_output proposal either');
  assert.equal(env.alerts.length, 1);
  assert.deepEqual(env.store.listOpenAlerts().map((a) => [a.kind, a.ref]), [['inference_key', '']], 'ADM-45: also on the dashboard list');
  assert.equal(env.alerts[0]!.kind, 'inference_key');
  assert.match(env.alerts[0]!.detail, /not answering customers until this is fixed/);
  assert.ok(!JSON.stringify([env.alerts, env.store.listAudit()]).includes('sk-test-secret-123'), 'the key is nowhere in the alert or the audit log');
  assert.deepEqual(env.runner.inferenceBlocked && Object.keys(env.runner.inferenceBlocked).sort(), ['at', 'detail']);

  // Blocked: the next message makes no request at all.
  const second = (await env.runner.handle(textEvent('e2')))[0]!;
  assert.equal(second.outcome, 'refused');
  assert.equal(env.handlerCalls.n, 1);
  assert.equal(env.alerts.length, 1, 'one alert, not one per message');
  assert.equal(env.store.listAudit().filter((a) => a.kind === 'inference_blocked').length, 1);

  // The admin fixes the key; a person clears the block; the same message now runs.
  env.setMode('ok');
  env.runner.resetInferenceProblem('person:admin');
  assert.equal(env.runner.inferenceBlocked, null);
  assert.deepEqual(env.store.listOpenAlerts(), [], 'ADM-48: the dashboard list is empty once a person has cleared it');
  assert.ok(env.store.listAudit().some((a) => a.kind === 'inference_problem_cleared' && a.actor === 'person:admin'));
  const again = (await env.runner.handle(textEvent('e1')))[0]!;
  assert.equal(again.outcome, 'proposal');
});

test('GWY-24: 401, 402 and a 429 that says the quota is gone all block; an ordinary 429 is retried and does not', async () => {
  for (const reply of [{ status: 401 }, { status: 402 }, { status: 429, rawBody: '{"error":{"message":"insufficient_quota: add credit"}}' }] as Reply[]) {
    const env = await rig(() => reply);
    env.setMode('bad');
    assert.equal((await env.runner.handle(textEvent('e1')))[0]!.outcome, 'refused', JSON.stringify(reply));
    assert.notEqual(env.runner.inferenceBlocked, null);
  }
  const rateLimited = await rig(() => ({ status: 429, rawBody: '{"error":{"message":"temporarily rate-limited upstream"}}' }));
  rateLimited.setMode('bad');
  const out = (await rateLimited.runner.handle(textEvent('e1')))[0]!;
  assert.equal(out.outcome, 'proposal');
  assert.equal((out as { proposal: { status: string } }).proposal.status, 'invalid_output', 'the normal retry-then-invalid path');
  assert.equal(rateLimited.handlerCalls.n, 2, 'one retry');
  assert.equal(rateLimited.runner.inferenceBlocked, null);
  assert.equal(rateLimited.alerts.length, 0);
});

test('ADM-44: a notifier that throws is logged and does not stop the refusal', async () => {
  const env = await rig(() => ({ status: 403 }));
  const registry = new HandlerRegistry({ autoReplyHandlers: [] });
  registry.registerHandler(echoHandler({ model: { level: 'json_object', name: 'm1' } }));
  const broken = new Runner({
    businessId: 'b', registry, store: env.store, ledger: env.store,
    model: new OpenAIGateway({ endpoint: { baseUrl: env.server.baseUrl } }, { capabilities: env.store, ledger: env.store }),
    notifier: { alert: async () => { throw new Error('toast daemon is not running'); } },
  });
  env.setMode('bad');
  assert.equal((await broken.handle(textEvent('e9')))[0]!.outcome, 'refused');
  assert.equal(env.store.listAudit().filter((a) => a.kind === 'admin_ping_failed').length, 1);
});

test('PRF-81: the upgrade digest lists the key problem and the blocked messages', async () => {
  const { buildUpgradeDigest } = await import('@cyborg/core');
  const env = await rig(() => ({ status: 403 }));
  env.setMode('bad');
  await env.runner.handle(textEvent('e1'));
  await env.runner.handle(textEvent('e2'));
  const digest = buildUpgradeDigest({ proposals: env.store, ledgerFailures: (s) => env.store.listLedgerFailures(s) });
  assert.deepEqual(digest.refusals.map((r) => r.kind), ['inference_key_problem', 'inference_blocked']);
  assert.match(digest.refusals[1]!.detail, /rejected the key/);
});
