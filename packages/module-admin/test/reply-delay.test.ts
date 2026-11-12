import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Lifecycle, ReplyScheduler, type CyborgEvent, type Proposal } from '@cyborg/core';
import { SqliteStore } from '@cyborg/store-sqlite';

const msg = (id: string, text: string, chat = 'c1'): CyborgEvent => ({ id, source: 'chat', kind: 'message.received', at: '2026-10-31T10:00:00.000Z', payload: { chat, text, sender: 's' } });

function rig() {
  const store = new SqliteStore(':memory:');
  const lifecycle = new Lifecycle({ store });
  const ran: CyborgEvent[] = [];
  let n = 0;
  const scheduler = new ReplyScheduler({
    run: async (event) => {
      ran.push(event);
      return [store.create({ businessId: 'b', handlerId: 'h', handlerVersion: '1', status: 'proposed', subject: `s${++n}`, changes: [], draft: `draft for ${event.id}`, findings: [], questions: [], modelCallId: null, reason: null }, null, '2026-10-31T10:00:00.000Z')] as Proposal[];
    },
    supersede: (id) => void lifecycle.supersede(id, 'reply-scheduler'),
    isOpen: (id) => store.get(id)?.status === 'proposed',
  });
  return { store, scheduler, ran };
}

// M7b-EC11
test('BEH-16, N-13 / M7b-EC11: a burst becomes one run, 60 s after the last message', async () => {
  const { scheduler, ran } = rig();
  scheduler.submit(msg('m1', 'hi'), 0);
  scheduler.submit(msg('m2', 'I wanted to ask'), 10_000);
  scheduler.submit(msg('m3', 'about the east tour'), 20_000);
  assert.deepEqual(await scheduler.tick(30_000), []);
  assert.deepEqual(await scheduler.tick(79_999), [], 'each message restarts the wait: 59.999 s after the last');
  const done = await scheduler.tick(80_000);
  assert.equal(done.length, 1);
  assert.equal(done[0]!.messages, 3);
  assert.equal(ran.length, 1);
  assert.equal(ran[0]!.id, 'm3');
  assert.equal(ran[0]!.payload['text'], 'hi\nI wanted to ask\nabout the east tour');
  assert.deepEqual(await scheduler.tick(200_000), [], 'nothing is run twice');
});

test('BEH-17 / M7b-EC11: commands, kill switches and ops events are not delayed', async () => {
  const { scheduler, ran } = rig();
  await scheduler.immediate({ ...msg('cmd1', '.stopall'), kind: 'manual:stopall' });
  assert.equal(ran.length, 1);
  assert.deepEqual(scheduler.pendingChats(), []);
});

test('chats are independent; a configured maximum wait forces a run', async () => {
  const { scheduler, ran } = rig();
  scheduler.submit(msg('a1', 'one', 'chat-a'), 0);
  scheduler.submit(msg('b1', 'two', 'chat-b'), 50_000);
  assert.equal((await scheduler.tick(60_000)).length, 1);
  assert.deepEqual(scheduler.pendingChats(), ['chat-b']);
  assert.equal(ran[0]!.payload['chat'], 'chat-a');

  const store = new SqliteStore(':memory:');
  const capped = new ReplyScheduler({ run: async () => [], supersede: () => undefined, isOpen: () => false, maxWaitMs: 100_000 });
  for (let t = 0; t <= 100_000; t += 30_000) capped.submit(msg(`m${t}`, 'x'), t);
  assert.equal((await capped.tick(100_000)).length, 1, 'the wait never ended on its own, the maximum did');
  void store;
});

test('BEH-18 / M7b-EC11: a message arriving after a proposal exists supersedes it, and a new run follows', async () => {
  const { scheduler, store } = rig();
  scheduler.submit(msg('m1', 'how much is it'), 0);
  const first = (await scheduler.tick(60_000))[0]!.proposals[0]!;
  assert.equal(store.get(first.id)!.status, 'proposed');
  scheduler.submit(msg('m2', 'sorry, for 4 people'), 70_000);
  assert.equal(store.get(first.id)!.status, 'superseded');
  const second = (await scheduler.tick(130_000))[0]!.proposals[0]!;
  assert.equal(store.get(second.id)!.status, 'proposed');
  assert.deepEqual(store.list({ status: 'proposed' }).map((p) => p.id), [second.id], 'one open proposal for the chat');
});

test('BEH-18: an already approved proposal is not superseded', async () => {
  const { scheduler, store } = rig();
  scheduler.submit(msg('m1', 'hello'), 0);
  const first = (await scheduler.tick(60_000))[0]!.proposals[0]!;
  new Lifecycle({ store }).decide(first.id, 'approve', 'person:staff');
  scheduler.submit(msg('m2', 'thanks'), 70_000);
  assert.equal(store.get(first.id)!.status, 'approved');
});
