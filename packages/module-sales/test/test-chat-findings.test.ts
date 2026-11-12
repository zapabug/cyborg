// ADM-113: three things found in zapa's own test chat on 2026-11-09. The drafts below are the model's real words from that chat.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ResolvedFacts } from '@cyborg/core';
import { commitmentHits, profileStatementFailures } from '../src/index.ts';
import { message, rig } from './helpers.ts';

// The made-up demo business of docs/demo/business-sheet.demo.txt: a flat short cut, two starting prices.
const DEMO_ITEMS = [
  { name: 'Short cut', price: 20, currency: 'EUR', note: '30 min' },
  { name: 'Long cut', price: 30, priceFrom: true, currency: 'EUR', note: '45 min' },
  { name: 'Colour', price: 55, priceFrom: true, currency: 'EUR', note: 'about 2 hours' },
];
const facts = (items: unknown[]): ResolvedFacts => ({
  profile: [
    { key: 'offer.items', value: items, class: 'public', status: 'confirmed' },
    { key: 'offer.availability', value: { days: [1, 2, 3, 4, 5, 6] }, class: 'public', status: 'confirmed' },
  ],
  pack: [],
});

test('ADM-113: a flat price written "from" is blocked (the short cut is a flat 20 EUR)', () => {
  const real = 'Next available days are Monday to Saturday. Please specify the service (Short cut: from 20 EUR / 30 min, Long cut: from 30 EUR / 45 min, Colour: from 55 EUR / ~2 hrs) and your preferred time.';
  assert.deepEqual(profileStatementFailures(real, facts(DEMO_ITEMS)), ['price 20 is a fixed price: the draft must not say "from"']);
});

test('ADM-113: a flat price said flat, and a starting price said "from", both pass; the old rule (a starting price needs "from") still holds', () => {
  assert.deepEqual(profileStatementFailures('A short cut is 20 EUR and a long cut is from 30 EUR.', facts(DEMO_ITEMS)), []);
  assert.deepEqual(profileStatementFailures('The Long cut starts from 30 EUR.', facts(DEMO_ITEMS)), []);
  assert.deepEqual(profileStatementFailures('A long cut is 30 EUR.', facts(DEMO_ITEMS)), ['price 30 is a starting price: the draft must say "from"']);
  assert.deepEqual(profileStatementFailures('A short cut is from €20.', facts(DEMO_ITEMS)), ['price 20 is a fixed price: the draft must not say "from"']);
  assert.deepEqual(profileStatementFailures('Um corte curto custa a partir de 20 EUR.', facts(DEMO_ITEMS)), ['price 20 is a fixed price: the draft must not say "from"']);
});

test('ADM-113: a price that two items share, one flat and one a starting price, is not flagged either way', () => {
  const shared = [{ name: 'A', price: 30 }, { name: 'B', price: 30, priceFrom: true }];
  assert.deepEqual(profileStatementFailures('B is from 30 EUR.', facts(shared)), []);
});

test('ADM-113: saying the bot sent a request, or will check back itself, is blocked', () => {
  const sent = 'Got it! I’ve sent a request to the team for Allan James on **[NUMBER_1]**’s behalf. The team will confirm the **Short cut** for **Wednesday** if it’s free. I’ll check back with them right away.';
  const hits = commitmentHits(sent.replace(/’/g, "'"), []);
  assert.equal(hits.length, 2, 'both the claim and the promise');
  assert.ok(hits.every((h) => /does not|bot does not/.test(h)));
  for (const claim of ['Your request has been sent.', 'We have sent the booking to the team.', 'I will get back to you shortly.', "I'll let you know once I hear.", 'Já enviei o pedido à equipa.']) {
    assert.ok(commitmentHits(claim, []).length > 0, claim);
  }
});

test('ADM-113: the team coming back is said as the team\'s and passes; so does the plain ask the prompt wants', () => {
  for (const ok of [
    'The office will come back to you with a time.',
    "I'll pass this to the office and they'll come back to you.",
    'Short cut is 20 EUR. Which day suits you?',
    'A colleague will confirm the Wednesday slot.',
  ]) assert.deepEqual(commitmentHits(ok, []), [], ok);
});

test('ADM-113: the reply prompt says what a placeholder is, and the reply writer is version 9', async () => {
  const env = rig({ enabledHandlers: ['sales.enquiry.reply_draft'], script: [JSON.stringify({ draft: 'The Long cut starts from 30 EUR. What day suits you?' })] });
  await env.runner.handle(message('how much is a long cut? call me on +351 913 000 222'));
  const prompt = env.model.calls[0]!.prompt;
  assert.match(prompt, /A placeholder such as \[PHONE_1\], \[EMAIL_1\] or \[NUMBER_1\] in the customer's message stands for a detail they wrote that you cannot see: never repeat it or comment on it, the team has it\./);
  assert.match(prompt, /call me on \[PHONE_1\]/, 'the model saw the placeholder, not the number');
  assert.doesNotMatch(prompt, /913 000 222/);
  assert.equal(env.registry.get('sales.enquiry.reply_draft')!.version, '9');
});

// ADM-114: day names in the prompt, and a booking said in other words.
test('ADM-114: the writer is given day names, never the day numbers, for the opening days and for an item\'s running days', async () => {
  const env = rig({ enabledHandlers: ['sales.enquiry.reply_draft'], script: [JSON.stringify({ draft: 'We work Monday to Saturday. Which day suits you?' })] });
  await env.runner.handle(message('which days do you work?'));
  const prompt = env.model.calls[0]!.prompt;
  const availability = /Availability: (.*)/.exec(prompt)![1]!;
  assert.doesNotMatch(availability, /"days":\s*\[/, 'no list of day numbers');
  assert.match(availability, /"days":"[A-Z][a-z]+day/, 'written as words');
  const offer = /Offer: (.*)/.exec(prompt)![1]!;
  assert.doesNotMatch(offer, /"days":\s*\[\d/, 'an item\'s running days are words too');
});

test('ADM-114: "lock it in", "book you in" and "I\'ll hold the date for you" are blocked as booking commitments', () => {
  for (const claim of ['Just confirm the days and we\'ll lock it in.', 'Great, we can lock you in for the 12th.', 'I\'ll book you in for Monday.', 'Done, got you booked!', 'We\'ll hold the date for you.', 'I will hold your slot.']) {
    assert.ok(commitmentHits(claim, []).length > 0, claim);
  }
  for (const ok of ['Which day would you like?', 'The owner confirms every booking himself.', 'We work Monday to Saturday.']) assert.deepEqual(commitmentHits(ok, []), [], ok);
});
