import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ScriptedModel } from '@cyborg/core/testing';
import { assetRecords, createCompany, withDeskCommands, dismissMaintenance, doneMaintenance, listMaintenance, loadCompanyConfig, scheduleMaintenance, seedProfile, withMaintenance } from '../src/index.ts';

// feat-wazaa-port W7, WZP-60..62: the maintenance watch through the company, with no model at all (the scripted model has nothing to say and is never called).
// Made-up plates and nicknames; a few of a Portuguese team's words for a problem.

const AT = '2026-11-02T09:00:00.000Z';
const ASSETS = [
  { id: 'van-01', label: 'Minibus 01', identifiers: ['AA 12 BB'], aliases: ['van 1'], consumables: ['óleo'] },
  { id: 'van-02', label: 'Minibus 02', identifiers: ['CC-34-DD'], aliases: ['van 2'] },
  { id: 'van-03', label: 'Minibus 03', identifiers: ['EE-56-FF'], aliases: ['van 3'] },
];
const MAINTENANCE = { issues: { high: ['avariou', 'não arranca'], medium: ['barulho'], low: ['revisão'] }, dedupHours: 24, contextWindowMsgs: 3, contextWindowMinutes: 10 };

async function withWatch<T>(work: (c: { company: ReturnType<typeof withMaintenance>; model: ScriptedModel; say: (chat: string, text: string, at?: string) => ReturnType<ReturnType<typeof withMaintenance>['process']> }) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'cyborg-mnt-'));
  const file = join(dir, 'c.json');
  writeFileSync(file, JSON.stringify({
    id: 'mnt', name: 'Mnt', language: 'en', store: { path: 's.sqlite', vaultPath: 'v.sqlite' }, inference: { baseUrl: 'http://127.0.0.1:1/v1', model: 'm' },
    chat: { authorisedSenders: ['owner'], originChannel: 'origin', roles: { 'team-1': 'monitor', 'customer-1': 'reply', 'ops-1': 'ops' } },
    modules: { maintenance: MAINTENANCE },
  }));
  const sink = (channel: string) => ({ channel, send: async () => undefined });
  const model = new ScriptedModel([]);
  const base = createCompany(loadCompanyConfig(file), { ack: sink('a'), review: sink('r') }, { model, capabilities: [], beforeLoad: (s) => void seedProfile(s, { profile: { 'fleet.assets': ASSETS } }, AT) });
  const company = withMaintenance(base, { config: MAINTENANCE, now: () => new Date(AT) });
  let n = 0;
  const say = (chat: string, text: string, at = AT) => company.process({ id: `e${++n}`, source: 'test', kind: 'message.received', at, payload: { chat, isGroup: true, addressed: false, sender: 'driver', text } });
  try {
    return await work({ company, model, say });
  } finally {
    base.close();
    rmSync(dir, { recursive: true });
  }
}
const minutes = (m: number) => new Date(Date.parse(AT) + m * 60_000).toISOString();

test('WZP-60: an asset and a problem in a team chat make one maintenance record, with a scrubbed snippet, and no model is called', async () => {
  await withWatch(async ({ company, model, say }) => {
    await say('team-1', 'a van 1 AA-12-BB não arranca, falar com o João +351 912 345 678');
    const [r] = listMaintenance(company);
    assert.deepEqual([r!.ref, r!.asset, r!.label, r!.priority, r!.status, r!.mentions], ['MNT-000001', 'van-01', 'Minibus 01', 'high', 'open', 1]);
    assert.equal(r!.issue, 'não arranca');
    assert.ok(r!.note.includes('[removed]') && !r!.note.includes('912'), 'the phone number is not kept');
    assert.equal(model.calls.length, 0, 'zero model calls in this path');
  });
});

test('WZP-60: only a role of monitor is watched: a customer chat, an unknown chat and a plain team message with no problem make nothing', async () => {
  await withWatch(async ({ company, say }) => {
    await say('customer-1', 'a van 1 avariou');
    await say('nowhere', 'a van 1 avariou');
    await say('team-1', 'a van 1 está limpa e pronta', minutes(0));
    await say('team-1', 'avariou alguma coisa, não sei o quê', minutes(60));
    assert.deepEqual(listMaintenance(company), []);
  });
});

