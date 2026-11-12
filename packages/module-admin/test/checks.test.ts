import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Checklist, HandlerRegistry, Runner, type AuditRow, type ShadowEntry } from '@cyborg/core';
import { SqliteStore } from '@cyborg/store-sqlite';
import {
  adminModule, checkCommitments, checkEvidence, checkInternals, checkReasoning, checkReplyTarget, ITEMS, recordResults, runAllChecks, type VerificationData,
} from '../src/index.ts';
import { loadModules, CORE_VERSION } from '@cyborg/core';

const entry = (id: string, draft: string | null, over: Partial<ShadowEntry> = {}): ShadowEntry => ({
  id, createdAt: '2026-10-31T10:00:00.000Z', eventSource: 'chat', eventId: id, handlerId: 'sales.enquiry.reply_draft', handlerVersion: '1',
  proposalId: null, draft, output: {}, input: {}, factsUsed: [], humanReply: null, humanAction: null, humanAt: null, marking: null, markedBy: null, markedAt: null, bandVerdict: null, ...over,
});
const gateRow = (id: number, detail: Record<string, unknown>): AuditRow => ({
  id, at: '2026-10-31T10:00:00.000Z', proposalId: null, kind: 'gate', fromStatus: null, toStatus: null, actor: 'gate', detail,
});
const base = (over: Partial<VerificationData> = {}): VerificationData => ({
  channel: 'channel-1', entries: [], audit: [], roles: {}, minimum: { entries: 2, days: 0 }, profileKeys: ['offer.items', 'tone.style'], modelNames: ['Ministral'], selfTests: {}, ...over,
});

// M7b-EC2 (the markers and the entries; the scratchpad is in reasoning.test.ts)
test('ADM-6 / M7b-EC2: a reasoning marker in any shadow output fails the item', () => {
  const clean = checkReasoning(base({ entries: [entry('e1', 'The East Tour is €35 per person.')] }));
  assert.equal(clean.outcome, 'pass');
  for (const bad of ['<think>hmm</think> Hello', 'Okay, so the user wants a price. It is 35.', 'Step 1: check the profile', 'Reasoning: the user asked']) {
    const result = checkReasoning(base({ entries: [entry('e1', 'fine'), entry('e2', bad)] }));
    assert.equal(result.outcome, 'fail', bad);
    assert.deepEqual(result.findings.map((f) => f.evidence), ['shadow entry e2']);
  }
  assert.equal(checkReasoning(base()).outcome, 'insufficient', 'no shadow output, nothing to say');
});

// M7b-EC8
test('ADM-13 / M7b-EC8: commitment wording in a shadow output is found; clean outputs pass', () => {
  assert.equal(checkCommitments(base({ entries: [entry('e1', 'A colleague will confirm the details.')] })).outcome, 'pass');
  for (const bad of ['Your booking is confirmed.', "We've reserved two places.", 'We guarantee it.', 'Ficou reservado.']) {
    assert.equal(checkCommitments(base({ entries: [entry('e1', bad)] })).outcome, 'fail', bad);
  }
});

test('ADM-15 / M7b-EC8: prompt fragments, ledger ids, vault codes, profile keys and model names in an output are found', () => {
  assert.equal(checkInternals(base({ entries: [entry('e1', 'The tour is €35, see you Monday.')] })).outcome, 'pass');
  const leaks = [
    'You write replies for the business',
    'call 3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    'for vault:0a1b2c3d4e5f',
    'see FLAG-12',
    'per offer.items it is 35',
    'I am Ministral, a model',
  ];
  for (const text of leaks) assert.equal(checkInternals(base({ entries: [entry('e1', text)] })).outcome, 'fail', text);
});

test('ADM-8: a recorded send to the origin channel fails the item', () => {
  const violation: AuditRow = { id: 7, at: '', proposalId: null, kind: 'shadow_violation', fromStatus: null, toStatus: null, actor: 'shadow', detail: {} };
  assert.equal(checkReplyTarget(base({ entries: [entry('e1', 'x')], audit: [violation] })).outcome, 'fail');
  assert.equal(checkReplyTarget(base({ entries: [entry('e1', 'x')] })).outcome, 'pass');
});

// M7b-EC10
test('ADM-20, ADM-21 / M7b-EC10: with too little real traffic the checks say insufficient and a pass is never recorded', () => {
  const { checklist, store } = (() => { const s = new SqliteStore(':memory:'); return { store: s, checklist: new Checklist(ITEMS, s, s) }; })();
  const results = runAllChecks(base({ entries: [entry('e1', 'fine')] }));
  const outcomes = Object.fromEntries(results.map((r) => [r.itemId, r.outcome]));
  assert.equal(outcomes['ADM-6'], 'pass');
  assert.equal(outcomes['ADM-7'], 'insufficient', 'no group traffic seen');
  assert.equal(outcomes['ADM-14'], 'insufficient', 'no handoff traffic seen');
  assert.equal(outcomes['ADM-18'], 'insufficient', 'no media seen');
  assert.equal(outcomes['ADM-20'], 'insufficient');
  assert.equal(outcomes['ADM-10'], 'insufficient', 'the loop-guard self-test was not run');

  const recorded = recordResults(checklist, 'channel-1', results, 'system');
  assert.ok(recorded.unchanged.includes('ADM-7') && recorded.unchanged.includes('ADM-20'));
  assert.equal(checklist.get('channel-1', 'ADM-7').status, 'unchecked');
  assert.equal(checklist.get('channel-1', 'ADM-20').status, 'unchecked');
  assert.equal(store.listAudit().filter((a) => a.kind === 'checklist' && (a.detail as { item: string }).item === 'ADM-7').length, 0);
});

