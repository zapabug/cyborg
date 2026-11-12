import type { SqliteStore, StoredTable } from './sqlite-store.ts';

export interface LeakHit {
  table: StoredTable;
  rowId: string;
  /** Index into the supplied values, never the value itself, so a failing report leaks nothing. */
  valueIndex: number;
}

/**
 * PRV-13: finds identity values in any proposal, audit row or ledger payload. Each value is
 * also searched in its JSON-escaped form because rows are stored as JSON text.
 */
export function findLeaks(store: SqliteStore, values: readonly string[]): LeakHit[] {
  const hits: LeakHit[] = [];
  const rows = store.exportStoredText();
  values.forEach((value, valueIndex) => {
    if (value.length === 0) return;
    const escaped = JSON.stringify(value).slice(1, -1);
    const doubleEscaped = JSON.stringify(escaped).slice(1, -1); // a JSON payload stored inside a JSON row
    for (const row of rows) {
      if (row.text.includes(value) || row.text.includes(escaped) || row.text.includes(doubleEscaped)) {
        hits.push({ table: row.table, rowId: row.id, valueIndex });
      }
    }
  });
  return hits;
}
