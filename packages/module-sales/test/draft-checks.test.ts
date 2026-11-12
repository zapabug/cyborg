import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ResolvedFacts } from '@cyborg/core';
import { itemsNamedIn, profileStatementFailures } from '../src/index.ts';

// ADM-100. The items are Demo Tours' real tours and the running days from its own catalog (unconfirmed, see the customer repository).
const facts = (items: unknown[], availability: unknown = { days: [0, 1, 2, 3, 4, 5, 6], closedDates: ['12-25'] }): ResolvedFacts => ({
  profile: [
    { key: 'offer.items', value: items, class: 'public', status: 'confirmed' },
    { key: 'offer.availability', value: availability, class: 'public', status: 'confirmed' },
  ],
  pack: [],
});
const ITEMS = [
  { name: 'West Tour', keywords: ['west'], price: 35, capacity: 80, days: [2, 5, 0] },
  { name: 'East Tour', keywords: ['east'], price: 35, capacity: 80, days: [1, 3, 4, 6] },
  { name: 'Private Tour or Walk', keywords: ['private'], price: 550, capacity: 8, days: [] },
];

test('ADM-100: a day named beside a tour must be a day that tour runs; another tour\'s day does not count', () => {
  assert.deepEqual(profileStatementFailures('The West Tour runs on Tuesday.', facts(ITEMS)), []);
  assert.deepEqual(profileStatementFailures('The West Tour runs on Thursday.', facts(ITEMS)), ['weekday 4 is not a running day of West Tour']);
  assert.deepEqual(profileStatementFailures('The east tour runs on Thursday.', facts(ITEMS)), []);
  assert.deepEqual(profileStatementFailures('We run the East Tour on Sunday.', facts(ITEMS)), ['weekday 0 is not a running day of East Tour']);
  assert.deepEqual(profileStatementFailures('The West Tour and the East Tour both run on Thursday or Tuesday.', facts(ITEMS)), [], 'two tours named: either one\'s days');
});

test('ADM-100: with no tour named any tour\'s day will do, an item with an empty list runs any day, and a keyword names its tour', () => {
  assert.deepEqual(profileStatementFailures('We have a tour on Wednesday.', facts(ITEMS.slice(0, 2))), []);
  assert.deepEqual(profileStatementFailures('The private tour can be any day, say Saturday.', facts(ITEMS)), []);
  assert.deepEqual(profileStatementFailures('The west one is on Thursday.', facts(ITEMS)), ['weekday 4 is not a running day of West Tour'], 'the keyword "west" names the West Tour');
  assert.deepEqual(itemsNamedIn('A day on the Westside', ITEMS).map((i) => i.name), [], 'a keyword is a whole word');
});

test('ADM-100: dates are held to the same rule, and closed dates still apply', () => {
  assert.deepEqual(profileStatementFailures('The West Tour on 2026-11-05 has room.', facts(ITEMS)), ['2026-11-05 falls on weekday 4, which is not a running day of West Tour']);
  assert.deepEqual(profileStatementFailures('The West Tour on 2026-11-03 has room.', facts(ITEMS)), []);
  assert.deepEqual(profileStatementFailures('The private tour on 2026-12-25 is possible.', facts(ITEMS)), ['2026-12-25 is a closed date (12-25)']);
});

test('ADM-100: items with no days of their own fall back to the business-wide list, as before', () => {
  const plain = [{ name: 'Alpha Walk', price: 20, capacity: 10 }];
  assert.deepEqual(profileStatementFailures('Alpha Walk runs on Tuesday.', facts(plain, { days: [1, 3] })), ['weekday 2 is not in offer.availability.days']);
  assert.deepEqual(profileStatementFailures('Alpha Walk runs on Wednesday.', facts(plain, { days: [1, 3] })), []);
});

test('feat-tailored: a starting price is stated with a "from" word, and a flat price needs none', () => {
  const items = [{ name: 'Item A', price: 30, priceFrom: true }, { name: 'Item B', price: 20 }, { name: 'Item C', price: 30, priceFrom: true }];
  assert.deepEqual(profileStatementFailures('Item A is 30 EUR.', facts(items)), ['price 30 is a starting price: the draft must say "from"']);
  assert.deepEqual(profileStatementFailures('Item A is from 30 EUR.', facts(items)), []);
  assert.deepEqual(profileStatementFailures('Item A começa a partir de 30 EUR.', facts(items)), []);
  assert.deepEqual(profileStatementFailures('Item B is 20 EUR.', facts(items)), []);
  assert.deepEqual(profileStatementFailures('Item A is 30 EUR.', facts([{ name: 'Item A', price: 30, priceFrom: true }, { name: 'Item D', price: 30 }])), [], 'the same amount is a flat price for another item: not blocked');
  assert.deepEqual(profileStatementFailures('The total is 90.', facts(items), 'Total for the group: 90'), [], 'an amount the code computed is allowed');
});

