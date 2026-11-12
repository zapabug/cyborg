import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ScriptedModel } from '@cyborg/core/testing';
import { SqliteStore, SqliteVault } from '@cyborg/store-sqlite';
import { renderDryRun, runDryRun, validateCompanyModel, validateTasks, type CompanyModel } from '../src/dryrun.ts';

const STRICT = [{ baseUrl: 'test', model: 'm', level: 'strict_schema' as const, requestShape: 'json_schema_wrapped' as const, logprobs: false, testedAt: '2026-10-31T10:00:00.000Z', attempts: [] }];
const TEMPLATE = new URL('../../docs/dryrun/', import.meta.url);

// A model in the shape of docs/dryrun/company-model.template.json. The values are structural fixtures for the
// plumbing, not a claim about any business (HR-4).
const company = (over: Partial<CompanyModel['profile']> = {}): CompanyModel => ({
  enquiryFields: [{ name: 'item', description: 'what they ask about' }, { name: 'when', description: 'the day' }],
  profile: {
    'business.name': 'Test Desk',
    'tone.style': 'plain',
    'offer.items': [{ name: 'Alpha', price: 20, unit: 'per person', capacity: 10 }],
    'offer.availability': { days: [1, 3], closedDates: ['12-25'] },
    'rules.commitments': ['never confirm a booking'],
    'faq.entries': [{ q: 'where', a: 'Here.' }],
    ...over,
  },
});

test('the shipped templates cannot be run until they are filled in', () => {
  const model = JSON.parse(readFileSync(new URL('company-model.template.json', TEMPLATE), 'utf8')) as unknown;
  const check = validateCompanyModel(model);
  assert.ok(check.errors.length >= 6);
  assert.ok(check.errors.some((e) => /still has "<fill in"/.test(e)));
  assert.ok(validateTasks(JSON.parse(readFileSync(new URL('tasks.template.json', TEMPLATE), 'utf8'))).some((e) => /<fill in/.test(e)));
});

test('validateCompanyModel names every problem with the key and what shape is wanted', () => {
  assert.deepEqual(validateCompanyModel(company()).errors, []);
  const bad = validateCompanyModel({ enquiryFields: [], profile: { 'offer.items': [{ name: 'A', price: '20' }], 'offer.availability': { days: [1, 9] }, 'faq.entries': [{ q: 'x' }] } });
  for (const part of ['enquiryFields', 'business.name: missing', 'offer.items[0].price: a number', 'availability.days: weekday numbers 0 to 6', 'faq.entries']) {
    assert.ok(bad.errors.some((e) => e.includes(part)), part);
  }
  const noCap = validateCompanyModel(company({ 'offer.items': [{ name: 'A', price: 1 }] }));
  assert.ok(noCap.warnings.some((w) => /no capacity/.test(w)));
  assert.ok(validateCompanyModel(company()).warnings.some((w) => /sales\.criteria.*qualify is skipped/.test(w)));
});

test('a dry run shows where the bot fails each task, without sending anything', async () => {
  const store = new SqliteStore(':memory:');
  const vault = new SqliteVault(':memory:');
  const intake = (items: unknown[]) => JSON.stringify({ items });
  const reply = (draft: string) => JSON.stringify({ draft });
  const model = new ScriptedModel([
    // task 1: all good
    intake([{ field: 'item', value: 'Alpha', sourcePhrase: 'alpha' }]), reply('Alpha is €20 per person.'),
    // task 2: the reply states a price the model does not have
    intake([]), reply('Alpha is €25 per person.'),
    // task 3: the model answers badly twice for the intake, then a promise in the reply
    'not json', 'not json', reply('Your booking is confirmed.'),
    // task 4: expectations the draft misses
    intake([]), reply('A colleague will reply.'),
  ]);
  const report = await runDryRun({
    company: company(), model, store, vault, capabilities: STRICT,
    now: () => new Date('2026-10-31T10:00:00.000Z'),
    tasks: [
      { text: 'how much is alpha', expectFields: ['item'], mustInclude: ['€20'] },
      { text: 'price of alpha please' },
      { text: 'can I book alpha for monday' },
      { text: 'what time does it start', mustInclude: ['10:00'], mustNotInclude: ['colleague'] },
    ],
  });
  const t = report.tasks;
  assert.deepEqual(t[0]!.failures, []);
  assert.equal(t[0]!.reply.band, 'high');
  assert.deepEqual(t[1]!.failures.map((f) => f.split(':')[0]), ['draft_blocked']);
  assert.match(t[1]!.failures[0]!, /price 25 is not a price in offer\.items/);
  assert.deepEqual(t[2]!.failures.map((f) => f.split(':')[0]).sort(), ['draft_blocked', 'invalid_output']);
  assert.match(t[2]!.failures.join(' '), /commitment/);
  assert.deepEqual(t[3]!.failures.map((f) => f.split(':')[0]).sort(), ['expectation', 'expectation']);
  assert.equal(report.summary.withFailures, 3);
  assert.deepEqual(report.summary.byKind, { draft_blocked: 2, invalid_output: 1, expectation: 2 });
  const text = renderDryRun(report);
  assert.match(text, /3 of 4 tasks failed/);
  assert.match(text, /#2 "price of alpha please"  FAILED/);

  // Everything is in the database, so the digest can be built after the run.
  assert.equal(store.listEntries().length > 0, true);
  assert.equal(store.list({ handlerId: 'sales.enquiry.reply_draft' }).length, 4);
  assert.equal(store.getFact('business.name')!.status, 'unconfirmed', 'the drafted model is not confirmed; shadow mode accepts that');
});

test('a model with errors does not run and reports the errors instead of failing tasks', async () => {
  const report = await runDryRun({ company: { ...company(), profile: {} }, tasks: [{ text: 'x' }], model: new ScriptedModel([]), store: new SqliteStore(':memory:'), vault: new SqliteVault(':memory:'), capabilities: [] });
  assert.equal(report.tasks.length, 0);
  assert.ok(report.modelCheck.errors.length > 0);
  assert.match(renderDryRun(report), /cannot run yet/);
});
