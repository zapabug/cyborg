// Imports a parsed (JSON) tree into a business profile as `unconfirmed` facts (PRF-61).
//   pnpm import-profile --json tree.json --db business.sqlite --source document --source-ref <file or url> --class public [--prefix catalog]
// The core does not parse YAML (PRF-62); convert first.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { SqliteStore } from '@cyborg/store-sqlite';
import { importTree } from '../src/index.ts';

const { values } = parseArgs({
  options: {
    json: { type: 'string' },
    db: { type: 'string' },
    source: { type: 'string' },
    'source-ref': { type: 'string' },
    class: { type: 'string' },
    prefix: { type: 'string' },
  },
});
const sources = ['client_statement', 'store_sync', 'document', 'observation', 'shadow_run'] as const;
const source = sources.find((s) => s === values.source);
const cls = values.class === 'public' || values.class === 'deal' ? values.class : undefined;
if (!values.json || !values.db || !source || !values['source-ref'] || !cls) {
  console.error(`usage: pnpm import-profile --json <file> --db <business.sqlite> --source <${sources.join('|')}> --source-ref <ref> --class <public|deal> [--prefix <key>]`);
  process.exit(2);
}
const store = new SqliteStore(values.db);
const result = importTree(store, JSON.parse(readFileSync(values.json, 'utf8')), {
  source,
  sourceRef: values['source-ref'],
  class: cls,
  ...(values.prefix ? { prefix: values.prefix } : {}),
  actor: 'cli:import-profile',
  at: new Date().toISOString(),
});
console.log(JSON.stringify(result));
store.close();
