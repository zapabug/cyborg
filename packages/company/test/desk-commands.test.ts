import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { CapabilityResult } from '@cyborg/core';
import { ScriptedModel } from '@cyborg/core/testing';
import { createTestChat, listNotes, loadCompanyConfig, openQuestions, type CompanyModelFile } from '../src/index.ts';

// feat-wazaa-port W5, WZP-48: wazaa's save, bug, idea, status and the office's ANSWER and LEARN, in both languages, for the real gate's chats.

const AT = '2026-11-02T09:00:00.000Z';
const capability: CapabilityResult = { baseUrl: 'http://127.0.0.1:1/v1', model: 'm', level: 'strict_schema', requestShape: 'json_schema_wrapped', logprobs: false, testedAt: AT, attempts: [] };
const FACTS: CompanyModelFile = {
  profile: {
    'business.name': 'Test desk', 'tone.style': 'friendly and short', 'offer.items': [{ name: 'East Tour', price: 35, unit: 'per person', capacity: 8 }],
    'offer.availability': { days: [1, 3, 5], closedDates: [] }, 'rules.commitments': ['never confirm a booking'], 'faq.entries': [{ q: 'Is it good for kids?', a: 'Yes, from 6 years old.' }],
  },
};
const EMPTY = JSON.stringify({ items: [] });
const DRAFT = JSON.stringify({ draft: 'A colleague will follow up.' });
const CARD = JSON.stringify({ wants: [{ note: 'to book the east tour', sourcePhrase: 'east tour' }], collected: [], needs: [], botSaid: [], open: ['Which day, and is there room for more people?'] });

async function withChat<T>(script: string[], work: (chat: ReturnType<typeof createTestChat>) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'cyborg-cmd-'));
  const file = join(dir, 'c.json');
  writeFileSync(file, JSON.stringify({
    id: 'cmd', name: 'Cmd', language: 'en', store: { path: 's.sqlite', vaultPath: 'v.sqlite' }, inference: { baseUrl: 'http://127.0.0.1:1/v1', model: 'm' },
    chat: { authorisedSenders: ['owner-ref'], originChannel: 'origin', roles: {} },
    modules: { sales: { enquiryFields: [{ name: 'service', description: 'which tour' }] }, enabledHandlers: { sales: ['sales.enquiry.intake', 'sales.enquiry.reply_draft', 'sales.handoff.card'] } },
  }));
  const chat = createTestChat(loadCompanyConfig(file), { company: FACTS, paths: { store: ':memory:', vault: ':memory:' }, deps: { model: new ScriptedModel(script), capabilities: [capability] } });
  try {
    return await work(chat);
  } finally {
    chat.close();
    rmSync(dir, { recursive: true });
  }
}

test('WZP-44, WZP-48: save, bug and idea keep a note from a chat and say so; no note, no save', async () => {
  await withChat([], async (chat) => {
    assert.match((await chat.customer('t1', '.save look at the pick-up wording')).note ?? '', /Note saved\./);
    assert.match((await chat.customer('t1', '.bug price wrong for 4')).note ?? '', /Bug saved\./);
    assert.match((await chat.customer('t1', '.idea ask the hotel name')).note ?? '', /Idea saved\./);
    assert.match((await chat.customer('t1', '.save')).note ?? '', /Write the note after \.save/);
    assert.deepEqual(listNotes(chat.company).map((n) => [n.kind, n.note]), [['idea', 'ask the hotel name'], ['bug', 'price wrong for 4'], ['save', 'look at the pick-up wording']]);
  });
});

test('WZP-45, WZP-48: questions lists what waits, answer settles it as the office\'s reply, learn also keeps it in the FAQ as unconfirmed; a number that is not open is refused', async () => {
  await withChat([EMPTY, DRAFT, CARD, EMPTY, DRAFT, CARD], async (chat) => {
    assert.match((await chat.office('questions')).note ?? '', /No question is waiting\./);
    await chat.customer('t1', 'how much is the east tour');
    assert.ok((await chat.handoff('t1')).card);
    assert.match((await chat.office('status')).note ?? '', /Questions waiting: 1 /);
    assert.match((await chat.office('questions')).note ?? '', /^1\. customer with no name: Which day, and is there room for more people\?/);
    assert.match((await chat.office('answer 9 nope')).note ?? '', /answered or does not exist/);
    assert.match((await chat.office('answer')).note ?? '', /Use: \.answer <question number> <text>/);
    assert.match((await chat.office('answer 1 It is 35 per person; Thursday has room.')).note ?? '', /^Answered\.$/);
    assert.equal(openQuestions(chat.company).length, 0, 'a person answering settles it');
    await chat.customer('t2', 'how much is the east tour');
    assert.ok((await chat.handoff('t2')).card);
    const learned = await chat.office('learn 1 Yes, children from 8 can come.');
    assert.match(learned.note ?? '', /Answered and kept in the FAQ \(to be confirmed\)\./);
    const faq = chat.company.store.getFact('faq.entries')!.value as { q: string; a: string }[];
    assert.deepEqual(faq.at(-1), { q: 'Which day, and is there room for more people?', a: 'Yes, children from 8 can come.' });
    assert.equal(chat.company.store.getFact('faq.entries')!.status, 'unconfirmed');
  });
});

test('WZP-48: the commands answer in the staff language, with the Portuguese words wazaa used', async () => {
  await withChat([], async (chat) => {
    await chat.office('lang pt');
    assert.match((await chat.office('ajuda')).note ?? '', /perguntas, \.responder <n> <texto>, \.aprender/);
    assert.match((await chat.customer('t1', '.guardar rever o texto')).note ?? '', /Nota guardada\./);
    assert.match((await chat.customer('t1', '.erro preço errado')).note ?? '', /Erro guardado\./);
    assert.match((await chat.office('estado')).note ?? '', /Perguntas à espera: 0/);
    assert.match((await chat.office('perguntas')).note ?? '', /Nenhuma pergunta à espera\./);
  });
});

test('ADM-11, WZP-48: the same words from someone who is not authorised are ordinary text, and a chat the bot ignores gets no command', async () => {
  await withChat([JSON.stringify({ items: [] }), JSON.stringify({ draft: 'A colleague will follow up.' })], async (chat) => {
    chat.company.store.setRole('stranger-chat', 'reply', 'test', AT);
    const result = await chat.company.process({ id: 'x1', source: 'test', kind: 'message.received', at: AT, payload: { chat: 'stranger-chat', isGroup: false, addressed: true, sender: 'someone-else', text: '.save sneaky' } });
    assert.equal(result.ran, true, 'it went to the handlers as an ordinary customer line');
    assert.deepEqual(listNotes(chat.company), []);
    const ignored = await chat.company.process({ id: 'x2', source: 'test', kind: 'message.received', at: AT, payload: { chat: 'unknown-chat', isGroup: false, addressed: true, sender: 'test-owner', text: '.save from nowhere' } });
    assert.equal(ignored.ran, false);
    assert.deepEqual(listNotes(chat.company), []);
  });
});
