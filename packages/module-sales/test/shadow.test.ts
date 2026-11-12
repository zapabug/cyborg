import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkLiveGate,
  enableLive,
  lessonApplier,
  LiveGateError,
  Lifecycle,
  markEntry,
  proposeImprovement,
  replayEntries,
  ShadowController,
  ShadowViolation,
  type OutboundMessage,
  type OutboundSink,
} from '@cyborg/core';
import { findLeaks } from '@cyborg/store-sqlite';
import { message, rig } from './helpers.ts';

const REPLY = 'sales.enquiry.reply_draft';
const draft = (text: string) => JSON.stringify({ draft: text });
const HOW_MUCH = 'how much is the east tour'; // a wazaa test chat

class Sink implements OutboundSink {
  sent: OutboundMessage[] = [];
  constructor(readonly channel: string) {}
  async send(m: OutboundMessage) {
    this.sent.push(m);
  }
}

/** A shadow run: unconfirmed facts are allowed (PRF-5), output goes to the review sink only. */
function shadowRig(script: string[], clock = { now: new Date('2026-10-31T10:00:00.000Z') }) {
  const env = rig({ mode: 'shadow', enabledHandlers: [REPLY], script, now: () => clock.now });
  const origin = new Sink('origin-chat');
  const review = new Sink('review-chat');
  const controller = new ShadowController({
    runner: env.runner, log: env.store, store: env.store, ledger: env.store,
    originChannel: origin.channel, review, now: () => clock.now,
  });
  const evalDeps = { log: env.store, profile: env.store, proposals: env.store, businessId: 'b', now: () => clock.now };
  return { ...env, origin, review, controller, evalDeps, clock };
}

// M7-EC1
test('PRF-15 / M7-EC1: during a shadow run nothing is sent to the origin channel', async () => {
  const env = shadowRig([draft('A colleague will follow up.'), draft('A colleague will follow up too.')]);
  await env.controller.observe(message(HOW_MUCH, 'e1'));
  await env.controller.observe(message('is it good for kids?', 'e2'));
  assert.equal(env.origin.sent.length, 0);
  assert.equal(env.review.sent.length, 2);
  assert.match(env.review.sent[0]!.text, /^\[shadow sales\.enquiry\.reply_draft 9\] A colleague will follow up\./);
});

test('PRF-15: an attempt to send to the origin channel is refused and audited', async () => {
  const env = shadowRig([]);
  await assert.rejects(env.controller.deliver(env.origin, { text: 'hello', ref: 'x' }), ShadowViolation);
  assert.equal(env.origin.sent.length, 0);
  assert.equal(env.store.listAudit().filter((a) => a.kind === 'shadow_violation').length, 1);
  await env.controller.deliver(env.review, { text: 'for staff' });
  assert.equal(env.review.sent.length, 1);
});

test('PRF-15: a shadow controller needs a shadow-mode runner and a review channel that is not the origin', () => {
  const live = rig({ mode: 'live' });
  const args = { runner: live.runner, log: live.store, store: live.store, ledger: live.store, originChannel: 'o', review: new Sink('r') };
  assert.throws(() => new ShadowController(args), /shadow mode/);
  const shadow = rig({ mode: 'shadow' });
  assert.throws(() => new ShadowController({ ...args, runner: shadow.runner, review: new Sink('o') }), ShadowViolation);
});

// M7-EC2
test('PRF-16, PRF-20 / M7-EC2: the log pairs the draft with what the human did and with the marking; identity stays sealed', async () => {
  const env = shadowRig([draft('The East Tour is €35 per person.')]);
  const sender = 'sender-+351 913 000 222-ident';
  await env.controller.observe(message(HOW_MUCH, 'e1', sender));
  const [entry] = env.store.listEntries();
  assert.equal(entry!.draft, 'The East Tour is €35 per person.');
  assert.equal(entry!.humanReply, null);
  assert.match(entry!.input['sender'] as string, /^vault:[0-9a-f]{12}$/);
  assert.deepEqual(entry!.factsUsed.filter((f) => f.kind === 'profile').map((f) => f.key).sort(), ['business.name', 'faq.entries', 'offer.availability', 'offer.items', 'presence.status', 'rules.commitments', 'tone.style']);

  const touched = env.controller.recordHuman('chat', 'e1', { reply: 'It is 35 euros per person, see you Monday!' });
  assert.equal(touched.length, 1);
  markEntry(env.evalDeps, entry!.id, 'match', 'person:1');
  const paired = env.store.getEntry(entry!.id)!;
  assert.equal(paired.draft, 'The East Tour is €35 per person.');
  assert.equal(paired.humanReply, 'It is 35 euros per person, see you Monday!');
  assert.equal(paired.marking, 'match');
  assert.equal(paired.markedBy, 'person:1');
  assert.deepEqual(findLeaks(env.store, [sender]), [], 'no raw identity in entries, proposals, audit or ledger');
});

