import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectHandlers, type RunOutcome } from '@cyborg/core';
import { deterministicHandler, echoHandler, goodResponse, textEvent } from '@cyborg/core/testing';
import { setup } from './helpers.ts';

const onlyProposal = (outcomes: RunOutcome[], index = 0) => {
  const outcome = outcomes[index]!;
  assert.equal(outcome.outcome, 'proposal');
  return (outcome as Extract<RunOutcome, { outcome: 'proposal' }>).proposal;
};

// M1-EC2
test('a registered handler runs from a trigger with a scripted model and persists exactly one proposal', async () => {
  const env = setup([goodResponse], [echoHandler()]);
  const outcomes = await env.runner.handle(textEvent('e1'));
  assert.equal(outcomes.length, 1);
  const proposal = onlyProposal(outcomes);
  assert.equal(proposal.status, 'proposed');
  assert.equal(proposal.handlerId, 'test.echo');
  assert.equal(proposal.handlerVersion, '1');
  assert.deepEqual(proposal.changes, [{ field: 'summary', oldValue: null, newValue: 'beta', sourcePhrase: 'beta' }]);
  assert.equal(env.store.list().length, 1);
  assert.deepEqual(env.store.get(proposal.id), proposal);
  assert.equal(env.model.calls.length, 1);
});

test('BEH-11: one request and one response per run; the request carries no tools (HR-3)', async () => {
  const env = setup([goodResponse], [echoHandler()]);
  await env.runner.handle(textEvent('e1'));
  const request = env.model.calls[0]!;
  assert.equal(request.prompt, 'Extract from: alpha beta gamma');
  for (const key of ['tools', 'tool_choice', 'functions', 'function_call']) assert.ok(!(key in request));
  assert.equal((request.outputJsonSchema as { type?: string }).type, 'object');
});

test('HR-6: the ledger row exists and holds the exact request and raw response', async () => {
  const env = setup([goodResponse], [echoHandler()]);
  const proposal = onlyProposal(await env.runner.handle(textEvent('e1')));
  const row = env.store.read(proposal.modelCallId!)!;
  assert.equal(row.rawResponse, goodResponse);
  assert.equal(row.handlerId, 'test.echo');
  assert.deepEqual((row.requestPayload as { prompt: string }).prompt, 'Extract from: alpha beta gamma');
});

// M1-EC5
test('HR-3, BEH-9: selecting handlers never calls the model', async () => {
  const env = setup([], [echoHandler(), deterministicHandler()]);
  const selected = selectHandlers(env.registry, textEvent('e1')).map((h) => h.id);
  assert.deepEqual(selected, ['test.echo', 'test.check']);
  assert.equal(env.model.calls.length, 0);
  // An event no handler selects: the runner makes no call at all.
  assert.deepEqual(await env.runner.handle(textEvent('e2', 'x', 'unknown.kind')), []);
  assert.equal(env.model.calls.length, 0);
});

test('BEH-9: handlers run in registration order for the same event', async () => {
  const env = setup([goodResponse], [echoHandler(), deterministicHandler()]);
  const outcomes = await env.runner.handle(textEvent('e1'));
  assert.deepEqual(outcomes.map((o) => o.handlerId), ['test.echo', 'test.check']);
});

// M1-EC6
test('BEH-10: the same event id is handled once per handler', async () => {
  const env = setup([goodResponse, goodResponse], [echoHandler()]);
  const first = await env.runner.handle(textEvent('e1'));
  const second = await env.runner.handle(textEvent('e1'));
  assert.equal(first[0]!.outcome, 'proposal');
  assert.equal(second[0]!.outcome, 'duplicate');
  assert.equal(env.store.list().length, 1);
  assert.equal(env.model.calls.length, 1);
});

test('BEH-10: two concurrent deliveries of one event still yield one proposal', async () => {
  const env = setup([goodResponse, goodResponse], [echoHandler()]);
  const [a, b] = await Promise.all([env.runner.handle(textEvent('e1')), env.runner.handle(textEvent('e1'))]);
  assert.deepEqual([a[0]!.outcome, b[0]!.outcome].sort(), ['duplicate', 'proposal']);
  assert.equal(env.store.list().length, 1);
  assert.equal(env.model.calls.length, 1);
});

