// Runs one ground-truth check (PRF-7..9) of a fact against an independent source and prints the outcome.
//   pnpm check-fact --db business.sqlite --key catalog.services.alpha.days --kind document --ref service-sheet.pdf --observed '[1,3,4,6]' [--day-sets]
// A source equal to the fact's own source is rejected (PRF-8). --day-sets compares weekday sets (0..6).
import { parseArgs } from 'node:util';
import { SqliteStore } from '@cyborg/store-sqlite';
import { compareDaySets, compareExact, NotIndependentError, runGroundTruthCheck } from '../src/index.ts';

const { values } = parseArgs({
  options: {
    db: { type: 'string' },
    key: { type: 'string' },
    kind: { type: 'string' },
    ref: { type: 'string' },
    observed: { type: 'string' },
    'day-sets': { type: 'boolean' },
  },
});
if (!values.db || !values.key || !values.kind || !values.ref || values.observed === undefined) {
  console.error('usage: pnpm check-fact --db <business.sqlite> --key <fact key> --kind <source kind> --ref <origin> --observed <JSON> [--day-sets]');
  process.exit(2);
}
const store = new SqliteStore(values.db);
try {
  const result = runGroundTruthCheck(
    store,
    {
      factKey: values.key,
      independent: { kind: values.kind, ref: values.ref },
      observed: JSON.parse(values.observed),
      compare: values['day-sets'] ? compareDaySets([0, 1, 2, 3, 4, 5, 6]) : compareExact,
    },
    'cli:check-fact',
    new Date().toISOString(),
  );
  console.log(JSON.stringify({ outcome: result.outcome, status: result.fact.status, note: result.note, discrepancy: result.discrepancy?.id }, null, 2));
} catch (error) {
  if (error instanceof NotIndependentError) {
    console.error(error.message);
    process.exitCode = 1;
  } else throw error;
} finally {
  store.close();
}
