import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AutoReplyPolicy, buildCalibrationReport, buildSample, CalibrationTracker, closeTicketFixed, collectReviewEntries, computeConfidence, exportForSupplier,
  flagReply, FLAG_REASONS, HeadsUpMonitor, isFalseConfidence, markEntry, previewCheck, previewLesson, proposeFlagImprovement, proposeOwnerReport,
  ShadowController, type DevReportSink, type HeadsUp, type OutboundMessage, type OutboundSink, type ReviewEntry,
} from '@cyborg/core';
import { message, rig, tourDeskConfig } from './helpers.ts';

const REPLY = 'sales.enquiry.reply_draft';
const draft = (text: string, selfAssessment?: { band: string; reason: string }) => JSON.stringify({ draft: text, ...(selfAssessment ? { selfAssessment } : {}) });
const HOW_MUCH = 'how much is the east tour'; // a wazaa test chat
const T0 = new Date('2026-10-31T10:00:00.000Z');

class Sink implements OutboundSink {
  sent: OutboundMessage[] = [];
  constructor(readonly channel: string) {}
  async send(m: OutboundMessage) { this.sent.push(m); }
}

function m8Rig(script: string[], opts: { config?: unknown; autoReply?: boolean } = {}) {
  const clock = { now: T0 };
  const env = rig({ mode: 'shadow', enabledHandlers: [REPLY], script, now: () => clock.now, config: opts.config ?? tourDeskConfig });
  const { policy, tracker } = env;
  const review = new Sink('review-chat');
  const controller = new ShadowController({ runner: env.runner, log: env.store, store: env.store, ledger: env.store, originChannel: 'origin', review, now: () => clock.now });
  const evalDeps = { log: env.store, profile: env.store, proposals: env.store, policy, businessId: 'b', now: () => clock.now };
  const entries = (isAutoReply = () => opts.autoReply ?? false): ReviewEntry[] =>
    collectReviewEntries({ log: env.store, proposals: env.store, ledger: env.store, flags: env.store, isAutoReply });
  const flagDeps = (monitor?: HeadsUpMonitor) => ({ flags: env.store, proposals: env.store, ledger: env.store, policy, ...(monitor ? { monitor } : {}), now: () => clock.now });
  return { ...env, clock, controller, evalDeps, entries, flagDeps };
}

// M8-EC1
test('PRF-27..29 / M8-EC1: the band starts high and only goes down; self-assessment can lower and never raise', () => {
  const facts = { profile: [], pack: [] };
  const base = { facts, input: {}, output: {}, meanLogprob: undefined, viaVoice: false };
  const band = (spec: Parameters<typeof computeConfidence>[0]['spec'], over: Partial<Parameters<typeof computeConfidence>[0]> = {}) =>
    computeConfidence({ ...base, spec, ...over }).band;
  assert.equal(band({}), 'high');
  assert.equal(band({ grounding: () => ({ ok: false, untraced: ['08:30'] }) }), 'low');
  assert.equal(band({ selfAssessment: () => ({ band: 'low', reason: 'unsure' }) }), 'low');
  assert.equal(band({ selfAssessment: () => ({ band: 'medium', reason: 'mostly' }) }), 'medium');
  assert.equal(band({ selfAssessment: () => ({ band: 'high', reason: 'sure' }) }), 'high');
  assert.equal(band({ grounding: () => ({ ok: false, untraced: ['x'] }), selfAssessment: () => ({ band: 'high', reason: 'sure' }) }), 'low', 'it never raises');
  assert.equal(band({}, { viaVoice: true }), 'medium', 'a voice transcript is capped at medium (ADM-30)');
  const withSignals = computeConfidence({ ...base, spec: { grounding: () => ({ ok: true, untraced: [] }) }, meanLogprob: -0.2 });
  assert.deepEqual(withSignals.signals.map((s) => [s.kind, s.passed]), [['checks', true], ['grounding', true], ['logprob', null]]);
  assert.equal(withSignals.rule, 'band-rule-1');
});

