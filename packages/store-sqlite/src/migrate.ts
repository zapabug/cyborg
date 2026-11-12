import type { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync } from 'node:fs';

// docs/01 ARC-9..13: a database file carries its schema version, and an upgrade changes it only through numbered migrations.

export interface Migration {
  /** 1, 2, 3 ... with no gaps. */
  version: number;
  name: string;
  up(db: DatabaseSync): void;
}

export interface MigrateOptions {
  /** The database file; `:memory:` is never backed up. */
  path: string;
  /** Shown in errors, such as "business store" or "vault". */
  label: string;
  /** Copy the file before any migration runs. Default true. */
  backup?: boolean;
  now?: () => Date;
}

export interface MigrateResult {
  from: number;
  to: number;
  applied: string[];
  backupPath: string | null;
}

const versionOf = (db: DatabaseSync): number => Number(db.prepare('PRAGMA user_version').get()?.['user_version'] ?? 0);
const hasTables = (db: DatabaseSync): boolean => Number(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get()?.['n'] ?? 0) > 0;

export function schemaVersion(db: DatabaseSync): number {
  return versionOf(db);
}

/** ARC-10: a copy of the whole database in one file, taken by SQLite itself, readable by the owner only (the vault is a database too). */
export function backupDatabase(db: DatabaseSync, path: string, from: number, now: Date): string {
  const target = `${path}.bak-v${from}-${now.toISOString().replace(/[:.]/g, '-')}`;
  if (existsSync(target)) throw new Error(`backup ${target} already exists`);
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  chmodSync(target, 0o600);
  return target;
}

/**
 * ARC-9..13. A file with no recorded version is either new (no tables) or older than versioning (tables, version 0): the
 * baseline migration is written with CREATE TABLE IF NOT EXISTS so it is safe on both. A file newer than this code is refused:
 * the code is upgraded, never the file downgraded. Each migration runs in its own transaction together with the version bump;
 * a failure rolls that one back and names the backup.
 */
export function migrate(db: DatabaseSync, migrations: readonly Migration[], options: MigrateOptions): MigrateResult {
  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  ordered.forEach((m, i) => {
    if (m.version !== i + 1) throw new Error(`${options.label}: migrations must be numbered 1..n without gaps, found ${m.version} at position ${i + 1}`);
  });
  const target = ordered.length;
  const from = versionOf(db);
  if (from > target) {
    throw new Error(`${options.label}: the database is schema version ${from} but this code knows up to ${target}. Upgrade cyborg; do not open a newer database with older code (ARC-11).`);
  }
  if (from === target) return { from, to: target, applied: [], backupPath: null };

  const now = (options.now ?? (() => new Date()))();
  const backupPath = options.backup !== false && options.path !== ':memory:' && hasTables(db) ? backupDatabase(db, options.path, from, now) : null;
  const applied: string[] = [];
  for (const m of ordered.slice(from)) {
    db.exec('BEGIN IMMEDIATE');
    try {
      m.up(db);
      db.exec(`PRAGMA user_version = ${m.version}`);
      db.exec('COMMIT');
      applied.push(`${m.version} ${m.name}`);
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(
        `${options.label}: migration ${m.version} "${m.name}" failed and was rolled back: ${(error as Error).message}.` +
          (backupPath ? ` The copy taken before the upgrade is ${backupPath}.` : ''),
      );
    }
  }
  return { from, to: target, applied, backupPath };
}
