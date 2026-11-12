import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { canTransition, IllegalTransitionError, STATUSES, type ProposalStatus } from '@cyborg/core';
import { SqliteStore } from '../src/index.ts';
import { fixedNow, MapApplier, newProposal, reach, setup } from './helpers.ts';

const patch = () => ({ actor: 'actor:1', at: fixedNow().toISOString() });

// M1-EC3: every legal transition passes.
test('every legal transition in docs/02 succeeds and is audited', async () => {
  const legal: [ProposalStatus, ProposalStatus][] = [
    ['proposed', 'approved'],
    ['proposed', 'declined'],
    ['proposed', 'superseded'],
    ['proposed', 'expired'],
    ['approved', 'applied'],
    ['approved', 'apply_failed'],
    ['applied', 'reverted'],
  ];
  const env = setup();
  let n = 0;
  for (const [from, to] of legal) {
    const proposal = await reach(from, env, `legal-${n++}`);
    const before = env.store.listAudit(proposal.id).length;
    const moved = env.store.transition(proposal.id, to, patch());
    assert.equal(moved.status, to, `${from} -> ${to}`);
    const audit = env.store.listAudit(proposal.id);
    assert.equal(audit.length, before + 1);
    const last = audit.at(-1)!;
    assert.deepEqual([last.fromStatus, last.toStatus, last.kind], [from, to, 'transition']);
  }
});

// M1-EC3: every illegal transition throws and writes nothing (BEH-2).
test('every illegal transition throws and writes nothing', async () => {
  const env = setup();
  let n = 0;
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      if (canTransition(from, to)) continue;
      const proposal = await reach(from, env, `illegal-${n++}`);
      const auditBefore = env.store.listAudit();
      assert.throws(
        () => env.store.transition(proposal.id, to, patch()),
        (e: unknown) => e instanceof IllegalTransitionError,
        `${from} -> ${to}`,
      );
      assert.deepEqual(env.store.get(proposal.id), proposal, `${from} -> ${to} left the proposal unchanged`);
      assert.deepEqual(env.store.listAudit(), auditBefore, `${from} -> ${to} wrote an audit row`);
    }
  }
  assert.ok(n > 60, 'covered all illegal pairs');
});

test('BEH-1: a proposal can only be created as proposed or invalid_output', () => {
  const { store } = setup();
  for (const status of STATUSES) {
    if (status === 'proposed' || status === 'invalid_output') continue;
    assert.throws(
      () => store.create({ ...newProposal(), status: status as never }, null, fixedNow().toISOString()),
      IllegalTransitionError,
    );
  }
  assert.equal(store.list().length, 0);
});

test('BEH-3: approve and decline record who decided and when', async () => {
  const env = setup();
  const a = await reach('proposed', env, 'a');
  const approved = env.lifecycle.decide(a.id, 'approve', 'actor:7');
  assert.equal(approved.decidedBy, 'actor:7');
  assert.equal(approved.decidedAt, fixedNow().toISOString());
  const b = await reach('proposed', env, 'b');
  assert.equal(env.lifecycle.decide(b.id, 'decline', 'actor:8').decidedBy, 'actor:8');
});

// M1-EC4: append-only audit.
test('BEH-7: the store exposes no way to update or delete audit rows', () => {
  const store = setup().store;
  const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(store));
  const audit = methods.filter((m) => /audit/i.test(m));
  assert.deepEqual(audit.sort(), ['appendAudit', 'audit', 'listAudit']);
  assert.ok(!methods.some((m) => /(update|delete|remove|clear|purge)/i.test(m) && /audit/i.test(m)));
});

test('BEH-7: the database itself refuses UPDATE and DELETE on audit rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cyborg-audit-'));
  try {
    const path = join(dir, 'business.sqlite');
    const store = new SqliteStore(path);
    store.create(newProposal(), null, fixedNow().toISOString());
    const raw = new DatabaseSync(path);
    assert.throws(() => raw.exec("UPDATE audit SET actor = 'x'"), /append-only/);
    assert.throws(() => raw.exec('DELETE FROM audit'), /append-only/);
    assert.equal(store.listAudit().length, 1);
    raw.close();
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('BEH-4: a target that changed since the proposal fails the apply, never overwritten', async () => {
  const env = setup();
  const p = await reach('approved', env, 'stale');
  const applier = new MapApplier(new Map([['summary', 'changed by someone']]));
  const result = await env.lifecycle.apply(p.id, applier, 'actor:1');
  assert.equal(result.status, 'apply_failed');
  assert.match(result.reason ?? '', /target changed/);
  assert.equal(applier.target.get('summary'), 'changed by someone');
});

test('BEH-5, HDL-8: apply records old and new values and may touch only proposed fields', async () => {
  const env = setup();
  const p = await reach('approved', env, 'ok');
  const applier = new MapApplier();
  const applied = await env.lifecycle.apply(p.id, applier, 'actor:1');
  assert.equal(applied.status, 'applied');
  assert.deepEqual(applied.appliedChanges, [{ field: 'summary', oldValue: null, newValue: 'beta' }]);

  const q = await reach('approved', env, 'stray');
  const stray: MapApplier = new MapApplier();
  stray.apply = async () => [{ field: 'other', oldValue: null, newValue: 'x' }];
  const failed = await env.lifecycle.apply(q.id, stray, 'actor:1');
  assert.equal(failed.status, 'apply_failed');
  assert.match(failed.reason ?? '', /outside the proposal/);
});

test('HDL-10: apply runs only for approved proposals; the applier is not called otherwise', async () => {
  const env = setup();
  const p = await reach('proposed', env, 'not-approved');
  let called = false;
  const applier = new MapApplier();
  applier.apply = async () => {
    called = true;
    return [];
  };
  await assert.rejects(env.lifecycle.apply(p.id, applier, 'actor:1'), IllegalTransitionError);
  assert.equal(called, false);
});

test('HDL-11: revert restores the recorded old values and only works on applied proposals', async () => {
  const env = setup();
  const applier = new MapApplier();
  const p = await reach('approved', env, 'rev');
  await env.lifecycle.apply(p.id, applier, 'actor:1');
  assert.equal(applier.target.get('summary'), 'beta');
  const reverted = await env.lifecycle.revert(p.id, applier, 'actor:1');
  assert.equal(reverted.status, 'reverted');
  assert.equal(applier.target.has('summary'), false);

  const q = await reach('proposed', env, 'rev-bad');
  await assert.rejects(env.lifecycle.revert(q.id, applier, 'actor:1'), IllegalTransitionError);
});
