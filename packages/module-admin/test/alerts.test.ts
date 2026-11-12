import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChannelGate, fanOutNotifier, officeStatus, OpsChatNotifier, presenceSentence, StoreNotifier, type AdminNotifier } from '@cyborg/core';
import { SqliteStore } from '@cyborg/store-sqlite';
import { advance, CUSTOMER_CHAT, clock, ev, gateRig, OWNER, Sink } from './helpers.ts';

const KEY_DETAIL = 'The inference key was rejected. The bot is not answering customers until this is fixed.';

test('ADM-45, ADM-47: one open alert per kind and chat; raising it again changes nothing', () => {
  const store = new SqliteStore(':memory:');
  const first = store.raiseAlert({ kind: 'inference_key', ref: '', detail: KEY_DETAIL, at: '2026-10-31T10:00:00.000Z' });
  const again = store.raiseAlert({ kind: 'inference_key', ref: '', detail: KEY_DETAIL, at: '2026-10-31T11:00:00.000Z' });
  assert.equal(first.created, true);
  assert.equal(again.created, false);
  assert.equal(again.alert.id, first.alert.id);
  assert.equal(again.alert.raisedAt, '2026-10-31T10:00:00.000Z');
  store.raiseAlert({ kind: 'customer_waiting', ref: 'chat-a', detail: 'x', at: '2026-10-31T10:00:00.000Z' });
  store.raiseAlert({ kind: 'customer_waiting', ref: 'chat-b', detail: 'x', at: '2026-10-31T10:00:00.000Z' });
  assert.equal(store.listOpenAlerts().length, 3);
});

test('ADM-48: seen is recorded once; clearing closes the alert and a later one opens a new alert', () => {
  const store = new SqliteStore(':memory:');
  const { alert } = store.raiseAlert({ kind: 'inference_key', ref: '', detail: KEY_DETAIL, at: '2026-10-31T10:00:00.000Z' });
  store.markAlertSeen(alert.id, 'person:owner', '2026-10-31T10:05:00.000Z');
  store.markAlertSeen(alert.id, 'person:other', '2026-10-31T10:06:00.000Z');
  const [seen] = store.listOpenAlerts();
  assert.deepEqual([seen!.seenAt, seen!.seenBy], ['2026-10-31T10:05:00.000Z', 'person:owner']);
  assert.equal(store.clearAlerts('inference_key', '', 'system', '2026-10-31T10:10:00.000Z'), 1);
  assert.deepEqual(store.listOpenAlerts(), []);
  const next = store.raiseAlert({ kind: 'inference_key', ref: '', detail: KEY_DETAIL, at: '2026-10-31T12:00:00.000Z' });
  assert.equal(next.created, true);
  assert.notEqual(next.alert.id, alert.id);
});

test('ADM-45, ADM-48: a waiting customer is on the dashboard list with no message text, until a person replies', async () => {
  const rig = gateRig();
  const withStore = new ChannelGate({
    control: rig.store, store: rig.store,
    config: { commandPrefix: '.', authorisedSenders: [OWNER], ack: rig.ack },
    notifier: new StoreNotifier(rig.store, () => clock.now),
    now: () => clock.now,
  });
  rig.store.setChatState(CUSTOMER_CHAT, 'handoff', 'person:staff', clock.now.toISOString());
  await withStore.admit(ev({ text: 'my private number is 123 and I need a person' }));
  const open = rig.store.listOpenAlerts();
  assert.equal(open.length, 1);
  assert.equal(open[0]!.kind, 'customer_waiting');
  assert.equal(open[0]!.ref, CUSTOMER_CHAT);
  assert.ok(!JSON.stringify(open).includes('private number'));
  advance(60_000);
  await withStore.admit(ev({ text: 'hello?' }));
  assert.equal(rig.store.listOpenAlerts().length, 1, 'once per waiting period');
  withStore.personReplied(CUSTOMER_CHAT);
  assert.deepEqual(rig.store.listOpenAlerts(), []);
});

test('ADM-48: a restart command and the auto-resume also clear the waiting alert', async () => {
  const rig = gateRig();
  const gate = new ChannelGate({
    control: rig.store, store: rig.store,
    config: { commandPrefix: '.', authorisedSenders: [OWNER], ack: rig.ack, handoffResumeMs: 60_000 },
    notifier: new StoreNotifier(rig.store, () => clock.now),
    now: () => clock.now,
  });
  rig.store.setChatState(CUSTOMER_CHAT, 'handoff', 'person:staff', clock.now.toISOString());
  await gate.admit(ev({}));
  await gate.admit(ev({ sender: OWNER, text: `.start ${CUSTOMER_CHAT}` }));
  assert.deepEqual(rig.store.listOpenAlerts(), [], '.start ends the period');
  rig.store.setChatState(CUSTOMER_CHAT, 'handoff', 'person:staff', clock.now.toISOString());
  await gate.admit(ev({}));
  assert.equal(rig.store.listOpenAlerts().length, 1);
  advance(2 * 60_000);
  assert.deepEqual(gate.resumeDue(), [CUSTOMER_CHAT]);
  assert.deepEqual(rig.store.listOpenAlerts(), []);
});

