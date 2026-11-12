import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Checklist, ChecklistError, checkLiveGate, type ChecklistItemDef } from '@cyborg/core';
import { SqliteStore } from '@cyborg/store-sqlite';
import { AFFECTED_BY, invalidateOnChange, ITEMS } from '../src/index.ts';

const CH = 'channel-1';
const at = new Date('2026-10-31T10:00:00.000Z');
const rig = (defs: readonly ChecklistItemDef[] = ITEMS) => {
  const store = new SqliteStore(':memory:');
  return { store, checklist: new Checklist(defs, store, store, () => at) };
};

// M7b-EC1
test('ADM-1, ADM-2 / M7b-EC1: items start unchecked, a pass needs evidence of the right kind, and every change is audited', () => {
  const { checklist, store } = rig();
  assert.ok(checklist.list(CH).every((r) => r.status === 'unchecked'));
  assert.throws(() => checklist.pass(CH, 'ADM-7', 'machine', 'system', '  '), ChecklistError);
  assert.throws(() => checklist.pass(CH, 'ADM-16', 'machine', 'system', 'x'), /verified by person, not by machine/);
  assert.throws(() => checklist.pass(CH, 'ADM-7', 'person', 'p', 'x'), /verified by machine/);
  assert.throws(() => checklist.pass(CH, 'ADM-99', 'machine', 'system', 'x'), /no checklist item/);

  checklist.pass(CH, 'ADM-7', 'machine', 'system', '120 group decisions, 0 unaddressed runs');
  checklist.pass(CH, 'ADM-16', 'person', 'person:staff', 'sampled 20 replies');
  assert.equal(checklist.get(CH, 'ADM-7').status, 'passed_machine');
  assert.equal(checklist.get(CH, 'ADM-16').status, 'passed_person');
  const rows = store.listAudit().filter((a) => a.kind === 'checklist');
  assert.deepEqual(rows.map((r) => [r.actor, (r.detail as { item: string; to: string; evidence: string }).item, (r.detail as { to: string }).to, (r.detail as { evidence: string }).evidence]), [
    ['system', 'ADM-7', 'passed_machine', '120 group decisions, 0 unaddressed runs'],
    ['person:staff', 'ADM-16', 'passed_person', 'sampled 20 replies'],
  ]);
});

test('ADM-39: an item verified by both stays unchecked until the machine part and the person part are recorded', () => {
  const { checklist } = rig();
  checklist.pass(CH, 'ADM-6', 'machine', 'system', '40 outputs scanned');
  assert.equal(checklist.get(CH, 'ADM-6').status, 'unchecked');
  checklist.pass(CH, 'ADM-6', 'person', 'person:staff', 'sampled 10 outputs');
  const row = checklist.get(CH, 'ADM-6');
  assert.equal(row.status, 'passed_person');
  assert.equal(row.evidence, '40 outputs scanned | sampled 10 outputs');
  checklist.fail(CH, 'ADM-6', 'system', 'a think tag in entry e9');
  assert.equal(checklist.get(CH, 'ADM-6').status, 'failed');
  checklist.pass(CH, 'ADM-6', 'machine', 'system', 'rescanned');
  assert.equal(checklist.get(CH, 'ADM-6').status, 'unchecked', 'the person must look again after a failure');
});

test('ADM-3 / M7b-EC1: unwaivable items refuse a waiver; a waiver records who, why and a review-by date', () => {
  const { checklist } = rig();
  for (const id of ['ADM-6', 'ADM-7', 'ADM-8', 'ADM-13']) {
    assert.throws(() => checklist.waive(CH, id, 'person:owner', 'we have no groups', '2027-01-01'), /unwaivable/, id);
  }
  assert.throws(() => checklist.waive(CH, 'ADM-19', 'person:owner', '', '2027-01-01'), /who, why and a review-by date/);
  assert.throws(() => checklist.waive(CH, 'ADM-19', 'person:owner', 'no quiet hours', ''), /review-by/);
  const row = checklist.waive(CH, 'ADM-19', 'person:owner', 'the desk is open all day', '2027-01-01');
  assert.equal(row.status, 'waived');
  assert.deepEqual(row.waiver, { by: 'person:owner', why: 'the desk is open all day', reviewBy: '2027-01-01' });
});