test('WZP-60: a repeat mention within the dedupe window is the same record with a higher count; after it, a new one', async () => {
  await withWatch(async ({ company, say }) => {
    await say('team-1', 'van 2 com barulho', minutes(0));
    await say('team-1', 'a van 2 continua com barulho', minutes(30));
    const one = listMaintenance(company);
    assert.equal(one.length, 1);
    assert.equal(one[0]!.mentions, 2);
    await say('team-1', 'van 2 com barulho outra vez', minutes(25 * 60));
    assert.equal(listMaintenance(company).length, 2, 'more than 24 hours later is a new record');
    await say('team-1', 'van 1 revisão', minutes(25 * 60 + 1));
    assert.equal(listMaintenance(company).length, 3, 'another asset is its own record');
  });
});

test('WZP-60: an asset in one message and a problem in the next, close together, are one alert; far apart they are none', async () => {
  await withWatch(async ({ company, say }) => {
    await say('team-1', 'a van 2', minutes(0));
    await say('team-1', 'não arranca', minutes(2));
    assert.deepEqual(listMaintenance(company).map((r) => [r.asset, r.priority]), [['van-02', 'high']]);
    await say('team-1', 'a van 1', minutes(100));
    await say('team-1', 'barulho', minutes(130));
    assert.equal(listMaintenance(company).length, 1, '30 minutes apart is outside the 10-minute window');
  });
});

test('WZP-60: the raw message is never stored, only a scrubbed snippet of at most 200 characters', async () => {
  await withWatch(async ({ company, say }) => {
    const tail = 'TAIL-MARKER-NOT-STORED';
    await say('team-1', `van 1 avariou ${'x'.repeat(300)} ${tail}`);
    assert.ok(listMaintenance(company)[0]!.note.length <= 200);
    assert.ok(!JSON.stringify(company.store.list()).includes(tail) && !JSON.stringify(company.store.listAudit()).includes(tail));
  });
});

test('WZP-62: a person schedules, finishes or dismisses a record; open and urgent come first; a closed record cannot be changed', async () => {
  await withWatch(async ({ company, say }) => {
    await say('team-1', 'van 1 revisão', minutes(0));
    await say('team-1', 'van 2 não arranca', minutes(1));
    await say('team-1', 'van 3 barulho', minutes(2));
    const [a, b, c] = listMaintenance(company);
    assert.deepEqual([a!.asset, a!.priority, b!.priority, c!.priority], ['van-02', 'high', 'medium', 'low'], 'most urgent first');
    scheduleMaintenance(company, a!.id, '2026-11-09', 'dashboard:Ana');
    assert.deepEqual(listMaintenance(company).find((r) => r.id === a!.id)!.status, 'scheduled');
    assert.equal(listMaintenance(company).find((r) => r.id === a!.id)!.scheduledFor, '2026-11-09');
    assert.throws(() => scheduleMaintenance(company, a!.id, 'soon', 'x'), /YYYY-MM-DD/);
    assert.throws(() => dismissMaintenance(company, a!.id, 'x'), /scheduled record is closed with done/);
    doneMaintenance(company, a!.id, 'dashboard:Ana');
    assert.equal(listMaintenance(company).find((r) => r.id === a!.id)!.status, 'done');
    assert.throws(() => doneMaintenance(company, a!.id, 'x'), /already closed/);
    dismissMaintenance(company, c!.id, 'dashboard:Ana', 'not a problem');
    doneMaintenance(company, b!.id, 'dashboard:Ana');
    assert.deepEqual(listMaintenance(company).map((r) => r.status).sort(), ['dismissed', 'done', 'done']);
    assert.throws(() => doneMaintenance(company, 'nothing', 'x'), /not a maintenance record/);
    assert.ok(company.store.listAudit().some((r) => r.actor === 'dashboard:Ana' && r.toStatus === 'applied'), 'who did it is in the log');
  });
});

