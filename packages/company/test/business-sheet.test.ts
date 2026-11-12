import assert from 'node:assert/strict';
import { test } from 'node:test';
import { daysFromHours, findPrice, missingAsks, parseBusinessSheet } from '../src/index.ts';

// feat-tailored TLR-10, TLR-13: the business sheet. These are syntax examples for the reader (labels, lists, bars), not a business; a real client's sheet is read
// at run time from a path and never committed (MOD-8).

const SHEET = `# a sheet
Name: Example Co
Tone: warm and short
Where: 1 Example Street
Hours: Mon-Sat 09:00-19:00
Parking: free behind the building

Services:
- Item one | 25 EUR | 45 min
- Item two - from €60
- Item three: 12,50 euros extra
- Item four

Questions:
- Do you take cards? | Yes, all cards.
- Q: Can I bring a friend?
  A: Yes, at no extra cost.
- Is there parking? Yes, behind the building.

Never:
- give a discount
- promise a time slot
`;

test('TLR-13: a sheet is read into the facts the sales module needs, with no model, and every line is accounted for', () => {
  const s = parseBusinessSheet(SHEET);
  assert.deepEqual(s.unread, []);
  assert.equal(s.statements['business.name'], 'Example Co');
  assert.equal(s.statements['tone.style'], 'warm and short');
  assert.deepEqual(s.statements['offer.items'], [
    { name: 'Item one', price: 25, currency: 'EUR', note: '45 min' },
    { name: 'Item two', price: 60, priceFrom: true, priceNote: 'starting price: always say "from 60", never just "60"', currency: 'EUR' },
    { name: 'Item three', price: 12.5, currency: 'EUR', note: 'extra' },
    { name: 'Item four' },
  ]);
  assert.deepEqual(s.statements['rules.commitments'], ['give a discount', 'promise a time slot']);
  assert.deepEqual(s.statements['faq.entries'], [
    { q: 'Where is your office?', a: '1 Example Street' },
    { q: 'What are your opening hours?', a: 'Mon-Sat 09:00-19:00' },
    { q: 'Parking?', a: 'free behind the building' },
    { q: 'Do you take cards?', a: 'Yes, all cards.' },
    { q: 'Can I bring a friend?', a: 'Yes, at no extra cost.' },
    { q: 'Is there parking?', a: 'Yes, behind the building.' },
  ]);
  assert.deepEqual(s.statements['offer.availability'], { days: [1, 2, 3, 4, 5, 6] });
  assert.deepEqual(s.missing, []);
  assert.ok(s.notes.some((n) => /"Parking" is not a label the sheet knows/.test(n)), 'an unknown label is kept as an answer and said so');
});

test('TLR-13: Portuguese labels work, and a bold intake-style label (*Nome:*) is read', () => {
  const s = parseBusinessSheet('*Nome:* Exemplo Lda\nTom: simpático\nHorário: seg a sáb 9h-19h\nServiços:\n- Item um | 20€\nPerguntas:\n- Aceitam cartão? | Sim.\nNunca:\n- dar descontos');
  assert.deepEqual(s.unread, []);
  assert.equal(s.statements['business.name'], 'Exemplo Lda');
  assert.deepEqual(s.statements['offer.items'], [{ name: 'Item um', price: 20, currency: 'EUR' }]);
  assert.deepEqual(s.statements['offer.availability'], { days: [1, 2, 3, 4, 5, 6] });
  assert.deepEqual(s.statements['rules.commitments'], ['dar descontos']);
});

test('TLR-13: lines it cannot read are listed with the line number and a reason, never guessed; missing facts are named', () => {
  const s = parseBusinessSheet('Name: Example Co\nsome loose words\nQuestions:\n- no answer here\nColours:\nServices:\n- Item | 10');
  assert.deepEqual(s.unread.map((u) => u.line), [2, 4, 5]);
  assert.match(s.unread[0]!.why, /not a "Label: value"/);
  assert.match(s.unread[1]!.why, /question as/);
  assert.match(s.unread[2]!.why, /not a list the sheet knows/);
  assert.deepEqual(s.missing, ['tone.style', 'rules.commitments', 'faq.entries']);
  assert.deepEqual(missingAsks(s.missing).map((a) => a.split(':')[0]), ['Tone', 'Never', 'Questions']);
});

