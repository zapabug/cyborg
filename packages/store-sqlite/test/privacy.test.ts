import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { HandlerRegistry, Runner } from '@cyborg/core';
import { echoHandler, goodResponse, ScriptedModel, textEvent } from '@cyborg/core/testing';
import { z } from 'zod';
import { findLeaks, purgeExpiredLedger, SqliteStore, SqliteVault } from '../src/index.ts';
import { probeHandler, runLeakCheck, token } from './leak-harness.ts';
import { setup } from './helpers.ts';

const probeEvent = (id: string, payload: Record<string, string>) => ({
  id,
  source: 'leak-source',
  kind: 'leak.probe',
  at: '2026-10-31T10:00:00.000Z',
  payload,
});

// M2-EC3
test('PRV-6: a scrubber hit is replaced by a placeholder and the call goes ahead; the number is in no prompt, ledger row, proposal or audit row', async () => {
  const store = new SqliteStore(':memory:');
  const vault = new SqliteVault(':memory:');
  const registry = new HandlerRegistry({ autoReplyHandlers: [] });
  registry.registerHandler(probeHandler);
  const model = new ScriptedModel([JSON.stringify({ summary: 'ok' })]);
  const runner = new Runner({ businessId: 'b', registry, store, ledger: store, model, vault });

  const phone = '+351 912 345 678';
  const [outcome] = await runner.handle(probeEvent('e1', { name: token('name'), contact: phone, note: `please call ${phone}`, topic: 'visit' }));
  assert.equal(outcome!.outcome, 'proposal');
  const proposal = (outcome as { proposal: { status: string; reason: string | null; findings: { statement: string; evidence: string }[]; modelCallId: string | null } }).proposal;
  assert.equal(proposal.status, 'proposed');
  assert.notEqual(proposal.reason, 'manual_handling: scrubber hit');
  assert.notEqual(proposal.modelCallId, null, 'a model call was made and recorded');
  assert.equal(model.calls.length, 1);
  assert.equal(model.calls[0]!.prompt, 'Topic: visit\nNote: please call [PHONE_1]');
  assert.match(proposal.findings.map((f) => f.statement).join('|'), /in the chat: a phone number/);
  const audit = store.listAudit().filter((a) => a.kind === 'scrub_replaced');
  assert.equal(audit.length, 1);
  assert.deepEqual((audit[0]!.detail as { fields: unknown }).fields, [{ field: 'note', rule: 'phone' }], 'the rule and the field, never the text');
  assert.deepEqual(findLeaks(store, [phone, '912 345 678']), []);
});

test('PRV-6: several kinds in one field become numbered placeholders by kind, overlapping rules make one placeholder, and a text with nothing left to replace is left alone', async () => {
  const { redact } = await import('@cyborg/core');
  const r = redact('Hi, it\'s Ana. Call me on +351 912 345 678 or write to ana.demo@example.com. My NIF is 123 456 789. And 987 654 321 too.');
  assert.equal(r.text, 'Hi, it\'s Ana. Call me on [PHONE_1] or write to [EMAIL_1]. My NIF is [NUMBER_1]. And [NUMBER_2] too.');
  assert.deepEqual(r.replaced.map((x) => x.placeholder), ['[PHONE_1]', '[EMAIL_1]', '[NUMBER_1]', '[NUMBER_2]']);
  assert.equal(redact('two bedrooms near the sea').replaced.length, 0);
  assert.equal(redact(r.text).replaced.length, 0, 'a redacted text has nothing left to replace');

  const store = new SqliteStore(':memory:');
  const vault = new SqliteVault(':memory:');
  const registry = new HandlerRegistry({ autoReplyHandlers: [] });
  registry.registerHandler(probeHandler);
  const model = new ScriptedModel([JSON.stringify({ summary: 'Call [PHONE_1] back' })]);
  const runner = new Runner({ businessId: 'b', registry, store, ledger: store, model, vault });
  const [outcome] = await runner.handle(probeEvent('e2', { name: token('name'), contact: token('contact'), note: 'ring +351 913 222 111', topic: 'visit' }));
  const findings = (outcome as { proposal: { findings: { statement: string }[] } }).proposal.findings.map((f) => f.statement).join('|');
  assert.match(findings, /in the chat: a phone number/);
});

