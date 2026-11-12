// Two-consumer proof (docs/07 MOD-7). Real inputs are read from run-time paths and never copied into the repo (MOD-8).
//   pnpm proof --base-url http://127.0.0.1:8081/v1 --model <name> --wazaa-tests ~/Projects/cyborg/wazaa/tests [--buyer-intake intake.json] [--limit 10]
// intake.json: { "text": "<one real buyer intake message>" }  (or an array of such objects)
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { OpenAIGateway } from '@cyborg/gateway';
import { SqliteStore } from '@cyborg/store-sqlite';
import { runProof, moduleSources, renderProof, type Consumer } from '../src/harness.ts';
import { extractWazaaChats } from '../src/wazaa-chats.ts';

const { values } = parseArgs({
  options: { 'base-url': { type: 'string' }, model: { type: 'string' }, 'key-env': { type: 'string' }, 'wazaa-tests': { type: 'string' }, 'buyer-intake': { type: 'string' }, limit: { type: 'string' } },
});
if (!values['base-url'] || !values.model) {
  console.error('usage: pnpm proof --base-url <url incl. /v1> --model <name> [--key-env VAR] [--wazaa-tests <dir>] [--buyer-intake <json>] [--limit n]');
  process.exit(2);
}
const limit = values.limit ? Number(values.limit) : 10;
const capabilityStore = new SqliteStore(':memory:');
const gateway = new OpenAIGateway(
  { endpoint: { baseUrl: values['base-url'], ...(values['key-env'] ? { apiKeyEnv: values['key-env'] } : {}), timeoutMs: 180_000 }, models: { 'sales.enquiry.intake': values.model } },
  { capabilities: capabilityStore, ledger: capabilityStore },
);
const capability = await gateway.runCapabilityTest(values.model);
console.log(`endpoint ${capability.baseUrl} ${capability.model}: ${capability.level}`);

const consumers: Consumer[] = [];
if (values['wazaa-tests']) {
  consumers.push({
    name: 'wazaa',
    messages: extractWazaaChats(values['wazaa-tests']).slice(0, limit),
    identifiers: ['wazaa', 'demo tours', 'madeira', 'tour', 'tours'],
    config: { enquiryFields: [
      { name: 'tour', description: 'which tour or activity the customer asks about' },
      { name: 'date', description: 'the day or period they want' },
      { name: 'party_size', description: 'how many people' },
      { name: 'language', description: 'the language the customer writes in or wants' },
    ] },
  });
}
if (values['buyer-intake']) {
  const parsed = JSON.parse(readFileSync(values['buyer-intake'], 'utf8')) as { text: string } | { text: string }[];
  consumers.push({
    name: 'madrltr',
    messages: (Array.isArray(parsed) ? parsed : [parsed]).map((p) => p.text),
    identifiers: ['madrltr', 'buyer', 'property', 'mortgage'],
    config: { enquiryFields: [
      { name: 'property_type', description: 'the kind of property wanted' },
      { name: 'area', description: 'where they want to buy' },
      { name: 'budget', description: 'what they can spend' },
      { name: 'financing', description: 'cash, mortgage or other' },
      { name: 'timeline', description: 'when they want to complete' },
    ] },
  });
}
const report = await runProof({ consumers, model: gateway, sourceFiles: moduleSources(new URL('../../packages/module-sales/src', import.meta.url).pathname) });
console.log(renderProof(report));
if (!values['buyer-intake']) console.log('\nNo buyer intake was given: M7-EC6 / M6-EC4 stay open until a real one exists (MOD-8).');
