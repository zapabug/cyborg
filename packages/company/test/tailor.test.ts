import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkCompanyConfig, loadCompanyConfig, tailorCustomer } from '../src/index.ts';

// feat-tailored T2, TLR-14..16: a customer repository from the business sheet. The sheet is a syntax example, not a business.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SHEET = 'Name: Example Co\nTone: warm and short\nHours: Mon-Sat 09:00-19:00\nServices:\n- Item one | 25 EUR\nNever:\n- give a discount\nQuestions:\n- Do you take cards? | Yes.\nloose words here\n';
const options = { id: 'example-co', name: 'Example Co', cyborgRoot: ROOT, sheet: SHEET, language: 'en' as const, endpoint: 'http://127.0.0.1:8081/v1', model: 'm', git: false };

test('TLR-14: a sheet becomes a customer repository whose config passes the check and whose facts are the client\'s words', () => {
  const into = mkdtempSync(join(tmpdir(), 'cyborg-tailor-'));
  try {
    const r = tailorCustomer({ ...options, into });
    const config = loadCompanyConfig(join(r.dir, 'company.config.json'));
    assert.deepEqual(checkCompanyConfig(config.config, {}).errors, []);
    assert.equal(config.config.language, 'en');
    assert.equal(config.config.inference.model, 'm');
    assert.equal(config.config.mode, 'shadow', 'shadow first');
    assert.deepEqual(config.config.chat.roles, {}, 'no chat, no number, until the picker links one');
    const model = JSON.parse(readFileSync(join(r.dir, 'company.json'), 'utf8')) as { profile: Record<string, unknown> };
    assert.equal(model.profile['business.name'], 'Example Co');
    assert.deepEqual(model.profile['offer.items'], [{ name: 'Item one', price: 25, currency: 'EUR' }]);
    assert.deepEqual(model.profile['rules.commitments'], ['give a discount']);
    assert.ok(existsSync(join(r.dir, 'docs', 'business-sheet.txt')), 'the client\'s words are kept as written');
    assert.equal(readFileSync(join(r.dir, 'docs', 'business-sheet.txt'), 'utf8'), SHEET);
  } finally {
    rmSync(into, { recursive: true });
  }
});

test('TLR-15, TLR-16: the report lists what was read, the line it could not read, and what to ask next; no code is written for the customer', () => {
  const into = mkdtempSync(join(tmpdir(), 'cyborg-tailor-'));
  try {
    const r = tailorCustomer({ ...options, into });
    assert.match(r.report, /line 10: "loose words here"/);
    assert.match(r.report, /Ask the client next/);
    assert.deepEqual(r.sheet.missing, []);
    assert.ok(r.sheet.unread.length === 1);
    assert.equal(readFileSync(join(r.dir, 'docs', 'sheet-report.md'), 'utf8'), r.report);
    assert.ok(!r.files.some((f) => /^src\//.test(f) && f !== 'src/adapter.ts' && f !== 'src/run.ts'), 'only the scaffold\'s two files');
    const missing = tailorCustomer({ ...options, id: 'bare', sheet: 'Name: Bare', into });
    assert.deepEqual(missing.sheet.missing, ['offer.items', 'tone.style', 'rules.commitments', 'faq.entries']);
    assert.match(missing.report, /Services: \(one line each/);
  } finally {
    rmSync(into, { recursive: true });
  }
});

test('TLR-14: an existing folder is never overwritten, and a bad id is refused', () => {
  const into = mkdtempSync(join(tmpdir(), 'cyborg-tailor-'));
  try {
    tailorCustomer({ ...options, into });
    assert.throws(() => tailorCustomer({ ...options, into }), /already exists/);
    assert.throws(() => tailorCustomer({ ...options, id: 'Bad Id', into }), /not a customer id/);
  } finally {
    rmSync(into, { recursive: true });
  }
});

test('TLR-14: with the questionnaire message too, its statements enter unconfirmed and the client\'s own "never" words are quoted into the rules, beside the sheet\'s', async () => {
  const { loadIntakeForm, loadTaskMap } = await import('../src/index.ts');
  const form = loadIntakeForm(join(import.meta.dirname, 'fixtures', 'intake-form-data.js'));
  const taskMap = loadTaskMap(join(ROOT, 'docs', 'intake', 'task-map.json'));
  const message = [`*${form.messageTitle}*`, `${form.filledBy}: Ana, Example Co`, '', `1. ${form.tasks[0]}: the office · 30 min/day · Yes`, '', '*Never automatic:* payments', '*Never promise:* a discount', '*Languages:* English and Portuguese'].join('\n');
  const into = mkdtempSync(join(tmpdir(), 'cyborg-tailor-'));
  try {
    const r = tailorCustomer({ ...options, into, intake: { message, form, taskMap } });
    const model = JSON.parse(readFileSync(join(r.dir, 'company.json'), 'utf8')) as { profile: Record<string, any> };
    assert.equal(model.profile['intake.languages'], 'English and Portuguese');
    assert.equal(model.profile['intake.tasks'].length, 1);
    assert.deepEqual(model.profile['rules.commitments'].slice(0, 1), ['give a discount']);
    assert.ok(model.profile['rules.commitments'].some((c: string) => /Never automatic, in the client's words: “payments”/.test(c)));
    assert.ok(existsSync(join(r.dir, 'docs', 'intake-report.md')) && existsSync(join(r.dir, 'docs', 'intake-message.txt')));
    assert.equal((JSON.parse(readFileSync(join(r.dir, 'intake', 'intake.json'), 'utf8')) as { draft: { tasks: unknown[] } }).draft.tasks.length, 1, 'the picker\'s task list');
    const pkg = JSON.parse(readFileSync(join(r.dir, 'package.json'), 'utf8')) as { scripts: Record<string, string>; dependencies: Record<string, string> };
    assert.match(pkg.scripts['whatsapp']!, /channel-whatsapp\/bin\/whatsapp\.ts/, 'the WhatsApp link is the framework\'s, not copied code');
    assert.ok('@cyborg/channel-whatsapp' in pkg.dependencies);
    assert.match(readFileSync(join(r.dir, '.gitignore'), 'utf8'), /whatsapp\.json/);
    assert.equal(r.intake!.tasks.length, 1);
    const only = tailorCustomer({ ...options, id: 'only-intake', sheet: undefined as never, into, intake: { message, form, taskMap } });
    assert.equal(only.sheet.statements['business.name'], undefined);
    assert.deepEqual([...only.sheet.missing].sort(), ['business.name', 'faq.entries', 'offer.items', 'rules.commitments', 'tone.style']);
  } finally {
    rmSync(into, { recursive: true });
  }
});
