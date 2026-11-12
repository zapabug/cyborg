import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HandlerRegistry, Lifecycle, ReplyScheduler, Runner, ShadowController, type CyborgEvent } from '@cyborg/core';
import { echoHandler, goodResponse, ScriptedModel } from '@cyborg/core/testing';
import { SqliteStore } from '@cyborg/store-sqlite';
import { ChannelGate } from '@cyborg/core';
import { CUSTOMER_CHAT, GROUP_CHAT, OWNER, Sink, Stt } from './helpers.ts';

/** The adapter's composition of the pieces: gate -> reply delay -> shadow controller -> review sink only. */
test('the manners pipeline end to end in a shadow run: gate, 60 s delay, shadow controller, review sink', async () => {
  const at = new Date('2026-10-31T10:00:00.000Z');
  const store = new SqliteStore(':memory:');
  const origin = new Sink('real-channel');
  const review = new Sink('review-chat');
  const registry = new HandlerRegistry({ autoReplyHandlers: [] });
  registry.registerHandler(echoHandler({ trigger: [{ type: 'event', kind: 'message.received' }] }));
  const model = new ScriptedModel([goodResponse, goodResponse]);
  const runner = new Runner({ businessId: 'b', registry, store, ledger: store, model, mode: 'shadow', now: () => at });
  const shadow = new ShadowController({ runner, log: store, store, ledger: store, originChannel: origin.channel, review, now: () => at });
  const lifecycle = new Lifecycle({ store, now: () => at });
  const scheduler = new ReplyScheduler({
    run: async (event) => (await shadow.observe(event)).flatMap((o) => (o.outcome === 'proposal' ? [o.proposal] : [])),
    supersede: (id) => void lifecycle.supersede(id, 'reply-scheduler'),
    isOpen: (id) => store.get(id)?.status === 'proposed',
  });
  const stt = new Stt('alpha beta gamma');
  const gate = new ChannelGate({
    control: store, store, now: () => at,
    config: { commandPrefix: '.', authorisedSenders: [OWNER], ack: new Sink('owner-self-chat'), originChannel: origin.channel },
    transcriber: stt,
  });
  store.setRole(CUSTOMER_CHAT, 'reply', 'setup', at.toISOString());
  store.setRole(GROUP_CHAT, 'reply', 'setup', at.toISOString());
  store.setRole('owner-self-chat', 'ops', 'setup', at.toISOString());

  const feed = async (id: string, payload: Record<string, unknown>, t = 0) => {
    const event: CyborgEvent = { id, source: 'chat', kind: 'message.received', at: at.toISOString(), payload: { chat: CUSTOMER_CHAT, isGroup: false, addressed: true, sender: 'customer-ref', text: '', ...payload } };
    const decision = await gate.admit(event);
    if (decision.kind === 'run') scheduler.submit(decision.event, t);
    return decision.kind;
  };

  assert.equal(await feed('v1', { media: { type: 'audio', ref: 'audio-1' } }, 0), 'run');
  assert.equal(await feed('g1', { chat: GROUP_CHAT, isGroup: true, addressed: false, text: 'unrelated group chatter' }, 5_000), 'ignore');
  assert.equal(await feed('m2', { text: 'beta' }, 10_000), 'run');
  assert.equal(await feed('b1', { fromBot: true, text: 'beep' }, 12_000), 'ignore');
  assert.equal(review.sent.length, 0, 'nothing is sent while the customer is still typing');
  await scheduler.tick(30_000);
  assert.equal(review.sent.length, 0);
  await scheduler.tick(70_000);
  assert.equal(model.calls.length, 1, 'the voice note and the text became one run');
  assert.ok(model.calls[0]!.prompt.includes('alpha beta gamma\nbeta'), 'the transcript and the text, joined');
  assert.equal(review.sent.length, 1);
  assert.match(review.sent[0]!.text, /^\[shadow test\.echo 1\]/);
  assert.equal(origin.sent.length, 0, 'nothing reached the origin channel');
  assert.deepEqual(stt.discarded, ['audio-1']);

  assert.equal(await feed('c1', { chat: 'owner-self-chat', sender: OWNER, text: '.stopall' }, 80_000), 'command');
  assert.equal(await feed('s1', { text: 'anyone there?' }, 90_000), 'store_only');
  await scheduler.tick(200_000);
  assert.equal(model.calls.length, 1, 'stop-all created nothing');
  assert.equal(origin.sent.length, 0);
});
