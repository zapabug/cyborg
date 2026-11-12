import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canMoveFact, IllegalFactMoveError, type FactStatus, HandlerRegistry } from '@cyborg/core';
import { echoHandler, textEvent } from '@cyborg/core/testing';
import { SqliteStore } from '@cyborg/store-sqlite';
import { markStaleFacts, effectiveStatus } from '../src/index.ts';
import { at, fact, factHandler, packOf, rig } from './helpers.ts';

const STATUSES: FactStatus[] = ['unconfirmed', 'confirmed', 'contradicted', 'stale'];
const LEGAL = ['unconfirmed>confirmed', 'unconfirmed>contradicted', 'confirmed>contradicted', 'confirmed>stale', 'contradicted>confirmed', 'stale>confirmed'];

// M4-EC1
test('PRF-1: a fact without a source is rejected', () => {
  const store = new SqliteStore(':memory:');
  assert.throws(() => store.putFact(fact('a.b', 1, { sourceRef: '' }), 'actor', at), /source/);
  assert.throws(() => store.putFact(fact('a.b', 1, { source: '' as never }), 'actor', at), /source/);
  assert.equal(store.listFacts().length, 0);
});

test('PRF-2: exactly the documented moves are legal', () => {
  for (const from of STATUSES) for (const to of STATUSES) assert.equal(canMoveFact(from, to), LEGAL.includes(`${from}>${to}`), `${from} -> ${to}`);
});

test('PRF-2: every legal move writes an audit event; every illegal move throws and writes nothing', () => {
  const store = new SqliteStore(':memory:');
  let n = 0;
  const reach = (to: FactStatus) => {
    const key = `f.k${n++}`;
    store.putFact(fact(key, 1), 'actor', at);
    if (to === 'unconfirmed') return key;
    if (to === 'confirmed') store.moveFact(key, 'confirmed', { actor: 'p', at });
    if (to === 'contradicted') store.moveFact(key, 'contradicted', { actor: 'p', at });
    if (to === 'stale') {
      store.moveFact(key, 'confirmed', { actor: 'p', at });
      store.moveFact(key, 'stale', { actor: 'p', at });
    }
    return key;
  };
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      const key = reach(from);
      const auditBefore = store.listAudit().length;
      if (LEGAL.includes(`${from}>${to}`)) {
        const moved = store.moveFact(key, to, { actor: 'person:1', at, reason: 'test' });
        assert.equal(moved.status, to);
        const last = store.listAudit().at(-1)!;
        assert.equal(store.listAudit().length, auditBefore + 1);
        assert.equal(last.kind, 'fact_status');
        assert.deepEqual(last.detail, { key, from, to, reason: 'test' });
      } else {
        assert.throws(() => store.moveFact(key, to, { actor: 'person:1', at }), IllegalFactMoveError, `${from} -> ${to}`);
        assert.equal(store.getFact(key)!.status, from);
        assert.equal(store.listAudit().length, auditBefore);
      }
    }
  }
});

test('PRF-2: confirming records who and when', () => {
  const store = new SqliteStore(':memory:');
  store.putFact(fact('a.b', 1), 'actor', at);
  const confirmed = store.moveFact('a.b', 'confirmed', { actor: 'vault:abc123', at });
  assert.equal(confirmed.confirmedBy, 'vault:abc123');
  assert.equal(confirmed.confirmedAt, at);
});

test('PRF-55: replacing a value is a new unconfirmed fact and the old value stays in the audit event', () => {
  const store = new SqliteStore(':memory:');
  store.putFact(fact('a.b', 'old'), 'actor', at);
  store.moveFact('a.b', 'confirmed', { actor: 'p', at });
  const replaced = store.putFact(fact('a.b', 'new', { source: 'store_sync', sourceRef: 'shop:1' }), 'actor', at);
  assert.equal(replaced.status, 'unconfirmed');
  assert.equal(replaced.confirmedBy, null);
  const event = store.listAudit().at(-1)!;
  assert.equal(event.kind, 'fact_replaced');
  assert.deepEqual((event.detail as { previous: { value: unknown; status: string } }).previous, {
    value: 'old', source: 'client_statement', sourceRef: 'test:ref', status: 'confirmed',
  });
});

test('PRF-54: a confirmed fact past reviewBy reads as stale, and the sweep persists it', () => {
  const store = new SqliteStore(':memory:');
  store.putFact(fact('a.b', 1, { reviewBy: '2026-10-01T00:00:00.000Z' }), 'actor', at);
  store.putFact(fact('a.c', 2, { reviewBy: '2027-01-01T00:00:00.000Z' }), 'actor', at);
  store.moveFact('a.b', 'confirmed', { actor: 'p', at });
  store.moveFact('a.c', 'confirmed', { actor: 'p', at });
  assert.equal(effectiveStatus(store.getFact('a.b')!, new Date(at)), 'stale');
  assert.equal(effectiveStatus(store.getFact('a.c')!, new Date(at)), 'confirmed');
  assert.deepEqual(markStaleFacts(store, new Date(at)), ['a.b']);
  assert.equal(store.getFact('a.b')!.status, 'stale');
  assert.deepEqual(markStaleFacts(store, new Date(at)), [], 'idempotent');
});