test('TLR-13: opening days are set only when the hours line says them; otherwise availability is empty and the notes say it is not checked', () => {
  const s = parseBusinessSheet('Hours: by appointment');
  assert.deepEqual(s.statements['offer.availability'], {});
  assert.ok(s.notes.some((n) => /availability is not checked/.test(n)));
  assert.deepEqual(daysFromHours('every day 9-18'), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(daysFromHours('Tue, Thu and Sat'), [2, 4, 6]);
  assert.deepEqual(daysFromHours('sex a seg'), [5, 6, 0, 1]);
  assert.equal(daysFromHours('9-18'), null);
});

test('TLR-13: findPrice reads the amount, "from" and the currency, and leaves the rest of the words', () => {
  assert.deepEqual(findPrice('from 25 EUR per head'), { price: 25, priceFrom: true, currency: 'EUR', rest: 'per head' });
  assert.equal(findPrice('no number'), null);
  assert.equal(findPrice('$9.5')?.price, 9.5);
  assert.equal(findPrice('€7')?.currency, 'EUR');
});

test('TLR-13: a web form\'s message is read: bold labels, a list that starts on the label line, plain lines with colons, the title and "Filled in by" skipped', () => {
  const message = [
    '*Your business: answers*', 'Filled in by: Ana, Example Co', '',
    '*Name:* Example Co', '*Tone:* warm and short', '*Where:* 1 Example Street', '*Hours:* Tue to Sat 10-18',
    '*Services:* Item one | 25 EUR | 30 min', 'Item two: from 40 EUR', 'Item three - 12 EUR',
    '*Questions:* Do you take cards? | Yes.', 'Is there parking? | Behind the building.',
    '*Never:* give a discount', 'promise a time',
  ].join('\n');
  const s = parseBusinessSheet(message);
  assert.deepEqual(s.unread, []);
  assert.equal(s.statements['business.name'], 'Example Co');
  assert.deepEqual(s.statements['offer.items'], [
    { name: 'Item one', price: 25, currency: 'EUR', note: '30 min' },
    { name: 'Item two', price: 40, priceFrom: true, priceNote: 'starting price: always say "from 40", never just "40"', currency: 'EUR' },
    { name: 'Item three', price: 12, currency: 'EUR' },
  ]);
  assert.deepEqual(s.statements['rules.commitments'], ['give a discount', 'promise a time']);
  assert.deepEqual((s.statements['faq.entries'] as { q: string }[]).map((f) => f.q), ['Where is your office?', 'What are your opening hours?', 'Do you take cards?', 'Is there parking?']);
  assert.deepEqual(s.statements['offer.availability'], { days: [2, 3, 4, 5, 6] });
  assert.ok(!s.notes.some((n) => /Filled in by/i.test(n)));
});

// ADM-114: "up to 15 passengers" on a service line is that item's capacity.
import { capacityFrom } from '../src/business-sheet.ts';
test('ADM-114: the sheet reader reads the limit a service line states in words as the item\'s capacity, and keeps the words', () => {
  const read = parseBusinessSheet('Name: Sample Tours\nServices:\n- Private custom trip | 280 USD | per day, 9h service, up to 15 passengers, overtime 30 USD per hour\n- Walk | 25 EUR | até 8 pessoas\n- Tour | 40 EUR | 12 people max\n- Plain | 10 EUR | nothing stated\n');
  const items = read.statements['offer.items'] as { name: string; capacity?: number; note?: string }[];
  assert.equal(items[0]!.capacity, 15);
  assert.match(items[0]!.note ?? '', /up to 15 passengers/);
  assert.equal(items[1]!.capacity, 8);
  assert.equal(items[2]!.capacity, 12);
  assert.equal(items[3]!.capacity, undefined);
  assert.equal(capacityFrom('overtime 30 USD per hour'), undefined, 'a rate is not a capacity');
  assert.equal(capacityFrom('group of 15 customers'), undefined, 'a number near a word is not a limit unless it says so');
});
