import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { HandlerRegistry, Runner, scanReasoning, stripThinkBlocks } from '@cyborg/core';
import { echoHandler, ScriptedModel, textEvent } from '@cyborg/core/testing';
import { FileScratchpad, SqliteStore } from '@cyborg/store-sqlite';

test('ADM-40: think blocks are removed and returned; an unclosed block swallows the rest', () => {
  assert.deepEqual(stripThinkBlocks('<think>step one</think>{"a":1}'), { text: '{"a":1}', reasoning: ['step one'] });
  assert.deepEqual(stripThinkBlocks('{"a":1}'), { text: '{"a":1}', reasoning: [] });
  assert.deepEqual(stripThinkBlocks('hello <thinking>a</thinking> there <think>b</think>'), { text: 'hello  there', reasoning: ['a', 'b'] });
  assert.deepEqual(stripThinkBlocks('{"a":1}<think>never closed'), { text: '{"a":1}', reasoning: ['never closed'] });
});

test('ADM-6: the marker scan', () => {
  assert.deepEqual(scanReasoning('Plain reply about the East Tour.'), []);
  assert.deepEqual(scanReasoning('<think>x</think>'), ['think tag']);
  assert.ok(scanReasoning("Let me think about this. Step 2: look it up").length >= 2);
});

// M7b-EC2
test('ADM-6, ADM-40 / M7b-EC2: reasoning in the model response goes to the scratchpad file and is never in the proposal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cyborg-pad-'));
  return (async () => {
    try {
      const path = join(dir, 'scratchpad.jsonl');
      const pad = new FileScratchpad(path);
      assert.equal(statSync(path).mode & 0o777, 0o600);
      const store = new SqliteStore(':memory:');
      const registry = new HandlerRegistry({ autoReplyHandlers: [] });
      registry.registerHandler(echoHandler());
      const response = `<think>The user wants beta. I should answer with value beta.</think>${JSON.stringify({ value: 'beta', phrase: 'beta' })}`;
      const runner = new Runner({ businessId: 'b', registry, store, ledger: store, model: new ScriptedModel([response]), scratchpad: pad, now: () => new Date('2026-10-31T10:00:00.000Z') });
      const [outcome] = await runner.handle(textEvent('e1'));
      assert.equal(outcome!.outcome, 'proposal');
      const proposal = (outcome as { proposal: { status: string } }).proposal;
      assert.equal(proposal.status, 'proposed', 'the response parsed once the reasoning was removed');
      const lines = readFileSync(path, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { kind: string; text: string });
      assert.deepEqual(lines.map((l) => l.kind), ['reasoning', 'route']);
      assert.match(lines[0]!.text, /The user wants beta/);
      assert.equal(JSON.stringify(proposal).includes('The user wants beta'), false, 'nothing of it reaches a proposal');
      assert.equal(JSON.stringify(store.listAudit()).includes('The user wants beta'), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })();
});
