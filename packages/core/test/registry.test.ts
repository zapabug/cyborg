import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { HandlerRegistry, RegistrationError, type AnyHandler } from '../src/index.ts';
import { deterministicHandler, echoHandler } from '../src/testing.ts';

const registry = (autoReplyHandlers: string[] = []) => new HandlerRegistry({ autoReplyHandlers });

function rejected(handler: unknown, rule: string, reg = registry()) {
  assert.throws(
    () => reg.registerHandler(handler as AnyHandler),
    (error: unknown) => error instanceof RegistrationError && error.rule === rule,
  );
}

test('a complete handler registers, model and deterministic', () => {
  const reg = registry();
  reg.registerHandler(echoHandler());
  reg.registerHandler(deterministicHandler());
  assert.deepEqual(reg.all().map((h) => h.id), ['test.echo', 'test.check']);
});

test('HDL-1: an input field without a data class is rejected', () => {
  rejected(
    echoHandler({
      input: {
        schema: z.object({ text: z.string(), extra: z.string() }),
        classes: { text: 'public' },
        fromEvent: () => ({}),
      },
    }),
    'HDL-1',
  );
});

test('HDL-1: an unknown data class and a class for a missing field are rejected', () => {
  rejected(
    echoHandler({ input: { ...echoHandler().input, classes: { text: 'confidential' as never } } }),
    'HDL-1',
  );
  rejected(echoHandler({ input: { ...echoHandler().input, classes: { text: 'public', ghost: 'deal' } } }), 'HDL-1');
});

test('HDL-2: tools, tool_choice, functions and function_call are rejected', () => {
  for (const key of ['tools', 'tool_choice', 'functions', 'function_call']) {
    rejected({ ...echoHandler(), [key]: [] }, 'HDL-2');
  }
  rejected({ ...echoHandler(), model: { level: 'json_object', name: 'x', tools: [] } }, 'HDL-2');
});

test('HDL-3: auto_reply needs adapter opt-in', () => {
  rejected(echoHandler({ effect: 'auto_reply' }), 'HDL-3');
  const reg = registry(['test.echo']);
  reg.registerHandler(echoHandler({ effect: 'auto_reply' }));
  assert.equal(reg.get('test.echo')?.effect, 'auto_reply');
});

test('HDL-3: auto_reply is never allowed for a commitment, even with opt-in', () => {
  rejected(echoHandler({ effect: 'auto_reply', commitment: true }), 'HDL-3', registry(['test.echo']));
});

test('HR-2: a prompt slot may not map to an identity or secret field', () => {
  for (const cls of ['identity', 'secret'] as const) {
    rejected(echoHandler({ input: { ...echoHandler().input, classes: { text: cls } } }), 'HR-2');
  }
});

test('PRV-6: a freetext slot is accepted; the runner scrubs it before any call', () => {
  const reg = registry();
  reg.registerHandler(echoHandler({ input: { ...echoHandler().input, classes: { text: 'freetext' } } }));
  assert.equal(reg.all().length, 1);
});

test('a prompt slot without a mapping is rejected', () => {
  rejected(echoHandler({ prompt: { template: 'Use {{other}}', slots: {} } }), 'HDL contract');
});

test('missing contract parts are rejected', () => {
  const base = echoHandler();
  for (const part of ['id', 'version', 'trigger', 'checks', 'toProposal', 'output', 'limits', 'profileKeys', 'packFacts']) {
    const broken = { ...base } as Record<string, unknown>;
    delete broken[part];
    rejected(broken, 'HDL contract');
  }
  rejected(echoHandler({ trigger: [] }), 'HDL contract');
  rejected(echoHandler({ model: { level: 'none' as never, name: 'x' } }), 'HDL contract');
});

test('a duplicate handler id is rejected', () => {
  const reg = registry();
  reg.registerHandler(echoHandler());
  rejected(echoHandler(), 'HDL contract', reg);
});
