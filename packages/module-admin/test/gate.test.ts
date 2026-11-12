import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advance, CUSTOMER_CHAT, ev, gateRig, GROUP_CHAT, OWNER, Sink, Stt, Forward, clock } from './helpers.ts';

// M7b-EC3
test('ADM-7 / M7b-EC3: in a group the bot acts only when addressed; a replay of group traffic yields no run for unaddressed events', async () => {
  const { gate } = gateRig();
  const traffic = [
    ev({ chat: GROUP_CHAT, isGroup: true, addressed: false, text: 'morning all' }),
    ev({ chat: GROUP_CHAT, isGroup: true, addressed: false, text: 'traffic was crazy today' }),
    ev({ chat: GROUP_CHAT, isGroup: true, addressed: true, text: 'bot, what is the cutoff?' }),
    ev({ chat: GROUP_CHAT, isGroup: true, addressed: false, text: 'ok thanks' }),
  ];
  const decisions: Awaited<ReturnType<typeof gate.admit>>[] = [];
  for (const e of traffic) decisions.push(await gate.admit(e));
  assert.deepEqual(decisions.map((d) => d.kind), ['ignore', 'ignore', 'run', 'ignore']);
  const unaddressedRuns = traffic.filter((e, i) => e.payload['addressed'] === false && decisions[i]!.kind === 'run');
  assert.equal(unaddressedRuns.length, 0);
  assert.equal((await gate.admit(ev({ text: 'a 1:1 chat with the reply role' }))).kind, 'run');
});

// M7b-EC4
test('ADM-8 / M7b-EC4: acknowledgements go to the self chat, never to a customer or the origin chat', async () => {
  const { gate, ack, store } = gateRig();
  await gate.admit(ev({ chat: 'owner-self-chat', sender: OWNER, text: '.stopall' }, 'c0')).catch(() => undefined);
  // The command arrives in a chat the owner uses; the role of that chat decides whether it is read at all.
  store.setRole('owner-self-chat', 'ops', 'setup', clock.now.toISOString());
  const decision = await gate.admit(ev({ chat: 'owner-self-chat', sender: OWNER, text: '.pause chat-customer-1' }, 'c1'));
  assert.equal(decision.kind, 'command');
  assert.deepEqual(ack.sent.map((m) => m.text), ['pause: chat-customer-1']);

  // An acknowledgement sink that is a customer (reply) chat is refused.
  const bad = gateRig({ config: { ack: new Sink(CUSTOMER_CHAT) } });
  bad.store.setRole('ops-chat', 'ops', 'setup', clock.now.toISOString());
  await assert.rejects(bad.gate.admit(ev({ chat: 'ops-chat', sender: OWNER, text: '.pause x' })), /admins only/);
  assert.equal(bad.ack.sent.length, 0);
  // And so is the origin channel in a shadow run.
  const origin = gateRig({ config: { ack: new Sink('real-channel'), originChannel: 'real-channel' } });
  origin.store.setRole('ops-chat', 'ops', 'setup', clock.now.toISOString());
  await assert.rejects(origin.gate.admit(ev({ chat: 'ops-chat', sender: OWNER, text: '.pause x' })), /admins only/);
});

// M7b-EC5
test('ADM-9 / M7b-EC5: an unknown chat is ignored; a role change is audited and applies at once', async () => {
  const { gate, store } = gateRig();
  const first = await gate.admit(ev({ chat: 'chat-unknown' }));
  assert.deepEqual(first, { kind: 'ignore', reason: 'chat role is ignored' });
  store.setRole('chat-unknown', 'reply', 'person:owner', clock.now.toISOString());
  assert.equal((await gate.admit(ev({ chat: 'chat-unknown' }))).kind, 'run');
  const roleRows = store.listAudit().filter((a) => a.kind === 'chat_role' && (a.detail as { chat: string }).chat === 'chat-unknown');
  assert.deepEqual(roleRows.map((r) => r.detail), [{ chat: 'chat-unknown', from: null, to: 'reply' }]);
  assert.equal(roleRows[0]!.actor, 'person:owner');
  store.setRole('chat-unknown', 'monitor', 'person:owner', clock.now.toISOString());
  assert.deepEqual(await gate.admit(ev({ chat: 'chat-unknown' })), { kind: 'store_only', reason: 'monitor chat' });
  store.setRole('chat-unknown', 'ops', 'person:owner', clock.now.toISOString());
  assert.equal((await gate.admit(ev({ chat: 'chat-unknown' }))).kind, 'ignore');
});