// M7-EC3
test('PRF-17 / M7-EC3: a wrong_fact marking contradicts the fact and opens a discrepancy', async () => {
  const env = shadowRig([draft('A colleague will follow up.')]);
  // A handler that used exactly one fact would default to it; this one used six, so the marker must name it.
  await env.controller.observe(message(HOW_MUCH, 'e1'));
  const [entry] = env.store.listEntries();
  assert.throws(() => markEntry(env.evalDeps, entry!.id, 'wrong_fact', 'person:1'), /must name the fact/);
  assert.equal(env.store.getEntry(entry!.id)!.marking, null, 'nothing was changed by the refused marking');

  env.controller.recordHuman('chat', 'e1', { reply: 'Actually it is not 35 here.' });
  markEntry(env.evalDeps, entry!.id, 'wrong_fact', 'person:1', { factKeys: ['offer.items'] });
  assert.equal(env.store.getFact('offer.items')!.status, 'contradicted');
  const [d] = env.store.listDiscrepancies('open');
  assert.equal(d!.factKey, 'offer.items');
  assert.deepEqual(d!.evidence[0]!.source, { kind: 'shadow_run', ref: entry!.id });
  assert.equal(d!.evidence[0]!.observed, 'Actually it is not 35 here.');
  // A contradicted fact never reaches a prompt again (PRF-5).
  const after = (await env.runner.handle(message('another question', 'e2')))[0]!;
  assert.equal(after.outcome, 'refused');
});

test('PRF-17: with one fact used, the marking defaults to it', async () => {
  const env = shadowRig([JSON.stringify({ draft: 'ok' })]);
  const entry = env.store.addEntry(
    { eventSource: 'chat', eventId: 'x', handlerId: REPLY, handlerVersion: '9', proposalId: null, draft: 'd', output: {}, input: {}, factsUsed: [{ kind: 'profile', key: 'tone.style', state: 'unconfirmed' }] },
    '2026-10-31T10:00:00.000Z',
  );
  markEntry(env.evalDeps, entry.id, 'wrong_fact', 'person:1');
  assert.equal(env.store.getFact('tone.style')!.status, 'contradicted');
});

test('PRF-21 / M7-EC3: an improvement proposal needs a marking other than match and can target fact, prompt, lesson or check', async () => {
  const env = shadowRig([draft('A colleague will follow up.')]);
  await env.controller.observe(message(HOW_MUCH, 'e1'));
  const [entry] = env.store.listEntries();
  assert.throws(() => proposeImprovement(env.evalDeps, entry!.id, { target: 'check', handlerId: REPLY, rule: 'x' }), /marked other than "match"/);
  markEntry(env.evalDeps, entry!.id, 'match', 'person:1');
  assert.throws(() => proposeImprovement(env.evalDeps, entry!.id, { target: 'check', handlerId: REPLY, rule: 'x' }), /marked other than "match"/);
  markEntry(env.evalDeps, entry!.id, 'worse', 'person:1');

  const fact = proposeImprovement(env.evalDeps, entry!.id, { target: 'fact', factKey: 'tone.style', newValue: 'formal', kind: 'correct', reason: 'the owner wants it formal' });
  assert.deepEqual(fact.changes, [{ field: 'tone.style', oldValue: 'warm, relaxed and easygoing', newValue: 'formal' }]);
  const prompt = proposeImprovement(env.evalDeps, entry!.id, { target: 'prompt', handlerId: REPLY, change: 'ask for the date first' });
  assert.match(prompt.findings[0]!.statement, /change the prompt of sales\.enquiry\.reply_draft/);
  const check = proposeImprovement(env.evalDeps, entry!.id, { target: 'check', handlerId: REPLY, rule: 'reject drafts that name Porto Santo' });
  assert.match(check.findings[0]!.statement, /add a code check/);
  const lesson = proposeImprovement(env.evalDeps, entry!.id, { target: 'lesson', handlerId: REPLY, text: 'when a guest asks about a private tour, quote the vehicle price' });
  assert.deepEqual(lesson.changes.map((c) => c.field), ['lesson.handler', 'lesson.text']);
  for (const p of [fact, prompt, check, lesson]) {
    assert.equal(p.status, 'proposed');
    assert.equal(p.handlerId, 'shadow.improvement');
  }
  assert.throws(() => proposeImprovement(env.evalDeps, entry!.id, { target: 'lesson', handlerId: null, text: 'call +351 912 345 678 for prices' }), /scrubber/);
});