// M7b-EC9
test('ADM-4 / M7b-EC9: complete needs every item passed or waived; the gate also needs a named business sign-off', () => {
  const { checklist, store } = rig();
  const gate = (channel = CH) => checkLiveGate({ log: store, profile: store, minimum: { entries: 0, days: 0 }, checklist: checklist.gateFor(channel) }, 'h');
  assert.equal(checklist.status(CH).complete, false);
  for (const d of ITEMS) {
    if (d.verification === 'person') checklist.pass(CH, d.id, 'person', 'person:staff', 'looked');
    else if (d.verification === 'machine') checklist.pass(CH, d.id, 'machine', 'system', 'ok');
    else {
      checklist.pass(CH, d.id, 'machine', 'system', 'ok');
      checklist.pass(CH, d.id, 'person', 'person:staff', 'ok');
    }
  }
  assert.equal(checklist.status(CH).complete, true);
  assert.equal(checklist.status(CH).signedOffBy, null);
  assert.ok(gate().failures.some((f) => /no named sign-off/.test(f)));
  assert.throws(() => checklist.signOff(CH, 'business', ' '), ChecklistError);
  checklist.signOff(CH, 'supplier', 'person:zapa');
  assert.ok(gate().failures.some((f) => /no named sign-off/.test(f)), 'the supplier sign-off is separate');
  checklist.signOff(CH, 'business', 'person:owner');
  assert.ok(!gate().failures.some((f) => /checklist/.test(f)));
  assert.deepEqual(checklist.status(CH), { complete: true, signedOffBy: 'person:owner', supplierSignedOffBy: 'person:zapa', open: [] });
});

test('ADM-4: a waived item counts as done, a failed one does not', () => {
  const { checklist } = rig();
  for (const d of ITEMS) {
    if (d.unwaivable) {
      if (d.verification === 'both') { checklist.pass(CH, d.id, 'machine', 's', 'e'); checklist.pass(CH, d.id, 'person', 'p', 'e'); } else checklist.pass(CH, d.id, 'machine', 's', 'e');
    } else checklist.waive(CH, d.id, 'person:owner', 'not needed here', '2027-01-01');
  }
  assert.equal(checklist.status(CH).complete, true);
  checklist.fail(CH, 'ADM-9', 'system', 'a run in an ignored chat');
  assert.deepEqual(checklist.status(CH).open, ['ADM-9']);
});

test('ADM-5 / M7b-EC9: a change puts the affected items back to unchecked and voids the sign-offs', () => {
  const { checklist } = rig();
  for (const d of ITEMS) {
    if (d.unwaivable) { if (d.verification === 'both') { checklist.pass(CH, d.id, 'machine', 's', 'e'); checklist.pass(CH, d.id, 'person', 'p', 'e'); } else checklist.pass(CH, d.id, 'machine', 's', 'e'); }
    else checklist.waive(CH, d.id, 'person:owner', 'n/a', '2027-01-01');
  }
  checklist.signOff(CH, 'business', 'person:owner');
  const moved = invalidateOnChange(checklist, CH, 'roles', 'person:owner');
  assert.deepEqual(moved.sort(), ['ADM-10', 'ADM-11', 'ADM-12', 'ADM-14', 'ADM-18', 'ADM-7', 'ADM-8', 'ADM-9'].sort());
  assert.ok(AFFECTED_BY.roles.every((id) => checklist.get(CH, id).status === 'unchecked'));
  assert.equal(checklist.get(CH, 'ADM-17').status, 'waived', 'unaffected items stay');
  assert.equal(checklist.status(CH).complete, false);
  assert.equal(checklist.status(CH).signedOffBy, null);
  for (const change of ['model', 'endpoint', 'handler_version'] as const) {
    assert.ok(invalidateOnChange(checklist, CH, change, 'person:owner').includes('ADM-13') || checklist.get(CH, 'ADM-13').status === 'unchecked');
  }
});
