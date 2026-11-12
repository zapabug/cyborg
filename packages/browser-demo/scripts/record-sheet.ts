// The business view of the showcase, recorded from a real run: a made-up business writes its sheet, cyborg reads it, builds the customer repository and a
// customer chats with it through the real test chat (sales module, shadow, nothing sent). Nothing is typed in by hand but the customer's lines.
//   node --import tsx packages/browser-demo/scripts/record-sheet.ts <sheet> <sheet with gaps> <base url> <model> <out folder> [api key env name]
// Writes <out>/full.json (the sessions, same shape as record.ts) and <out>/business.json (the two sheets and what was read from each).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCompanyConfig, missingAsks, openTestChat, parseBusinessSheet, tailorCustomer, type CompanyModelFile } from '@cyborg/company';
import type { TestTurn } from '@cyborg/company';

const [sheetFile, gapsFile, baseUrl, model, outDir, keyEnv] = process.argv.slice(2);
if (!sheetFile || !gapsFile || !baseUrl || !model || !outDir) throw new Error('usage: record-sheet.ts <sheet> <sheet with gaps> <base url> <model> <out folder> [api key env name]');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const text = readFileSync(sheetFile, 'utf8');
const gaps = readFileSync(gapsFile, 'utf8');

const tmp = mkdtempSync(join(tmpdir(), 'cyborg-record-'));
try {
  const made = tailorCustomer({ id: 'demo-studio', name: 'Demo Studio', cyborgRoot: root, into: tmp, sheet: text, language: 'en', endpoint: baseUrl, model, ...(keyEnv ? { apiKeyEnv: keyEnv } : {}), git: false });
  const loaded = loadCompanyConfig(join(made.dir, 'company.config.json'));
  const company = JSON.parse(readFileSync(join(made.dir, 'company.json'), 'utf8')) as CompanyModelFile;
  const chat = await openTestChat(loaded, { company, demo: 'Demo Studio', paths: { store: join(tmp, 'chat-store.sqlite'), vault: join(tmp, 'chat-vault.sqlite') } }, console.log);

  // The made-up business has read its facts back and said they are right: every fact is confirmed before the customer writes (the test chat runs in shadow mode, which would also accept unconfirmed ones).
  const confirmedAt = new Date().toISOString();
  for (const key of Object.keys(company.profile)) {
    const fact = chat.company.store.getFact(key);
    if (fact && fact.status !== 'confirmed') chat.company.store.moveFact(key, 'confirmed', { actor: 'demo', at: confirmedAt, reason: 'the made-up business confirmed its sheet' });
  }

  // A turn in the shape the replay renders (view.ts): what the customer typed, the draft, the facts it used, the checks, and why a draft was held back.
  // A retry inside the reading step is the framework's own detail and is left out; the reply's own reason is kept.
  const view = (line: string, turn: TestTurn) => {
    const r = turn.replies.find((x) => x.handler === 'reply_draft');
    return { text: line, draft: r?.draft ?? null, band: (r?.band as 'high' | 'medium' | 'low' | null) ?? null, facts: (r?.facts ?? []).map((f) => ({ key: f.key, unconfirmed: f.unconfirmed, value: chat.company.store.getFact(f.key)?.value })), checks: r?.checks ?? [], computed: '', problems: turn.problems.filter((p) => !p.startsWith('intake:')), needsOffice: turn.needsOffice, request: null };
  };
  const say = async (id: string, line: string) => {
    const turn = await chat.customer(id, line);
    if (turn.kind !== 'reply') console.log('  [kind]', turn.kind, turn.note);
    const v = view(line, turn);
    console.log(`> ${line}\n  ${v.draft ?? `(no draft) ${v.problems.join('; ')}`}`);
    return { text: line, view: v };
  };
  const card = async (id: string) => ({ text: 'Pass to the office', card: (await chat.handoff(id)).card ?? 'No card: the model gave nothing the code could check against the conversation.' });

  // Three general questions the sheet answers: hours, a price, where the office is. Nothing here asks for what the facts do not hold.
  const hours = [await say('s1', 'what are your opening hours?')];
  const price = [await say('s2', 'how much is a long cut?')];
  const where = [await say('s3', 'where is your office?')];

  const recorded = {
    recordedAt: new Date().toISOString(), model: model + (baseUrl.includes('127.0.0.1') ? ' (local)' : ''),
    sessions: [
      { id: 'hours', title: 'Shadow: opening hours', mode: 'shadow', blurb: 'Shadow mode is the first stage: the bot drafts beside the team and sends nothing. The business confirmed "Mon-Sat 09:00-19:00", and the draft is that fact in the business\'s tone. The team marks it right or wrong.', turns: hours },
      { id: 'price', title: 'Drafts: a price', mode: 'drafts', blurb: 'In drafts mode a person approves each reply before it is sent. The sheet says a long cut is "from 30 EUR", and the code holds the draft to that: a starting price is never stated as a flat one.', turns: price },
      { id: 'where', title: 'Auto: where the office is', mode: 'auto', blurb: 'In auto mode a safe answer goes out by itself. The address is one of the confirmed answers the business wrote, so nothing needs a person.', turns: where },
    ],
  };
  const sheetView = (id: string, title: string, blurb: string, source: string) => {
    const read = parseBusinessSheet(source);
    return { id, title, blurb, text: source, statements: read.statements, notes: read.notes, unread: read.unread, asks: missingAsks(read.missing) };
  };
  const business = {
    demo: 'Demo Studio, a made-up business',
    sheets: [
      sheetView('complete', 'A complete sheet', 'Everything the sales desk needs. Nothing could be misread.', text),
      sheetView('gaps', 'A sheet with gaps', 'A stray line, a question without an answer, no tone and no rules. Nothing is guessed: it is listed, and the next questions are named.', gaps),
    ],
  };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'full.json'), `${JSON.stringify(recorded, null, 2)}\n`);
  writeFileSync(join(outDir, 'business.json'), `${JSON.stringify(business, null, 2)}\n`);
  console.log('wrote', join(outDir, 'full.json'), 'and business.json');
  chat.close();
} finally {
  rmSync(tmp, { recursive: true });
}
