import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addDays, computeQuote, conversationFacts, parseDate, parsePartySize, resolveService, step, weekdayOf, type BookingsConfig, type FlowContext, type ServiceItem } from '../src/index.ts';

// feat-wazaa-port W6, WZP-50..55: the funnel's code. Today is a Thursday; the tours and settings are structural test inputs, with wazaa's config values
// (a 14-day look-ahead, last minute is today or tomorrow, up to 200 people) as the starting numbers.

const TODAY = '2026-11-05';
const CONFIG: BookingsConfig = {
  confirmWords: ['yes', 'sim', 'ok', 'confirm', 'go ahead'], cancelWords: ['cancel', 'cancelar', 'never mind'],
  lastMinuteDays: 1, lastMinuteNote: 'It is last minute: any tour can be tried but it needs manager approval and may not happen.', alternativeDaysAhead: 14, maxGroup: 200, currency: 'EUR',
};
const ITEMS: ServiceItem[] = [
  { name: 'East Tour', price: 45, capacity: 8, days: [2, 4], keywords: ['east', 'leste'] },
  { name: 'Coast Walk', price: 40, capacity: 6, minGroup: 2, keywords: ['coast'] },
  { name: 'Private Day', capacity: 4 },
];
const ctx = (taken: Record<string, number> = {}, over: Partial<FlowContext> = {}): FlowContext => ({
  items: ITEMS, availability: { days: [2, 4, 6], closedDates: ['12-25'] }, today: TODAY, taken: (tour, date) => taken[`${tour}|${date}`] ?? 0, config: CONFIG, ...over,
});