test('BEH-10: the same id from another source is a different event', async () => {
  const env = setup([goodResponse, goodResponse], [echoHandler()]);
  await env.runner.handle(textEvent('e1'));
  await env.runner.handle({ ...textEvent('e1'), source: 'other-source' });
  assert.equal(env.store.list().length, 2);
});

test('BEH-13, N-1: invalid output is retried once, then a valid answer is accepted', async () => {
  const env = setup(['not json', goodResponse], [echoHandler()]);
  const proposal = onlyProposal(await env.runner.handle(textEvent('e1')));
  assert.equal(proposal.status, 'proposed');
  assert.equal(env.model.calls.length, 2);
});

test('BEH-13, BEH-6: after the retry the proposal is invalid_output and cannot be approved', async () => {
  const env = setup(['not json', JSON.stringify({ value: 1 })], [echoHandler()]);
  const proposal = onlyProposal(await env.runner.handle(textEvent('e1')));
  assert.equal(proposal.status, 'invalid_output');
  assert.equal(env.model.calls.length, 2);
  assert.match(proposal.reason ?? '', /attempt 1.*attempt 2/);
  assert.throws(() => env.lifecycle.decide(proposal.id, 'approve', 'actor:1'));
});

test('BEH-12, HDL-6: a source phrase that is not in the input fails validation', async () => {
  const wrong = JSON.stringify({ value: 'delta', phrase: 'delta' });
  const env = setup([wrong, wrong], [echoHandler()]);
  const proposal = onlyProposal(await env.runner.handle(textEvent('e1')));
  assert.equal(proposal.status, 'invalid_output');
  assert.match(proposal.reason ?? '', /sourcePhrase/);
});

test('handler code checks run after the schema and can fail the output', async () => {
  const empty = JSON.stringify({ value: '', phrase: 'beta' });
  const env = setup([empty, goodResponse], [echoHandler()]);
  const proposal = onlyProposal(await env.runner.handle(textEvent('e1')));
  assert.equal(proposal.status, 'proposed');
  assert.equal(env.model.calls.length, 2);
});

test('a failing model call is retried, recorded in the ledger, then yields invalid_output', async () => {
  const env = setup([new Error('connection refused'), new Error('connection refused')], [echoHandler()]);
  const proposal = onlyProposal(await env.runner.handle(textEvent('e1')));
  assert.equal(proposal.status, 'invalid_output');
  const row = env.store.read(proposal.modelCallId!)!;
  assert.equal(row.error, 'connection refused');
  assert.equal(row.rawResponse, null);
});

test('HDL-4: a handler may produce no proposal, with the reason recorded', async () => {
  const env = setup([goodResponse], [echoHandler({ toProposal: () => ({ none: 'nothing to propose' }) })]);
  const outcomes = await env.runner.handle(textEvent('e1'));
  assert.deepEqual(outcomes[0], { handlerId: 'test.echo', outcome: 'none', reason: 'nothing to propose' });
  assert.equal(env.store.list().length, 0);
  assert.equal(env.store.listAudit().at(-1)!.kind, 'no_proposal');
  assert.equal((await env.runner.handle(textEvent('e1')))[0]!.outcome, 'duplicate');
});

test('an input that fails its schema is recorded and the model is not called', async () => {
  const env = setup([], [echoHandler()]);
  const outcomes = await env.runner.handle({ ...textEvent('e1'), payload: { text: 42 } });
  assert.equal(outcomes[0]!.outcome, 'none');
  assert.match((outcomes[0] as { reason: string }).reason, /^input_rejected/);
  assert.equal(env.model.calls.length, 0);
});

test('HDL-13: a deterministic handler makes no model call and has no ledger row', async () => {
  const env = setup([], [deterministicHandler()]);
  const proposal = onlyProposal(await env.runner.handle(textEvent('e1')));
  assert.equal(proposal.status, 'proposed');
  assert.equal(proposal.modelCallId, null);
  assert.equal(env.model.calls.length, 0);
});

test('a handler that declares profile facts cannot run without a fact provider', async () => {
  const env = setup([], [echoHandler({ profileKeys: ['business.name'] })]);
  await assert.rejects(env.runner.handle(textEvent('e1')), /no fact provider/);
});