test('ADM-46: the ops-chat card names the chat or the cause and carries no message text; it refuses a customer or origin chat', async () => {
  const rig = gateRig();
  rig.store.setRole('ops-chat', 'ops', 'setup', clock.now.toISOString());
  const ops = new Sink('ops-chat');
  const notifier = new OpsChatNotifier(ops, rig.store, 'origin-chat');
  await notifier.notify({ chat: CUSTOMER_CHAT, waitedMs: 0 });
  await notifier.alert({ kind: 'inference_key', detail: KEY_DETAIL });
  assert.deepEqual(ops.sent.map((m) => m.text), [
    `[NEEDS A PERSON] A customer is waiting for a person in ${CUSTOMER_CHAT}.`,
    `[NEEDS ATTENTION] ${KEY_DETAIL}`,
  ]);
  await assert.rejects(new OpsChatNotifier(new Sink(CUSTOMER_CHAT), rig.store).notify({ chat: 'x', waitedMs: 0 }), /admins only/);
  await assert.rejects(new OpsChatNotifier(new Sink('origin-chat'), rig.store, 'origin-chat').alert({ kind: 'inference_key', detail: KEY_DETAIL }), /admins only/);
});

test('ADM-47: the fan-out reaches every path; one path down is not a failure, all paths down is', async () => {
  const sent: string[] = [];
  const good: AdminNotifier = { notify: async () => undefined, alert: async (a) => void sent.push(a.detail) };
  const down: AdminNotifier = { notify: async () => undefined, alert: async () => { throw new Error('whatsapp is disconnected'); } };
  const noAlerts: AdminNotifier = { notify: async () => undefined };
  await fanOutNotifier(down, good, noAlerts).alert!({ kind: 'inference_key', detail: KEY_DETAIL });
  assert.deepEqual(sent, [KEY_DETAIL]);
  await assert.rejects(fanOutNotifier(down, down).alert!({ kind: 'inference_key', detail: KEY_DETAIL }), /whatsapp is disconnected/);
  await fanOutNotifier(noAlerts).alert!({ kind: 'inference_key', detail: KEY_DETAIL }); // nobody supports it: nothing to fail
});

test('ADM-50..53: .ooo and .back flip a presence toggle with audit; the sentence for the bot is built in code from it', async () => {
  const rig = gateRig();
  assert.equal(presenceSentence(rig.store.getPresence()), 'A person is on duty and watching this chat.');
  await rig.gate.admit(ev({ sender: OWNER, text: '.ooo back 09:00 Monday' }));
  assert.deepEqual(rig.store.getPresence(), { state: 'out_of_office', label: 'back 09:00 Monday', since: clock.now.toISOString(), by: OWNER, until: null });
  assert.equal(presenceSentence(rig.store.getPresence()), 'No person is on duty right now. Staff note: back 09:00 Monday. Requests are noted and a person handles them when back.');
  await rig.gate.admit(ev({ sender: 'customer-ref', text: '.ooo' }));
  assert.equal(rig.store.getPresence()!.by, OWNER, 'a customer typing the command changes nothing');
  await rig.gate.admit(ev({ sender: OWNER, text: '.ooo ' + 'x'.repeat(41) }));
  assert.equal(rig.store.getPresence()!.label, 'back 09:00 Monday', 'an over-long or odd label is refused');
  await rig.gate.admit(ev({ sender: OWNER, text: '.back' }));
  assert.equal(rig.store.getPresence()!.state, 'in_office');
  assert.deepEqual(rig.store.listAudit().filter((a) => a.kind === 'presence').map((a) => (a.detail as { to: string }).to), ['out_of_office', 'in_office']);
});

test('ADM-53: out of office, a waiting customer is stored but not pushed; .back lists who is waiting', async () => {
  const rig = gateRig();
  rig.store.setRole('ops-chat', 'ops', 'setup', clock.now.toISOString());
  const ops = new Sink('ops-chat');
  const gate = new ChannelGate({
    control: rig.store, store: rig.store,
    config: { commandPrefix: '.', authorisedSenders: [OWNER], ack: rig.ack },
    notifier: fanOutNotifier(new StoreNotifier(rig.store, () => clock.now), new OpsChatNotifier(ops, rig.store)),
    now: () => clock.now,
  });
  rig.store.setChatState(CUSTOMER_CHAT, 'handoff', 'person:staff', clock.now.toISOString());
  await gate.admit(ev({ sender: OWNER, text: '.ooo weekend' }));
  await gate.admit(ev({}));
  assert.equal(rig.store.listOpenAlerts().length, 1, 'on the dashboard list');
  assert.deepEqual(ops.sent, [], 'no push to the ops chat');
  await gate.admit(ev({ sender: OWNER, text: '.back' }));
  assert.equal(rig.ack.sent.at(-1)!.text, `back in office. Waiting for a person: ${CUSTOMER_CHAT}`);
  gate.personReplied(CUSTOMER_CHAT);
  rig.store.setChatState(CUSTOMER_CHAT, 'handoff', 'person:staff', clock.now.toISOString());
  await gate.admit(ev({}));
  assert.equal(ops.sent.length, 1, 'in office again, the next waiting customer is pushed');
});

