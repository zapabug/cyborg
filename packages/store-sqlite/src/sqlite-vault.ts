import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { chmodSync, closeSync, openSync } from 'node:fs';
import type { IdentityVault, VaultEntry } from '@cyborg/core';
import { migrate, type MigrateResult, type Migration } from './migrate.ts';

/** ARC-9: append here, never edit an entry that has shipped. */
export const VAULT_MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'baseline schema', up: (db) => db.exec(`CREATE TABLE IF NOT EXISTS vault (
      code TEXT PRIMARY KEY,
      class TEXT NOT NULL CHECK (class IN ('identity', 'secret')),
      value TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (class, value)
    )`) },
];

/**
 * The identity vault (PRV-11): a separate SQLite file, owner-only permissions. Entries are
 * `{ code, class, value, createdAt }`. Encryption at rest and key custody are OPEN
 * (PRV-12); until they are decided the protection is the file mode and the separation
 * from the business database.
 */
export class SqliteVault implements IdentityVault {
  readonly migration: MigrateResult;
  private readonly db: DatabaseSync;

  constructor(
    path: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (path !== ':memory:') {
      // Create the file with mode 0600 before SQLite opens it, and force the mode if it already existed.
      closeSync(openSync(path, 'a', 0o600));
      chmodSync(path, 0o600);
    }
    this.db = new DatabaseSync(path);
    this.migration = migrate(this.db, VAULT_MIGRATIONS, { path, label: 'vault', now: this.now });
  }

  put(cls: 'identity' | 'secret', value: string): string {
    if (cls !== 'identity' && cls !== 'secret') throw new Error(`the vault holds identity and secret values only, not "${String(cls)}"`);
    const existing = this.db.prepare('SELECT code FROM vault WHERE class = ? AND value = ?').get(cls, value);
    if (existing) return existing['code'] as string;
    const code = `vault:${randomBytes(6).toString('hex')}`;
    this.db.prepare('INSERT INTO vault (code, class, value, created_at) VALUES (?, ?, ?, ?)').run(code, cls, value, this.now().toISOString());
    return code;
  }

  /** feat-desk DSK-42: a person's `.forget` drops a customer's name from the vault (the caller checks no other chat still uses the code). */
  remove(code: string): boolean {
    return Number(this.db.prepare('DELETE FROM vault WHERE code = ?').run(code).changes) > 0;
  }

  get(code: string): VaultEntry | null {
    const row = this.db.prepare('SELECT code, class, value, created_at FROM vault WHERE code = ?').get(code);
    if (!row) return null;
    return {
      code: row['code'] as string,
      class: row['class'] as 'identity' | 'secret',
      value: row['value'] as string,
      createdAt: row['created_at'] as string,
    };
  }

  close(): void {
    this.db.close();
  }
}
