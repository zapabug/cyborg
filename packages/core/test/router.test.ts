import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HandlerRegistry, selectHandlers } from '../src/index.ts';
import { deterministicHandler, echoHandler, textEvent } from '../src/testing.ts';

function build(overrides?: Record<string, { type: 'event'; kind: string }[]>) {
  const registry = new HandlerRegistry({ autoReplyHandlers: [], ...(overrides ? { triggerOverrides: overrides } : {}) });
  registry.registerHandler(echoHandler());
  registry.registerHandler(deterministicHandler());
  registry.registerHandler(
    echoHandler({ id: 'test.other', trigger: [{ type: 'event', kind: 'form.submitted' }] }),
  );
  return registry;
}

test('BEH-9: the same event selects the same handlers in the same order', () => {
  const registry = build();
  const first = selectHandlers(registry, textEvent('e1')).map((h) => h.id);
  assert.deepEqual(first, ['test.echo', 'test.check']);
  for (let i = 0; i < 25; i++) {
    assert.deepEqual(selectHandlers(registry, textEvent(`e${i}`)).map((h) => h.id), first);
  }
});

test('an unmatched event selects nothing', () => {
  assert.deepEqual(selectHandlers(build(), textEvent('e1', 'x', 'unknown.kind')), []);
});

test('schedule and manual triggers match their event kinds', () => {
  const registry = new HandlerRegistry({ autoReplyHandlers: [] });
  registry.registerHandler(echoHandler({ trigger: [{ type: 'schedule', name: 'nightly' }] }));
  registry.registerHandler(deterministicHandler({ trigger: [{ type: 'manual', command: 'recheck' }] }));
  assert.deepEqual(selectHandlers(registry, textEvent('e1', 'x', 'schedule:nightly')).map((h) => h.id), ['test.echo']);
  assert.deepEqual(selectHandlers(registry, textEvent('e2', 'x', 'manual:recheck')).map((h) => h.id), ['test.check']);
});

test('adapter config overrides a handler trigger (BEH-9)', () => {
  const registry = build({ 'test.echo': [{ type: 'event', kind: 'form.submitted' }] });
  assert.deepEqual(selectHandlers(registry, textEvent('e1')).map((h) => h.id), ['test.check']);
  assert.deepEqual(selectHandlers(registry, textEvent('e2', 'x', 'form.submitted')).map((h) => h.id), ['test.echo', 'test.other']);
});