// M7b-EC6
test('ADM-10 / M7b-EC6: own, bot and system messages produce no output; a duplicated event produces one', async () => {
  const { gate } = gateRig();
  for (const flag of ['fromSelf', 'fromBot', 'system']) {
    assert.equal((await gate.admit(ev({ [flag]: true }))).kind, 'ignore', flag);
  }
  const first = ev({}, 'dup-1');
  const kinds = [await gate.admit(first), await gate.admit(first), await gate.admit(first)];
  assert.deepEqual(kinds.map((d) => d.kind), ['run', 'ignore', 'ignore']);
});

// M7b-EC7
test('ADM-11 / M7b-EC7: commands work only from authorised senders; the same text from a customer has no effect', async () => {
  const { gate, store, ack } = gateRig();
  const fromCustomer = await gate.admit(ev({ sender: 'customer-ref', text: '.stopall' }));
  assert.equal(fromCustomer.kind, 'run', 'ordinary text for the bot, not a command');
  assert.equal(store.getGlobalStop(), false);
  assert.equal(ack.sent.length, 0);
  const fromOwner = await gate.admit(ev({ sender: OWNER, text: '.stopall' }));
  assert.equal(fromOwner.kind, 'command');
  assert.equal(store.getGlobalStop(), true);
  assert.deepEqual(ack.sent.map((m) => m.text), ['stopped everywhere']);
});

test('ADM-12 / M7b-EC7: stop-all stores incoming messages and creates nothing for any chat; start-all resumes', async () => {
  const { gate, store } = gateRig();
  store.setRole('chat-second', 'reply', 'setup', clock.now.toISOString());
  await gate.admit(ev({ sender: OWNER, text: '.stopall' }));
  const during = [await gate.admit(ev({})), await gate.admit(ev({ chat: 'chat-second' })), await gate.admit(ev({ chat: GROUP_CHAT, isGroup: true, addressed: true }))];
  assert.deepEqual(during.map((d) => d.kind), ['store_only', 'store_only', 'store_only']);
  assert.ok(store.listAudit().filter((a) => a.kind === 'gate' && (a.detail as { decision: string }).decision === 'store_only').length >= 3, 'the messages are recorded');
  assert.equal((await gate.admit(ev({ sender: OWNER, text: '.startall' }))).kind, 'command', 'commands still work during stop-all');
  assert.equal((await gate.admit(ev({}))).kind, 'run');
});

test('ADM-12: per-chat stop, pause, start and restart change that chat only, with audit', async () => {
  const { gate, store } = gateRig();
  store.setRole('chat-b', 'reply', 'setup', clock.now.toISOString());
  await gate.admit(ev({ sender: OWNER, text: `.stop ${CUSTOMER_CHAT}` }));
  assert.equal((await gate.admit(ev({}))).kind, 'waiting');
  assert.equal((await gate.admit(ev({ chat: 'chat-b' }))).kind, 'run');
  await gate.admit(ev({ sender: OWNER, text: `.start ${CUSTOMER_CHAT}` }));
  assert.equal((await gate.admit(ev({}))).kind, 'run');
  await gate.admit(ev({ sender: OWNER, text: `.pause ${CUSTOMER_CHAT}` }));
  assert.equal(store.getChatState(CUSTOMER_CHAT), 'paused');
  await gate.admit(ev({ sender: OWNER, text: `.restart ${CUSTOMER_CHAT}` }));
  assert.equal(store.getChatState(CUSTOMER_CHAT), 'bot');
  assert.ok(store.listAudit().filter((a) => a.kind === 'chat_state').length >= 4);
});

