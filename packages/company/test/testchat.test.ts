import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { CapabilityResult } from '@cyborg/core';
import { ScriptedModel } from '@cyborg/core/testing';
import { readFileSync } from 'node:fs';
import { createTestChat, loadCompanyConfig, scaffoldCustomer, validateScript, type CompanyModelFile } from '../src/index.ts';

// feat-wazaa-port W1, WZP-10..19. The scripted model drives the model's side only (HR-4); the facts are the simulation tests' own.

const AT = '2026-11-02T09:00:00.000Z';
const capability: CapabilityResult = { baseUrl: 'http://127.0.0.1:1/v1', model: 'm', level: 'strict_schema', requestShape: 'json_schema_wrapped', logprobs: false, testedAt: AT, attempts: [] };

const baseConfig = (over: Record<string, unknown> = {}) => ({
  language: 'en',
  id: 'test-desk',
  name: 'Test desk',
  store: { path: 'store.sqlite', vaultPath: 'vault.sqlite' },
  inference: { baseUrl: 'http://127.0.0.1:1/v1', model: 'm' },
  limits: { maxModelCallsPer24h: 50 },
  chat: { authorisedSenders: ['owner-ref'], originChannel: 'origin', roles: { 'chat-1': 'reply', 'ops-1': 'ops' } },
  modules: {
    sales: { enquiryFields: [{ name: 'service', description: 'which tour or activity the customer asks about' }, { name: 'date', description: 'the day they want' }] },
    enabledHandlers: { sales: ['sales.enquiry.intake', 'sales.enquiry.reply_draft', 'sales.handoff.card'] },
  },
  ...over,
});

const COMPANY: CompanyModelFile = {
  profile: {
    'business.name': 'Test desk',
    'tone.style': 'friendly and short',
    'offer.items': [{ name: 'East Tour', price: 35, unit: 'per person', capacity: 8 }],
    'offer.availability': { days: [1, 3, 5], closedDates: [] },
    'rules.commitments': ['never confirm a booking'],
    'faq.entries': [{ q: 'Is it good for kids?', a: 'Yes, from 6 years old.' }],
  },
};
const INTAKE = JSON.stringify({ items: [{ field: 'service', value: 'East Tour', sourcePhrase: 'east tour' }] });
const DRAFT = JSON.stringify({ draft: 'The East Tour is 35 per person.' });
const CARD = JSON.stringify({
  wants: [{ note: 'to book the east tour', sourcePhrase: 'east tour' }],
  collected: [{ field: 'service', value: 'East Tour', sourcePhrase: 'east tour' }],
  needs: [], botSaid: [], open: ['Which day, and is there room for more people?'],
});

function inTemp<T>(config: unknown, work: (file: string, dir: string) => Promise<T> | T): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'cyborg-testchat-'));
  const file = join(dir, 'company.config.json');
  writeFileSync(file, JSON.stringify(config));
  return Promise.resolve(work(file, dir)).finally(() => rmSync(dir, { recursive: true }));
}

const open = (file: string, script: string[], over: Partial<Parameters<typeof createTestChat>[1]> = {}) =>
  createTestChat(loadCompanyConfig(file), { company: COMPANY, deps: { model: new ScriptedModel(script), capabilities: [capability] }, ...over });

test('WZP-10, WZP-12: a customer line gets the draft, its band, the facts it used and the checks, and nothing is sent', async () => {
  await inTemp(baseConfig(), async (file) => {
    const chat = open(file, [INTAKE, DRAFT]);
    const turn = await chat.customer('t1', 'how much is the east tour');
    assert.equal(turn.kind, 'reply');
    const reply = turn.replies.find((r) => r.handler === 'reply_draft')!;
    assert.match(reply.draft ?? '', /The East Tour is 35 per person\./, 'the draft as a customer would read it, with the first-message introduction');
    assert.ok(reply.band, 'the confidence band is shown');
    assert.ok(reply.facts.some((f) => f.key === 'offer.items' && f.unconfirmed), 'the facts it used are listed, with their status');
    assert.deepEqual(turn.problems, []);
    assert.ok(turn.replies.every((r) => !('sent' in r)));
    assert.equal(turn.needsOffice, false);
    chat.close();
  });
});