test('PRF-28d / M8-EC2: a log-probability is recorded but changes the band only when a floor came from a review (HR-10)', () => {
  const input = { facts: { profile: [], pack: [] }, input: {}, output: {}, viaVoice: false };
  assert.equal(computeConfidence({ ...input, spec: {}, meanLogprob: -5 }).band, 'high', 'no floor configured: recorded only');
  assert.equal(computeConfidence({ ...input, spec: { logprobFloor: -1 }, meanLogprob: -5 }).band, 'medium');
  assert.equal(computeConfidence({ ...input, spec: { logprobFloor: -1 }, meanLogprob: -0.5 }).band, 'high');
  assert.ok(!computeConfidence({ ...input, spec: {}, meanLogprob: undefined }).signals.some((s) => s.kind === 'logprob'), 'no log-probability, no signal');
});

test('PRF-27 / M8-EC1: a sales draft carries a band with its signals; an untraced number makes it low; extraction carries none', async () => {
  const env = m8Rig([draft('The East Tour is €35 per person.'), draft('The East Tour is €35 and pick-up is at 08:30.')]);
  await env.controller.observe(message(HOW_MUCH, 'e1'));
  await env.controller.observe(message(HOW_MUCH, 'e2'));
  const [a, b] = env.store.list({ handlerId: REPLY });
  assert.equal(a!.confidence!.band, 'high');
  assert.deepEqual(a!.confidence!.signals.map((s) => s.kind), ['checks', 'grounding', 'language']);
  assert.equal(b!.confidence!.band, 'low');
  assert.match(b!.confidence!.signals.find((s) => s.kind === 'grounding')!.detail ?? '', /08:30/);

  const intake = rig({ enabledHandlers: ['sales.enquiry.intake'], script: [JSON.stringify({ items: [{ field: 'tour', value: 'East Tour', sourcePhrase: 'east tour' }] })] });
  const out = (await intake.runner.handle(message(HOW_MUCH)))[0] as { proposal: { confidence: unknown } };
  assert.equal(out.proposal.confidence, null);
});

test('PRF-28c: the model\'s own band is asked for only when configured, and can only lower the computed band', async () => {
  const env = m8Rig([draft('A colleague will follow up.', { band: 'medium', reason: 'no exact answer' }), draft('A colleague will follow up.', { band: 'high', reason: 'sure' })], { config: { ...tourDeskConfig, selfAssessment: true } });
  assert.match(env.registry.get(REPLY)!.version, /^9\+[0-9a-f]{8}$/);
  await env.controller.observe(message(HOW_MUCH, 'e1'));
  await env.controller.observe(message(HOW_MUCH, 'e2'));
  assert.match(env.model.calls[0]!.prompt, /Also give selfAssessment/);
  const [a, b] = env.store.list({ handlerId: REPLY });
  assert.equal(a!.confidence!.band, 'medium');
  assert.equal(b!.confidence!.band, 'high');
  assert.deepEqual(a!.confidence!.signals.map((s) => s.kind), ['checks', 'grounding', 'self_assessment']);
});

// M8-EC3
test('PRF-30, PRF-38 / M8-EC3: a new version makes the calibration stale and a review due; a new model or endpoint also suspends auto-reply', () => {
  const env = m8Rig([]);
  const t = (iso: string) => iso;
  assert.deepEqual(env.tracker.observe(REPLY, '9', 'm1', 'http://a/v1', t('2026-10-31T10:00:00.000Z')), { changed: true });
  assert.deepEqual(env.tracker.observe(REPLY, '9', 'm1', 'http://a/v1', t('2026-10-31T11:00:00.000Z')), { changed: false });
  assert.equal(env.tracker.reviewDue(new Date('2026-11-01T00:00:00.000Z')).length, 0);

  env.tracker.observe(REPLY, '9+L1', 'm1', 'http://a/v1', t('2026-11-02T10:00:00.000Z'));
  assert.equal(env.store.getSuspension(REPLY), null, 'a lesson or prompt change does not suspend');
  assert.deepEqual(env.tracker.reviewDue(new Date('2026-11-02T10:00:00.000Z')).map((c) => [c.handlerVersion, c.status]), [['9', 'stale']]);

  env.tracker.observe(REPLY, '9+L1', 'm2', 'http://a/v1', t('2026-11-03T10:00:00.000Z'));
  assert.match(env.store.getSuspension(REPLY)!.reason, /model or endpoint changed.*PRF-38/);
  assert.equal(env.store.listCalibrations().filter((c) => c.status === 'current').length, 1);
  assert.ok(env.store.listAudit().filter((a) => a.kind === 'calibration_stale').length >= 2);
});

