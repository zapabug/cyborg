// Writes the upgrade digest (docs/06 PRF-81) for one business database as JSON.
//   pnpm digest --db business.sqlite [--since 2026-10-01T00:00:00Z] > digest.json
import { parseArgs } from 'node:util';
import { buildUpgradeDigest } from '@cyborg/core';
import { SqliteStore } from '../src/index.ts';

const { values } = parseArgs({ options: { db: { type: 'string' }, since: { type: 'string' } } });
if (!values.db) {
  console.error('usage: pnpm digest --db <business.sqlite> [--since <ISO time>]');
  process.exit(2);
}
const store = new SqliteStore(values.db);
const digest = buildUpgradeDigest(
  { proposals: store, ledgerFailures: (since) => store.listLedgerFailures(since), flags: store },
  values.since ? { since: values.since } : {},
);
console.log(JSON.stringify(digest, null, 2));
store.close();
