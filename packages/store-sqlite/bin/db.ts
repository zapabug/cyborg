// ARC-10, ARC-13: look at a database file's schema version, or take a copy of it, without opening it through the store
// (opening through the store runs pending migrations).
import { DatabaseSync } from 'node:sqlite';
import { backupDatabase, schemaVersion } from '../src/migrate.ts';
import { STORE_MIGRATIONS } from '../src/sqlite-store.ts';
import { VAULT_MIGRATIONS } from '../src/sqlite-vault.ts';

const [command, path] = process.argv.slice(2);
if ((command !== 'info' && command !== 'backup') || !path) {
  console.error('usage: pnpm db info <file>   shows the schema version and what this code expects\n       pnpm db backup <file> writes a copy next to it, readable by its owner only');
  process.exit(2);
}

const db = new DatabaseSync(path, { readOnly: command === 'info' });
try {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => String(r['name']));
  const isVault = tables.includes('vault') && !tables.includes('proposals');
  const version = schemaVersion(db);
  if (command === 'info') {
    const expected = (isVault ? VAULT_MIGRATIONS : STORE_MIGRATIONS).length;
    console.log(`${isVault ? 'vault' : 'business store'}: schema version ${version}, this code expects ${expected}`);
    console.log(version === expected ? 'up to date' : version < expected ? 'older: opening it through cyborg will copy it and migrate it' : 'NEWER than this code: cyborg will refuse to open it');
  } else {
    console.log(backupDatabase(db, path, version, new Date()));
  }
} finally {
  db.close();
}
