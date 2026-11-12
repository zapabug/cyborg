import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ScriptedModel } from '@cyborg/core/testing';
import { extractWazaaChats } from '../src/wazaa-chats.ts';
import { moduleSources, renderProof, runProof } from '../src/harness.ts';

const WAZAA_TESTS = process.env['CYBORG_WAZAA_TESTS'] ?? join(homedir(), 'Projects', 'wazaa', 'test-business', 'docs', 'wazaa', 'tests');
const SALES_SRC = new URL('../../packages/module-sales/src', import.meta.url).pathname;
const haveWazaa = existsSync(WAZAA_TESTS);
// The tests that read a customer's real chats run only when that folder is found (set CYBORG_WAZAA_TESTS); the framework's own run does not need it.
const SKIP_WHY = 'wazaa tests folder not found (set CYBORG_WAZAA_TESTS to run it)';

test('MOD-7: wazaa chats are read from wazaa\'s tests at run time, commands skipped', { skip: haveWazaa ? false : SKIP_WHY }, () => {
  const chats = extractWazaaChats(WAZAA_TESTS);
  assert.ok(chats.length > 10);
  assert.ok(chats.includes('how much is the east tour'));
  assert.ok(chats.every((c) => !c.startsWith('.')));
  assert.ok(!chats.includes('HELP') && !chats.includes('STATUS'));
});

test('M7-EC6 (machine part): the same sales code runs over real wazaa chats with a wazaa config and records zero special cases', { skip: haveWazaa ? false : SKIP_WHY }, async () => {
  const messages = extractWazaaChats(WAZAA_TESTS).slice(0, 5);
  // The model's side is scripted: an empty extraction for every message. This checks the plumbing, not the model.
  const model = new ScriptedModel(messages.map(() => JSON.stringify({ items: [] })));
  const report = await runProof({
    model,
    sourceFiles: moduleSources(SALES_SRC),
    consumers: [{
      name: 'wazaa', messages, identifiers: ['wazaa', 'demo tours', 'madeira', 'tour', 'tours'],
      config: { enquiryFields: [{ name: 'tour', description: 'which tour the customer asks about' }, { name: 'date', description: 'the day they want' }] },
    }],
  });
  assert.deepEqual(report.specialCases, []);
  assert.equal(report.consumers[0]!.messages, 5);
  assert.equal(report.consumers[0]!.outcomes['none'], 5);
  assert.match(renderProof(report), /Special cases the module needed: 0/);
});

test('MOD-7: a business-specific word in the module source is recorded as a special case', async () => {
  const report = await runProof({
    model: new ScriptedModel([]),
    sourceFiles: [{ path: 'fake.ts', text: "const a = 1;\nif (consumer === 'madrltr') {}" }],
    consumers: [{ name: 'madrltr', messages: [], identifiers: ['madrltr'], config: { enquiryFields: [{ name: 'budget', description: 'what they can spend' }] } }],
  });
  assert.deepEqual(report.specialCases, [{ consumer: 'madrltr', where: 'module-source', detail: 'fake.ts:2 mentions "madrltr"' }]);
});

test('MOD-7: the real sales module source has no mention of either consumer', async () => {
  const report = await runProof({
    model: new ScriptedModel([]),
    sourceFiles: moduleSources(SALES_SRC),
    consumers: [
      { name: 'wazaa', messages: [], identifiers: ['wazaa', 'demo tours', 'madeira', 'tour', 'tours'], config: { enquiryFields: [{ name: 'tour', description: 'a tour' }] } },
      { name: 'madrltr', messages: [], identifiers: ['madrltr', 'buyer', 'property', 'mortgage'], config: { enquiryFields: [{ name: 'budget', description: 'a budget' }] } },
    ],
  });
  assert.deepEqual(report.specialCases, []);
});

import { scriptFromChats } from '../src/wazaa-chats.ts';
import { validateScript } from '@cyborg/company';

test('WZP-82: wazaa\'s scripted chats become a valid simulation script, one chat per line', { skip: haveWazaa ? false : SKIP_WHY }, () => {
  const chats = extractWazaaChats(WAZAA_TESTS);
  const script = scriptFromChats(chats, '2026-11-02T09:00:00.000Z');
  assert.equal(script.steps.length, chats.length);
  assert.ok(script.steps.length > 10);
  assert.deepEqual(validateScript(script).errors, []);
  assert.equal(new Set(script.steps.map((s) => s.chat)).size, chats.length, 'each line is its own chat');
});