// M4-EC2
test('PRF-4: a fact slot may only use a key the handler declares', () => {
  const registry = new HandlerRegistry({ autoReplyHandlers: [] });
  assert.throws(
    () => registry.registerHandler(factHandler({ profileKeys: [] })),
    (e: unknown) => (e as { rule?: string }).rule === 'PRF-4',
  );
  assert.throws(
    () => registry.registerHandler(factHandler({ packFacts: [] })),
    (e: unknown) => (e as { rule?: string }).rule === 'PRF-4',
  );
});

test('PRF-4: only the declared keys are injected into the prompt', async () => {
  const env = rig('live');
  env.packs.add(packOf([{}]));
  env.store.putFact(fact('rules.cutoff', 'CUTOFF-17h'), 'a', at);
  env.store.putFact(fact('rules.other', 'OTHER-SECRET-RULE'), 'a', at);
  env.store.moveFact('rules.cutoff', 'confirmed', { actor: 'p', at });
  env.store.moveFact('rules.other', 'confirmed', { actor: 'p', at });
  const [outcome] = await env.runner.handle(textEvent('e1'));
  assert.equal(outcome!.outcome, 'proposal');
  const prompt = env.model.calls[0]!.prompt;
  assert.equal(prompt, 'Cutoff: CUTOFF-17h Rule: rule alpha Text: alpha beta gamma');
  assert.ok(!prompt.includes('OTHER-SECRET-RULE'));
});

test('PRF-5: shadow accepts unconfirmed facts and marks them in the ledger; live refuses them', async () => {
  const shadow = rig('shadow');
  shadow.packs.add(packOf([{}]));
  shadow.store.putFact(fact('rules.cutoff', '17h'), 'a', at);
  const [out] = await shadow.runner.handle(textEvent('e1'));
  assert.equal(out!.outcome, 'proposal');
  const row = shadow.store.read((out as { proposal: { modelCallId: string } }).proposal.modelCallId)!;
  assert.deepEqual(row.factsUsed, [
    { kind: 'profile', key: 'rules.cutoff', state: 'unconfirmed', unconfirmed: true },
    { kind: 'pack', key: 'pack.alpha', state: 'checked' },
  ]);

  const live = rig('live');
  live.packs.add(packOf([{}]));
  live.store.putFact(fact('rules.cutoff', '17h'), 'a', at);
  const [refused] = await live.runner.handle(textEvent('e1'));
  assert.equal(refused!.outcome, 'refused');
  assert.match((refused as { reason: string }).reason, /rules\.cutoff.*unconfirmed, not allowed in live mode/);
  assert.equal(live.model.calls.length, 0);
  assert.equal(live.store.listAudit().filter((a) => a.kind === 'profile_refused').length, 1);
  assert.equal(live.store.hasRun({ source: 'test-source', eventId: 'e1', handlerId: 'test.facts' }), false);
});

test('PRF-5: a contradicted or stale fact never reaches a prompt, in either mode', async () => {
  for (const mode of ['shadow', 'live'] as const) {
    for (const bad of ['contradicted', 'stale'] as const) {
      const env = rig(mode);
      env.packs.add(packOf([{}]));
      env.store.putFact(fact('rules.cutoff', '17h', bad === 'stale' ? { reviewBy: '2026-10-30T00:00:00.000Z' } : {}), 'a', at);
      if (bad === 'contradicted') env.store.moveFact('rules.cutoff', 'contradicted', { actor: 'p', at });
      else env.store.moveFact('rules.cutoff', 'confirmed', { actor: 'p', at });
      const [out] = await env.runner.handle(textEvent('e1'));
      assert.equal(out!.outcome, 'refused', `${mode}/${bad}`);
      assert.equal(env.model.calls.length, 0, `${mode}/${bad}`);
    }
  }
});

test('a missing declared fact refuses the handler and lists the key', async () => {
  const env = rig('live');
  env.packs.add(packOf([{}]));
  const [out] = await env.runner.handle(textEvent('e1'));
  assert.equal(out!.outcome, 'refused');
  assert.match((out as { reason: string }).reason, /profile fact "rules\.cutoff": missing/);
});

test('a handler that declares facts but has no provider cannot run', async () => {
  const echo = echoHandler({ profileKeys: ['x.y'], prompt: { template: '{{text}}', slots: { text: 'text' } } });
  const registry = new HandlerRegistry({ autoReplyHandlers: [] });
  registry.registerHandler(echo);
  const { Runner } = await import('@cyborg/core');
  const { ScriptedModel } = await import('@cyborg/core/testing');
  const store = new SqliteStore(':memory:');
  const runner = new Runner({ businessId: 'b', registry, store, ledger: store, model: new ScriptedModel([]) });
  await assert.rejects(runner.handle(textEvent('e1')), /no fact provider/);
});