// M7b-EC12
test('ADM-23..25 / M7b-EC12: a customer message in a chat the bot does not hold pings the admin once, with no message text', async () => {
  const { gate, store, notifier } = gateRig();
  store.setChatState(CUSTOMER_CHAT, 'handoff', 'person:staff', clock.now.toISOString(), 'customer asked for a person');
  const first = await gate.admit(ev({ text: 'I need to talk to someone about my booking, my number is private' }));
  assert.deepEqual(first, { kind: 'waiting', chat: CUSTOMER_CHAT, pinged: true });
  advance(5 * 60_000);
  const second = await gate.admit(ev({ text: 'hello? anyone?' }));
  assert.deepEqual(second, { kind: 'waiting', chat: CUSTOMER_CHAT, pinged: false });
  assert.equal(notifier.pings.length, 1, 'once per waiting period');
  assert.deepEqual(Object.keys(notifier.pings[0]!).sort(), ['chat', 'waitedMs']);
  assert.ok(!JSON.stringify(notifier.pings).includes('booking') && !JSON.stringify(notifier.pings).includes('anyone'), 'no message text');
  assert.equal(store.getWaiting(CUSTOMER_CHAT)!.lastCustomerAt, clock.now.toISOString(), 'the period tracks the last message');
  assert.equal(store.listAudit().filter((a) => a.kind === 'admin_ping').length, 1);
});

test('ADM-26: a person\'s reply ends the waiting period and the next one pings again; each end is audited', async () => {
  const { gate, store, notifier } = gateRig();
  store.setChatState(CUSTOMER_CHAT, 'handoff', 'person:staff', clock.now.toISOString());
  await gate.admit(ev({}));
  gate.personReplied(CUSTOMER_CHAT);
  assert.equal(store.getWaiting(CUSTOMER_CHAT), null);
  await gate.admit(ev({}));
  assert.equal(notifier.pings.length, 2);
  assert.deepEqual(store.listAudit().filter((a) => a.kind === 'admin_ping_ended').map((a) => a.detail), [{ chat: CUSTOMER_CHAT, reason: 'person_replied' }]);
  await gate.admit(ev({ sender: OWNER, text: `.restart ${CUSTOMER_CHAT}` }));
  assert.equal(store.getWaiting(CUSTOMER_CHAT), null);
  assert.equal(store.listAudit().filter((a) => a.kind === 'admin_ping_ended').length, 2);
});

// M7b-EC13
test('ADM-14, N-14 / M7b-EC13: a handed-off chat returns to the bot after the admin\'s silence interval (12 h by default)', async () => {
  const { gate, store } = gateRig();
  store.setChatState(CUSTOMER_CHAT, 'handoff', 'person:staff', clock.now.toISOString());
  await gate.admit(ev({}));
  advance(11 * 3_600_000);
  assert.deepEqual(gate.resumeDue(), []);
  advance(61 * 60_000);
  assert.deepEqual(gate.resumeDue(), [CUSTOMER_CHAT]);
  assert.equal(store.getChatState(CUSTOMER_CHAT), 'bot');
  assert.equal(store.getWaiting(CUSTOMER_CHAT), null);
  assert.deepEqual(store.listAudit().filter((a) => a.kind === 'admin_ping_ended').map((a) => (a.detail as { reason: string }).reason), ['auto_resume']);
  assert.equal((await gate.admit(ev({}))).kind, 'run');

  // The admin sets the interval per business.
  const short = gateRig({ config: { handoffResumeMs: 2 * 3_600_000 } });
  short.store.setChatState(CUSTOMER_CHAT, 'handoff', 'staff', clock.now.toISOString());
  await short.gate.admit(ev({}));
  advance(3 * 3_600_000);
  assert.deepEqual(short.gate.resumeDue(), [CUSTOMER_CHAT]);
});

