// Dry run (docs/11). Runs your drafted company model and your own test tasks through the sales handlers in shadow
// mode against a real model. Nothing is sent anywhere.
//   pnpm dryrun --company company.json --tasks tasks.json --base-url http://127.0.0.1:8081/v1 --model <name> --db ./dryrun.sqlite [--out report.json] [--key-env VAR]
// company.json: see docs/dryrun/company-model.template.json.   tasks.json: a list of strings or { text, mustInclude, mustNotInclude, expectFields }.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { OpenAIGateway } from '@cyborg/gateway';
import { SqliteStore, SqliteVault } from '@cyborg/store-sqlite';
import { renderDryRun, runDryRun, validateCompanyModel, validateTasks, type CompanyModel, type Task } from '../src/dryrun.ts';

const { values } = parseArgs({
  options: { company: { type: 'string' }, tasks: { type: 'string' }, 'base-url': { type: 'string' }, model: { type: 'string' }, db: { type: 'string' }, out: { type: 'string' }, 'key-env': { type: 'string' }, 'timeout-ms': { type: 'string' }, 'provider-options': { type: 'string' }, check: { type: 'boolean' } },
});
if (!values.company) {
  console.error('usage: pnpm dryrun --company <company.json> [--check] --tasks <tasks.json> --base-url <url incl. /v1> --model <name> --db <dryrun.sqlite> [--out report.json] [--key-env VAR]');
  process.exit(2);
}
const company = JSON.parse(readFileSync(values.company, 'utf8')) as CompanyModel;
const check = validateCompanyModel(company);
if (values.check || check.errors.length > 0) {
  console.log(renderDryRun({ generatedAt: '', modelCheck: check, tasks: [], summary: { tasks: 0, withFailures: 0, byKind: {} } }));
  if (check.errors.length === 0) console.log('The company model looks well formed.');
  process.exit(check.errors.length > 0 ? 1 : 0);
}
if (!values.tasks || !values['base-url'] || !values.model || !values.db) {
  console.error('--tasks, --base-url, --model and --db are required for a run');
  process.exit(2);
}
const rawTasks: unknown = JSON.parse(readFileSync(values.tasks, 'utf8'));
const taskErrors = validateTasks(rawTasks);
if (taskErrors.length > 0) {
  console.error(`The tasks file cannot run yet:\n${taskErrors.map((e) => `  - ${e}`).join('\n')}`);
  process.exit(1);
}
const tasks: Task[] = (rawTasks as (string | Task)[]).map((t) => (typeof t === 'string' ? { text: t } : t));

const store = new SqliteStore(values.db);
const vault = new SqliteVault(`${values.db}.vault`);
const gateway = new OpenAIGateway(
  {
    endpoint: { baseUrl: values['base-url'], ...(values['key-env'] ? { apiKeyEnv: values['key-env'] } : {}), timeoutMs: Number(values['timeout-ms'] ?? 180_000), ...(values['provider-options'] ? { providerOptions: JSON.parse(values['provider-options']) as Record<string, unknown> } : {}) },
    models: Object.fromEntries(['sales.enquiry.intake', 'sales.enquiry.reply_draft', 'sales.enquiry.qualify'].map((id) => [id, values.model!])),
  },
  { capabilities: store, ledger: store },
);
const capability = await gateway.runCapabilityTest(values.model);
console.log(`endpoint ${capability.baseUrl} ${capability.model}: ${capability.level}${capability.requestShape ? ` (${capability.requestShape})` : ''}, log-probabilities ${capability.logprobs ? 'yes' : 'no'}`);
if (capability.level === 'none') console.log('This endpoint cannot return the structured output the handlers need; every task will fail. Try another model or endpoint.');

const report = await runDryRun({ company, tasks, model: gateway, store, vault, capabilities: store.listCapabilities() });
console.log(renderDryRun(report));
if (values.out) writeFileSync(values.out, JSON.stringify(report, null, 2));
console.log(`\nThe run is in ${values.db}. Next: pnpm digest --db ${values.db}`);
store.close();
vault.close();
