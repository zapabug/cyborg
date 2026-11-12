import assert from 'node:assert/strict';
import { test } from 'node:test';
import { message, rig } from './helpers.ts';

const REPLY = 'sales.enquiry.reply_draft';
const HOW_MUCH = 'how much is the east tour'; // a wazaa test chat

// audit 2026-11-03 F-2 / PRF-29: a draft the code blocks must not read as a confident one
test('PRF-29: a reply blocked in code for a commitment reads low, with the failed check as a signal', async () => {
  const env = rig({ enabledHandlers: [REPLY], script: [JSON.stringify({ draft: 'Your booking is confirmed for Monday.' }), JSON.stringify({ draft: 'The East Tour is €35 per person.' })] });
  await env.runner.handle(message(HOW_MUCH, 'blocked-1'));
  await env.runner.handle(message(HOW_MUCH, 'fine-1'));
  const [blocked, fine] = env.store.list({ handlerId: REPLY });
  assert.equal(blocked!.draft, undefined);
  assert.equal(blocked!.confidence!.band, 'low');
  const checks = blocked!.confidence!.signals.find((s) => s.kind === 'checks')!;
  assert.equal(checks.passed, false);
  assert.match(String(checks.value), /blocked/);
  assert.equal(fine!.confidence!.band, 'high', 'a draft that passes every check is unchanged');
  assert.equal(fine!.confidence!.signals.find((s) => s.kind === 'checks')!.passed, true);
});
