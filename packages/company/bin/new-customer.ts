// ARC-15: start a business's repository outside the framework, in a folder you choose.
//   pnpm new-customer <id> --name "Company name" --into <folder> [--no-git]
// The folder can also come from CYBORG_BUSINESSES (on Homebase09: ~/Projects/cyborg).
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { scaffoldCustomer } from '../src/index.ts';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { name: { type: 'string' }, into: { type: 'string' }, 'no-git': { type: 'boolean' }, demo: { type: 'boolean' } } });
const [id] = positionals;
const into = values.into ?? process.env['CYBORG_BUSINESSES'];
if (!id || !values.name || !into) {
  console.error('usage: pnpm new-customer <id> --name "Company name" --into <folder> [--no-git] [--demo]\n  (or set CYBORG_BUSINESSES to the folder that holds your business repositories; it is never inside the framework)');
  process.exit(2);
}
const cyborgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const result = scaffoldCustomer({ id, name: values.name, cyborgRoot, into, git: !values['no-git'], demo: values.demo === true });
console.log(`Created ${result.dir}${result.committed ? ' (git repository, first commit made, no remote)' : ''}\n${values.demo ? `Next: cd ${result.dir} && pnpm install, fill in the two "<fill in" values in company.config.json (the model endpoint and name), then pnpm run testchat. SHOW.md is the script for showing it.` : `Next: cd ${result.dir} && pnpm install, then fill in docs/questionnaire.md from the meeting.`}`);
