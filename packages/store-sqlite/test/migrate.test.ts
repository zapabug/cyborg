import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { STORE_MIGRATIONS, SqliteStore, SqliteVault, type Migration } from '../src/index.ts';

const dir = () => mkdtempSync(join(tmpdir(), 'cyborg-migrate-'));
const backups = (d: string) => readdirSync(d).filter((f) => f.includes('.bak-'));
const raw = (path: string, sql: string) => {
  const db = new DatabaseSync(path);
  try {
    return db.prepare(sql).all();
  } finally {
    db.close();
  }
};

// ARC-9..13
test('ARC-9: a new database is created at the latest schema version with no backup', () => {
  const d = dir();
  try {
    const store = new SqliteStore(join(d, 'b.sqlite'));
    assert.deepEqual([store.migration.from, store.migration.to, store.migration.backupPath], [0, STORE_MIGRATIONS.length, null]);
    assert.equal(store.schemaVersion(), STORE_MIGRATIONS.length);
    store.close();
    assert.deepEqual(backups(d), []);
  } finally {
    rmSync(d, { recursive: true });
  }
});

test('ARC-9, ARC-10: a database made before versioning is adopted, with a copy taken first and the data kept', () => {
  const d = dir();
  const path = join(d, 'b.sqlite');
  try {
    const first = new SqliteStore(path);
    first.recordSettled('chat-1', 'staff', 'done', '2026-10-31T10:00:00.000Z');
    first.close();
    const legacy = new DatabaseSync(path);
    legacy.exec('PRAGMA user_version = 0');
    legacy.close();

    const store = new SqliteStore(path, { now: () => new Date('2026-11-01T08:00:00.000Z') });
    assert.equal(store.migration.from, 0);
    assert.deepEqual(store.migration.applied, STORE_MIGRATIONS.map((m) => `${m.version} ${m.name}`));
    assert.equal(store.lastSettledAt('chat-1'), '2026-10-31T10:00:00.000Z');
    store.close();

    const [backup] = backups(d);
    assert.equal(backup, 'b.sqlite.bak-v0-2026-11-01T08-00-00-000Z');
    assert.equal(statSync(join(d, backup!)).mode & 0o777, 0o600, 'a copy of the store is readable by its owner only');
    assert.deepEqual(raw(join(d, backup!), 'SELECT chat FROM settlements').map((r) => r['chat']), ['chat-1']);
  } finally {
    rmSync(d, { recursive: true });
  }
});

const N = STORE_MIGRATIONS.length;
const addNote: Migration = { version: N + 1, name: 'add a note column', up: (db) => db.exec('ALTER TABLE settlements ADD COLUMN note TEXT') };

test('ARC-9, ARC-10: a later migration alters an existing database after a copy; a reopen at the same version does nothing', () => {
  const d = dir();
  const path = join(d, 'b.sqlite');
  try {
    const v1 = new SqliteStore(path);
    v1.recordSettled('chat-1', 'staff', 'done', '2026-10-31T10:00:00.000Z');
    v1.close();
    const v2 = new SqliteStore(path, { migrations: [...STORE_MIGRATIONS, addNote], now: () => new Date('2026-11-01T08:00:00.000Z') });
    assert.deepEqual([v2.migration.from, v2.migration.to, v2.migration.applied], [N, N + 1, [`${N + 1} add a note column`]]);
    assert.equal(v2.lastSettledAt('chat-1'), '2026-10-31T10:00:00.000Z');
    v2.close();
    assert.deepEqual(backups(d), [`b.sqlite.bak-v${N}-2026-11-01T08-00-00-000Z`]);
    assert.deepEqual(raw(path, "SELECT name FROM pragma_table_info('settlements')").map((r) => r['name']).includes('note'), true);

    const again = new SqliteStore(path, { migrations: [...STORE_MIGRATIONS, addNote] });
    assert.deepEqual(again.migration.applied, []);
    again.close();
    assert.equal(backups(d).length, 1, 'no second copy when nothing ran');
  } finally {
    rmSync(d, { recursive: true });
  }
});