test('N-9: a current calibration is due for review a month after its last review', () => {
  const env = m8Rig([]);
  env.tracker.observe(REPLY, '9', 'm1', 'e', '2026-10-01T10:00:00.000Z');
  assert.equal(env.tracker.reviewDue(new Date('2026-10-30T00:00:00.000Z')).length, 0);
  assert.equal(env.tracker.reviewDue(new Date('2026-11-02T00:00:00.000Z')).length, 1);
  env.store.recordReview(REPLY, '9', 'm1', 'e', '2026-11-02T00:00:00.000Z');
  assert.equal(env.tracker.reviewDue(new Date('2026-11-20T00:00:00.000Z')).length, 0);
  assert.equal(env.tracker.reviewDue(new Date('2026-12-03T00:00:00.000Z')).length, 1);
});

test('the runner tells the tracker which (version, model, endpoint) each confidence-bearing proposal came from', async () => {
  const env = m8Rig([draft('A colleague will follow up.'), draft('A colleague will follow up.')]);
  await env.controller.observe(message(HOW_MUCH, 'e1'));
  env.store.addLesson({ handlerId: REPLY, text: 'be brief', originEntryId: null }, T0.toISOString());
  await env.controller.observe(message(HOW_MUCH, 'e2'));
  assert.deepEqual(env.store.listCalibrations().map((c) => [c.handlerVersion, c.status, c.model, c.endpoint]), [['9', 'stale', 'default', 'scripted://local'], ['9+L1', 'current', 'default', 'scripted://local']]);
});

// M8-EC4
test('PRF-32 / M8-EC4: the sample is seeded, reproducible and stratified, and draws only from stored entries', async () => {
  const letters = (i: number) => String.fromCharCode(97 + Math.floor(i / 26)) + String.fromCharCode(97 + (i % 26));
  const drafts = Array.from({ length: 30 }, (_, i) => draft(i % 5 === 0 ? 'pick-up at 07:15 sharp' : `Reply ${letters(i)} from a colleague.`));
  const env = m8Rig(drafts);
  for (let i = 0; i < 30; i++) await env.controller.observe(message(HOW_MUCH, `e${i}`));
  const all = env.entries();
  assert.equal(all.length, 30);
  assert.equal(all.filter((e) => e.band === 'low').length, 6);
  const config = { seed: 'review-2026-10', highDraw: 4, mediumDraw: 0 };
  const one = buildSample(all, config);
  const two = buildSample(all, config);
  assert.deepEqual(one.sample.map((e) => e.entry.id), two.sample.map((e) => e.entry.id), 'same seed, same sample');
  assert.notDeepEqual(buildSample(all, { ...config, seed: 'another' }).sample.map((e) => e.entry.id), one.sample.map((e) => e.entry.id));
  assert.equal(one.mandatory, 6, 'every low-band entry is in');
  assert.equal(one.drawn, 4);
  assert.equal(one.sample.length, 10);
  const stored = new Set(env.store.listEntries().map((e) => e.id));
  assert.ok(one.sample.every((e) => stored.has(e.entry.id)));
  assert.ok(one.sample.filter((e) => e.band === 'high').length === 4);

  // Entries marked wrong and entries of auto-reply handlers are always in.
  const high = all.find((e) => e.band === 'high')!;
  markEntry(env.evalDeps, high.entry.id, 'worse', 'person:staff');
  const withWrong = buildSample(env.entries(), config);
  assert.ok(withWrong.sample.some((e) => e.entry.id === high.entry.id));
  assert.equal(buildSample(env.entries(() => true), config).sample.length, 30, 'all auto-reply entries are eligible');
});

