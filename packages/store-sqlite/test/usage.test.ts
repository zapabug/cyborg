import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildUsageReport, formatUsageReport, HandlerRegistry, Runner, StoreNotifier, type LedgerEntry } from '@cyborg/core';
import { echoHandler, goodResponse, ScriptedModel, textEvent } from '@cyborg/core/testing';
import { SqliteStore } from '../src/index.ts';

const row = (over: Partial<LedgerEntry>): LedgerEntry => ({
  handlerId: 'h.a', handlerVersion: '1', at: '2026-10-30T10:00:00.000Z', endpoint: 'http://e/v1', model: 'm1',
  requestPayload: {}, rawResponse: '{}', error: null, durationMs: 5, usage: { prompt_tokens: 300, completion_tokens: 50, total_tokens: 350 }, ...over,
});

// GWY-28..30: the rows below are ledger entries as the gateway writes them; the numbers are chosen to add up by hand.
function seeded() {
  const store = new SqliteStore(':memory:');
  store.write(row({}));
  store.write(row({ at: '2026-10-30T11:00:00.000Z', usage: { prompt_tokens: 200, completion_tokens: 100 } }));
  store.write(row({ at: '2026-10-31T09:00:00.000Z', handlerId: 'h.b', model: 'm2', error: 'HTTP 500', usage: null }));
  store.write(row({ at: '2026-10-31T09:30:00.000Z', handlerId: 'h.b', model: 'm2', usage: { prompt_tokens: 1000, completion_tokens: 400 } }));
  store.write(row({ at: '2026-10-31T10:00:00.000Z', endpoint: null, model: null, usage: undefined })); // a deterministic handler: no model call
  return store;
}
const WINDOW = { since: '2026-10-30T00:00:00.000Z', until: '2026-10-31T23:59:59.000Z' };

test('GWY-28, GWY-29: the report counts model calls and tokens by day, model and handler, and says which calls had no token counts', () => {
  const store = seeded();
  const report = buildUsageReport(store.usageRows(WINDOW.since), WINDOW);
  assert.deepEqual(report.totals, { calls: 4, failed: 1, promptTokens: 1500, completionTokens: 550, callsWithoutUsage: 1 });
  assert.deepEqual(report.byDay.map((d) => [d.day, d.calls, d.promptTokens]), [['2026-10-30', 2, 500], ['2026-10-31', 2, 1000]]);
  assert.deepEqual(report.byModel.map((m) => [m.model, m.calls, m.failed]), [['m1', 2, 0], ['m2', 2, 1]]);
  assert.deepEqual(report.byHandler.map((h) => [h.handlerId, h.completionTokens]), [['h.a', 150], ['h.b', 400]]);
  assert.equal(report.cost, null, 'no prices, no cost');
  assert.match(formatUsageReport(report), /Spec: cost\nState: not shown: no prices set/);
});

test('GWY-30: cost comes only from the prices given; a model without a price is named, not guessed', () => {
  const store = seeded();
  const prices = { m1: { inputPerMillion: 2, outputPerMillion: 10, currency: 'EUR' } };
  const report = buildUsageReport(store.usageRows(WINDOW.since), { ...WINDOW, prices });
  // m1: 500 in, 150 out = 500/1e6*2 + 150/1e6*10 = 0.001 + 0.0015
  assert.equal(report.cost!.currency, 'EUR');
  assert.ok(Math.abs(report.cost!.amount - 0.0025) < 1e-12);
  assert.deepEqual(report.cost!.unpricedModels, ['m2']);
  assert.match(formatUsageReport(report), /0\.0025 EUR, not including m2 \(no price set\)/);
  assert.throws(() => buildUsageReport([], { ...WINDOW, prices: { a: { inputPerMillion: 1, outputPerMillion: 1, currency: 'EUR' }, b: { inputPerMillion: 1, outputPerMillion: 1, currency: 'USD' } } }), /more than one currency/);
});

test('GWY-28: the count for the cap includes failed attempts and ignores rows older than the window', () => {
  const store = seeded();
  assert.equal(store.countModelCalls('2026-10-31T00:00:00.000Z'), 2);
  assert.equal(store.countModelCalls('2026-10-30T00:00:00.000Z'), 4);
});

function capRig(maxPer24h: number, now: { t: Date }) {
  const store = new SqliteStore(':memory:');
  const registry = new HandlerRegistry({ autoReplyHandlers: [] });
  registry.registerHandler(echoHandler());
  const model = new ScriptedModel([goodResponse, goodResponse, goodResponse, goodResponse]);
  const alerts: { kind: string; detail: string }[] = [];
  const stored = new StoreNotifier(store, () => now.t);
  const runner = new Runner({
    businessId: 'b', registry, store, ledger: store, model, now: () => now.t,
    callCap: { maxPer24h }, usage: store,
    notifier: { alert: async (a) => { alerts.push(a); await stored.alert(a); }, resolved: (w) => stored.resolved(w) },
  });
  return { store, runner, alerts };
}

test('GWY-31: at the cap a model handler is refused with the event kept, the admin is alerted once, and it clears when the window moves on', async () => {
  const now = { t: new Date('2026-10-31T10:00:00.000Z') };
  const env = capRig(2, now);
  assert.equal((await env.runner.handle(textEvent('e1')))[0]!.outcome, 'proposal');
  assert.equal((await env.runner.handle(textEvent('e2')))[0]!.outcome, 'proposal');
  const third = (await env.runner.handle(textEvent('e3')))[0]!;
  assert.equal(third.outcome, 'refused');
  assert.match((third as { reason: string }).reason, /limit of 2 model calls in 24 hours is used \(2\)/);
  assert.equal(env.store.hasRun({ source: 'test-source', eventId: 'e3', handlerId: 'test.echo' }), false, 'the event is not used up');
  await env.runner.handle(textEvent('e4'));
  assert.equal(env.alerts.length, 1, 'one alert, not one per refused event');
  assert.equal(env.alerts[0]!.kind, 'call_cap');
  assert.deepEqual(env.store.listOpenAlerts().map((a) => a.kind), ['call_cap']);
  assert.equal(env.store.listAudit().filter((a) => a.kind === 'call_cap_blocked').length, 2);

  now.t = new Date('2026-11-01T10:30:00.000Z'); // both calls are now more than 24 hours old
  assert.equal((await env.runner.handle(textEvent('e3')))[0]!.outcome, 'proposal', 'the kept event runs once there is room');
  assert.deepEqual(env.store.listOpenAlerts(), []);
  assert.ok(env.store.listAudit().some((a) => a.kind === 'call_cap_cleared'));
});

test('GWY-31: a runner with a cap and no usage counter is refused at construction', () => {
  const store = new SqliteStore(':memory:');
  assert.throws(() => new Runner({ businessId: 'b', registry: new HandlerRegistry({ autoReplyHandlers: [] }), store, ledger: store, model: new ScriptedModel([]), callCap: { maxPer24h: 5 } }), /needs a usage counter/);
});
