import assert from 'node:assert/strict';
import { test } from 'node:test';
import { conversationRuleFailures } from '../src/index.ts';

// WZP-51 (brain spec "totals only"): the rules the company's code states in the facts it computed for a chat are held in code.

const NEED = 'Booking in progress.\n- Tour: East Tour\nRule: state no price yet.\nNext: ask how many people.';
const QUOTED = 'Booking in progress.\n- Total for the group: 180 EUR (45 EUR per person × 4).\nRule: state the total 180 whenever you state a per-person price.\nNext: give the total.';

test('no price is stated before the group size is known, in any of the usual ways', () => {
  assert.deepEqual(conversationRuleFailures('Happy to help! How many people, and which day?', NEED), []);
  for (const draft of ['It is 45 per person. How many are you?', 'It is 45 EUR.', 'It is €45!', 'São 45 por pessoa.', 'Es kostet 45 pro Person.']) {
    assert.deepEqual(conversationRuleFailures(draft, NEED), ['states a price before the group size is known'], draft);
  }
});

test('a per-person price comes only with the total', () => {
  assert.deepEqual(conversationRuleFailures('For 4 people it is 180 EUR in total (45 EUR per person).', QUOTED), []);
  assert.deepEqual(conversationRuleFailures('It is 180 EUR in total.', QUOTED), []);
  assert.deepEqual(conversationRuleFailures('It is 45 EUR per person.', QUOTED), ['gives a per-person price without the total (180)']);
});

test('without the rules in the computed facts nothing changes: an ordinary question is answered as before', () => {
  assert.deepEqual(conversationRuleFailures('The tour is 45 per person.', ''), []);
  assert.deepEqual(conversationRuleFailures('The tour is 45 per person.', 'Booking in progress.\n- Tour: East Tour'), []);
});

import type { ResolvedFacts } from '@cyborg/core';
import { officeTopicFailures } from '../src/index.ts';

const facts = (...values: unknown[]): ResolvedFacts => ({ profile: values.map((value, i) => ({ key: `k${i}`, value, state: 'unconfirmed' })), packs: [] }) as never;
const TOPICS = [{ label: 'pets', words: ['dog', 'dogs', 'pet', 'pets', 'cão'] }, { label: 'wheelchair access', words: ['wheelchair', 'mobility'] }];

test('a topic the business listed as unknown goes to the office when the customer raises it and no fact covers it', () => {
  assert.deepEqual(officeTopicFailures('Can I bring my dog?', facts({ q: 'Pick-up?', a: 'Yes.' }), TOPICS), ["the customer asks about pets, which the business's facts do not cover"]);
  assert.deepEqual(officeTopicFailures('Is it OK for a wheelchair and my dogs?', facts({ a: 'Hotel pick-up.' }), TOPICS).length, 2);
  assert.deepEqual(officeTopicFailures('Can I bring my dog?', facts({ q: 'Are pets allowed?', a: 'Small dogs on a lead are welcome.' }), TOPICS), [], 'a fact that covers the topic answers it');
  assert.deepEqual(officeTopicFailures('How much is the east tour?', facts({}), TOPICS), [], 'a message that does not raise a topic is untouched');
  assert.deepEqual(officeTopicFailures('Can I bring my dog?', facts({}), []), [], 'no topics listed, no rule');
  assert.deepEqual(officeTopicFailures('My doggy is small', facts({}), TOPICS), [], 'a word, not a part of one');
});