// M8-EC5
test('PRF-34, PRF-37 / M8-EC5: the report counts markings and verdicts per band, has no single score, and the supplier export carries no customer text', async () => {
  const env = m8Rig([draft('The East Tour is €35 per person.'), draft('pick-up at 07:15 sharp'), draft('A colleague will follow up.')]);
  const sender = 'sender-+351 913 999 000-ident';
  await env.controller.observe(message(HOW_MUCH, 'e1', sender));
  await env.controller.observe(message(HOW_MUCH, 'e2', sender));
  await env.controller.observe(message(HOW_MUCH, 'e3', sender));
  env.controller.recordHuman('chat', 'e1', { reply: 'It is 35 euros per person, a private customer note.' });
  const [a, b, c] = env.store.listEntries();
  markEntry(env.evalDeps, a!.id, 'match', 'person:staff');
  markEntry(env.evalDeps, b!.id, 'different_but_fine', 'person:staff');
  env.store.setBandVerdict(a!.id, 'about_right', 'person:staff', T0.toISOString());
  env.store.setBandVerdict(b!.id, 'too_low', 'person:staff', T0.toISOString());
  const report = buildCalibrationReport({ handlerId: REPLY, handlerVersion: '9', model: 'default', endpoint: 'scripted://local' }, env.entries(), 0, T0);
  assert.deepEqual(report.perBand.high.markings, { match: 1, better: 0, worse: 0, different_but_fine: 0, wrong_fact: 0, unmarked: 1 });
  assert.deepEqual(report.perBand.low.markings.different_but_fine, 1);
  assert.deepEqual(report.perBand.low.verdicts, { about_right: 0, too_high: 0, too_low: 1, none: 0 });
  assert.deepEqual(report.perBand.high.verdicts, { about_right: 1, too_high: 0, too_low: 0, none: 1 });
  assert.equal(c!.marking, null);
  assert.ok(!/"(score|accuracy|percent|rate)"/i.test(JSON.stringify(report)), 'no single score');

  const exported = JSON.stringify(exportForSupplier(report));
  for (const secret of ['private customer note', sender, 'pick-up at 07:15', 'The East Tour is']) assert.equal(exported.includes(secret), false, secret);
  const proposal = proposeOwnerReport(env.store, 'b', report, T0.toISOString());
  assert.equal(proposal.status, 'proposed');
  assert.equal(proposal.handlerId, 'calibration.owner_report');
  assert.ok(!JSON.stringify(proposal).includes('private customer note'));
  assert.match(proposal.findings.at(-1)!.statement, /false confidence 0; over-caution 0|over-caution/);
});

// M8-EC6
test('PRF-35, PRF-36 / M8-EC6: a high-band reply marked wrong suspends auto-reply until a person re-enables it, and no threshold changes by itself', async () => {
  const env = m8Rig([draft('The East Tour is €35 per person.')], { autoReply: true });
  assert.deepEqual(env.policy.decide({ handlerId: REPLY, confidence: { band: 'high', rule: 'x', signals: [] } }), { send: false, why: 'no eligible band is set; auto-reply is off by default (HDL-3)' });
  assert.throws(() => env.policy.setEligibleBand(REPLY, 'high', ' ', 'person:owner'), /report it came from/);
  env.policy.setEligibleBand(REPLY, 'high', 'calibration-2026-10', 'person:owner');
  await env.controller.observe(message(HOW_MUCH, 'e1'));
  const [proposal] = env.store.list({ handlerId: REPLY });
  assert.equal(env.policy.decide(proposal!).send, true);
  assert.equal(env.policy.decide({ handlerId: REPLY, confidence: { band: 'medium', rule: 'x', signals: [] } }).send, false);

  const [entry] = env.store.listEntries();
  markEntry(env.evalDeps, entry!.id, 'wrong_fact', 'person:staff', { factKeys: ['offer.items'] });
  assert.match(env.store.getSuspension(REPLY)!.reason, /high-band reply was marked wrong_fact/);
  assert.equal(env.policy.decide(proposal!).send, false);
  assert.equal(env.store.getEligibleBand(REPLY)!.band, 'high', 'the eligible band did not move by itself');
  assert.throws(() => env.policy.reenable(REPLY, ' '), /a person/);
  env.policy.reenable(REPLY, 'person:owner');
  assert.equal(env.store.getSuspension(REPLY), null);
  assert.ok(env.store.listAudit().some((a) => a.kind === 'auto_reply_reenabled' && a.actor === 'person:owner'));
});

test('PRF-36: a medium-band entry marked wrong does not suspend', async () => {
  const env = m8Rig([draft('A colleague will follow up.', { band: 'medium', reason: 'x' })], { config: { ...tourDeskConfig, selfAssessment: true } });
  await env.controller.observe(message(HOW_MUCH, 'e1'));
  markEntry(env.evalDeps, env.store.listEntries()[0]!.id, 'worse', 'person:staff');
  assert.equal(env.store.getSuspension(REPLY), null);
});

