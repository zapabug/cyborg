// CMP-15..22: a simulated day for one company against its real model endpoint.
//   pnpm simulate --config company.config.json --script day.json [--company-model company.json] [--out report.json] [--estimate]
// --estimate prints how many model calls the script will make and stops. The company's database in the config is used as it is:
// point store.path at a scratch file for a simulation, never at a live install's database.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { checkCompanyConfig, createCompany, estimateModelCalls, loadCompanyConfig, renderSimulation, runSimulation, seedProfile, testCapabilities, validateScript, type CompanyModelFile } from '../src/index.ts';

const { values } = parseArgs({ options: { config: { type: 'string' }, script: { type: 'string' }, 'company-model': { type: 'string' }, out: { type: 'string' }, estimate: { type: 'boolean' } } });
if (!values.config || !values.script) {
  console.error('usage: pnpm simulate --config <company.config.json> --script <day.json> [--company-model <company.json>] [--out report.json] [--estimate]');
  process.exit(2);
}
const loaded = (() => {
  try {
    return loadCompanyConfig(values.config);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
})();
const check = checkCompanyConfig(loaded.config);
for (const e of check.errors) console.log(`ERROR   ${e}`);
for (const w of check.warnings) console.log(`WARNING ${w}`);
if (loaded.config.mode === 'live') {
  console.error('A simulation runs in shadow mode. Set "mode": "shadow" in the config you simulate with.');
  process.exit(1);
}
const { script, errors } = validateScript(JSON.parse(readFileSync(values.script, 'utf8')));
if (!script) {
  console.error(`The script cannot run yet:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
  process.exit(1);
}
const companyModel = values['company-model'] ? (JSON.parse(readFileSync(values['company-model'], 'utf8')) as CompanyModelFile) : undefined;

if (values.estimate) {
  // Built on in-memory files so counting touches no database; a scripted capability stands in for the endpoint test.
  const scratch = { ...loaded, paths: { store: ':memory:', vault: ':memory:' } };
  const noop = { channel: 'estimate', send: async () => undefined };
  const company = createCompany(scratch, { ack: noop, review: noop }, {
    capabilities: [{ baseUrl: loaded.config.inference.baseUrl, model: loaded.config.inference.model, level: 'strict_schema', requestShape: 'json_schema_wrapped', logprobs: false, testedAt: new Date().toISOString(), attempts: [] }],
    model: { call: async () => { throw new Error('estimate only'); } },
    ...(companyModel ? { beforeLoad: (store) => void seedProfile(store, companyModel, new Date().toISOString()) } : {}),
  });
  if (company.loaded.refused.length) {
    console.log(`The modules did not load, so the count would be wrong:\n${company.loaded.refused.flatMap((r) => r.unmet.map((u) => `  - ${r.moduleId}: ${u.kind} ${u.item}: ${u.detail}`)).join('\n')}\nGive --company-model so the profile facts the modules need are there.`);
    company.close();
    process.exit(1);
  }
  const estimate = estimateModelCalls(script, company.registry);
  console.log(`${script.steps.length} steps, about ${estimate.calls} model calls (one per model handler that matches each customer message, handoff and review).`);
  const cap = loaded.config.limits.maxModelCallsPer24h;
  console.log(cap ? `The company's cap is ${cap} calls in 24 hours.${estimate.calls > cap ? ' This script is over it: the runner will refuse calls past the cap.' : ''}` : 'No call cap is set in this config.');
  company.close();
  process.exit(0);
}

if (check.errors.length) process.exit(1);
console.log('Testing the endpoint ...');
for (const r of await testCapabilities(loaded)) console.log(`  ${r.model}: ${r.level}`);
const report = await runSimulation(loaded, script, companyModel ? { company: companyModel } : {});
console.log(`\n${renderSimulation(report)}`);
if (values.out) writeFileSync(values.out, JSON.stringify(report, null, 2));