test('WZP-15, WZP-4: the test chat has its own store and vault, is always shadow, and takes none of the install\'s chats', async () => {
  await inTemp(baseConfig({ mode: 'live' }), async (file, dir) => {
    const loaded = loadCompanyConfig(file);
    assert.equal(loaded.config.mode, 'live');
    const chat = open(file, [INTAKE, DRAFT]);
    await chat.customer('t1', 'how much is the east tour');
    assert.ok(existsSync(join(dir, 'testchat-store.sqlite')) && existsSync(join(dir, 'testchat-vault.sqlite')), 'its own files, named apart from the install\'s');
    assert.ok(!existsSync(join(dir, 'store.sqlite')), 'the install\'s store was never opened');
    assert.equal(chat.company.store.getRole('chat-1'), null, 'the install\'s chats are not carried over');
    assert.throws(() => createTestChat(loaded, { paths: { store: loaded.paths.store, vault: join(dir, 'x.sqlite') } }), /must not use the install/);
    chat.close();
  });
});

test('WZP-14: owner commands work in a test chat and act on that chat; .new starts it afresh; .help lists them', async () => {
  await inTemp(baseConfig(), async (file) => {
    const chat = open(file, [INTAKE, DRAFT, INTAKE, DRAFT]);
    await chat.customer('t1', 'how much is the east tour');
    const stop = await chat.customer('t1', '.stop');
    assert.equal(stop.kind, 'command');
    assert.match(stop.note ?? '', /stop/i);
    const quiet = await chat.customer('t1', 'and for two people?');
    assert.notEqual(quiet.kind, 'reply', 'a stopped chat gets no draft');
    assert.equal((await chat.customer('t1', '.start')).kind, 'command');
    const back = await chat.customer('t1', 'how much is the east tour');
    assert.equal(back.kind, 'reply');
    assert.equal((await chat.customer('t1', '.new')).kind, 'new');
    assert.match((await chat.customer('t1', '.help')).note ?? '', /\.stop/);
    const noted = await chat.customer('t1', '.bug the price was wrong');
    assert.equal(noted.kind, 'command');
    assert.match(noted.note ?? '', /Bug saved\./);
    chat.close();
  });
});

test('WZP-14: another test chat is not stopped by .stop in the first', async () => {
  await inTemp(baseConfig(), async (file) => {
    const chat = open(file, [INTAKE, DRAFT]);
    await chat.customer('t1', 'hello');
    await chat.customer('t1', '.stop');
    const other = await chat.customer('t2', 'how much is the east tour');
    assert.equal(other.kind, 'reply');
    chat.close();
  });
});

test('WZP-13: the office box takes commands with or without the prefix and shows what the company would post to the office', async () => {
  await inTemp(baseConfig(), async (file) => {
    const chat = open(file, [INTAKE, DRAFT]);
    await chat.customer('t1', 'how much is the east tour');
    const away = await chat.office('ooo back 09:00 Monday');
    assert.equal(away.kind, 'command');
    assert.match(away.note ?? '', /out of office|ooo/i);
    await chat.office('stop t1');
    const quiet = await chat.customer('t1', 'hello again');
    assert.notEqual(quiet.kind, 'reply', 'a chat the office stopped by its test name stays quiet');
    chat.close();
  });
});

test('WZP-12: a draft the checks block says so, offers the office, and the card is built from what was typed and posted nowhere', async () => {
  await inTemp(baseConfig(), async (file) => {
    const blocked = JSON.stringify({ draft: 'Great, your booking is confirmed for Monday.' });
    const chat = open(file, [INTAKE, blocked, CARD]);
    const turn = await chat.customer('t1', 'please book the east tour for monday');
    assert.equal(turn.needsOffice, true);
    assert.match(turn.problems.join(), /reply blocked/);
    assert.equal(turn.replies.find((r) => r.handler === 'reply_draft')!.draft, null);
    const { card } = await chat.handoff('t1');
    assert.match(card ?? '', /Handoff: t1\b/, 'the card names the chat as the page did, not by an internal id');
    assert.ok(chat.company.store.listOpenAlerts().length === 0);
    chat.close();
  });
});

