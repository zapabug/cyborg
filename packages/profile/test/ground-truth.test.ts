import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SqliteStore } from '@cyborg/store-sqlite';
import { compareDaySets, NotIndependentError, proposeDiscrepancyReport, runGroundTruthCheck } from '../src/index.ts';
import { at, fact } from './helpers.ts';

const STORE_FIELD = { kind: 'store_sync', ref: 'shop:product-1:Days' };
const DAYS = compareDaySets([0, 1, 2, 3, 4, 5, 6]);

function daysFact(store: SqliteStore) {
  store.putFact(fact('catalog.west.days', [2, 5, 0], { source: 'store_sync', sourceRef: STORE_FIELD.ref }), 'import', at);
}

// M4-EC3
test('PRF-8: a check whose source is the fact\'s own source is rejected', () => {
  const store = new SqliteStore(':memory:');
  daysFact(store);
  assert.throws(
    () => runGroundTruthCheck(store, { factKey: 'catalog.west.days', independent: STORE_FIELD, observed: [2, 5, 0], compare: DAYS }, 'p', at),
    NotIndependentError,
  );
  assert.equal(store.listChecks().length, 0, 'a rejected check is not evidence');
  assert.equal(store.getFact('catalog.west.days')!.status, 'unconfirmed');
});

test('PRF-7: a different kind or a different origin is independent', () => {
  const store = new SqliteStore(':memory:');
  daysFact(store);
  const sameKindOtherOrigin = runGroundTruthCheck(store, { factKey: 'catalog.west.days', independent: { kind: 'store_sync', ref: 'shop:page-script' }, observed: [2, 5, 0], compare: DAYS }, 'p', at);
  assert.equal(sameKindOtherOrigin.outcome, 'pass');
  const otherKind = runGroundTruthCheck(store, { factKey: 'catalog.west.days', independent: { kind: 'document', ref: 'sheet.pdf' }, observed: [2, 5, 0], compare: DAYS }, 'p', at);
  assert.equal(otherKind.outcome, 'pass');
});

test('PRF-59: a passing independent check is evidence and does not confirm', () => {
  const store = new SqliteStore(':memory:');
  daysFact(store);
  runGroundTruthCheck(store, { factKey: 'catalog.west.days', independent: { kind: 'document', ref: 'sheet.pdf' }, observed: [2, 5, 0], compare: DAYS }, 'p', at);
  assert.equal(store.getFact('catalog.west.days')!.status, 'unconfirmed');
  assert.deepEqual(store.listChecks('catalog.west.days').map((c) => c.outcome), ['pass']);
});

// M4-EC5 (machine part): the shape of the Demo Tours "Days" case, with structural values.
test('PRF-9: an independent source that shows the complement flags the inversion, contradicts the fact and opens a discrepancy', () => {
  const store = new SqliteStore(':memory:');
  daysFact(store);
  // A second read of the same field cannot confirm it:
  assert.throws(() => runGroundTruthCheck(store, { factKey: 'catalog.west.days', independent: STORE_FIELD, observed: [2, 5, 0], compare: DAYS }, 'p', at), NotIndependentError);
  // An independent source (a service sheet) lists the days the tour runs:
  const result = runGroundTruthCheck(store, { factKey: 'catalog.west.days', independent: { kind: 'document', ref: 'service-sheet' }, observed: [1, 3, 4, 6], compare: DAYS }, 'p', at);
  assert.equal(result.outcome, 'fail');
  assert.match(result.note ?? '', /complement/);
  assert.equal(result.fact.status, 'contradicted');
  assert.equal(store.listDiscrepancies('open').length, 1);
  assert.equal(store.listDiscrepancies('open')[0]!.evidence[0]!.note, result.note);
  assert.equal(store.listChecks()[0]!.outcome, 'fail');
});

// audit 2026-11-03 F-4
test('PRF-9 / PRF-2: a failed independent check on a stale fact is recorded and opens a discrepancy instead of throwing', () => {
  const store = new SqliteStore(':memory:');
  daysFact(store);
  store.moveFact('catalog.west.days', 'confirmed', { actor: 'person', at, reason: 'checked with Demo Tours' });
  store.moveFact('catalog.west.days', 'stale', { actor: 'system', at, reason: 'past its review date' });
  const result = runGroundTruthCheck(store, { factKey: 'catalog.west.days', independent: { kind: 'document', ref: 'service-sheet' }, observed: [1, 3, 4, 6], compare: DAYS }, 'p', at);
  assert.equal(result.outcome, 'fail');
  assert.equal(result.fact.status, 'stale', 'PRF-2 has no stale -> contradicted move');
  assert.equal(store.listChecks('catalog.west.days')[0]!.outcome, 'fail');
  assert.equal(store.listDiscrepancies('open').length, 1);
});

test('PRF-9, PRF-60: the discrepancy report is a proposal with evidence per discrepancy and says when it is a single source', () => {
  const store = new SqliteStore(':memory:');
  assert.equal(proposeDiscrepancyReport(store, store, 'b', at), null, 'nothing open, nothing to propose');
  daysFact(store);
  runGroundTruthCheck(store, { factKey: 'catalog.west.days', independent: { kind: 'document', ref: 'service-sheet' }, observed: [1, 3, 4, 6], compare: DAYS }, 'p', at);
  const one = proposeDiscrepancyReport(store, store, 'b', at)!;
  assert.equal(one.status, 'proposed');
  assert.equal(one.handlerId, 'profile.discrepancy_report');
  assert.match(one.findings[0]!.statement, /catalog\.west\.days.*The evidence is a single source\./);
  assert.match(one.findings[0]!.evidence, /document at service-sheet observed \[1,3,4,6\]/);
  assert.equal(one.questions.length, 1);

  runGroundTruthCheck(store, { factKey: 'catalog.west.days', independent: { kind: 'observation', ref: 'live-page-script' }, observed: [1, 3, 4, 6], compare: DAYS }, 'p', at);
  const two = proposeDiscrepancyReport(store, store, 'b', at)!;
  assert.ok(!two.findings[0]!.statement.includes('single source'));
});

test('a failing check on an already contradicted fact adds evidence without an illegal move', () => {
  const store = new SqliteStore(':memory:');
  daysFact(store);
  const a = { factKey: 'catalog.west.days', observed: [1], compare: DAYS };
  runGroundTruthCheck(store, { ...a, independent: { kind: 'document', ref: 'one' } }, 'p', at);
  runGroundTruthCheck(store, { ...a, independent: { kind: 'document', ref: 'two' } }, 'p', at);
  assert.equal(store.listDiscrepancies('open').length, 2);
});
