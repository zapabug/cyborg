// CMP-4..6, CMP-12: look at a company's config file, and run the capability test for the models it uses.
//   pnpm company check <company.config.json>        validates the file and what this machine needs for it
//   pnpm company wording <company.config.json>      prints every text the code adds for this company, as it would read
//   pnpm company capability <company.config.json>   runs the capability test for every model in the file (calls the endpoint)
import { existsSync } from 'node:fs';
import { checkCompanyConfig, describeWording, FIXED_TEXTS, loadCompanyConfig, modelsInUse, testCapabilities } from '../src/index.ts';

const [command, file] = process.argv.slice(2);
if ((command !== 'check' && command !== 'capability' && command !== 'wording') || !file) {
  console.error('usage: pnpm company check <company.config.json>\n       pnpm company wording <company.config.json>\n       pnpm company capability <company.config.json>');
  process.exit(2);
}
const loaded = (() => {
  try {
    return loadCompanyConfig(file);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
})();
const { errors, warnings } = checkCompanyConfig(loaded.config);

if (command === 'check') {
  console.log(`${loaded.config.name} (${loaded.config.id}), mode ${loaded.config.mode}`);
  console.log(`store ${loaded.paths.store}${existsSync(loaded.paths.store) ? '' : ' (not created yet)'}\nvault ${loaded.paths.vault}${existsSync(loaded.paths.vault) ? '' : ' (not created yet)'}`);
  console.log(`models: ${modelsInUse(loaded.config).join(', ')}`);
  for (const e of errors) console.log(`ERROR   ${e}`);
  for (const w of warnings) console.log(`WARNING ${w}`);
  console.log(errors.length ? `\n${errors.length} error(s): fix them before this install runs.` : '\nThe file is well formed.');
  process.exit(errors.length ? 1 : 0);
}

if (command === 'wording') {
  for (const o of describeWording(loaded.config)) console.log(`${o.where}\n  ${o.text}\n`);
  console.log(`Not editable from the config yet:\n${FIXED_TEXTS.map((t) => `  - ${t}`).join('\n')}`);
  for (const e of errors.filter((x) => /wording|persona/.test(x))) console.log(`\nERROR   ${e}`);
  process.exit(errors.some((x) => /wording|persona/.test(x)) ? 1 : 0);
}

if (errors.length) {
  console.error(errors.map((e) => `ERROR ${e}`).join('\n'));
  process.exit(1);
}
const results = await testCapabilities(loaded);
for (const r of results) console.log(`${r.baseUrl} ${r.model}: ${r.level}${r.requestShape ? ` (${r.requestShape})` : ''}, log-probabilities ${r.logprobs ? 'yes' : 'no'}`);
if (results.some((r) => r.level === 'none')) console.log('A model with level none cannot return the structured output the handlers need.');
