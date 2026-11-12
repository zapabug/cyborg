// WZP-20..29: read a client's intake message into a draft company model, a draft task list and a report. No model call, no network.
//   pnpm intake --form <intake form-data.js> --message <file | -> --out <folder> [--task-map <file>] [--company-model <company.json>]
// Writes intake.json (what was read and the draft), intake-report.md (for the person who reads it with the client) and company.intake.json
// (the company model with the intake's statements added, every one unconfirmed). It never changes company.json or company.config.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { draftFromIntake, loadIntakeForm, loadTaskMap, mergeIntakeModel, parseIntakeMessage, renderIntakeReport } from '../src/intake.ts';

const { values } = parseArgs({ options: { form: { type: 'string' }, message: { type: 'string' }, out: { type: 'string' }, 'task-map': { type: 'string' }, 'company-model': { type: 'string' } } });
if (!values.form || !values.message || !values.out) {
  console.error('usage: pnpm intake --form <intake form-data.js> --message <file | -> --out <folder> [--task-map <file>] [--company-model <company.json>]');
  process.exit(2);
}
try {
  const here = dirname(fileURLToPath(import.meta.url));
  const form = loadIntakeForm(resolve(values.form));
  const map = loadTaskMap(resolve(values['task-map'] ?? join(here, '..', '..', '..', 'docs', 'intake', 'task-map.json')));
  const text = readFileSync(values.message === '-' ? 0 : resolve(values.message), 'utf8');
  const parsed = parseIntakeMessage(text, form);
  const draft = draftFromIntake(parsed, map);
  const base = values['company-model'] ? (JSON.parse(readFileSync(resolve(values['company-model']), 'utf8')) as { profile: Record<string, unknown> }) : null;
  const out = resolve(values.out);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'intake.json'), `${JSON.stringify({ parsed, draft }, null, 2)}\n`);
  writeFileSync(join(out, 'intake-report.md'), renderIntakeReport(draft));
  writeFileSync(join(out, 'company.intake.json'), `${JSON.stringify(mergeIntakeModel(base, draft), null, 2)}\n`);
  console.log(`${renderIntakeReport(draft)}\nWritten to ${out}: intake.json, intake-report.md, company.intake.json (every statement is unconfirmed).`);
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