// M8-EC8 / EC9 / EC10
async function flaggedRig() {
  const env = m8Rig([draft('The East Tour is €35 per person.'), draft('The East Tour is €35 per person, see you Monday.'), draft('A colleague will follow up.'), draft('The East Tour takes 9 hours.')]);
  for (const id of ['e1', 'e2', 'e3', 'e4']) await env.controller.observe(message(HOW_MUCH, id));
  const proposals = env.store.list({ handlerId: REPLY });
  return { env, proposals };
}

test('PRF-39, PRF-46 / M8-EC8: staff can flag a reply with a reason at any time; it is stored with version, model, endpoint and band', async () => {
  const { env, proposals } = await flaggedRig();
  assert.deepEqual([...FLAG_REASONS], ['wrong_fact', 'promised_something', 'missed_question', 'wrong_tone', 'too_long', 'unclear', 'other']);
  await assert.rejects(flagReply(env.flagDeps(), { proposalId: proposals[0]!.id, reason: 'bad' as never, actor: 'person:staff', lastMessages: [], autoReplied: false }), /not a flag reason/);
  const { flag } = await flagReply(env.flagDeps(), { proposalId: proposals[0]!.id, reason: 'wrong_tone', note: 'too stiff', actor: 'person:staff', lastMessages: ['hello'], autoReplied: false });
  assert.deepEqual([flag.proposalId, flag.handlerVersion, flag.model, flag.endpoint, flag.band, flag.reason, flag.status], [proposals[0]!.id, '9', 'default', 'scripted://local', 'high', 'wrong_tone', 'open']);
  assert.equal(env.store.listFlags({ handlerId: REPLY }).length, 1);
});

test('PRF-40, PRF-41, PRF-42 / M8-EC9, EC10: the flagged-by-band view, false-confidence entries in full, and per-signal pass counts', async () => {
  const { env, proposals } = await flaggedRig();
  const [p1, p2, p3, p4] = proposals;
  assert.deepEqual(proposals.map((p) => p.confidence!.band), ['high', 'high', 'high', 'low']);
  for (const p of [p2!, p4!]) await flagReply(env.flagDeps(), { proposalId: p.id, reason: 'wrong_fact', actor: 'person:staff', lastMessages: [], autoReplied: false });
  const entries = env.entries();
  const report = buildCalibrationReport({ handlerId: REPLY, handlerVersion: '9', model: 'default', endpoint: 'scripted://local' }, entries, 0, T0);
  assert.deepEqual(report.flagView.flagged, { low: 1, medium: 0, high: 1, none: 0 });
  assert.deepEqual(report.flagView.notFlagged, { low: 0, medium: 0, high: 2, none: 0 });
  const fc = entries.filter(isFalseConfidence);
  assert.equal(fc.length, 2, 'the flagged high entry and the flagged low entry whose code checks all passed');
  assert.deepEqual(report.falseConfidence.map((f) => f.entryId).sort(), fc.map((e) => e.entry.id).sort());
  const highFc = report.falseConfidence.find((f) => f.band === 'high')!;
  assert.deepEqual(highFc.signals.map((s) => [s.kind, s.passed]), [['checks', true], ['grounding', true], ['language', true]]);
  assert.deepEqual(report.signalPassCounts, { checks: { passed: 2, total: 2 }, grounding: { passed: 1, total: 2 }, language: { passed: 1, total: 1 } });
  assert.equal(report.overCaution, 0);
  // The sample always carries them.
  assert.ok(fc.every((e) => buildSample(entries, { seed: 's', highDraw: 0, mediumDraw: 0 }).sample.some((s) => s.entry.id === e.entry.id)));
  void p1; void p3;
});

