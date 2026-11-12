// WZP-82: wazaa's scripted customer chats as a simulation script.
//   pnpm wazaa-script --out day.json [--tests <wazaa tests folder>] [--limit 20] [--start 2026-11-02T09:00:00.000Z]
// The folder is read at run time (default: the copy in the Demo Tours repository) and the result is for a scratch folder, never this repository (HR-4).
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { validateScript } from '@cyborg/company';
import { extractWazaaChats, scriptFromChats } from '../src/wazaa-chats.ts';

const { values } = parseArgs({ options: { out: { type: 'string' }, tests: { type: 'string' }, limit: { type: 'string' }, start: { type: 'string' } } });
if (!values.out) {
  console.error('usage: pnpm wazaa-script --out day.json [--tests <folder>] [--limit N] [--start <ISO time>]');
  process.exit(2);
}
const folder = values.tests ?? process.env['CYBORG_WAZAA_TESTS'] ?? join(homedir(), 'Projects', 'cyborg', 'test-business', 'docs', 'wazaa', 'tests');
const chats = extractWazaaChats(folder).slice(0, values.limit ? Number(values.limit) : undefined);
const script = scriptFromChats(chats, values.start ?? '2026-11-02T09:00:00.000Z');
const { errors } = validateScript(script);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
writeFileSync(values.out, `${JSON.stringify(script, null, 2)}\n`);
console.log(`${script.steps.length} customer lines from ${folder} written to ${values.out}`);
