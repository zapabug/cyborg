import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scrub } from '../src/index.ts';

// Pattern samples are synthetic strings in the shape of each rule's target. They are
// detector inputs, not business or customer data.
const SHOULD_HIT: Record<string, string[]> = {
  email: ['write to someone@example.com please', 'a.b+tag@mail.example.org'],
  iban: ['IBAN PT50 0002 0123 1234 5678 9015 4', 'PT50000201231234567890154'],
  phone: ['call +351 912 345 678', 'call 00351912345678', 'ring +44 20 7946 0958'],
  id_number: ['cc 12345678 9 ZZ4', 'passport AB1234567'],
  nif_or_phone: ['nif 123456789', 'nif 123 456 789', 'tel 912.345.678'],
  long_number: ['account 12345678901'],
};

test('PRV-6: each rule detects its pattern', () => {
  for (const [rule, samples] of Object.entries(SHOULD_HIT)) {
    for (const sample of samples) {
      assert.ok(scrub(sample).some((h) => h.rule === rule), `${rule} should hit: ${sample}`);
    }
  }
});

test('ordinary deal text passes', () => {
  for (const text of [
    'two bedrooms, budget 250000 euros, arriving 12 October',
    'plot of 1200 m2 near Calheta, wants a quote by 2026-11-15',
    'group of 6 people, 3 nights, ground floor',
  ]) {
    assert.deepEqual(scrub(text), [], text);
  }
});

test('PRV-2: a hit carries the rule and position, never the matched text', () => {
  const text = 'mail someone@example.com now';
  const hits = scrub(text);
  assert.ok(hits.length > 0);
  for (const hit of hits) {
    assert.deepEqual(Object.keys(hit).sort(), ['end', 'rule', 'start']);
    assert.ok(!JSON.stringify(hit).includes('someone'));
  }
  assert.deepEqual(hits.find((h) => h.rule === 'email'), { rule: 'email', start: 5, end: 24 });
});

// PRV-6b: a payment card number is found by its digits and the Luhn check, with or without spaces; the numbers below are the card schemes' public test numbers.
import { luhn, redact as redactText } from '../src/scrubber.ts';
test('PRV-6b: a card number that passes the Luhn check is the `card` rule, in a run or in groups, and becomes [CARD_n]', () => {
  for (const pan of ['4111 1111 1111 1111', '4111-1111-1111-1111', '4111111111111111', '5500 0000 0000 0004', '3782 822463 10005']) {
    assert.deepEqual(scrub(`pay with ${pan} please`).map((h) => h.rule).filter((r) => r === 'card'), ['card'], pan);
  }
  const r = redactText('my card is 4111 1111 1111 1111, thanks');
  assert.equal(r.text, 'my card is [CARD_1], thanks');
  assert.deepEqual(r.replaced.map((x) => x.rule), ['card']);
});

test('PRV-6b: a long number that fails the card check is not a card', () => {
  assert.equal(luhn('4111111111111111'), true);
  assert.equal(luhn('4111111111111112'), false);
  assert.deepEqual(scrub('order 4111111111111112').map((h) => h.rule).filter((r) => r === 'card'), []);
});