test('a clean freetext field reaches the prompt', async () => {
  const model = await (async () => {
    const store = new SqliteStore(':memory:');
    const vault = new SqliteVault(':memory:');
    const registry = new HandlerRegistry({ autoReplyHandlers: [] });
    registry.registerHandler(probeHandler);
    const m = new ScriptedModel([JSON.stringify({ summary: 'ok' })]);
    const runner = new Runner({ businessId: 'b', registry, store, ledger: store, model: m, vault });
    await runner.handle(probeEvent('e1', { name: token('name'), contact: token('contact'), note: 'two bedrooms near the sea', topic: 'visit' }));
    return m;
  })();
  assert.equal(model.calls[0]!.prompt, 'Topic: visit\nNote: two bedrooms near the sea');
});

// M2-EC4
test('PRV-8: the ledger row exists before the response is used', async () => {
  let rowsSeenByChecks = -1;
  const holder: { env?: ReturnType<typeof setup> } = {};
  const env = setup([goodResponse], [
    echoHandler({
      checks: () => {
        rowsSeenByChecks = holder.env!.store.exportStoredText().filter((r) => r.table === 'prompt_ledger').length;
        return [];
      },
    }),
  ]);
  holder.env = env;
  await env.runner.handle(textEvent('e1'));
  assert.equal(rowsSeenByChecks, 1);
});

test('PRV-8: if the ledger write fails the response is never used', async () => {
  let used = false;
  const store = new SqliteStore(':memory:');
  const registry = new HandlerRegistry({ autoReplyHandlers: [] });
  registry.registerHandler(echoHandler({ checks: () => ((used = true), []) }));
  const failingLedger = { write: () => { throw new Error('disk full'); }, read: () => null };
  const runner = new Runner({ businessId: 'b', registry, store, ledger: failingLedger, model: new ScriptedModel([goodResponse]) });
  await assert.rejects(runner.handle(textEvent('e1')), /disk full/);
  assert.equal(used, false);
  assert.equal(store.list().length, 0);
});

test('PRV-8: the ledger row holds handler, version, endpoint, model, exact request, raw response and timing', async () => {
  const env = setup([goodResponse], [echoHandler()]);
  const [outcome] = await env.runner.handle(textEvent('e1'));
  const row = env.store.read((outcome as { proposal: { modelCallId: string } }).proposal.modelCallId)!;
  assert.equal(row.handlerId, 'test.echo');
  assert.equal(row.handlerVersion, '1');
  assert.equal(row.endpoint, 'scripted://local');
  assert.equal(row.model, 'scripted');
  assert.equal(row.rawResponse, goodResponse);
  assert.ok(row.durationMs >= 0 && row.at);
  assert.ok(row.requestPayload);
});

test('PRV-10, N-4: ledger rows older than the retention are purged, audit rows are not', async () => {
  const env = setup([goodResponse], [echoHandler()]);
  await env.runner.handle(textEvent('e1')); // ledger row stamped 2026-10-31T10:00Z by the fixed clock
  const auditBefore = env.store.listAudit().length;
  assert.equal(purgeExpiredLedger(env.store, new Date('2026-11-15T00:00:00Z')), 0, 'inside 30 days');
  assert.equal(purgeExpiredLedger(env.store, new Date('2026-12-15T00:00:00Z')), 1, 'outside 30 days');
  assert.equal(env.store.exportStoredText().filter((r) => r.table === 'prompt_ledger').length, 0);
  assert.equal(env.store.listAudit().length, auditBefore);
});

// M2-EC6
test('PRV-11: the vault is a separate file with owner-only permissions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cyborg-vault-'));
  try {
    const vaultPath = join(dir, 'vault.sqlite');
    const storePath = join(dir, 'business.sqlite');
    const vault = new SqliteVault(vaultPath);
    const store = new SqliteStore(storePath);
    assert.equal(statSync(vaultPath).mode & 0o777, 0o600);
    assert.notEqual(vaultPath, storePath);
    const value = token('identity');
    const code = vault.put('identity', value);
    assert.match(code, /^vault:[0-9a-f]{12}$/);
    assert.equal(vault.put('identity', value), code, 'same value, same code');
    assert.notEqual(vault.put('secret', value), code, 'class is part of the key');
    assert.equal(vault.get(code)?.value, value);
    assert.equal(vault.get(code)?.class, 'identity');
    vault.close();
    store.close();
    // The value is in the vault file and nowhere in the business database.
    const business = new DatabaseSync(storePath);
    const tables = business.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r['name']);
    assert.ok(!tables.includes('vault'));
    business.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PRV-11: an existing vault file with loose permissions is tightened', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cyborg-vault-'));
  try {
    const path = join(dir, 'vault.sqlite');
    new SqliteVault(path).close();
    // Loosen, then reopen.
    chmodSync(path, 0o666);
    new SqliteVault(path).close();
    assert.equal(statSync(path).mode & 0o777, 0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PRV-11: only identity and secret values may be stored in the vault', () => {
  const vault = new SqliteVault(':memory:');
  assert.throws(() => vault.put('deal' as never, 'x'));
});