test('WZP-60: each asset has a track record: records, open ones, when last mentioned and the most urgent open one', async () => {
  await withWatch(async ({ company, say }) => {
    await say('team-1', 'van 1 revisão', minutes(0));
    await say('team-1', 'van 1 não arranca', minutes(60 * 25));
    const rec = assetRecords(company);
    assert.deepEqual(rec.map((r) => [r.id, r.total, r.open, r.worst]), [['van-01', 2, 2, 'high'], ['van-02', 0, 0, null], ['van-03', 0, 0, null]]);
    assert.ok(rec[0]!.lastAt);
  });
});

test('WZP-48: the office lists, schedules, finishes and dismisses maintenance records by reference in both languages; .done with a chat is still the gate\'s', async () => {
  await withWatch(async ({ company, say }) => {
    const acks: string[] = [];
    const commands = withDeskCommands(company, { commandPrefix: '.', authorisedSenders: ['owner'], ack: { channel: 'ops-ack', send: async (m) => void acks.push(m.text) } });
    const office = async (text: string) => { await commands.process({ id: `o${acks.length}-${text}`, source: 'test', kind: 'message.received', at: AT, payload: { chat: 'ops-1', isGroup: false, addressed: true, sender: 'owner', text } }); return acks.at(-1)!; };
    assert.equal(await office('.maintenance'), 'No maintenance record is open.');
    await say('team-1', 'a van 1 não arranca', minutes(0));
    await say('team-1', 'van 3 barulho', minutes(1));
    assert.equal(await office('.maintenance'), 'MNT-000001 · Minibus 01: não arranca · high\nMNT-000002 · Minibus 03: barulho · medium');
    assert.equal(await office('.schedule MNT-000002 2026-11-09'), 'MNT-000002 scheduled for 2026-11-09.');
    assert.match(await office('.maintenance'), /MNT-000002 · Minibus 03: barulho · medium, scheduled 2026-11-09/);
    assert.equal(await office('.done MNT-000001'), 'MNT-000001 done.');
    assert.match(await office('.dismiss 2'), /That could not be done: a scheduled record is closed with done/);
    assert.equal(await office('.done MNT-000002'), 'MNT-000002 done.');
    assert.match(await office('.done MNT-000009'), /That maintenance record does not exist\./);
    const before = acks.length;
    await office('.done some-chat');
    assert.equal(acks.length, before, '.done with a chat is left to the gate, which acknowledges on its own sink');
    await office('.lang pt');
    assert.equal(await office('.manutencao'), 'Nenhum pedido de manutenção aberto.');
    assert.match(await office('.feito MNT-9'), /Esse pedido de manutenção não existe\./);
  });
});

test('WZP-60: with no assets listed the watch loads and stays idle: it never invents a plate', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cyborg-mnt0-'));
  const file = join(dir, 'c.json');
  writeFileSync(file, JSON.stringify({
    id: 'mnt0', name: 'Mnt0', language: 'en', store: { path: 's.sqlite', vaultPath: 'v.sqlite' }, inference: { baseUrl: 'http://127.0.0.1:1/v1', model: 'm' },
    chat: { authorisedSenders: ['owner'], originChannel: 'origin', roles: { 'team-1': 'monitor' } }, modules: { maintenance: MAINTENANCE },
  }));
  const sink = (channel: string) => ({ channel, send: async () => undefined });
  const base = createCompany(loadCompanyConfig(file), { ack: sink('a'), review: sink('r') }, { model: new ScriptedModel([]), capabilities: [] });
  try {
    assert.deepEqual(base.loaded.refused, [], 'the module is not refused for lacking assets');
    const watching = withMaintenance(base, { config: MAINTENANCE, now: () => new Date(AT) });
    await watching.process({ id: 'x', source: 'test', kind: 'message.received', at: AT, payload: { chat: 'team-1', isGroup: true, addressed: false, sender: 'd', text: 'a van avariou' } });
    assert.deepEqual(listMaintenance(watching), []);
    assert.deepEqual(assetRecords(watching), []);
  } finally {
    base.close();
    rmSync(dir, { recursive: true });
  }
});
