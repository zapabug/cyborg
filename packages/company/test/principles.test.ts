// feat-desk DK2 / DSK-7..12, TLR-55: the company's principles, from the sheet to the writer and to the check on the draft. The scripted model drives the
// model's side only (HR-4).
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ScriptedModel } from '@cyborg/core/testing';
import type { CapabilityResult } from '@cyborg/core';
import { PRINCIPLE_CHECKS, principleFailures } from '@cyborg/module-sales';
import { createTestChat, loadCompanyConfig, parseBusinessSheet, type CompanyModelFile } from '../src/index.ts';

const SHEET = `Name: Sample Tours
Tone: friendly and outgoing
Hours: Mon-Sat
Services:
- Private custom trip | 280 USD | per day, up to 15 passengers
Principles:
- Always guide the customer to give us the dates, the party size and what they like | check: ends-with-a-question
- [qualify] Ask one thing at a time | check: one-question-only
- [offer] Say the day rate before anything else
- Never rush the customer | check: no-pressure-words
Never:
- give a discount
`;

test('TLR-55: the Principles list is read with its stages and checks, numbered, and kept as a fact', () => {
  const read = parseBusinessSheet(SHEET);
  assert.deepEqual(read.statements['rules.principles'], [
    { id: 'P1', text: 'Always guide the customer to give us the dates, the party size and what they like', check: 'ends-with-a-question' },
    { id: 'P2', text: 'Ask one thing at a time', stage: 'qualify', check: 'one-question-only' },
    { id: 'P3', text: 'Say the day rate before anything else', stage: 'offer' },
    { id: 'P4', text: 'Never rush the customer', check: 'no-pressure-words' },
  ]);
  assert.ok(read.notes.some((n) => /4 principles, 3 held in code/.test(n)));
  assert.deepEqual(read.unread, []);
});

test('TLR-55: a stage or a check the framework does not offer is listed as unread, with the names that are offered, and nothing is guessed', () => {
  const read = parseBusinessSheet('Principles:\n- [closing] Say thanks\n- Be nice | check: is-nice\n- [qualify] \n- Be brief | check: one-question-only\n');
  assert.equal((read.statements['rules.principles'] as unknown[]).length, 1);
  assert.equal(read.unread.length, 3);
  assert.match(read.unread[0]!.why, /"closing" is not a stage \(greet, qualify, offer, close, handoff\)/);
  assert.match(read.unread[1]!.why, /"is-nice" is not a check the framework offers \(ends-with-a-question, one-question-only, no-pressure-words\)/);
});

test('DSK-9: each check says why a reply breaks it, and passes a reply that keeps it', () => {
  const t = (name: string, draft: string) => PRINCIPLE_CHECKS[name]!.test(draft);
  assert.equal(t('ends-with-a-question', 'Which days would you like?'), null);
  assert.equal(t('ends-with-a-question', 'Which days would you like? 😊'), null, 'an emoji after the question mark is fine');
  assert.match(t('ends-with-a-question', 'It is 280 USD per day.')!, /does not end with a question/);
  assert.match(t('ends-with-a-question', 'Which days? We are open Monday to Saturday.')!, /does not end/);
  assert.equal(t('one-question-only', 'How many people?'), null);
  assert.match(t('one-question-only', 'How many people? And which day?')!, /more than one question/);
  assert.match(t('no-pressure-words', 'Hurry, only 3 left!')!, /presses/);
  assert.equal(t('no-pressure-words', 'Take your time.'), null);
});

const AT = '2026-11-09T10:00:00.000Z';
const capability: CapabilityResult = { baseUrl: 'http://127.0.0.1:1/v1', model: 'm', level: 'strict_schema', requestShape: 'json_schema_wrapped', logprobs: false, testedAt: AT, attempts: [] };
const FIELDS = [{ name: 'when', description: 'when they want it' }, { name: 'how_many', description: 'how many people' }];
const sheet = parseBusinessSheet(SHEET);
const COMPANY: CompanyModelFile = { profile: { ...(sheet.statements as Record<string, unknown>), 'faq.entries': [{ q: 'Which days?', a: 'Monday to Saturday.' }] } as CompanyModelFile['profile'] };
const config = (principles: boolean) => ({
  language: 'en', id: 'mad', name: 'Sample Tours',
  store: { path: 'store.sqlite', vaultPath: 'vault.sqlite' },
  inference: { baseUrl: 'http://127.0.0.1:1/v1', model: 'm' },
  limits: { maxModelCallsPer24h: 50 },
  chat: { authorisedSenders: ['owner-ref'], originChannel: 'origin', roles: {} },
  modules: { sales: { enquiryFields: FIELDS, conversationContext: true, ...(principles ? { principles: true } : {}) }, enabledHandlers: { sales: ['sales.enquiry.intake', 'sales.enquiry.reply_draft'] } },
});
const draft = (text: string) => JSON.stringify({ draft: text });
const items = (...i: { field: string; value: string; sourcePhrase: string }[]) => JSON.stringify({ items: i });

