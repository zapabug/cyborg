import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SqliteStore } from '../src/index.ts';

// WZP-50: a module's own state by key
test('WZP-50: module state is kept by module and key, versioned, audited with the actor, and listed per module', () => {
  const store = new SqliteStore(':memory:');
  assert.equal(store.getModuleState('bookings', 'chat-1'), null);
  assert.deepEqual(store.setModuleState('bookings', 'chat-1', { stage: 'collecting', tour: 'East Tour' }, 'bookings:state', '2026-11-05T10:00:00.000Z'), { version: 1 });
  assert.deepEqual(store.setModuleState('bookings', 'chat-1', { stage: 'confirming' }, 'bookings:state', '2026-11-05T10:01:00.000Z'), { version: 2 });
  store.setModuleState('bookings', 'chat-2', { stage: 'collecting' }, 'bookings:state', '2026-11-05T10:02:00.000Z');
  store.setModuleState('other', 'chat-1', { x: 1 }, 'other:state', '2026-11-05T10:03:00.000Z');
  assert.deepEqual(store.getModuleState('bookings', 'chat-1'), { value: { stage: 'confirming' }, version: 2, updatedAt: '2026-11-05T10:01:00.000Z' });
  assert.deepEqual(store.listModuleState('bookings').map((r) => [r.key, r.record.version]), [['chat-1', 2], ['chat-2', 1]], 'only that module\'s keys');
  const rows = store.listAudit().filter((r) => r.kind === 'module_state');
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[1]!.detail, { module: 'bookings', key: 'chat-1', version: 2 });
  assert.ok(!JSON.stringify(rows).includes('East Tour'), 'the audit names the key and version, not the value');
  store.close();
});