test('ADM-27 / M7b-EC13: a failed ping is logged and the bot goes on', async () => {
  const { gate, store, notifier } = gateRig();
  notifier.fail = true;
  store.setChatState(CUSTOMER_CHAT, 'handoff', 'staff', clock.now.toISOString());
  const decision = await gate.admit(ev({}));
  assert.deepEqual(decision, { kind: 'waiting', chat: CUSTOMER_CHAT, pinged: false });
  assert.equal(store.listAudit().filter((a) => a.kind === 'admin_ping_failed').length, 1);
  assert.equal((await gate.admit(ev({ chat: GROUP_CHAT, isGroup: true, addressed: true }))).kind, 'run', 'other chats are unaffected');
  const quiet = gateRig({ withNotifier: false });
  quiet.store.setChatState(CUSTOMER_CHAT, 'handoff', 'staff', clock.now.toISOString());
  assert.equal((await quiet.gate.admit(ev({}))).kind, 'waiting');
});

// M7b-EC15
test('ADM-28..31 / M7b-EC15: a voice message reaches the handlers as a local transcript marked as voice; the audio is discarded', async () => {
  const stt = new Stt('is the east tour running on monday');
  const { gate } = gateRig({ stt });
  const decision = await gate.admit(ev({ text: '', media: { type: 'audio', ref: 'audio-1' } }));
  assert.equal(decision.kind, 'run');
  const event = (decision as { event: { payload: Record<string, unknown> } }).event;
  assert.equal(event.payload['text'], 'is the east tour running on monday');
  assert.equal(event.payload['source'], 'voice');
  assert.equal(event.payload['media'], undefined);
  assert.deepEqual(stt.discarded, ['audio-1']);
});

test('ADM-30: a failed transcription hands the chat off and pings the admin; no handler runs', async () => {
  for (const stt of [new Stt(new Error('whisper crashed')), new Stt('   ')]) {
    const { gate, store, notifier } = gateRig({ stt });
    const decision = await gate.admit(ev({ text: '', media: { type: 'audio', ref: 'audio-2' } }));
    assert.equal(decision.kind, 'waiting');
    assert.equal(store.getChatState(CUSTOMER_CHAT), 'handoff');
    assert.equal(notifier.pings.length, 1);
    assert.equal(store.listAudit().filter((a) => a.kind === 'transcription_failed').length, 1);
    assert.deepEqual(stt.discarded, ['audio-2'], 'the audio is discarded even when transcription fails');
  }
  const none = gateRig();
  assert.equal((await none.gate.admit(ev({ text: '', media: { type: 'audio', ref: 'a' } }))).kind, 'waiting');
});

test('ADM-32 / M7b-EC15: an image or file creates no run, is forwarded to the admins and the chat waits for a person', async () => {
  const { gate, forward, notifier, store } = gateRig();
  for (const type of ['image', 'document', 'video']) {
    const decision = await gate.admit(ev({ text: '', media: { type, ref: `ref-${type}` } }));
    assert.equal(decision.kind, 'media_forwarded', type);
  }
  assert.deepEqual(forward.forwarded.map((f) => f.type), ['image', 'document', 'video']);
  assert.equal(notifier.pings.length, 1);
  assert.equal(store.listAudit().filter((a) => a.kind === 'media_forwarded').length, 3);
});

test('ADM-33: text with an image goes to the bot as text and the image to the admins; a forward to the origin or a customer chat is refused', async () => {
  const { gate, forward } = gateRig();
  const decision = await gate.admit(ev({ text: 'here is the voucher', media: { type: 'image', ref: 'img-1' } }));
  assert.equal(decision.kind, 'run');
  assert.deepEqual(forward.forwarded, [{ chat: CUSTOMER_CHAT, type: 'image' }]);

  const toOrigin = gateRig({ config: { originChannel: 'real-channel' }, forward: new Forward('real-channel') });
  await assert.rejects(toOrigin.gate.admit(ev({ text: '', media: { type: 'image', ref: 'x' } })), /admins only/);
  assert.equal(toOrigin.forward.forwarded.length, 0);
  const toCustomer = gateRig({ forward: new Forward(CUSTOMER_CHAT) });
  await assert.rejects(toCustomer.gate.admit(ev({ text: '', media: { type: 'image', ref: 'x' } })), /admins only/);
});
