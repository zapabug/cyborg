import assert from 'node:assert/strict';
import { test } from 'node:test';
import { textEvent } from '@cyborg/core/testing';
import { PackRegistry } from '../src/index.ts';
import { at, fact, factHandler, packOf, rig } from './helpers.ts';

const confirmedCutoff = (env: ReturnType<typeof rig>) => {
  env.store.putFact(fact('rules.cutoff', '17h'), 'a', at);
  env.store.moveFact('rules.cutoff', 'confirmed', { actor: 'p', at });
};

// M4-EC7
test('PRF-12: an unverified pack fact never reaches a prompt, even if the handler would accept any grade', async () => {
  const env = rig('shadow', factHandler({ packFacts: [{ key: 'pack.alpha', minGrade: 'unverified' }] }));
  env.packs.add(packOf([{ grade: 'unverified' }]));
  confirmedCutoff(env);
  const [out] = await env.runner.handle(textEvent('e1'));
  assert.equal(out!.outcome, 'refused');
  assert.match((out as { reason: string }).reason, /never feeds a prompt/);
  assert.equal(env.model.calls.length, 0);
  assert.deepEqual(env.packs.openQuestions(), [{ packId: 'pack-test', text: 'Is the exemption threshold still current?' }]);
});

test('PRF-12: a secondary pack fact needs opt-in and then shows its grade in the proposal', async () => {
  const strict = rig('live');
  strict.packs.add(packOf([{ grade: 'secondary' }]));
  confirmedCutoff(strict);
  assert.equal((await strict.runner.handle(textEvent('e1')))[0]!.outcome, 'refused');

  const optIn = rig('live', factHandler({ packFacts: [{ key: 'pack.alpha', minGrade: 'secondary' }] }));
  optIn.packs.add(packOf([{ grade: 'secondary' }]));
  confirmedCutoff(optIn);
  const [out] = await optIn.runner.handle(textEvent('e1'));
  assert.equal(out!.outcome, 'proposal');
  const proposal = (out as { proposal: { findings: { statement: string; evidence: string }[] } }).proposal;
  assert.match(proposal.findings[0]!.statement, /pack\.alpha.*secondary/);
  assert.equal(proposal.findings[0]!.evidence, 'https://example.invalid/source');
});

test('PRF-13: a pack fact past its reviewBy is stale and blocked', async () => {
  const env = rig('live');
  env.packs.add(packOf([{ reviewBy: '2026-10-01T00:00:00.000Z' }]));
  confirmedCutoff(env);
  const [out] = await env.runner.handle(textEvent('e1'));
  assert.equal(out!.outcome, 'refused');
  assert.match((out as { reason: string }).reason, /stale since/);
});

test('a checked pack fact reaches the prompt', async () => {
  const env = rig('live');
  env.packs.add(packOf([{}]));
  confirmedCutoff(env);
  assert.equal((await env.runner.handle(textEvent('e1')))[0]!.outcome, 'proposal');
});

test('PRF-11: a pack must validate and may not redefine another pack\'s key', () => {
  const packs = new PackRegistry();
  assert.throws(() => packs.add({ id: 'x' }));
  assert.throws(() => packs.add(packOf([{ grade: 'great' }])));
  packs.add(packOf([{}]));
  assert.throws(() => packs.add({ ...packOf([{}]), id: 'pack-two' }), /already defined/);
});