test('WZP-51: the code reads dates itself: ISO, day/month, today and tomorrow in six languages, weekday names; a past date is never returned', () => {
  assert.equal(weekdayOf(TODAY), 4, 'the test\'s today is a Thursday');
  assert.equal(parseDate('tomorrow please', TODAY), '2026-11-06');
  assert.equal(parseDate('amanhã de manhã', TODAY), '2026-11-06');
  assert.equal(parseDate('hoje', TODAY), TODAY);
  assert.equal(parseDate('morgen', TODAY), '2026-11-06');
  assert.equal(parseDate('demain', TODAY), '2026-11-06');
  assert.equal(parseDate('mañana', TODAY), '2026-11-06');
  assert.equal(parseDate('on thursday', TODAY), '2026-11-12', 'a weekday name is the next such day after today');
  assert.equal(parseDate('domingo', TODAY), '2026-11-08');
  assert.equal(parseDate('2026-12-01', TODAY), '2026-12-01');
  assert.equal(parseDate('12/12', TODAY), '2026-12-12');
  assert.equal(parseDate('1/11', TODAY), '2027-11-01', 'a day already past this year is next year\'s');
  assert.equal(parseDate('3/3/2025', TODAY), null, 'a date before today is refused');
  assert.equal(parseDate('2026-10-01', TODAY), null);
  assert.equal(parseDate('2026-02-31', TODAY), null, 'not a real day');
  assert.equal(parseDate('how much is it?', TODAY), null);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('WZP-51: the group size is read from "4 people", "for 4", "somos 4"; the tour from its name or its keywords', () => {
  assert.equal(parsePartySize('we are 4 people'), 4);
  assert.equal(parsePartySize('for 6 on friday'), 6);
  assert.equal(parsePartySize('somos 3'), 3);
  assert.equal(parsePartySize('2 pessoas'), 2);
  assert.equal(parsePartySize('how much is it'), null);
  assert.equal(resolveService('the leste one', ITEMS)?.name, 'East Tour');
  assert.equal(resolveService('coast walk', ITEMS)?.name, 'Coast Walk');
  assert.equal(resolveService('helicopter tours?', ITEMS), null, 'a tour that is not in the offer is not made up');
});

test('WZP-51: the quote is computed from the profile: totals, running days, closed dates, capacity, the smallest and largest group, with open days to offer', () => {
  const q = (fields: Parameters<typeof computeQuote>[0], c = ctx()) => computeQuote(fields, c);
  const busy = ctx({ 'East Tour|2026-11-12': 6 });
  assert.deepEqual(q({}), { kind: 'need', missing: ['service', 'party_size', 'date'] });
  assert.deepEqual(q({ service: 'East Tour', date: '2026-11-12' }), { kind: 'need', missing: ['party_size'] });
  assert.deepEqual(q({ service: 'East Tour', partySize: 4, date: '2026-11-12' }), { kind: 'ok', service: 'East Tour', partySize: 4, date: '2026-11-12', perPerson: 45, total: 180, lastMinute: false });
  const wrongDay = q({ service: 'East Tour', partySize: 4, date: '2026-11-06' });
  assert.deepEqual([wrongDay.kind === 'refused' && wrongDay.reason, wrongDay.kind === 'refused' && wrongDay.alternatives], ['not_running', ['2026-11-10', '2026-11-12', '2026-11-17']]);
  assert.equal((q({ service: 'Coast Walk', partySize: 3, date: '2026-12-25' }) as { reason: string }).reason, 'closed');
  assert.equal((q({ service: 'East Tour', partySize: 3, date: '2026-10-01' }) as { reason: string }).reason, 'past');
  assert.equal((q({ service: 'Coast Walk', partySize: 1, date: '2026-11-07' }) as { reason: string; detail: number }).detail, 2, 'a tour that runs for at least 2');
  assert.deepEqual([(q({ service: 'East Tour', partySize: 201, date: '2026-11-12' }) as { reason: string }).reason, (q({ service: 'Private Day', partySize: 2, date: '2026-11-07' }) as { reason: string }).reason], ['over_max', 'no_price']);
  const full = q({ service: 'East Tour', partySize: 4, date: '2026-11-12' }, busy);
  assert.deepEqual([full.kind === 'refused' && full.reason, full.kind === 'refused' && full.alternatives], ['full', ['2026-11-10', '2026-11-17', '2026-11-19']], 'the full day is not offered; the three nearest open days are');
  const everyday = ctx({}, { availability: { days: [0, 1, 2, 3, 4, 5, 6], closedDates: [] } });
  const lastMinute = q({ service: 'Coast Walk', partySize: 2, date: '2026-11-06' }, everyday);
  assert.equal(lastMinute.kind === 'ok' && lastMinute.lastMinute, true, 'tomorrow is last minute at 1 day');
  assert.equal((q({ service: 'Coast Walk', partySize: 2, date: '2026-11-07' }, everyday) as { lastMinute: boolean }).lastMinute, false);
});

test('WZP-52, WZP-53: a booking goes collecting, confirming, requested; only an explicit yes word to a shown quote, with nothing changed, makes a request', () => {
  const c = ctx();
  const t1 = step(null, {}, 'how much is the east tour', c);
  assert.deepEqual([t1.state, t1.quote, t1.request], [{ stage: 'collecting', service: 'East Tour' }, { kind: 'need', missing: ['party_size', 'date'] }, false]);
  const t2 = step(t1.state, {}, 'we are 4 people on thursday', c);
  assert.equal(t2.state?.stage, 'confirming');
  assert.deepEqual(t2.quote?.kind === 'ok' && [t2.quote.total, t2.quote.date], [180, '2026-11-12']);
  assert.equal(t2.request, false, 'seeing a quote is not agreeing to it');
  const changed = step(t2.state, {}, 'yes but make it 5 people', c);
  assert.deepEqual([changed.request, changed.quote?.kind === 'ok' && changed.quote.total], [false, 225], 'a changed group is a new quote, not a yes');
  const maybe = step(t2.state, {}, 'hmm let me think', c);
  assert.deepEqual([maybe.request, maybe.state?.stage], [false, 'confirming']);
  const yes = step(t2.state, {}, 'yes please', c);
  assert.deepEqual([yes.request, yes.state?.stage], [true, 'requested']);
  const thanks = step(yes.state, {}, 'thank you', c);
  assert.deepEqual([thanks.request, thanks.state], [false, yes.state], 'a sent request stays as it is');
  const fresh = step(yes.state, {}, 'and the coast walk for 2 on saturday', c);
  assert.equal(fresh.state?.stage, 'confirming', 'naming something new starts a new booking');
  assert.equal(fresh.state?.service, 'Coast Walk');
  assert.equal(fresh.state?.ref, undefined);
  const cancelled = step(t2.state, {}, 'cancel that', c);
  assert.deepEqual([cancelled.state, cancelled.cancelled], [null, true]);
  const collecting = step(null, {}, 'east tour', c).state;
  assert.equal(step(collecting, {}, 'no pets allowed?', c).cancelled, false, 'a cancel word inside a question before the quote is a question');
  assert.equal(step(collecting, {}, ' Cancel ', c).cancelled, true, 'the whole message being a cancel word clears it');
  assert.equal(step(yes.state, {}, 'cancel', c).cancelled, false, 'a request that was sent is the office\'s to cancel');
  assert.equal(step(null, {}, 'yes', c).request, false, 'a yes with no booking is just a word');
  assert.equal(step(t1.state, {}, 'yes', c).request, false, 'a yes before a quote is not a request');
});

test('WZP-51: what the model read helps only where the code found nothing, and is re-checked: a tour not in the offer, a group out of range or a past date is not taken', () => {
  const c = ctx();
  const viaModel = step(null, { service: 'the coast one', partySize: 3, date: '2026-11-14' }, 'sounds lovely', c);
  assert.deepEqual([viaModel.state?.service, viaModel.state?.partySize, viaModel.state?.date], ['Coast Walk', 3, '2026-11-14']);
  assert.equal(step(null, { service: 'helicopter' }, 'hi', c).state, null, 'a tour that does not exist starts nothing');
  assert.equal(step(null, { service: 'East Tour', partySize: 0 }, 'hi', c).state?.partySize, undefined);
  assert.equal(step(null, { service: 'East Tour', partySize: 2.5 }, 'hi', c).state?.partySize, undefined);
  assert.equal(step(null, { service: 'East Tour', date: '2020-01-01' }, 'hi', c).state?.date, undefined, 'the model\'s past date is dropped');
  const codeWins = step(null, { service: 'East Tour', date: '2026-11-17' }, 'thursday', c);
  assert.equal(codeWins.state?.date, '2026-11-12', 'the code\'s reading of "thursday" wins over the model\'s date');
});

test('WZP-51, WZP-55: the writer is given the computed facts, per-person only with the total, last minute said honestly, no availability claim, and nothing when no booking is running', () => {
  const c = ctx();
  const q = step(step(null, {}, 'east tour', c).state, {}, '4 people thursday', c);
  const facts = conversationFacts(q, c);
  assert.match(facts, /- Service: East Tour/);
  assert.match(facts, /- Date: 2026-11-12 \(Thursday\)/);
  assert.match(facts, /Total for the group: 180 EUR \(45 EUR per person × 4\)\. Give the per-person price only together with this total\./);
  assert.match(facts, /never say it is booked, confirmed, reserved or available/);
  const need = conversationFacts(step(null, {}, 'east tour', c), c);
  assert.match(need, /ask the customer how many people \(give no price until you know\), then which day/);
  assert.ok(!/ EUR/.test(need), 'no price before the group size is known');
  const open = ctx({}, { availability: { days: [0, 1, 2, 3, 4, 5, 6], closedDates: [] } });
  const late = conversationFacts(step(null, { service: 'coast', partySize: 2 }, 'tomorrow', open), open);
  assert.match(late, /Last minute: It is last minute/);
  const refused = conversationFacts(step(null, {}, 'east tour 4 people tomorrow', c), c);
  assert.match(refused, /East Tour does not run on that weekday/);
  assert.match(refused, /2026-11-10 \(Tuesday\), 2026-11-12 \(Thursday\), 2026-11-17 \(Tuesday\)/);
  const sent = conversationFacts(step(q.state, {}, 'yes', c), c, 'B-000007');
  assert.match(sent, /Request B-000007 was sent to the team for review\./);
  assert.match(sent, /Never say the trip is booked/);
  assert.equal(conversationFacts({ state: null, quote: null, request: false, cancelled: false }, c), '');
  assert.match(conversationFacts({ state: null, quote: null, request: false, cancelled: true }, c), /Nothing was sent to the team/);
});
