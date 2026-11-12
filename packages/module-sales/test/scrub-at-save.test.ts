// feat-desk DK0 / docs/04 PRV-6a: what cyborg saves of an exchange (the shadow entry) holds the customer's message and
// the staff reply after the scrubber, never the original. The bot's own output is saved as written.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redact, ShadowController, type OutboundMessage, type OutboundSink } from '@cyborg/core';
import { message, rig, tourDeskConfig } from './helpers.ts';

const REPLY = 'sales.enquiry.reply_draft';
const draft = (text: string) => JSON.stringify({ draft: text });

// Real-shaped values a customer or a staff member types; none of them may survive in the stored entry.
const PHONE = '+351 913 000 222';
const EMAIL = 'ana.silva@example.com';
const IBAN = 'PT50 0002 0123 1234 5678 9015 4';

class Sink implements OutboundSink {
  sent: OutboundMessage[] = [];
  constructor(readonly channel: string) {}
  async send(m: OutboundMessage) {
    this.sent.push(m);
  }
}

function shadowRig(script: string[]) {
  const clock = { now: new Date('2026-11-09T10:00:00.000Z') };
  const env = rig({ mode: 'shadow', enabledHandlers: [REPLY], script, now: () => clock.now });
  const controller = new ShadowController({
    runner: env.runner, log: env.store, store: env.store, ledger: env.store,
    originChannel: 'origin-chat', review: new Sink('review-chat'), now: () => clock.now,
  });
  return { ...env, controller };
}

const planted = (text: string) => [PHONE, EMAIL, IBAN, '913 000 222', '913000222', 'PT50000201231234567890154'].filter((v) => text.includes(v));

test('PRV-6a / DK0: a phone, email and bank number in the customer message are placeholders in the saved entry', async () => {
  const env = shadowRig([draft('A colleague will follow up.')]);
  await env.controller.observe(message(`how much is the east tour? call me on ${PHONE}, write to ${EMAIL}, pay to ${IBAN}`, 'e1'));
  const [entry] = env.store.listEntries();
  assert.ok(entry, 'the entry was saved');
  const stored = JSON.stringify(entry);
  assert.deepEqual(planted(stored), [], 'no planted value is anywhere in the stored entry');
  const text = entry.input['text'] as string;
  assert.match(text, /\[PHONE_1\]/);
  assert.match(text, /\[EMAIL_1\]/);
  assert.match(text, /\[IBAN_1\]/);
  assert.match(text, /^how much is the east tour\?/, 'the rest of the message is kept so the audit can read it');
});

test('PRV-6a / DK0: the bot output is saved as written', async () => {
  const env = shadowRig([draft('The East Tour is €35 per person.')]);
  await env.controller.observe(message(`east tour price? my number is ${PHONE}`, 'e1'));
  const [entry] = env.store.listEntries();
  assert.equal(entry!.draft, 'The East Tour is €35 per person.');
});

test('PRV-6a / DK0: a phone, email and bank number in the staff reply are placeholders in the saved entry', async () => {
  const env = shadowRig([draft('A colleague will follow up.')]);
  await env.controller.observe(message('how much is the east tour', 'e1'));
  env.controller.recordHuman('chat', 'e1', { reply: `It is 35 euros. Call ${PHONE} or write ${EMAIL}. Deposit to ${IBAN}.` });
  const [entry] = env.store.listEntries();
  assert.deepEqual(planted(JSON.stringify(entry)), []);
  assert.match(entry!.humanReply!, /^It is 35 euros\. Call \[PHONE_1\] or write \[EMAIL_1\]\. Deposit to \[IBAN_1\]\.$/);
});

test('PRV-6a / DK0: the audit says which rule and field were replaced, never the text', async () => {
  const env = shadowRig([draft('A colleague will follow up.')]);
  await env.controller.observe(message(`east tour? ${EMAIL}`, 'e1'));
  env.controller.recordHuman('chat', 'e1', { reply: `Sent to ${EMAIL}, call ${PHONE}` });
  const audits = env.store.listAudit().filter((a) => a.kind === 'scrub_replaced');
  assert.ok(audits.length >= 2, 'one audit for the customer message and one for the staff reply');
  assert.deepEqual(planted(JSON.stringify(audits)), []);
  const staff = audits.find((a) => a.actor === 'shadow');
  assert.ok(staff, 'the staff reply replacement is audited');
  const fields = (staff!.detail as { fields: { field: string; rule: string }[] }).fields;
  assert.ok(fields.every((f) => f.field === 'reply' && typeof f.rule === 'string'));
  assert.ok(fields.some((f) => f.rule === 'email') && fields.some((f) => f.rule === 'phone' || f.rule === 'nif_or_phone'));
});

test('PRV-6a / DK0: a message and a staff reply with nothing to replace are saved unchanged, with no audit', async () => {
  const env = shadowRig([draft('A colleague will follow up.')]);
  const auditsBefore = env.store.listAudit().filter((a) => a.kind === 'scrub_replaced').length;
  await env.controller.observe(message('is the east tour good for kids?', 'e1'));
  env.controller.recordHuman('chat', 'e1', { reply: 'Yes, from age 6, see you Monday!' });
  const [entry] = env.store.listEntries();
  assert.equal(entry!.input['text'], 'is the east tour good for kids?');
  assert.equal(entry!.humanReply, 'Yes, from age 6, see you Monday!');
  assert.equal(env.store.listAudit().filter((a) => a.kind === 'scrub_replaced').length, auditsBefore);
});

test('PRV-6a / DK0: saving twice is stable: scrubbing a saved text changes nothing', async () => {
  const env = shadowRig([draft('A colleague will follow up.')]);
  await env.controller.observe(message(`east tour? ${PHONE} ${EMAIL}`, 'e1'));
  const text = env.store.listEntries()[0]!.input['text'] as string;
  assert.equal(redact(text).text, text);
  assert.equal(redact(text).replaced.length, 0);
});

test('PRV-6, HR-2 (audit 2026-11-10): the conversation block the writer is given is scrubbed like the customer message, so a number in it never reaches the model', async () => {
  const env = rig({ enabledHandlers: ['sales.enquiry.reply_draft'], config: { ...tourDeskConfig, conversationContext: true }, script: [JSON.stringify({ draft: 'A colleague will follow up.' })] });
  const event = { ...message('how much is the east tour'), payload: { text: 'how much is the east tour', sender: 'sender-x', first: false, conversation: 'This chat so far: the customer wrote from 912345678 and anna@example.com' } };
  await env.runner.handle(event);
  const prompt = env.model.calls[0]!.prompt;
  assert.match(prompt, /This chat so far/, 'the block is still given');
  assert.doesNotMatch(prompt, /912345678|anna@example\.com/);
  assert.match(prompt, /\[PHONE_1\]|\[NUMBER_1\]/);
  assert.match(prompt, /\[EMAIL_1\]/);
});
