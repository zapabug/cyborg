// Runs the endpoint capability test (docs/05, GWY-9) and stores the result in a business database.
//   pnpm capability --base-url http://127.0.0.1:8081/v1 --model <name> --db ./business.sqlite [--key-env OPENAI_API_KEY] [--timeout-ms 60000] [--provider-options '{"provider":{"data_collection":"deny","require_parameters":true}}']
// No port or host is assumed (GWY-2): --base-url and --model are required.
import { parseArgs } from 'node:util';
import { SqliteStore } from '@cyborg/store-sqlite';
import { OpenAIGateway } from '../src/index.ts';

const { values } = parseArgs({
  options: {
    'base-url': { type: 'string' },
    model: { type: 'string' },
    db: { type: 'string' },
    'key-env': { type: 'string' },
    'timeout-ms': { type: 'string' },
    'provider-options': { type: 'string' },
  },
});

const baseUrl = values['base-url'];
const model = values.model;
const db = values.db;
if (!baseUrl || !model || !db) {
  console.error('usage: pnpm capability --base-url <url incl. /v1> --model <name> --db <business.sqlite> [--key-env <VAR>] [--timeout-ms <n>]');
  process.exit(2);
}

const store = new SqliteStore(db);
const gateway = new OpenAIGateway(
  {
    endpoint: {
      baseUrl,
      ...(values['key-env'] ? { apiKeyEnv: values['key-env'] } : {}),
      ...(values['timeout-ms'] ? { timeoutMs: Number(values['timeout-ms']) } : {}),
      ...(values['provider-options'] ? { providerOptions: JSON.parse(values['provider-options']) as Record<string, unknown> } : {}),
    },
  },
  { capabilities: store, ledger: store },
);

const result = await gateway.runCapabilityTest(model);
console.log(JSON.stringify({ ...result, attempts: undefined }, null, 2));
for (const a of result.attempts) {
  console.log(`  ${a.shape}: http ${a.httpStatus ?? '-'}, valid JSON ${a.validJson}/${a.trials}, conforming ${a.conforming}/${a.trials}${a.error ? `, ${a.error}` : ''}`);
}
if (result.inconclusive) console.log('INCONCLUSIVE: a rejected key or empty credit (401, 402, 403), a rate limit, a server error or a network failure stopped the test. Nothing was stored. Run it again.');
store.close();
