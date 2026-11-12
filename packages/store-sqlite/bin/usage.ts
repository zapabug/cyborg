// GWY-29: what a company's inference has cost, from its own prompt ledger.
//   pnpm usage --db business.sqlite [--days 7] [--prices prices.json] [--cap 500] [--json]
// prices.json: { "model-name": { "inputPerMillion": 0.2, "outputPerMillion": 0.6, "currency": "EUR" } }
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { buildUsageReport, formatUsageReport, type Prices } from '@cyborg/core';
import { SqliteStore } from '../src/index.ts';

const { values } = parseArgs({ options: { db: { type: 'string' }, days: { type: 'string' }, prices: { type: 'string' }, cap: { type: 'string' }, json: { type: 'boolean' } } });
if (!values.db) {
  console.error('usage: pnpm usage --db <business.sqlite> [--days 7] [--prices prices.json] [--cap <calls per 24 h>] [--json]');
  process.exit(2);
}
const days = Number(values.days ?? '7');
if (!Number.isFinite(days) || days <= 0) throw new Error('--days must be a positive number');
const until = new Date();
const store = new SqliteStore(values.db, { backup: true });
const report = buildUsageReport(store.usageRows(new Date(until.getTime() - days * 86_400_000).toISOString()), {
  since: new Date(until.getTime() - days * 86_400_000).toISOString(),
  until: until.toISOString(),
  ...(values.prices ? { prices: JSON.parse(readFileSync(values.prices, 'utf8')) as Prices } : {}),
  ...(values.cap ? { cap: { maxPer24h: Number(values.cap), usedLast24h: store.countModelCalls(new Date(until.getTime() - 86_400_000).toISOString()) } } : {}),
});
console.log(values.json ? JSON.stringify(report, null, 2) : formatUsageReport(report));
store.close();