test('ARC-12: a failing migration rolls back, leaves the version where it was and names the copy', () => {
  const d = dir();
  const path = join(d, 'b.sqlite');
  try {
    new SqliteStore(path).close();
    const broken: Migration = { version: N + 1, name: 'half done', up: (db) => { db.exec('ALTER TABLE settlements ADD COLUMN note TEXT'); db.exec('ALTER TABLE no_such_table ADD COLUMN x TEXT'); } };
    assert.throws(() => new SqliteStore(path, { migrations: [...STORE_MIGRATIONS, broken], now: () => new Date('2026-11-01T08:00:00.000Z') }), new RegExp(`migration ${N + 1} "half done" failed and was rolled back.*bak-v${N}-2026-11-01T08-00-00-000Z`));
    assert.equal(raw(path, 'PRAGMA user_version')[0]!['user_version'], N);
    assert.equal(raw(path, "SELECT name FROM pragma_table_info('settlements')").some((r) => r['name'] === 'note'), false, 'the first half was undone too');
  } finally {
    rmSync(d, { recursive: true });
  }
});

test('ADM-81: a file at schema version 1 is upgraded to the chat index after a copy, keeping its data', () => {
  const d = dir();
  const path = join(d, 'b.sqlite');
  try {
    const v1 = new SqliteStore(path, { migrations: [STORE_MIGRATIONS[0]!] });
    v1.recordSettled('chat-1', 'staff', 'done', '2026-10-31T10:00:00.000Z');
    v1.close();
    const upgraded = new SqliteStore(path, { now: () => new Date('2026-11-01T08:00:00.000Z') });
    assert.deepEqual([upgraded.migration.from, upgraded.migration.applied], [1, ['2 chat index: event to chat links and customer contacts']]);
    assert.equal(upgraded.lastSettledAt('chat-1'), '2026-10-31T10:00:00.000Z');
    upgraded.linkEvent('chat', 'e1', 'chat-1', '2026-11-01T08:00:00.000Z');
    assert.equal(upgraded.chatOfEvent('chat', 'e1'), 'chat-1');
    assert.deepEqual(backups(d), ['b.sqlite.bak-v1-2026-11-01T08-00-00-000Z']);
    upgraded.close();
  } finally {
    rmSync(d, { recursive: true });
  }
});

test('ARC-11, ARC-13: a database newer than the code is refused untouched, and migrations must be numbered without gaps', () => {
  const d = dir();
  const path = join(d, 'b.sqlite');
  try {
    new SqliteStore(path).close();
    const newer = new DatabaseSync(path);
    newer.exec('PRAGMA user_version = 99');
    newer.close();
    assert.throws(() => new SqliteStore(path), new RegExp(`schema version 99 but this code knows up to ${N}`));
    assert.equal(raw(path, 'PRAGMA user_version')[0]!['user_version'], 99);
    assert.deepEqual(backups(d), []);
    assert.throws(() => new SqliteStore(join(d, 'c.sqlite'), { migrations: [STORE_MIGRATIONS[0]!, { version: N + 2, name: 'skips one', up: () => undefined }] }), /without gaps/);
  } finally {
    rmSync(d, { recursive: true });
  }
});

test('ARC-9: the vault is versioned the same way and a copy of it is owner-only', () => {
  const d = dir();
  const path = join(d, 'v.sqlite');
  try {
    const vault = new SqliteVault(path);
    assert.deepEqual([vault.migration.from, vault.migration.to], [0, 1]);
    const code = vault.put('identity', 'chat-ref-1');
    const legacy = new DatabaseSync(path);
    legacy.exec('PRAGMA user_version = 0');
    legacy.close();
    const reopened = new SqliteVault(path, () => new Date('2026-11-01T08:00:00.000Z'));
    assert.equal(reopened.get(code)?.value, 'chat-ref-1');
    const [backup] = backups(d);
    assert.equal(statSync(join(d, backup!)).mode & 0o777, 0o600);
  } finally {
    rmSync(d, { recursive: true });
  }
});
