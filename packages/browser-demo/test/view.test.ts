import assert from 'node:assert/strict';
import { test } from 'node:test';
import { factLabel, factText, plainProblem } from '../src/view.ts';

// The replay is for a business reader: no handler names, no profile keys, one sentence per problem.

test('a blocked draft is said in a sentence a business reads, without the handler name or the profile key', () => {
  assert.equal(plainProblem('reply_draft: reply blocked: weekday 0 is not in offer.availability.days'), 'Sunday is not one of the opening days.');
  assert.equal(plainProblem('the drafted reply was blocked: weekday 4 is not a running day of West Tour'), 'Thursday is not one of the opening days.');
  assert.equal(plainProblem('price 30 is a starting price: the draft must say "from"'), 'Price 30 is a starting price: the draft must say "from"');
  assert.equal(plainProblem('reply_draft: the model refused the key'), 'The model refused the key');
});

test('profile keys are shown as the business\'s words, and an unknown key as it is', () => {
  assert.equal(factLabel('offer.items'), 'Services and prices');
  assert.equal(factLabel('rules.commitments'), 'Rules it must keep');
  assert.equal(factLabel('live.something'), 'live.something');
});

test('the office card does not show the chat\'s internal reference', async () => {
  const { cardText } = await import('../src/view.ts');
  assert.equal(cardText('Handoff: s2\n──\nSpec: wants'), 'Handoff to the office\n──\nSpec: wants');
  assert.equal(cardText('No card: nothing to check.'), 'No card: nothing to check.');
});

// feat-desk DK1-EC4: the panel says what the writer was given, in the business's words, with each fact's content.
test('the panel shows each fact\'s content: services and prices, the days it runs, the rules, the business\'s answers and the tone', () => {
  const items = [{ name: 'Short cut', price: 20, currency: 'EUR', note: '30 min' }, { name: 'Long cut', price: 30, priceFrom: true, currency: 'EUR', note: '45 min' }];
  assert.equal(factText('offer.items', items), 'Short cut: 20 EUR (30 min)\nLong cut: from 30 EUR (45 min)');
  assert.equal(factText('offer.availability', { days: [1, 2, 3, 4, 5, 6] }), 'Monday to Saturday');
  assert.equal(factText('offer.availability', { days: [1, 3], closedDates: ['12-25'] }), 'Monday, Wednesday. Closed on 12-25');
  assert.equal(factText('rules.commitments', ['confirm an appointment: the team confirms it', 'give a discount']), 'confirm an appointment: the team confirms it\ngive a discount');
  assert.equal(factText('faq.entries', [{ q: 'Where is your office?', a: '1 Demo Street' }]), 'Where is your office? 1 Demo Street');
  assert.equal(factText('tone.style', 'friendly and plain, in short full sentences'), 'friendly and plain, in short full sentences');
  assert.equal(factText('something.new', { a: 1 }), '{"a":1}');
});
