import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CORE_VERSION, HandlerRegistry, Lifecycle, loadModules, Runner, type CapabilityResult, type LoadEnv } from '@cyborg/core';
import { ScriptedModel } from '@cyborg/core/testing';
import { renderMorningSheet } from '@cyborg/module-admin';
import { SqliteStore } from '@cyborg/store-sqlite';
import { complaintsSection, feedbackModule, reviewEvent } from '../src/index.ts';

const AT = '2026-10-31T10:00:00.000Z';
const capability: CapabilityResult = { baseUrl: 'http://x/v1', model: 'm', level: 'strict_schema', requestShape: 'json_schema_wrapped', logprobs: false, testedAt: AT, attempts: [] };

function rig(script: string[]) {
  const store = new SqliteStore(':memory:');
  const registry = new HandlerRegistry({ autoReplyHandlers: [] });
  const env: LoadEnv = {
    coreVersion: CORE_VERSION, profile: store, packs: [], capabilities: [capability],
    connectors: { reviews: {} }, dependencyChecks: { 'connector:reviews': () => ({ ok: true }) }, moduleConfig: {},
  };
  const report = loadModules(registry, [feedbackModule], env);
  const model = new ScriptedModel([...script]);
  const runner = new Runner({ businessId: 'b', registry, store, ledger: store, model, now: () => new Date(AT) });
  return { store, report, model, runner };
}

// Reviews are written by the test: the framework has no review corpus, and the extraction only needs text with and without a complaint.
const COMPLAINT = 'Lovely guide but the pickup was 40 minutes late and nobody told us. The food stop was fine.';
const PRAISE = 'Great day out, would book again.';

test('ADM-58: the module loads with its manifest and one handler', () => {
  const env = rig([]);
  assert.deepEqual(env.report.refused, []);
  assert.deepEqual(env.report.loaded[0]!.handlerIds, ['feedback.review.complaints']);
});

test('ADM-58: a review becomes a proposal of complaints, each with the reviewer\'s words; praise alone makes none', async () => {
  const env = rig([
    JSON.stringify({ complaints: [{ topic: 'late pickup', sourcePhrase: 'the pickup was 40 minutes late' }, { topic: 'no communication', sourcePhrase: 'nobody told us' }] }),
    JSON.stringify({ complaints: [] }),
  ]);
  const [out] = await env.runner.handle(reviewEvent({ site: 'site-a', ref: 'r1', text: COMPLAINT, at: AT }));
  assert.equal(out!.outcome, 'proposal');
  const proposal = (out as Extract<typeof out, { outcome: 'proposal' }>).proposal;
  assert.equal(proposal.subject, 'site-a:r1');
  assert.deepEqual(proposal.findings, [
    { statement: 'complaint: late pickup', evidence: 'the pickup was 40 minutes late' },
    { statement: 'complaint: no communication', evidence: 'nobody told us' },
  ]);
  assert.ok(env.model.calls[0]!.prompt.includes(`Review from site-a:\n${COMPLAINT}`));
  const [praise] = await env.runner.handle(reviewEvent({ site: 'site-a', ref: 'r2', text: PRAISE, at: AT }));
  assert.equal(praise!.outcome, 'none');
});

test('ADM-58: words that are not in the review make the output invalid', async () => {
  const wrong = JSON.stringify({ complaints: [{ topic: 'rude guide', sourcePhrase: 'the guide was rude' }] });
  const env = rig([wrong, wrong]);
  const [out] = await env.runner.handle(reviewEvent({ site: 'site-a', text: COMPLAINT, at: AT }));
  const proposal = (out as Extract<typeof out, { outcome: 'proposal' }>).proposal;
  assert.equal(proposal.status, 'invalid_output');
  assert.match(proposal.reason ?? '', /does not occur in the review/);
});

test('ADM-58: pasting the same review twice raises the same event and the handler runs once', async () => {
  const env = rig([JSON.stringify({ complaints: [{ topic: 'late pickup', sourcePhrase: 'the pickup was 40 minutes late' }] })]);
  const first = reviewEvent({ site: 'site-a', text: COMPLAINT, at: AT });
  const again = reviewEvent({ site: 'site-a', text: COMPLAINT, at: '2026-10-31T12:00:00.000Z' });
  assert.equal(first.id, again.id);
  assert.notEqual(first.id, reviewEvent({ site: 'site-b', text: COMPLAINT, at: AT }).id);
  await env.runner.handle(first);
  await env.runner.handle(again);
  assert.equal(env.model.calls.length, 1);
  assert.equal(env.store.list({ handlerId: 'feedback.review.complaints' }).length, 1);
});

test('ADM-58, ADM-59: open complaints appear on the morning sheet until a person approves or declines them', async () => {
  const env = rig([JSON.stringify({ complaints: [{ topic: 'late pickup', sourcePhrase: 'the pickup was 40 minutes late' }] })]);
  const [out] = await env.runner.handle(reviewEvent({ site: 'site-a', ref: 'r1', text: COMPLAINT, at: AT }));
  const proposal = (out as Extract<typeof out, { outcome: 'proposal' }>).proposal;
  const sections = [complaintsSection(env.store)];
  const sheet = () => renderMorningSheet({ sections, control: env.store, now: () => new Date('2026-11-01T09:00:00.000Z') });
  assert.match(sheet(), /Review complaints: 1/);
  assert.match(sheet(), /Complaint: site-a:r1\nSpec: complaints\nState: late pickup \("the pickup was 40 minutes late"\)/);
  new Lifecycle({ store: env.store }).decide(proposal.id, 'approve', 'person:staff-2', { note: 'handled' });
  assert.match(sheet(), /Nothing is pending\./);
});