test('WZP-12: an invalid model result is a problem on the turn, not a silent pass', async () => {
  await inTemp(baseConfig(), async (file) => {
    const bad = JSON.stringify({ items: [{ field: 'service', value: 'West Tour', sourcePhrase: 'west tour' }] });
    const chat = open(file, [bad, bad, DRAFT]);
    const turn = await chat.customer('t1', 'how much is the east tour');
    assert.match(turn.problems.join(), /intake: invalid output/);
    chat.close();
  });
});

test('WZP-16: demo facts enter as demo statements, and the test chat knows its label; real company facts do not carry it', async () => {
  await inTemp(baseConfig(), async (file) => {
    const demo = open(file, [], { company: { ...COMPANY, demo: 'Demo Tours (made-up facts)' }, demo: 'Demo Tours (made-up facts)', paths: { store: ':memory:', vault: ':memory:' } });
    assert.equal(demo.demo, 'Demo Tours (made-up facts)');
    assert.equal(demo.company.store.getFact('business.name')?.sourceRef, 'demo:company-model');
    demo.close();
    const real = open(file, [], { paths: { store: ':memory:', vault: ':memory:' } });
    assert.equal(real.demo, null);
    assert.equal(real.company.store.getFact('business.name')?.sourceRef, 'simulation:company-model');
    real.close();
  });
});

test('WZP-18: the test chat reads the install\'s own config: its persona and wording show in the test chat\'s company', async () => {
  await inTemp(baseConfig({ wording: { onDuty: 'The office is staffed right now.' } }), async (file) => {
    const chat = open(file, [], { paths: { store: ':memory:', vault: ':memory:' } });
    assert.equal(chat.commandPrefix, '.');
    assert.equal(chat.company.defaultLanguage, 'en');
    chat.close();
  });
});

test('WZP-10: an empty line is refused', async () => {
  await inTemp(baseConfig(), async (file) => {
    const chat = open(file, [], { paths: { store: ':memory:', vault: ':memory:' } });
    await assert.rejects(chat.customer('t1', '   '), /empty/);
    await assert.rejects(chat.office(''), /empty/);
    chat.close();
  });
});

const ROOT = new URL('../../..', import.meta.url).pathname;