test('ADM-112: saying a day is closed is a correct answer; claiming it is open is still blocked; saying a running day is closed is blocked', () => {
  const week = facts([], { days: [1, 2, 3, 4, 5, 6], closedDates: ['12-25'] }); // Monday to Saturday
  const ok = [
    "No, we're closed on Sunday. Open Monday to Saturday 09:00-19:00.",
    "We're closed on Sundays.",
    'Closed Sunday, open Monday to Saturday.',
    "We don't run on Sundays.",
    'Aos domingos estamos fechados.',
    'Não abrimos ao domingo.',
    'Open every day except Sunday.',
    "We're open Monday to Saturday, but not on Sunday.",
  ];
  for (const draft of ok) assert.deepEqual(profileStatementFailures(draft, week), [], draft);
  const blocked: [string, RegExp][] = [
    ["Yes, we're open on Sunday.", /weekday 0 is not in offer\.availability\.days/],
    ['Open on Sundays!', /weekday 0 is not/],
    ['Sunday works for us.', /weekday 0 is not/],
    ['Sim, abrimos ao domingo.', /weekday 0 is not/],
    ["We're closed on Monday.", /says weekday 1 is closed, but it is in offer\.availability\.days/],
    ['Fechado à segunda.', /says weekday 1 is closed/],
    ["Not open Sunday, but yes we're open Sunday afternoons.", /weekday 0 is not/],
  ];
  for (const [draft, re] of blocked) assert.match(profileStatementFailures(draft, week).join('|'), re, draft);
  // a date reads the same way
  assert.deepEqual(profileStatementFailures("We're closed on 2026-12-25.", week), []);
  assert.match(profileStatementFailures('Yes, we are open on 2026-12-25.', week).join('|'), /closed date/);
  // the days it runs may still be listed
  assert.deepEqual(profileStatementFailures("We're closed Sunday. We run Monday, Tuesday, Wednesday, Thursday, Friday and Saturday.", week), []);
});

test('ADM-112: a claim about every day is blocked when the business lists fewer than seven, and passes when it is negated or all seven run', () => {
  const week = facts([], { days: [1, 2, 3, 4, 5, 6], closedDates: [] });
  for (const draft of ["We're open every day, including weekends, Mon-Sat 09:00-19:00.", 'Open daily 9 to 7.', 'Estamos abertos todos os dias.', 'We are open all week.']) {
    assert.match(profileStatementFailures(draft, week).join('|'), /open every day, but .* lists only 6 days/, draft);
  }
  for (const draft of ["We're not open every day: Monday to Saturday.", 'Open Monday to Saturday, closed Sundays.']) assert.deepEqual(profileStatementFailures(draft, week), [], draft);
  assert.deepEqual(profileStatementFailures('We are open every day, 9 to 7.', facts([], { days: [0, 1, 2, 3, 4, 5, 6], closedDates: [] })), []);
});

test('SAL-5: "Booked a short cut on Friday" and "Reserved your spot" are commitments, and a request passed to the team is not', async () => {
  const { commitmentHits } = await import('../src/index.ts');
  for (const draft of ['Booked a short cut on Friday at 15:00.', 'Reserved your spot for Thursday.', 'Confirmed for Friday.', 'Marcámos para sexta.']) assert.ok(commitmentHits(draft, []).length > 0, draft);
  for (const draft of ['Please send the day and time and the team will confirm.', 'I will pass your request to the team, who confirm bookings.', 'The booking needs the team to confirm.']) assert.deepEqual(commitmentHits(draft, []), [], draft);
});

test('PRF-28b: a time the facts give as 09:00-19:00 is traced when the draft writes it as 9 AM-7 PM; a time the facts do not have is not', async () => {
  const { untracedNumbers } = await import('../src/index.ts');
  const f: ResolvedFacts = { profile: [{ key: 'faq.entries', value: [{ q: 'hours', a: 'Mon-Sat 09:00-19:00' }], class: 'public', status: 'confirmed' }], pack: [] };
  assert.deepEqual(untracedNumbers('Open Monday to Saturday, 9 AM–7 PM.', 'are you open on sunday?', f), []);
  assert.deepEqual(untracedNumbers('We open at 09:00 and close at 7:00 pm.', '', f), []);
  assert.deepEqual(untracedNumbers('We close at 8 PM.', '', f), ['8']);
});