function inTemp<T>(cfg: unknown, work: (file: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'cyborg-principles-'));
  const file = join(dir, 'company.config.json');
  writeFileSync(file, JSON.stringify(cfg));
  return work(file).finally(() => rmSync(dir, { recursive: true }));
}

test('DSK-8, DSK-80: the writer is given the principles of the stage the code set, and those that apply to every stage', async () => {
  await inTemp(config(true), async (file) => {
    const model = new ScriptedModel([
      items(), draft('Hello! Which days would you like?'),
      items({ field: 'how_many', value: '6 people', sourcePhrase: 'we are 6' }), draft('Lovely! Which days would you like?'),
      items({ field: 'when', value: 'the 12th', sourcePhrase: 'the 12th' }), draft('Noted. Anything else you would like to do?'),
    ]);
    const chat = createTestChat(loadCompanyConfig(file), { company: COMPANY, deps: { model, capabilities: [capability] } });
    await chat.customer('t1', 'hello');
    await chat.customer('t1', 'we are 6 people');
    await chat.customer('t1', 'on the 12th please');
    const prompts = model.calls.map((c) => c.prompt).filter((p) => /How this business works/.test(p));
    assert.equal(prompts.length, 3);
    // first line of the chat: greet. P2 is [qualify] and P3 is [offer]; only the unstaged ones apply
    assert.match(prompts[0]!, /P1\. Always guide the customer/);
    assert.match(prompts[0]!, /P4\. Never rush the customer/);
    assert.doesNotMatch(prompts[0]!, /P2\.|P3\./);
    // second line: fields still missing (when): qualify
    assert.match(prompts[1]!, /P2\. Ask one thing at a time/);
    assert.doesNotMatch(prompts[1]!, /P3\./);
    // third line: both fields told after the second message... the card has how_many only until this line is read, so qualify still
    assert.match(prompts[2]!, /P1\. /);
    chat.close();
  });
});

test('DSK-9: a checkable principle that the draft breaks blocks it like any failed check, naming the principle', async () => {
  await inTemp(config(true), async (file) => {
    const model = new ScriptedModel([items(), draft('We are open Monday to Saturday. Hurry, it is selling fast.')]);
    const chat = createTestChat(loadCompanyConfig(file), { company: COMPANY, deps: { model, capabilities: [capability] } });
    const turn = await chat.customer('t1', 'which days do you work?');
    assert.equal(turn.needsOffice, true, 'no draft is offered');
    const said = turn.problems.join('|');
    assert.match(said, /principle P1 is broken .*does not end with a question/);
    assert.match(said, /principle P4 is broken .*presses the customer/);
    chat.close();
  });
});

test('DSK-9: a reply that keeps the principles passes; a principle for another stage is not held against it', () => {
  const facts = { profile: [{ key: 'rules.principles', value: sheet.statements['rules.principles'], class: 'public', status: 'confirmed' }], pack: [] } as never;
  assert.deepEqual(principleFailures('Which days would you like?', facts, 'greet'), []);
  // P2 (one question only) is a qualify principle: two questions at the greet stage are not held against the reply by P2, but P1 still wants it to end with one
  assert.deepEqual(principleFailures('Hello? Which days would you like?', facts, 'greet'), []);
  assert.match(principleFailures('Hello? Which days would you like?', facts, 'qualify').join('|'), /P2 is broken/);
});

test('a business with no principles gets the prompt it had: no principles block', async () => {
  await inTemp(config(false), async (file) => {
    const model = new ScriptedModel([items(), draft('Which days would you like?')]);
    const chat = createTestChat(loadCompanyConfig(file), { company: COMPANY, deps: { model, capabilities: [capability] } });
    await chat.customer('t1', 'hello');
    assert.ok(model.calls.every((c) => !/How this business works/.test(c.prompt)));
    chat.close();
  });
});