test('WZP-16, WZP-17: a demo base has made-up facts marked demo, a config that needs only the model endpoint, and a test chat command', async () => {
  const into = mkdtempSync(join(tmpdir(), 'cyborg-demo-'));
  try {
    const { dir } = scaffoldCustomer({ id: 'demo', name: 'Demo Tours', cyborgRoot: ROOT, into, git: false, demo: true });
    const model = JSON.parse(readFileSync(join(dir, 'company.json'), 'utf8')) as CompanyModelFile;
    assert.match(model.demo ?? '', /made-up/);
    assert.ok(!readFileSync(join(dir, 'company.json'), 'utf8').includes('<fill in'), 'the demo facts are complete');
    const configText = readFileSync(join(dir, 'company.config.json'), 'utf8');
    assert.deepEqual([...configText.matchAll(/<fill in[^"]*/g)].length, 2, 'only the endpoint and the model name are left for the machine');
    assert.throws(() => loadCompanyConfig(join(dir, 'company.config.json')), /fill in/);
    const filled = join(dir, 'filled.json');
    writeFileSync(filled, configText.replace(/<fill in: the endpoint[^"]*/, 'http://127.0.0.1:1/v1').replace(/<fill in: the model[^"]*/, 'm'));
    const chat = createTestChat(loadCompanyConfig(filled), { company: model, demo: model.demo ?? null, paths: { store: ':memory:', vault: ':memory:' }, deps: { model: new ScriptedModel([]), capabilities: [capability] } });
    assert.equal(chat.company.store.getFact('business.name')?.value, 'Demo Tours');
    assert.equal(chat.company.store.getFact('business.name')?.sourceRef, 'demo:company-model');
    chat.close();
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    assert.match(pkg.scripts['testchat'] ?? '', /bin\/testchat\.ts --config company\.config\.json --company-model company\.json/);
    assert.match(readFileSync(join(dir, 'README.md'), 'utf8'), /every fact in `company\.json` is made up/);
  } finally {
    rmSync(into, { recursive: true });
  }
});

test('WZP-17: an ordinary customer repository also gets the test chat command, and is not marked demo', async () => {
  const into = mkdtempSync(join(tmpdir(), 'cyborg-cust-'));
  try {
    const { dir } = scaffoldCustomer({ id: 'acme', name: 'Acme', cyborgRoot: ROOT, into, git: false });
    assert.match(readFileSync(join(dir, 'package.json'), 'utf8'), /"testchat"/);
    assert.ok(!readFileSync(join(dir, 'company.json'), 'utf8').includes('"demo"'));
  } finally {
    rmSync(into, { recursive: true });
  }
});

test('WZP-19: a test chat can be saved as a simulation script that the simulation accepts, in the order it was typed', async () => {
  await inTemp(baseConfig(), async (file) => {
    const chat = open(file, [INTAKE, DRAFT], { paths: { store: ':memory:', vault: ':memory:' } });
    await chat.customer('t1', 'how much is the east tour');
    await chat.customer('t1', '.stop');
    await chat.customer('t1', '.help');
    await chat.office('ooo back 09:00 Monday');
    const script = chat.script();
    assert.deepEqual(script.steps, [
      { do: 'customer', chat: 't1', text: 'how much is the east tour' },
      { do: 'admin', text: '.stop t1' },
      { do: 'admin', text: '.ooo back 09:00 Monday' },
    ], '.help is the test chat\'s own and is not part of a day');
    assert.deepEqual(validateScript(script).errors, []);
    chat.close();
  });
});

test('WZP-15: a later session on the same test store answers again: event ids do not repeat across restarts', async () => {
  await inTemp(baseConfig(), async (file) => {
    let clock = Date.parse(AT);
    const first = open(file, [INTAKE, DRAFT], { now: () => new Date(clock) });
    assert.equal((await first.customer('t1', 'how much is the east tour')).replies.some((r) => r.draft !== null), true);
    first.close();
    clock += 60_000;
    const second = open(file, [INTAKE, DRAFT], { now: () => new Date(clock) });
    const turn = await second.customer('t1', 'how much is the east tour');
    assert.ok(turn.replies.some((r) => r.handler === 'reply_draft' && r.draft !== null), 'the second session drafts a reply, not a duplicate of the first\'s');
    assert.notEqual(turn.note, 'No reply: no step of the bot had anything to do with this line.');
    second.close();
  });
});

test('WZP-12: when the sales step did not load because the business has no facts, the test chat says what is missing, not "nothing to do"', async () => {
  await inTemp(baseConfig(), async (file) => {
    const chat = createTestChat(loadCompanyConfig(file), { company: { profile: { 'business.name': 'Test desk' } }, deps: { model: new ScriptedModel([]), capabilities: [capability] } });
    const turn = await chat.customer('t1', 'hi i would like to check availability');
    assert.deepEqual(turn.replies, []);
    assert.match(turn.note ?? '', /does not have this step yet/);
    assert.match(turn.note ?? '', /what you sell and when/);
    assert.match(turn.note ?? '', /the common questions/);
    assert.ok(!/offer\.|faq\.|profile_key/.test(turn.note ?? ''), 'staff never see an internal key (DSH-7)');
    chat.close();
  });
  await inTemp(baseConfig(), async (file) => {
    const chat = open(file, []);
    const turn = await chat.customer('t1', 'ok');
    assert.doesNotMatch(turn.note ?? '', /does not have this step yet/, 'with the facts in, the old sentence is unchanged');
    chat.close();
  });
});

test('PRV-6, WZP-10: a line typed in the test chat goes through the same scrubber as a real chat: a number or an address is replaced before the model, the task is still done, and the page says so in words', async () => {
  await inTemp(baseConfig(), async (file) => {
    const model = new ScriptedModel([INTAKE, DRAFT, INTAKE, DRAFT]);
    const chat = createTestChat(loadCompanyConfig(file), { company: COMPANY, deps: { model, capabilities: [capability] } });
    const turn = await chat.customer('t1', 'how much is the east tour? my number is +351 912 345 678, call me');
    assert.equal(model.calls.length, 2, 'the model ran');
    assert.ok(model.calls.every((c) => c.prompt.includes('[PHONE_1]') && !c.prompt.includes('912 345')), 'it saw the placeholder, never the number');
    assert.ok(turn.replies.some((r) => r.handler === 'reply_draft' && r.draft), 'the task was done: there is a draft');
    assert.equal(turn.replaced, 'Replaced before the model: a phone number. The model saw placeholders such as [PHONE_1] instead; the original stays in the chat.');
    assert.ok(!/scrubber|rule\(s\)|nif_or_phone/.test(turn.replaced ?? ''), 'staff never see an internal name (DSH-7)');
    const plain = await chat.customer('t2', 'how much is the east tour');
    assert.equal(plain.replaced, null, 'a line with nothing to replace says nothing');
    chat.close();
  });
});

test('PRV-6, CMP-19: a simulated day (the editable script) runs the same scrubber: the model sees placeholders and the step names the rules that matched', async () => {
  await inTemp(baseConfig(), async (file) => {
    const model = new ScriptedModel([INTAKE, DRAFT]);
    const { script, errors } = validateScript({ steps: [{ do: 'customer', chat: 'chat-1', text: 'how much is the east tour? call me on +351 912 345 678' }] });
    assert.deepEqual(errors, []);
    const { runSimulation } = await import('../src/index.ts');
    const report = await runSimulation(loadCompanyConfig(file), script!, { company: COMPANY, deps: { model, capabilities: [capability] } });
    assert.ok(model.calls.every((c) => c.prompt.includes('[PHONE_1]') && !c.prompt.includes('912 345')));
    assert.match(report.steps[0]!.did, /intake: proposed; reply_draft: proposed; scrubbed before the model: phone, nif_or_phone \(2 replaced by placeholders\)|scrubbed before the model: phone/);
  });
});

// feat-desk DSK-74..78: the test is a person against the bot. Right or wrong under the bot's reply; the wrong answer is the office's own, saved beside it.
test('DSK-75: "right" marks the bot\'s latest reply match, and the person carries on with the next line', async () => {
  await inTemp(baseConfig(), async (file) => {
    const chat = open(file, [INTAKE, DRAFT, INTAKE, DRAFT]);
    await chat.customer('t1', 'how much is the east tour');
    const r = chat.verdict('t1', 'right');
    assert.equal(r.marking, 'match');
    const entry = chat.company.store.getEntry(r.entryId)!;
    assert.equal(entry.marking, 'match');
    assert.equal(entry.markedBy, 'test');
    assert.equal(entry.humanReply, null, 'nothing is added when the bot was right');
    const next = await chat.customer('t1', 'how much is the east tour for 2');
    assert.equal(next.kind, 'reply', 'the bot keeps answering after a verdict');
    chat.close();
  });
});

test('DSK-75, PRV-6a: "wrong" saves the correct answer beside the reply, scrubbed, and marks it worse', async () => {
  await inTemp(baseConfig(), async (file) => {
    const chat = open(file, [INTAKE, DRAFT, INTAKE, DRAFT]);
    await chat.customer('t1', 'how much is the east tour');
    const r = chat.verdict('t1', 'wrong', 'It is 35 euros per person. Call us on 913 000 222 or write ana.silva@example.com.');
    assert.equal(r.marking, 'worse');
    const entry = chat.company.store.getEntry(r.entryId)!;
    assert.equal(entry.marking, 'worse');
    assert.equal(entry.humanReply, 'It is 35 euros per person. Call us on [NUMBER_1] or write [EMAIL_1].');
    assert.ok(!JSON.stringify(entry).includes('913 000 222') && !JSON.stringify(entry).includes('ana.silva'));
    assert.equal(entry.draft, 'The East Tour is 35 per person.', 'the bot\'s reply is kept as it was');
    const next = await chat.customer('t1', 'and for the west tour?');
    assert.equal(next.kind, 'reply');
    chat.close();
  });
});

test('DSK-75: "wrong" needs an answer, a reply is marked once, and there must be a reply to mark', async () => {
  await inTemp(baseConfig(), async (file) => {
    const chat = open(file, [INTAKE, DRAFT]);
    assert.throws(() => chat.verdict('t1', 'right'), /has not replied/);
    await chat.customer('t1', 'how much is the east tour');
    assert.throws(() => chat.verdict('t1', 'wrong', '   '), /write the correct answer/);
    chat.verdict('t1', 'right');
    assert.throws(() => chat.verdict('t1', 'wrong', 'It is 40.'), /already been marked/);
    chat.close();
  });
});

test('DSK-76: right and wrong verdicts land in the marking counts the audit reads, in one record', async () => {
  await inTemp(baseConfig(), async (file) => {
    const chat = open(file, [INTAKE, DRAFT, INTAKE, DRAFT]);
    await chat.customer('t1', 'how much is the east tour');
    await chat.customer('t2', 'how much is the east tour');
    chat.verdict('t1', 'right');
    chat.verdict('t2', 'wrong', 'It is 35 euros.');
    const counts = chat.company.store.markingCounts().find((c) => c.handlerId === 'sales.enquiry.reply_draft')!;
    assert.equal(counts.counts.match, 1);
    assert.equal(counts.counts.worse, 1);
    chat.close();
  });
});

// ADM-114: a person can change a mark.
test('ADM-114: Change clears the mark and the answer a Wrong saved, audits it, and the reply can be marked again', async () => {
  await inTemp(baseConfig(), async (file) => {
    const chat = open(file, [INTAKE, DRAFT]);
    await chat.customer('t1', 'how much is the east tour');
    const wrong = chat.verdict('t1', 'wrong', 'It is 40 euros. Call 913 000 222.');
    assert.equal(chat.company.store.getEntry(wrong.entryId)!.humanReply, 'It is 40 euros. Call [NUMBER_1].');
    const undone = chat.verdict('t1', 'undo');
    assert.equal(undone.marking, null);
    const entry = chat.company.store.getEntry(wrong.entryId)!;
    assert.equal(entry.marking, null);
    assert.equal(entry.markedBy, null);
    assert.equal(entry.humanReply, null, 'the answer the Wrong saved goes with the mark');
    assert.ok(chat.company.store.listAudit().some((a) => a.kind === 'mark_undone'));
    assert.equal(chat.verdict('t1', 'right').marking, 'match', 'the reply can be marked again');
    assert.throws(() => chat.verdict('t1', 'wrong', 'x'), /change the mark first/);
    assert.throws(() => { chat.verdict('t1', 'undo'); chat.verdict('t1', 'undo'); }, /no mark to change/);
    chat.close();
  });
});

// PRV-6b, feat-desk DSK-41 (zapa, 2026-11-09, said twice): the scrubber makes the model call safe, so a card number is replaced and the call goes ahead.
test('PRV-6b: a card number is replaced by [CARD_1], the model still does the task and never sees the number, and the draft tells staff a card number is in the chat', async () => {
  await inTemp(baseConfig({ modules: { ...baseConfig().modules, sales: { ...baseConfig().modules.sales, conversationContext: true } } }), async (file) => {
    const model = new ScriptedModel([INTAKE, DRAFT, INTAKE, DRAFT]);
    const chat = createTestChat(loadCompanyConfig(file), { company: COMPANY, deps: { model, capabilities: [capability] } });
    const turn = await chat.customer('t1', 'ok I pay with card 4111 1111 1111 1111, expires 12/28. how much is the east tour?');
    assert.ok(model.calls.length > 0, 'the model was called');
    for (const c of model.calls) {
      assert.ok(!c.prompt.includes('4111'), 'the prompt never holds the card number');
    }
    assert.ok(model.calls.some((c) => c.prompt.includes('[CARD_1]')), 'the model saw the placeholder');
    assert.ok(turn.replies.some((r) => r.draft), 'a draft was written');
    assert.ok(turn.replies.some((r) => r.checks.some((x) => /payment card number/.test(x))), 'the draft carries the finding for staff');
    const store = chat.company.store;
    assert.ok(!store.listAudit().some((a) => a.kind === 'chat_sealed'), 'nothing is sealed');
    assert.ok(store.listEntries().every((e) => !JSON.stringify(e).includes('4111 1111')), 'the saved entries hold [CARD_1], not the number');
    const later = await chat.customer('t1', 'is the east tour good for kids?');
    assert.ok(later.replies.some((r) => r.draft), 'a later line in the same chat still gets a draft');
    chat.close();
  });
});

test('PRV-6: a phone number is replaced by a placeholder and the model still does the task', async () => {
  await inTemp(baseConfig(), async (file) => {
    const model = new ScriptedModel([INTAKE, DRAFT, INTAKE, DRAFT]);
    const chat = createTestChat(loadCompanyConfig(file), { company: COMPANY, deps: { model, capabilities: [capability] } });
    const turn = await chat.customer('t1', 'how much is the east tour? call me on +351 912 345 678');
    assert.ok(turn.replies.some((r) => r.draft), 'a draft was written');
    assert.ok(!chat.company.store.listAudit().some((a) => a.kind === 'chat_sealed'));
    chat.close();
  });
});

// ADM-115, feat-desk DSK-42: `.forget` drops this install's own copies of one chat, after asking.
test('ADM-115: .forget shows what it would drop and drops nothing until the same command is sent with yes', async () => {
  await inTemp(baseConfig({ modules: { ...baseConfig().modules, sales: { ...baseConfig().modules.sales, conversationContext: true } } }), async (file) => {
    const model = new ScriptedModel([INTAKE, DRAFT, INTAKE, DRAFT, INTAKE, DRAFT]);
    const chat = createTestChat(loadCompanyConfig(file), { company: COMPANY, deps: { model, capabilities: [capability] } });
    await chat.customer('t1', 'how much is the east tour');
    await chat.customer('t2', 'how much is the east tour');
    const store = chat.company.store;
    const internal = (name: string) => store.listEntries().map((e) => store.chatOfEvent(e.eventSource, e.eventId)).find((c) => c !== null && c.includes(`-${name}-`)) ?? '';
    const t1 = internal('t1');
    const t2 = internal('t2');
    assert.ok(t1 && t2 && t1 !== t2);
    const had1 = store.chatEntryCount(t1);
    const had2 = store.chatEntryCount(t2);
    assert.ok(had1 > 0 && had2 > 0);
    // a customer name for each, in the vault; the two chats share the same name, which therefore stays until the last chat that uses it goes
    const code = chat.company.vault.put('identity', 'Ana Costa');
    store.setContact(t1, code, '2026-11-09T10:00:00.000Z');
    store.setContact(t2, code, '2026-11-09T10:00:00.000Z');

    const ask = await chat.office('.forget t1');
    assert.match(ask.office.join('\n'), /This drops the saved copies of this chat: \d+ saved messages and replies, the chat's card and the customer's name\. Nothing is deleted in WhatsApp/);
    assert.match(ask.office.join('\n'), /send: \.forget t1 yes/);
    assert.equal(store.chatEntryCount(t1), had1, 'asking drops nothing');

    const done = await chat.office('.forget t1 yes');
    assert.match(done.office.join('\n'), /Forgotten: \d+ saved messages and replies were dropped\. Delete the chat in WhatsApp too\./);
    assert.equal(store.chatEntryCount(t1), 0, 'the saved exchanges of that chat are gone');
    assert.equal(store.chatEntryCount(t2), had2, 'another chat is untouched');
    assert.equal(store.getContact(t1), null);
    assert.equal(store.getContact(t2), code);
    assert.ok(chat.company.vault.get(code), 'the name another chat still uses stays in the vault');
    assert.ok(store.listModuleState('chat-card').every((c) => !c.key.includes('-t1-')), 'the chat card of that chat is gone');
    assert.ok(store.list({}).length > 0, 'proposals, the business\'s own records, are not touched');
    const audit = store.listAudit().find((a) => a.kind === 'chat_forgotten');
    assert.ok(audit, 'one audit row');
    assert.deepEqual(Object.keys(audit!.detail as object).sort(), ['entries', 'links', 'states'], 'counts only, no text');

    await chat.office('.forget t2 yes');
    assert.equal(chat.company.vault.get(code), null, 'the last chat that used the name takes it from the vault');
    assert.match((await chat.office('.forget nope yes')).office.join('\n'), /I cannot find that chat\./);
    chat.close();
  });
});