// M8-EC11
test('PRF-43, PRF-44 / M8-EC11: an improvement from a false-confidence entry names the missed signal, and its effect on the flagged and on match entries is shown first', async () => {
  const { env, proposals } = await flaggedRig();
  const [p1, p2, p3] = proposals;
  await flagReply(env.flagDeps(), { proposalId: p2!.id, reason: 'promised_something', actor: 'person:staff', lastMessages: [], autoReplied: false });
  let entries = env.entries();
  const flagged = entries.find((e) => e.entry.proposalId === p2!.id)!;
  assert.equal(isFalseConfidence(flagged), true);
  markEntry(env.evalDeps, flagged.entry.id, 'worse', 'person:staff');
  markEntry(env.evalDeps, entries.find((e) => e.entry.proposalId === p1!.id)!.entry.id, 'match', 'person:staff');
  markEntry(env.evalDeps, entries.find((e) => e.entry.proposalId === p3!.id)!.entry.id, 'match', 'person:staff');
  entries = env.entries();
  const deps = { ...env.evalDeps };

  assert.throws(() => proposeFlagImprovement(deps, entries.find((e) => e.entry.id === flagged.entry.id)!, { target: 'check', handlerId: REPLY, rule: 'no day names' }, undefined), /must name the signal that missed it/);
  const proposal = proposeFlagImprovement(deps, entries.find((e) => e.entry.id === flagged.entry.id)!, { target: 'check', handlerId: REPLY, rule: 'block "see you <day>" wording' }, 'checks');
  assert.equal(proposal.handlerId, 'shadow.improvement');
  assert.deepEqual(env.store.listAudit(proposal.id).filter((a) => a.kind === 'missed_by_signal').map((a) => a.detail), [{ entryId: flagged.entry.id, signal: 'checks' }]);

  // A candidate check, run over the stored outputs: it would block the flagged reply and leave the match entries alone.
  const candidate = (d: string) => (/see you/i.test(d) ? ['sounds like a promise'] : []);
  const cp = previewCheck(candidate, entries.find((e) => e.entry.id === flagged.entry.id)!, entries);
  assert.deepEqual(cp, { wouldBlockFlagged: true, matchEntriesBlocked: [], matchEntriesChecked: 2 });
  const tooBroad = previewCheck((d) => (d.includes('€35') ? ['no prices'] : []), entries.find((e) => e.entry.id === flagged.entry.id)!, entries);
  assert.equal(tooBroad.matchEntriesBlocked.length, 1, 'the approver sees that the check also catches a match entry');
});

test('PRF-44: a candidate lesson is replayed against the flagged entry and every match entry before approval', async () => {
  const { env, proposals } = await flaggedRig();
  const [p1, p2, p3] = proposals;
  await flagReply(env.flagDeps(), { proposalId: p2!.id, reason: 'promised_something', actor: 'person:staff', lastMessages: [], autoReplied: false });
  let entries = env.entries();
  const byProposal = (id: string) => entries.find((e) => e.entry.proposalId === id)!;
  markEntry(env.evalDeps, byProposal(p2!.id).entry.id, 'worse', 'person:staff');
  markEntry(env.evalDeps, byProposal(p1!.id).entry.id, 'match', 'person:staff');
  markEntry(env.evalDeps, byProposal(p3!.id).entry.id, 'match', 'person:staff');
  entries = env.entries();
  // The scripted model plays the answers the new version would give: the flagged reply changes, one match entry changes, one does not.
  env.model.calls.length = 0;
  (env.model as unknown as { script: string[] }).script.push(draft('The East Tour is €35 per person.'), draft('The East Tour is €35 per person.'), draft('A colleague will follow up.'));
  const preview = await previewLesson(env.runner, 'never say "see you" on a day', byProposal(p2!.id), entries);
  assert.equal(preview.matchEntriesChecked, 2);
  assert.equal(preview.flagged.draftChanged, true);
  assert.equal(preview.flagged.newDraft, 'The East Tour is €35 per person.');
  assert.deepEqual(preview.matchEntriesChanged.map((r) => r.entryId), [], 'both match entries kept their draft');
  assert.match(env.model.calls[0]!.prompt, /- never say "see you" on a day/, 'the candidate was in the prompt of the replay');
  assert.equal(env.store.activeLessonsFor(REPLY).length, 0, 'nothing was stored: the lesson is only a candidate');
});