test('PRF-22, PRF-67: an approved lesson reaches the prompt and changes the handler version; revert retires it', async () => {
  const env = shadowRig([draft('first'), draft('second'), draft('third')]);
  await env.controller.observe(message(HOW_MUCH, 'e1'));
  assert.equal(env.model.calls[0]!.prompt.includes('Lessons from the team'), true);
  assert.match(env.model.calls[0]!.prompt, /facts win\):\n\n\nCustomer message/, 'no lessons yet');
  const [entry] = env.store.listEntries();
  assert.equal(entry!.handlerVersion, '9');
  markEntry(env.evalDeps, entry!.id, 'worse', 'person:1');
  const proposal = proposeImprovement(env.evalDeps, entry!.id, { target: 'lesson', handlerId: REPLY, text: 'when a guest asks about a private tour, quote the vehicle price' });

  const lifecycle = new Lifecycle({ store: env.store, now: () => env.clock.now });
  lifecycle.decide(proposal.id, 'approve', 'person:1');
  const applier = lessonApplier(env.store, () => env.clock.now);
  await lifecycle.apply(proposal.id, applier, 'person:1');
  const [lesson] = env.store.activeLessonsFor(REPLY);
  assert.equal(lesson!.version, 1);
  assert.equal(lesson!.originEntryId, entry!.id);
  assert.equal(env.runner.versionOf(env.registry.get(REPLY)!), '9+L1');

  await env.controller.observe(message('what about a private tour', 'e2'));
  assert.match(env.model.calls[1]!.prompt, /facts win\):\n- when a guest asks about a private tour, quote the vehicle price\n\nCustomer message/);
  const second = env.store.listEntries().at(-1)!;
  assert.equal(second.handlerVersion, '9+L1', 'PRF-24: the lesson changed the version');
  assert.equal(env.store.list({ handlerId: REPLY }).at(-1)!.handlerVersion, '9+L1');

  await lifecycle.revert(proposal.id, applier, 'person:1');
  assert.deepEqual(env.store.activeLessonsFor(REPLY), []);
  assert.equal(env.runner.versionOf(env.registry.get(REPLY)!), '9');
});

// M7-EC4
test('PRF-25, PRF-68 / M7-EC4: replaying stored inputs through a new version reports per-entry changes', async () => {
  const env = shadowRig([draft('Sorry, a colleague will answer.'), draft('Let me check with a colleague.'), draft('Sorry, a colleague will answer.'), draft('A colleague will follow up, thanks!'), draft('Let me check with a colleague.')]);
  await env.controller.observe(message(HOW_MUCH, 'e1'));
  await env.controller.observe(message('is it good for kids?', 'e2'));
  const [a, b] = env.store.listEntries();
  markEntry(env.evalDeps, a!.id, 'match', 'person:1');
  markEntry(env.evalDeps, b!.id, 'worse', 'person:1');

  // A new version (a lesson) and a replay of the stored real inputs; the scripted model plays the new version's answers.
  env.store.addLesson({ handlerId: REPLY, text: 'sign off with thanks', originEntryId: b!.id }, '2026-10-31T11:00:00.000Z');
  const report = await replayEntries(env.runner, env.store.listEntries());
  assert.equal(report.length, 2);
  assert.deepEqual(report.map((r) => [r.entryId === a!.id, r.draftChanged, r.markingAtRisk, r.oldVersion, r.newVersion]), [
    [true, false, false, '9', '9+L1'],
    [false, true, false, '9', '9+L1'],
  ].map(([isA, changed, risk, o, n]) => [isA, changed, risk, o, n]));
  assert.equal(report[0]!.oldDraft, 'Sorry, a colleague will answer.');
  assert.equal(report[0]!.newDraft, 'Sorry, a colleague will answer.');
  assert.equal(report[1]!.newDraft, 'A colleague will follow up, thanks!');
  assert.equal(env.store.list().length, 2, 'a replay creates no proposals');
});

