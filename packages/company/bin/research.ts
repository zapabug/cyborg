// feat-desk DK7 / DSK-84..88: research a business from its public pages and write a DRAFT business sheet with the source of every line.
//   pnpm research --name "Company name" --url https://example.com [--url <another public page>] --out <folder> --endpoint <url ending /v1> --model <name> [--key-env NAME]
// A setup tool for zapa's own machine, never the bot and never the client's machine. It reads only the pages named (and same-site pages they point to), and the
// model only copies: code drops every line whose words are not on a fetched page. Nothing is sent anywhere but the page requests and the model calls.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { OpenAIGateway } from '@cyborg/gateway';
import { SqliteStore } from '@cyborg/store-sqlite';
import { runResearch } from '../src/research.ts';

const { values } = parseArgs({ options: { name: { type: 'string' }, url: { type: 'string', multiple: true }, out: { type: 'string' }, endpoint: { type: 'string' }, model: { type: 'string' }, 'key-env': { type: 'string' } } });
if (!values.name || !values.url?.length || !values.out || !values.endpoint || !values.model) {
  console.error('usage: pnpm research --name "Company name" --url <public page> [--url <page>] --out <folder> --endpoint <url ending /v1> --model <name> [--key-env NAME]');
  process.exit(2);
}
// HR-6: the probe requests and the extraction call are kept, with the exact request and the raw answer, in <out>/ledger.sqlite (read it with pnpm usage / pnpm digest).
const out = resolve(values.out);
mkdirSync(join(out, 'sources'), { recursive: true });
const store = new SqliteStore(join(out, 'ledger.sqlite'));
const gateway = new OpenAIGateway({ endpoint: { baseUrl: values.endpoint, ...(values['key-env'] ? { apiKeyEnv: values['key-env'] } : {}) }, defaultModel: values.model }, { capabilities: store, ledger: store });
try {
  console.log('Testing the model endpoint once (a few real calls)...');
  const cap = await gateway.runCapabilityTest(values.model);
  if (cap.inconclusive || cap.level === 'none') throw new Error(cap.inconclusive ? 'the endpoint test was inconclusive (a rejected key, no credit, a rate limit or a network failure); run it again' : 'the model does not return JSON, so it cannot copy into fields');
  console.log(`  ${values.model}: ${cap.level}`);
  const result = await runResearch({
    name: values.name, urls: values.url, model: gateway, modelName: values.model, ledger: store,
    fetch: (url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<NonNullable<Parameters<typeof runResearch>[0]['fetch']>>,
  });
  writeFileSync(join(out, 'sheet.draft.txt'), result.sheet);
  writeFileSync(join(out, 'research-report.md'), result.report);
  result.pages.forEach((p, i) => writeFileSync(join(out, 'sources', `${String(i + 1).padStart(2, '0')}.txt`), `${p.url}\nread ${p.fetchedAt}\n\n${p.text}\n`));
  console.log(`${result.report}\nWrote ${out}/sheet.draft.txt, research-report.md, ledger.sqlite and sources/ (${result.pages.length} pages)`);
  console.log(`Next: pnpm tailor <id> --name "${values.name}" --into <folder> --sheet ${out}/sheet.draft.txt --language en|pt --endpoint ${values.endpoint} --model ${values.model}`);
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  store.close();
}