// M8-EC12
test('PRF-45 / M8-EC12: a wrong_fact or promised_something flag on an auto-replied entry suspends auto-reply; other reasons do not', async () => {
  const { env, proposals } = await flaggedRig();
  await flagReply(env.flagDeps(), { proposalId: proposals[0]!.id, reason: 'too_long', actor: 'person:staff', lastMessages: [], autoReplied: true });
  assert.equal(env.store.getSuspension(REPLY), null);
  await flagReply(env.flagDeps(), { proposalId: proposals[1]!.id, reason: 'wrong_fact', actor: 'person:staff', lastMessages: [], autoReplied: false });
  assert.equal(env.store.getSuspension(REPLY), null, 'not auto-replied');
  await flagReply(env.flagDeps(), { proposalId: proposals[1]!.id, reason: 'promised_something', actor: 'person:staff', lastMessages: [], autoReplied: true });
  assert.match(env.store.getSuspension(REPLY)!.reason, /staff flag \(promised_something\)/);
});

// M8-EC13
test('PRF-47 / M8-EC13: a flag files a ticket with the last messages and the bot trace; fixing it wipes the transcript and keeps the note and trace', async () => {
  const { env, proposals } = await flaggedRig();
  const messages = Array.from({ length: 15 }, (_, i) => `customer message ${i + 1}`);
  const { flag, ticket } = await flagReply(env.flagDeps(), { proposalId: proposals[1]!.id, reason: 'wrong_tone', note: 'should have been warmer', actor: 'person:staff', lastMessages: messages, autoReplied: false });
  assert.deepEqual(ticket.transcript, messages.slice(5), 'the last 10 (N-17)');
  const trace = ticket.trace as { handlerId: string; ledgerCallId: string; confidence: { band: string; signals: { kind: string }[] }; changedFields: string[] };
  assert.equal(trace.handlerId, REPLY);
  assert.equal(trace.ledgerCallId, proposals[1]!.modelCallId);
  assert.equal(trace.confidence.band, 'high');
  assert.ok(!JSON.stringify(ticket.trace).includes('see you Monday'), 'no reply text in the trace');

  const fixed = closeTicketFixed({ flags: env.store, proposals: env.store, now: () => new Date('2026-11-05T10:00:00.000Z') }, ticket.id, 'person:supplier');
  assert.equal(fixed.transcript, null);
  assert.equal(fixed.transcriptClearedAt, '2026-11-05T10:00:00.000Z');
  assert.equal(fixed.note, 'should have been warmer');
  assert.deepEqual(fixed.trace, ticket.trace);
  assert.equal(env.store.getFlag(flag.id)!.status, 'closed');
  assert.ok(!JSON.stringify(env.store.getTicket(ticket.id)).includes('customer message 7'));
});

// M8-EC14, EC15
class RecordingSink implements DevReportSink {
  sent: HeadsUp[] = [];
  fail = false;
  async send(report: HeadsUp) {
    if (this.fail) throw new Error('relay unreachable');
    this.sent.push(report);
  }
}

async function manyFlags(count: number, over: { includeNotes?: boolean; fail?: boolean } = {}) {
  const script = Array.from({ length: count }, () => draft('A colleague will follow up.'));
  const env = m8Rig(script);
  for (let i = 0; i < count; i++) await env.controller.observe(message(HOW_MUCH, `e${i}`));
  const sink = new RecordingSink();
  sink.fail = over.fail ?? false;
  const monitor = new HeadsUpMonitor({ businessId: 'b', flags: env.store, sink, audit: env.store, ...(over.includeNotes ? { includeNotes: true } : {}), now: () => T0 });
  return { env, sink, monitor, proposals: env.store.list({ handlerId: REPLY }) };
}

test('PRF-48, PRF-51 / M8-EC14: exactly one heads-up at N-12 open flags, and the next only after N-12 more', async () => {
  const { env, sink, monitor, proposals } = await manyFlags(20);
  const flag = (i: number, note?: string) => flagReply(env.flagDeps(monitor), { proposalId: proposals[i]!.id, reason: i % 2 ? 'wrong_fact' : 'unclear', ...(note ? { note } : {}), actor: 'person:staff', lastMessages: [`private message about ${i}`], autoReplied: false });
  for (let i = 0; i < 9; i++) await flag(i);
  assert.equal(sink.sent.length, 0);
  await flag(9);
  assert.equal(sink.sent.length, 1);
  const report = sink.sent[0]!;
  assert.deepEqual([report.businessId, report.handlerId, report.handlerVersion, report.openFlags, report.model, report.endpoint], ['b', REPLY, '9', 10, 'default', 'scripted://local']);
  assert.deepEqual(report.byReason, { unclear: 5, wrong_fact: 5 });
  assert.deepEqual(report.flagByBand, { high: 10 });
  assert.equal(report.tickets.length, 10);
  assert.ok(report.tickets.every((t) => t.ref && t.trace && !('note' in t)));
  const text = JSON.stringify(report);
  assert.ok(!text.includes('private message'), 'no transcript');
  for (let i = 10; i < 19; i++) await flag(i);
  assert.equal(sink.sent.length, 1, 'no new alert until 10 more are open');
  await flag(19);
  assert.equal(sink.sent.length, 2);
  assert.equal(sink.sent[1]!.openFlags, 20);
});

