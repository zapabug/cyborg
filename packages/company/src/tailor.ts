import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseBusinessSheet, missingAsks, type Sheet } from './business-sheet.ts';
import { draftFromIntake, mergeIntakeModel, parseIntakeMessage, renderIntakeReport, type IntakeForm, type IntakeDraft, type TaskMap } from './intake.ts';
import { scaffoldCustomer, type ScaffoldResult } from './scaffold.ts';

// feat-tailored T2 (TLR-14..16): a customer repository built from the business sheet. The scaffold supplies the folder, the framework links and the scripts;
// this fills in the config and the company model from what the client said, leaves every statement unconfirmed, and writes a report of what was read,
// what could not be, and what to ask next. No code is written for the customer (TLR-16), and no model is called.

export interface TailorOptions {
  id: string;
  name: string;
  cyborgRoot: string;
  into: string;
  /** The business sheet's text (business-sheet.ts); the message of the "Your business" form has the same lines. Empty: nothing was given yet. */
  sheet?: string;
  /** The questionnaire message (the tasks and the eight answers) with the form's own data and the task map (WZP-20..29). It adds its statements, unconfirmed, and the client's own words about what is never automatic. */
  intake?: { message: string; form: IntakeForm; taskMap: TaskMap };
  /** The language the business writes to its customers in. */
  language: 'en' | 'pt';
  /** The OpenAI-compatible endpoint including /v1, and the model every handler uses. */
  endpoint: string;
  model: string;
  /** The NAME of the environment variable that holds the key; absent for a local endpoint. */
  apiKeyEnv?: string;
  git?: boolean;
}

export interface TailorResult extends ScaffoldResult {
  sheet: Sheet;
  intake: IntakeDraft | null;
  report: string;
}

export function renderSheetReport(name: string, sheet: Sheet): string {
  const lines = [`# ${name}: what the business sheet said`, '', 'Every statement below is **unconfirmed** until the client confirms it in the dashboard.', ''];
  lines.push('## Read', '', ...(sheet.notes.length ? sheet.notes.map((n) => `- ${n}`) : ['- nothing']), '');
  lines.push('## Could not be read', '', ...(sheet.unread.length ? sheet.unread.map((u) => `- line ${u.line}: "${u.text}": ${u.why}`) : ['- every line was read']), '');
  lines.push('## Ask the client next', '', ...(sheet.missing.length ? missingAsks(sheet.missing).map((a) => `- ${a}`) : ['- nothing the sales desk needs is missing']), '');
  return lines.join('\n');
}

export function tailorCustomer(options: TailorOptions): TailorResult {
  const sheetText = options.sheet ?? '';
  const sheet = parseBusinessSheet(sheetText);
  const parsedIntake = options.intake ? parseIntakeMessage(options.intake.message, options.intake.form) : null;
  const intake = options.intake && parsedIntake ? draftFromIntake(parsedIntake, options.intake.taskMap) : null;
  const made = scaffoldCustomer({ id: options.id, name: options.name, cyborgRoot: options.cyborgRoot, into: options.into, git: false });
  const read = (file: string) => JSON.parse(readFileSync(join(made.dir, file), 'utf8')) as Record<string, any>;
  const write = (file: string, text: string) => writeFileSync(join(made.dir, file), text);

  // The model reads these three from every message; the code resolves them. They are the business's to change.
  const enquiryFields = [
    { name: 'interest', description: "which of the business's items the customer asks about" },
    { name: 'when', description: 'when they want it, in their own words' },
    { name: 'how_many', description: 'how many people or items, if they say' },
  ];

  const config = read('company.config.json');
  config['language'] = options.language;
  config['inference'] = { baseUrl: options.endpoint, model: options.model, ...(options.apiKeyEnv ? { apiKeyEnv: options.apiKeyEnv } : {}) };
  for (const key of ['limits', 'prices', 'office', 'wording']) delete config[key];
  config['chat'] = { authorisedSenders: [], originChannel: 'origin-chat', roles: {} };
  config['modules'].sales = { enquiryFields, conversationContext: true, defaultLanguage: options.language, ...(sheet.statements['rules.principles'] ? { principles: true } : {}) };
  write('company.config.json', `${JSON.stringify(config, null, 2)}\n`);

  const base: Record<string, unknown> = { ...sheet.statements };
  if (base['business.name'] === undefined) base['business.name'] = options.name;
  const profile = intake ? mergeIntakeModel({ profile: base }, intake).profile : base;
  write('company.json', `${JSON.stringify({ enquiryFields, commitmentPhrases: [], selfAssessment: false, profile }, null, 2)}\n`);

  const report = renderSheetReport(options.name, sheet);
  write('docs/business-sheet.txt', sheetText === '' || sheetText.endsWith('\n') ? sheetText : `${sheetText}\n`);
  write('docs/sheet-report.md', report);
  if (options.intake) {
    write('docs/intake-message.txt', options.intake.message.endsWith('\n') ? options.intake.message : `${options.intake.message}\n`);
    write('docs/intake-report.md', renderIntakeReport(intake!));
    // The picker offers each kind of chat the tasks of its role from this file (WZP-34).
    mkdirSync(join(made.dir, 'intake'), { recursive: true });
    write('intake/intake.json', `${JSON.stringify({ parsed: parsedIntake, draft: intake }, null, 2)}\n`);
  }

  let committed = false;
  if (options.git !== false) {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: made.dir, stdio: 'ignore' });
    git('init', '-q', '-b', 'main');
    git('add', '-A');
    git('commit', '-q', '-m', `Start the ${options.name} customer repository from its business sheet`);
    committed = true;
  }
  return { ...made, files: [...made.files, 'docs/business-sheet.txt', 'docs/sheet-report.md', ...(options.intake ? ['docs/intake-message.txt', 'docs/intake-report.md', 'intake/intake.json'] : [])].sort(), committed, sheet, intake, report };
}
