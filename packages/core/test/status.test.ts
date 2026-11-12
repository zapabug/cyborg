import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canTransition, legalTransitions, STATUSES } from '../src/index.ts';

// BEH-2: only the transitions in docs/02 are legal.
const DOC_LEGAL = [
  'proposed>approved',
  'proposed>declined',
  'proposed>superseded',
  'proposed>expired',
  'approved>applied',
  'approved>apply_failed',
  'applied>reverted',
];

test('the legal set is exactly the docs/02 diagram', () => {
  assert.deepEqual(
    legalTransitions().map(([a, b]) => `${a}>${b}`).sort(),
    [...DOC_LEGAL].sort(),
  );
});

test('every other pair of statuses is illegal', () => {
  for (const from of STATUSES) {
    for (const to of STATUSES) {
      assert.equal(canTransition(from, to), DOC_LEGAL.includes(`${from}>${to}`), `${from} -> ${to}`);
    }
  }
});

test('invalid_output has no way out (BEH-6)', () => {
  for (const to of STATUSES) assert.equal(canTransition('invalid_output', to), false);
});