test('PRF-49 / M8-EC14: notes go in only if enabled, and a note the scrubber blocks is withheld', async () => {
  const { env, sink, monitor, proposals } = await manyFlags(10, { includeNotes: true });
  const notes = ['too stiff', 'call the customer on +351 912 345 678', ...Array.from({ length: 8 }, () => 'unclear')];
  for (let i = 0; i < 10; i++) await flagReply(env.flagDeps(monitor), { proposalId: proposals[i]!.id, reason: 'unclear', note: notes[i]!, actor: 'person:staff', lastMessages: ['x'], autoReplied: false });
  const sent = sink.sent[0]!;
  assert.equal(sent.tickets[0]!.note, 'too stiff');
  assert.equal(sent.tickets[1]!.note, 'note withheld');
  assert.ok(!JSON.stringify(sent).includes('912 345 678'));

  const off = await manyFlags(10);
  for (let i = 0; i < 10; i++) await flagReply(off.env.flagDeps(off.monitor), { proposalId: off.proposals[i]!.id, reason: 'unclear', note: 'a note', actor: 'person:staff', lastMessages: [], autoReplied: false });
  assert.ok(off.sink.sent[0]!.tickets.every((t) => !('note' in t)), 'notes are off unless the business enabled them');
});

test('PRF-50 / M8-EC15: the supplier channel is outbound only, and a failed send is logged and never stops the bot', async () => {
  const { env, monitor, proposals } = await manyFlags(10, { fail: true });
  for (let i = 0; i < 10; i++) await flagReply(env.flagDeps(monitor), { proposalId: proposals[i]!.id, reason: 'unclear', actor: 'person:staff', lastMessages: [], autoReplied: false });
  assert.equal(env.store.listAudit().filter((a) => a.kind === 'heads_up_failed').length, 1);
  assert.equal(env.store.listAudit().filter((a) => a.kind === 'heads_up_sent').length, 0);
  await env.controller.observe(message(HOW_MUCH, 'after-failure')).catch(() => undefined);

  // The sink is a Proxy that allows `send` and throws on any other access: the monitor must never read or call anything else.
  const touched: string[] = [];
  const strict = new Proxy({ send: async () => undefined }, { get: (t, k) => (k === 'send' ? t.send : (touched.push(String(k)), (() => { throw new Error(`the monitor touched ${String(k)}`); })())) });
  const guarded = await manyFlags(10);
  const monitor2 = new HeadsUpMonitor({ businessId: 'b', flags: guarded.env.store, sink: strict as unknown as DevReportSink, audit: guarded.env.store });
  for (let i = 0; i < 10; i++) await flagReply(guarded.env.flagDeps(monitor2), { proposalId: guarded.proposals[i]!.id, reason: 'unclear', actor: 'person:staff', lastMessages: [], autoReplied: false });
  assert.deepEqual(touched, []);
  assert.deepEqual(Object.keys(RecordingSink.prototype).concat(Object.getOwnPropertyNames(RecordingSink.prototype)).filter((k) => k !== 'constructor' && k !== 'send'), [], 'the sink interface has one method: send');
});

test('PRF-28c: with the config off, the output schema has no selfAssessment field at all (a strict endpoint would fill it)', () => {
  const off = m8Rig([]).registry.get(REPLY) as unknown as { output: { shape: Record<string, unknown> } };
  assert.deepEqual(Object.keys(off.output.shape), ['draft']);
  const on = m8Rig([], { config: { ...tourDeskConfig, selfAssessment: true } }).registry.get(REPLY) as unknown as { output: { shape: Record<string, unknown> } };
  assert.deepEqual(Object.keys(on.output.shape), ['draft', 'selfAssessment']);
});