test('PRF-68: a match whose draft changes is flagged as at risk', async () => {
  const env = shadowRig([draft('first draft'), draft('a different draft')]);
  await env.controller.observe(message(HOW_MUCH, 'e1'));
  const [a] = env.store.listEntries();
  markEntry(env.evalDeps, a!.id, 'match', 'person:1');
  const [r] = await replayEntries(env.runner, [env.store.getEntry(a!.id)!]);
  assert.equal(r!.markingAtRisk, true);
});

test('PRF-26, PRF-69 / M7-EC4: counts per handler version, never a single score', async () => {
  const env = shadowRig([draft('a'), draft('b'), draft('c')]);
  for (const id of ['e1', 'e2', 'e3']) await env.controller.observe(message(HOW_MUCH, id));
  const [a, b] = env.store.listEntries();
  markEntry(env.evalDeps, a!.id, 'match', 'person:1');
  markEntry(env.evalDeps, b!.id, 'different_but_fine', 'person:1');
  env.store.addLesson({ handlerId: REPLY, text: 'be brief', originEntryId: null }, '2026-10-31T11:00:00.000Z');
  assert.deepEqual(env.store.markingCounts(), [
    { handlerId: REPLY, handlerVersion: '9', counts: { match: 1, better: 0, worse: 0, different_but_fine: 1, wrong_fact: 0, unmarked: 1 } },
  ]);
  assert.ok(!/score|accuracy|percent|rate/i.test(JSON.stringify(env.store.markingCounts())));
});

// M7-EC5
test('PRF-18, PRF-70 / M7-EC5: live use needs a shadow run that meets the minimum, confirmed facts and a checklist', async () => {
  const clock = { now: new Date('2026-10-31T10:00:00.000Z') };
  const env = shadowRig([draft('a'), draft('b'), draft('c')], clock);
  const gate = (over: Record<string, unknown> = {}) => ({
    log: env.store, profile: env.store, now: () => clock.now,
    minimum: { entries: 3, days: 2 } as { entries: number; days: number } | undefined,
    checklist: (() => ({ complete: true, signedOffBy: 'person:owner' })) as (() => { complete: boolean; signedOffBy: string | null }) | undefined,
    ...over,
  });

  // No shadow run at all.
  assert.ok(checkLiveGate(gate(), REPLY).failures.includes('there is no recorded shadow run for this handler'));

  for (const [i, day] of ['2026-10-31', '2026-11-01', '2026-11-02'].entries()) {
    clock.now = new Date(`${day}T10:00:00.000Z`);
    await env.controller.observe(message(HOW_MUCH, `e${i}`));
  }
  // The shadow run used unconfirmed facts? Here the facts were confirmed by the rig; unconfirm one to see the gate notice.
  env.store.putFact({ key: 'tone.style', value: 'formal', class: 'public', source: 'client_statement', sourceRef: 'test:fixture' }, 'a', clock.now.toISOString());
  const notConfirmed = checkLiveGate(gate(), REPLY);
  assert.ok(notConfirmed.failures.some((f) => /"tone\.style" used in the shadow run is unconfirmed/.test(f)), notConfirmed.failures.join('|'));
  env.store.moveFact('tone.style', 'confirmed', { actor: 'person:1', at: clock.now.toISOString() });

  // The minimum comes from the adapter; with none configured the gate fails and says so.
  assert.ok(checkLiveGate(gate({ minimum: undefined }), REPLY).failures.some((f) => /N-7 .* is not configured/.test(f)));
  assert.ok(checkLiveGate(gate({ minimum: { entries: 4, days: 2 } }), REPLY).failures.some((f) => /has 3 entries, the minimum is 4/.test(f)));
  assert.ok(checkLiveGate(gate({ minimum: { entries: 3, days: 5 } }), REPLY).failures.some((f) => /spans 2\.0 days, the minimum is 5/.test(f)));

  // The checklist is M7b's: absent, incomplete or unsigned all fail closed.
  assert.ok(checkLiveGate(gate({ checklist: undefined }), REPLY).failures.some((f) => /checklist is not available/.test(f)));
  assert.ok(checkLiveGate(gate({ checklist: () => ({ complete: false, signedOffBy: null }) }), REPLY).failures.some((f) => /not complete/.test(f)));
  assert.ok(checkLiveGate(gate({ checklist: () => ({ complete: true, signedOffBy: null }) }), REPLY).failures.some((f) => /no named sign-off/.test(f)));

  // Everything in place: it passes. (The checklist here is a stand-in for M7b.)
  const ok = checkLiveGate(gate(), REPLY);
  assert.deepEqual(ok.failures, []);
  assert.equal(ok.evidence.entries, 3);

  assert.throws(() => enableLive({ ...gate({ minimum: undefined }), live: env.store, store: env.store }, REPLY, 'person:owner'), LiveGateError);
  assert.equal(env.store.isEnabled(REPLY), false);
  assert.equal(env.store.listAudit().filter((a) => a.kind === 'live_enable_refused').length, 1);
  enableLive({ ...gate(), live: env.store, store: env.store }, REPLY, 'person:owner');
  assert.equal(env.store.isEnabled(REPLY), true);
  const [record] = env.store.listEnabled();
  assert.equal(record!.enabledBy, 'person:owner');
  assert.equal((record!.evidence as { entries: number }).entries, 3);
  assert.equal(env.store.listAudit().filter((a) => a.kind === 'live_enabled').length, 1);
});