test('ADM-56: a handoff card may carry message text, but only to an admin chat', async () => {
  const rig = gateRig();
  rig.store.setRole('ops-chat', 'ops', 'setup', clock.now.toISOString());
  const ops = new Sink('ops-chat');
  await new OpsChatNotifier(ops, rig.store, 'origin-chat').card('chat-ref-1', 'Handoff: chat-ref-1\nSpec: wants');
  assert.deepEqual(ops.sent, [{ text: 'Handoff: chat-ref-1\nSpec: wants', ref: 'card:chat-ref-1' }]);
  await assert.rejects(new OpsChatNotifier(new Sink(CUSTOMER_CHAT), rig.store).card('x', 'y'), /admins only/);
});

test('ADM-57: a person replying or .done from an authorised sender is recorded as settling the chat, whoever the person is', async () => {
  const rig = gateRig();
  assert.equal(rig.store.lastSettledAt(CUSTOMER_CHAT), null);
  rig.gate.personReplied(CUSTOMER_CHAT, 'staff-member-2');
  const first = rig.store.lastSettledAt(CUSTOMER_CHAT);
  assert.equal(first, clock.now.toISOString());
  advance(60_000);
  await rig.gate.admit(ev({ sender: OWNER, text: `.done ${CUSTOMER_CHAT}` }));
  assert.equal(rig.store.lastSettledAt(CUSTOMER_CHAT), clock.now.toISOString());
  await rig.gate.admit(ev({ sender: 'customer-ref', text: `.done ${CUSTOMER_CHAT}` }));
  assert.equal(rig.store.listAudit().filter((a) => a.kind === 'settled').length, 2, 'a customer typing it settles nothing');
});

// ADM-60..63
const DESK = { timezone: 'Atlantic/Madeira', hours: { mon: ['09:00-18:00'], tue: ['09:00-18:00'] }, closedDates: [] };

test('ADM-61: with a schedule, .ooo holds until the office would next change, .back until the next change too, and a person may still answer', async () => {
  const rig = gateRig();
  clock.now = new Date('2026-11-02T11:00:00.000Z'); // Monday, open
  const gate = new ChannelGate({
    control: rig.store, store: rig.store, office: DESK,
    config: { commandPrefix: '.', authorisedSenders: [OWNER], ack: rig.ack },
    now: () => clock.now,
  });
  await gate.admit(ev({ sender: OWNER, text: '.ooo at the dentist' }));
  assert.equal(rig.store.getPresence()!.until, '2026-11-02T18:00:00.000Z', 'out for the rest of the open period');
  assert.match(rig.ack.sent.at(-1)!.text, /or the schedule changes/);
  assert.equal(officeStatus(rig.store.getPresence(), DESK, clock.now).onDuty, false);
  advance(8 * 3_600_000); // 19:00Z, after the toggle ended; the office is closed by the schedule
  assert.equal(officeStatus(rig.store.getPresence(), DESK, clock.now).source, 'schedule');
  await gate.admit(ev({ sender: OWNER, text: '.back' }));
  assert.equal(rig.store.getPresence()!.until, '2026-11-03T09:00:00.000Z', 'in the office on a closed evening, until the next opening');
  assert.equal(officeStatus(rig.store.getPresence(), DESK, clock.now).onDuty, true);
  // ADM-63: nothing about being out of hours stops a person from answering or the bot from working.
  rig.store.setChatState(CUSTOMER_CHAT, 'handoff', 'person:staff', clock.now.toISOString());
  await gate.admit(ev({}));
  gate.personReplied(CUSTOMER_CHAT, 'staff-member-2');
  assert.equal(rig.store.lastSettledAt(CUSTOMER_CHAT), clock.now.toISOString());
});

test('ADM-53, ADM-62: a waiting customer out of hours is stored but not pushed when the schedule says closed, with no toggle at all', async () => {
  const rig = gateRig();
  clock.now = new Date('2026-11-02T20:00:00.000Z');
  const ops = new Sink('ops-chat');
  rig.store.setRole('ops-chat', 'ops', 'setup', clock.now.toISOString());
  const gate = new ChannelGate({
    control: rig.store, store: rig.store, office: DESK,
    config: { commandPrefix: '.', authorisedSenders: [OWNER], ack: rig.ack },
    notifier: fanOutNotifier(new StoreNotifier(rig.store, () => clock.now), new OpsChatNotifier(ops, rig.store)),
    now: () => clock.now,
  });
  rig.store.setChatState(CUSTOMER_CHAT, 'handoff', 'person:staff', clock.now.toISOString());
  await gate.admit(ev({}));
  assert.equal(rig.store.listOpenAlerts().length, 1);
  assert.deepEqual(ops.sent, []);
});