test('ADM-20: the evidence item needs N-7, the minimum entries and days, and all four traffic types', () => {
  const traffic = (t: string, id: number) => gateRow(id, { decision: 'run', traffic: t, chat: 'c' });
  const all = [traffic('group', 1), traffic('direct', 2), traffic('handoff', 3), traffic('command', 4)];
  const entries = [entry('e1', 'a'), entry('e2', 'b', { createdAt: '2026-11-03T10:00:00.000Z' })];
  assert.equal(checkEvidence(base({ entries, audit: all, minimum: { entries: 2, days: 3 } })).outcome, 'pass');
  assert.ok(checkEvidence(base({ entries, audit: all, minimum: undefined })).findings.some((f) => /N-7/.test(f.statement)));
  assert.ok(checkEvidence(base({ entries, audit: all, minimum: { entries: 5, days: 3 } })).findings.some((f) => /2 entries, the minimum is 5/.test(f.statement)));
  assert.ok(checkEvidence(base({ entries, audit: all, minimum: { entries: 2, days: 9 } })).findings.some((f) => /days, the minimum is 9/.test(f.statement)));
  assert.ok(checkEvidence(base({ entries, audit: all.slice(0, 3) })).findings.some((f) => /no command traffic/.test(f.statement)));
});

test('ADM-21 / M7b-EC10: with enough real traffic and no findings a pass is recorded with its evidence; findings fail the item with references', () => {
  const s = new SqliteStore(':memory:');
  const checklist = new Checklist(ITEMS, s, s);
  const audit = [gateRow(1, { decision: 'ignore', traffic: 'ignored', group: true, reason: 'group message not addressed to the bot' }), gateRow(2, { decision: 'run', traffic: 'group', chat: 'g' })];
  const good = runAllChecks(base({ entries: [entry('e1', 'The East Tour is €35.'), entry('e2', 'A colleague will reply.')], audit, roles: { g: 'reply' } }));
  recordResults(checklist, 'channel-1', good, 'system');
  assert.equal(checklist.get('channel-1', 'ADM-7').status, 'passed_machine');
  assert.match(checklist.get('channel-1', 'ADM-7').evidence ?? '', /group decisions observed/);
  assert.equal(checklist.get('channel-1', 'ADM-6').status, 'unchecked', 'ADM-6 is verified by both: the person part is still missing');

  const bad = runAllChecks(base({ entries: [entry('e1', 'Your booking is confirmed.')], audit, roles: { g: 'reply' } }));
  const result = recordResults(checklist, 'channel-1', bad, 'system');
  assert.ok(result.failed.includes('ADM-13'));
  assert.match(checklist.get('channel-1', 'ADM-13').evidence ?? '', /reads like a commitment \[shadow entry e1\]/);
});

test('ADM-21, ADM-22: the verification handler is model-free, returns findings and questions, and changes nothing in the checklist', async () => {
  const store = new SqliteStore(':memory:');
  const checklist = new Checklist(ITEMS, store, store);
  const registry = new HandlerRegistry({ autoReplyHandlers: [] });
  const source = { load: () => base({ entries: [entry('e1', 'Okay, so the user wants a price. Your booking is confirmed.')] }) };
  const report = loadModules(registry, [adminModule], {
    coreVersion: CORE_VERSION, profile: store, packs: [], capabilities: [], connectors: { 'verification-data': source },
    dependencyChecks: { 'connector:verification-data': () => ({ ok: true }) },
  });
  assert.deepEqual(report.refused, []);
  const handler = registry.get('admin.check.manners')!;
  assert.equal(handler.kind, 'deterministic');
  const runner = new Runner({ businessId: 'b', registry, store, ledger: store, model: { call: async () => { throw new Error('a model-free handler must not call the model'); } } });
  const [outcome] = await runner.handle({ id: 'check-1', source: 'admin', kind: 'manual:admin.check', at: '2026-10-31T10:00:00.000Z', payload: { channel: 'channel-1' } });
  assert.equal(outcome!.outcome, 'proposal');
  const proposal = (outcome as { proposal: { modelCallId: string | null; findings: { statement: string }[]; questions: string[]; subject: string } }).proposal;
  assert.equal(proposal.modelCallId, null);
  assert.equal(proposal.subject, 'admin.check:manners:channel-1');
  assert.ok(proposal.findings.some((f) => /ADM-6 \[manners\]: output contains a reasoning marker/.test(f.statement)));
  assert.ok(proposal.findings.some((f) => /ADM-13 \[manners\]/.test(f.statement)));
  assert.ok(proposal.questions.some((q) => /^ADM-7: not enough real traffic yet/.test(q)));
  assert.ok(checklist.list('channel-1').every((r) => r.status === 'unchecked'), 'the handler recorded nothing');
});