test('HR-8: a runner given a live registry refuses handlers that are not enabled, in live mode', async () => {
  const store = { enabled: new Set<string>() };
  const live = { isEnabled: (id: string) => store.enabled.has(id) };
  const env = rig({ mode: 'live', enabledHandlers: [REPLY], script: [draft('A colleague will follow up.')], live });
  const refused = (await env.runner.handle(message(HOW_MUCH, 'e1')))[0]!;
  assert.equal(refused.outcome, 'refused');
  assert.match((refused as { reason: string }).reason, /not enabled for live use/);
  assert.equal(env.model.calls.length, 0);
  assert.equal(env.store.listAudit().filter((a) => a.kind === 'live_refused').length, 1);
  store.enabled.add(REPLY);
  assert.equal((await env.runner.handle(message(HOW_MUCH, 'e1')))[0]!.outcome, 'proposal');
});

test('HR-8: an auto-reply handler cannot run in live mode without a live registry', async () => {
  const env = rig({ mode: 'live', config: { ...(await import('./helpers.ts')).tourDeskConfig, autoReply: [REPLY] }, autoReplyOptIn: [REPLY], enabledHandlers: [REPLY], script: [draft('A colleague will follow up.')] });
  const refused = (await env.runner.handle(message(HOW_MUCH, 'e1')))[0]!;
  assert.equal(refused.outcome, 'refused');
  assert.match((refused as { reason: string }).reason, /needs a live registry/);
  assert.equal(env.model.calls.length, 0);
});

// ADM-52
test('ADM-52: the reply prompt carries the on-duty sentence built from the toggle, and the model cannot change it', async () => {
  const env = shadowRig([draft('A colleague will follow up.'), draft('A colleague will follow up.')]);
  await env.controller.observe(message(HOW_MUCH, 'p1'));
  assert.match(env.model.calls[0]!.prompt, /Staff: A person is on duty and watching this chat\./);
  env.store.setPresence({ state: 'out_of_office', label: 'back 09:00 Monday', since: env.clock.now.toISOString(), by: 'person:owner' });
  await env.controller.observe(message(HOW_MUCH, 'p2'));
  assert.match(env.model.calls[1]!.prompt, /Staff: No person is on duty right now\. Staff note: back 09:00 Monday\./);
});
