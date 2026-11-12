import { N4_LEDGER_RETENTION_DAYS } from '@cyborg/core';
import type { SqliteStore } from './sqlite-store.ts';

/** PRV-10: applies N-4 (default 30 days; the days are config per client). */
export function purgeExpiredLedger(store: SqliteStore, now: Date, days = N4_LEDGER_RETENTION_DAYS): number {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return store.purgeLedgerBefore(cutoff.toISOString());
}
