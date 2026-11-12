import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { CyborgEvent } from '@cyborg/core';
import { runLeakCheck } from './leak-harness.ts';

// PRV-13, M2-EC5 user part. Runs only when CYBORG_LEAK_INPUT points at a JSON file kept outside the repo:
//   { "identityValues": ["..."], "events": [ { "id": "...", "payload": { "name": "...", "contact": "...", "note": "...", "topic": "..." } } ] }
// A reported hit names a table, a row and a value index, never the value. A hit caused by a name
// typed inside `note` is the known limit of the scrubber (PRV-7), not a bug in the test.
const path = process.env['CYBORG_LEAK_INPUT'];

test('PRV-13: real identity values and real inputs leave no trace', { skip: path ? false : 'CYBORG_LEAK_INPUT is not set' }, async () => {
  const input = JSON.parse(readFileSync(path!, 'utf8')) as {
    identityValues: string[];
    events: { id: string; source?: string; at?: string; payload: Record<string, string> }[];
  };
  const events: CyborgEvent[] = input.events.map((e) => ({
    id: e.id,
    source: e.source ?? 'real-input',
    kind: 'leak.probe',
    at: e.at ?? new Date().toISOString(),
    payload: e.payload,
  }));
  const result = await runLeakCheck(events, input.identityValues);
  assert.deepEqual(result.hits, [], `leaks found: ${JSON.stringify(result.hits)}`);
});