test('PRV-2: handlers see vault codes for identity fields, and proposals refer to codes only', async () => {
  const store = new SqliteStore(':memory:');
  const vault = new SqliteVault(':memory:');
  const registry = new HandlerRegistry({ autoReplyHandlers: [] });
  registry.registerHandler(probeHandler);
  const runner = new Runner({ businessId: 'b', registry, store, ledger: store, model: new ScriptedModel([JSON.stringify({ summary: 'ok' })]), vault });
  const name = token('name');
  const [outcome] = await runner.handle(probeEvent('e1', { name, contact: token('contact'), note: 'a quiet street', topic: 'visit' }));
  const proposal = (outcome as { proposal: { subject: string } }).proposal;
  assert.match(proposal.subject, /^vault:[0-9a-f]{12}$/);
  assert.equal(vault.get(proposal.subject)?.value, name);
  assert.deepEqual(findLeaks(store, [name]), []);
});

test('a handler with identity fields and no vault configured cannot run', async () => {
  const store = new SqliteStore(':memory:');
  const registry = new HandlerRegistry({ autoReplyHandlers: [] });
  registry.registerHandler(probeHandler);
  const runner = new Runner({ businessId: 'b', registry, store, ledger: store, model: new ScriptedModel([]) });
  await assert.rejects(runner.handle(probeEvent('e1', { name: token('n'), contact: token('c'), note: 'x', topic: 't' })), /no identity vault/);
});

test('PRV-2: an input rejected by its schema leaves no value in the audit reason', async () => {
  const store = new SqliteStore(':memory:');
  const registry = new HandlerRegistry({ autoReplyHandlers: [] });
  const strict = echoHandler({
    input: { ...echoHandler().input, schema: z.object({ text: z.string().min(1000) }) },
  });
  registry.registerHandler(strict);
  const runner = new Runner({ businessId: 'b', registry, store, ledger: store, model: new ScriptedModel([]) });
  const value = token('secretish');
  await runner.handle(textEvent('e1', value));
  assert.deepEqual(findLeaks(store, [value]), []);
});

// M2-EC5 (machine part)
test('PRV-13: identity values never reach the ledger, proposals or audit rows', async () => {
  const values = { name: token('name'), contact: token('contact@leak.invalid'), phoneInNote: '+351 913 222 111' };
  const events = [
    probeEvent('a', { name: values.name, contact: values.contact, note: 'quiet street, two floors', topic: 'visit' }),
    probeEvent('b', { name: values.name, contact: values.phoneInNote, note: `reach me on ${values.phoneInNote}`, topic: 'visit' }),
    probeEvent('c', { name: token('other'), contact: values.contact, note: `write to ${values.contact}`, topic: 'visit' }),
  ];
  const result = await runLeakCheck(events, Object.values(values));
  assert.deepEqual(result.hits, []);
  assert.equal(result.proposals, 3);
  assert.equal(result.modelCalls, 3, 'events b and c went ahead with placeholders instead of the values');
});

test('PRV-13: the finder is not vacuous - a planted value is found in each table', () => {
  const store = new SqliteStore(':memory:');
  const planted = token('planted');
  store.create(
    { businessId: 'b', handlerId: 'h', handlerVersion: '1', status: 'proposed', subject: planted, changes: [], findings: [], questions: [], modelCallId: null, reason: null },
    null,
    '2026-10-31T10:00:00.000Z',
  );
  store.write({ handlerId: 'h', handlerVersion: '1', at: '2026-10-31T10:00:00.000Z', endpoint: null, model: null, requestPayload: { prompt: `x ${planted}` }, rawResponse: null, error: null, durationMs: 0 });
  store.appendAudit({ at: '2026-10-31T10:00:00.000Z', proposalId: null, kind: 'k', fromStatus: null, toStatus: null, actor: 'a', detail: { note: planted } });
  const tables = new Set(findLeaks(store, [planted]).map((h) => h.table));
  assert.deepEqual([...tables].sort(), ['audit', 'prompt_ledger', 'proposals']);
  assert.deepEqual(findLeaks(store, ['not-there']), []);
});
