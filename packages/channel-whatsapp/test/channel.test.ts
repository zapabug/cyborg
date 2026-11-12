import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { applyChoices, channelFileOf, chatKey, chatRef, loadChannelFile, loadSalt, plan, qrRows, scrubId, type KnownChat } from '../src/channel.ts';

const write = (obj: unknown): string => {
  const dir = mkdtempSync(join(tmpdir(), 'wa-'));
  const file = join(dir, 'whatsapp.json');
  writeFileSync(file, JSON.stringify(obj));
  return file;
};

test('chatKey: a person is the digits, a group keeps its id', () => {
  assert.equal(chatKey('351 912-345 678'), '351912345678');
  assert.equal(chatKey('351912345678@c.us'), '351912345678');
  assert.equal(chatKey('1203630@g.us'), '1203630@g.us');
});

test('chatRef: stable per salt, different per salt, never shows the number', () => {
  const a = chatRef('salt-a', '351912345678');
  assert.equal(a, chatRef('salt-a', '351912345678'));
  assert.notEqual(a, chatRef('salt-b', '351912345678'));
  assert.match(a, /^wa-[0-9a-f]{12}$/);
  assert.ok(!a.includes('351912345678'));
});

test('loadSalt: written once, owner-only, then read back', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wa-salt-'));
  const s = loadSalt(dir);
  assert.equal(loadSalt(dir), s);
  assert.equal(statSync(join(dir, 'wa-salt')).mode & 0o777, 0o600);
});

test('plan: reply chats get reply, the review chat and ops chat get ops, the account is authorised as "self"', () => {
  const file = loadChannelFile(write({ ownNumber: '351900000001', replyChats: ['351900000002', '351 900 000 003'], monitorChats: ['120363@g.us'], reviewChat: 'self', authorisedSenders: ['self'] }));
  const p = plan(file, 'salt');
  assert.equal(p.roles[chatRef('salt', '351900000002')], 'reply');
  assert.equal(p.roles[chatRef('salt', '351900000003')], 'reply');
  assert.equal(p.roles[chatRef('salt', '120363@g.us')], 'monitor');
  assert.equal(p.roles[p.reviewRef], 'ops');
  assert.equal(p.opsRef, p.reviewRef);
  assert.deepEqual(p.authorisedSenders, [chatRef('salt', '351900000001')]);
  assert.equal(p.roles[chatRef('salt', '351900000009')], undefined);
});

test('loadChannelFile refuses a customer chat that is also the review chat', () => {
  assert.throws(() => loadChannelFile(write({ ownNumber: '351900000001', replyChats: ['351900000001'], reviewChat: 'self' })), /customer chat and the review or ops chat/);
  assert.throws(() => loadChannelFile(write({ ownNumber: '351900000001', replyChats: ['351900000002'], reviewChat: '351900000002' })), /customer chat and the review or ops chat/);
});

test('loadChannelFile refuses an empty watch list, a missing number and unfilled placeholders', () => {
  assert.throws(() => loadChannelFile(write({ ownNumber: '351900000001', replyChats: [] })), /no chat is watched/);
  assert.throws(() => loadChannelFile(write({ replyChats: ['351900000002'] })), /ownNumber/);
  assert.throws(() => loadChannelFile(write({ ownNumber: '<fill in: x>', replyChats: ['351900000002'] })), /<fill in/);
  assert.throws(() => loadChannelFile(write({ ownNumber: '351900000001', replyChats: ['351900000002'], replyDelayMs: -1 })), /replyDelayMs/);
});

// ADM-106: the message id never reaches the core with a number in it. The numbers below are placeholders (HR-4 ruling pending, audit 2026-11-03).
const noNumber = (s: string) => assert.doesNotMatch(s.replace(/wa-[0-9a-f]{12}/g, 'REF'), /@|\d{7,}/);

test('scrubId: a person\'s message id keeps its shape, the number becomes the chat\'s reference', () => {
  const id = 'false_351900000002@c.us_3EB0C767D82B6A4A0D9E';
  const out = scrubId('salt', id);
  assert.equal(out, `false_${chatRef('salt', '351900000002')}_3EB0C767D82B6A4A0D9E`);
  assert.equal(scrubId('salt', id), out, 'the same message always gives the same id');
  assert.notEqual(scrubId('other-salt', id), out);
  noNumber(out);
});

test('scrubId: a group message hides the group and the sender', () => {
  const id = 'false_351900000002-1600000000@g.us_ABCDEF0123_351900000003@c.us';
  const out = scrubId('salt', id);
  assert.equal(out, `false_${chatRef('salt', '351900000002-1600000000@g.us')}_ABCDEF0123_${chatRef('salt', '351900000003')}`);
  noNumber(out);
});

test('scrubId: an @lid address the adapter resolved gets the reference it already knows', () => {
  const ref = chatRef('salt', '351900000002');
  assert.equal(scrubId('salt', 'true_123456789012345@lid_3EB0AA', new Map([['123456789012345@lid', ref]])), `true_${ref}_3EB0AA`);
  noNumber(scrubId('salt', 'true_123456789012345@lid_3EB0AA'));
});

test('scrubId: anything number-like left over and the whole id is hashed', () => {
  for (const id of ['false_351900000002@c.us_3EB01234567', 'false_351900000002@unknown.server_3EB0', 'odd-351900000002']) {
    const out = scrubId('salt', id);
    assert.match(out, /^wa-m-[0-9a-f]{24}$/, id);
    assert.equal(scrubId('salt', id), out);
  }
});

test('qrRows: a square of 0/1 modules with the three finder squares, the same code qrcode-terminal prints (ADM-111)', () => {
  const rows = qrRows('2@abc,def,ghi=');
  assert.ok(rows.length >= 21 && rows.every((r) => r.length === rows.length && /^[01]+$/.test(r)));
  const n = rows.length;
  for (const [r, c] of [[0, 0], [0, n - 7], [n - 7, 0]] as const) assert.equal(rows[r]!.slice(c, c + 7), '1111111', `finder at ${r},${c}`);
  assert.deepEqual(qrRows('2@abc,def,ghi='), rows);
});

// WZP-35..38: the chats a person chooses in the dashboard. The numbers below are placeholders, as above.
const OWN = '351900000001';
const SALT = 'salt';
const known = (rows: Record<string, KnownChat>): Map<string, KnownChat> => new Map(Object.entries(rows));
const chat = (key: string, group = false): [string, KnownChat] => [chatRef(SALT, key), { jid: group ? key : `${key}@c.us`, key, name: null, group }];
const fresh = () => plan(loadChannelFile(write({ ownNumber: OWN, replyChats: ['351900000002'], reviewChat: 'self', authorisedSenders: ['self'] })), SALT);

test('loadChannelFile accepts a file that watches only a team or the office chat, and still refuses one that watches nothing', () => {
  assert.doesNotThrow(() => loadChannelFile(write({ ownNumber: OWN, replyChats: [], monitorChats: ['120363@g.us'] })));
  assert.doesNotThrow(() => loadChannelFile(write({ ownNumber: OWN, replyChats: [], opsChat: '351900000005' })));
  assert.throws(() => loadChannelFile(write({ ownNumber: OWN, replyChats: [], monitorChats: [] })), /no chat is watched/);
});

test('applyChoices: a role is set and a chat set back to ignore is dropped, in the plan the gate and the adapter share', () => {
  const p = fresh();
  const list = new Map([chat('351900000002'), chat('351900000003'), chat('120363@g.us', true)]);
  const refGroup = chatRef(SALT, '120363@g.us');
  const changed = applyChoices(p, list, [{ ref: chatRef(SALT, '351900000003'), role: 'reply' }, { ref: refGroup, role: 'monitor' }, { ref: chatRef(SALT, '351900000002'), role: 'ignored' }]);
  assert.equal(p.roles[chatRef(SALT, '351900000003')], 'reply');
  assert.equal(p.roles[refGroup], 'monitor');
  assert.equal(p.roles[chatRef(SALT, '351900000002')], undefined, 'ignored is not watched');
  assert.equal(p.keys.get(refGroup), '120363@g.us');
  assert.deepEqual(changed.map((c) => c.role), ['reply', 'monitor', 'ignored']);
});

test('applyChoices: the account\'s own chat and a chat that is not in the list cannot be chosen, and a new office chat replaces the old one', () => {
  const p = fresh();
  const list = new Map([chat('351900000003'), chat('351900000004')]);
  assert.throws(() => applyChoices(p, list, [{ ref: p.ownRef, role: 'reply' }]), /not in the list/);
  const listWithOwn = new Map([...list, [p.ownRef, { jid: `${OWN}@c.us`, key: OWN, name: null, group: false }] as [string, KnownChat]]);
  assert.throws(() => applyChoices(p, listWithOwn, [{ ref: p.ownRef, role: 'reply' }]), /receives the drafts/);
  assert.throws(() => applyChoices(p, list, [{ ref: 'wa-000000000000', role: 'reply' }]), /not in the list/);
  const a = chatRef(SALT, '351900000003');
  const b = chatRef(SALT, '351900000004');
  applyChoices(p, list, [{ ref: a, role: 'ops' }]);
  assert.equal(p.opsRef, a);
  const changed = applyChoices(p, list, [{ ref: b, role: 'ops' }]);
  assert.equal(p.opsRef, b);
  assert.equal(p.roles[a], undefined, 'the old office chat is no longer one');
  assert.deepEqual(changed, [{ ref: a, role: 'ignored' }, { ref: b, role: 'ops' }]);
  applyChoices(p, list, [{ ref: b, role: 'reply' }]);
  assert.equal(p.opsRef, p.reviewRef, 'with no office chat the drafts and alerts go back to the account\'s own chat');
});

test('channelFileOf: what a person chose is written as a channel file that loads back into the same plan, and nothing chosen writes nothing', () => {
  const file = loadChannelFile(write({ ownNumber: OWN, replyChats: ['351900000002'], reviewChat: 'self', authorisedSenders: ['self'], replyDelayMs: 4000 }));
  const p = plan(file, SALT);
  const list = new Map([chat('351900000003'), chat('120363@g.us', true), chat('351900000005')]);
  applyChoices(p, list, [{ ref: chatRef(SALT, '351900000003'), role: 'reply' }, { ref: chatRef(SALT, '120363@g.us'), role: 'monitor' }, { ref: chatRef(SALT, '351900000005'), role: 'ops' }]);
  const dir = mkdtempSync(join(tmpdir(), 'wa-out-'));
  const path = join(dir, 'whatsapp.json');
  const body = channelFileOf(file, p, path)!;
  assert.deepEqual(body['replyChats'], ['351900000002', '351900000003']);
  assert.deepEqual(body['monitorChats'], ['120363@g.us']);
  assert.equal(body['opsChat'], '351900000005');
  assert.equal(body['replyDelayMs'], 4000);
  assert.ok(![...(body['replyChats'] as string[]), ...(body['monitorChats'] as string[]), body['opsChat'] as string].some((v) => /^wa-[0-9a-f]{12}$/.test(v)), 'the file lists the chats, never the core\'s internal references');
  writeFileSync(path, JSON.stringify(body));
  const again = plan(loadChannelFile(path), SALT);
  assert.deepEqual(again.roles, p.roles, 'the next start watches exactly what was chosen');
  assert.equal(again.opsRef, p.opsRef);
  const empty = plan(loadChannelFile(write({ ownNumber: OWN, replyChats: ['351900000002'], reviewChat: 'self' })), SALT);
  applyChoices(empty, new Map([chat('351900000002')]), [{ ref: chatRef(SALT, '351900000002'), role: 'ignored' }]);
  assert.equal(channelFileOf(file, empty, path), null);
});

test('WZP-34: the intake tasks chosen for a chat are kept in the plan, written to the channel file, and read back; a chat set to ignore loses them', () => {
  const file = loadChannelFile(write({ ownNumber: OWN, replyChats: ['351900000002'], reviewChat: 'self', authorisedSenders: ['self'], chatTasks: { '351900000002': ['Answering customer questions'] } }));
  const p = plan(file, SALT);
  assert.deepEqual(p.tasks[chatRef(SALT, '351900000002')], ['Answering customer questions']);
  const a = chatRef(SALT, '351900000003');
  const list = new Map([chat('351900000002'), chat('351900000003')]);
  applyChoices(p, list, [{ ref: a, role: 'reply', tasks: ['Giving prices and quotes', 'Checking availability'] }]);
  const dir = mkdtempSync(join(tmpdir(), 'wa-tasks-'));
  const path = join(dir, 'whatsapp.json');
  const body = channelFileOf(file, p, path)!;
  assert.deepEqual(body['chatTasks'], { '351900000002': ['Answering customer questions'], '351900000003': ['Giving prices and quotes', 'Checking availability'] });
  writeFileSync(path, JSON.stringify(body));
  assert.deepEqual(plan(loadChannelFile(path), SALT).tasks, p.tasks, 'the next start has the same tasks');
  applyChoices(p, list, [{ ref: a, role: 'ignored' }]);
  assert.equal(p.tasks[a], undefined);
  assert.throws(() => loadChannelFile(write({ ownNumber: OWN, replyChats: ['351900000002'], chatTasks: ['x'] })), /chatTasks must map/);
});

// feat-wazaa-port WZP-85: Unlink. The channel is built the usual way; its WhatsApp client is swapped for one that records what it is asked, so nothing
// opens a browser and no account is touched.
import { existsSync, mkdirSync as mkdirSyncW } from 'node:fs';
import { WhatsAppChannel } from '../src/channel.ts';

function fakeClient(over: { logout?: () => Promise<void> } = {}) {
  const calls: string[] = [];
  const client = {
    calls,
    on: () => client,
    logout: over.logout ?? (async () => { calls.push('logout'); }),
    destroy: async () => { calls.push('destroy'); },
    initialize: async () => { calls.push('initialize'); },
    info: { wid: { user: '351912345678' } },
  };
  return client;
}

function linkedChannel(over: { logout?: () => Promise<void> } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wa-unlink-'));
  const channel = new WhatsAppChannel({
    file: { ownNumber: '351912345678', replyChats: [], monitorChats: [], reviewChat: 'self', authorisedSenders: ['self'], dataDir: dir },
    plan: { reviewRef: 'self' } as never, salt: 'x', commandPrefix: '.', agreement: { agreed: () => true } as never,
  });
  const before = fakeClient(over);
  const after = fakeClient();
  const inner = channel as unknown as { client: unknown; state: string; linkedAs: string; build: () => unknown };
  inner.client = before;
  inner.state = 'ready';
  inner.linkedAs = '351912345678';
  inner.build = () => after;
  mkdirSyncW(join(dir, 'session', 'Default'), { recursive: true });
  writeFileSync(join(dir, 'session', 'Default', 'cookies'), 'signed-in');
  return { channel, inner, before, after, dir };
}

test('WZP-85: unlinking logs the account out, stops the client, deletes the stored session and starts a fresh client for a new code', async () => {
  const { channel, inner, before, after, dir } = linkedChannel();
  assert.ok(existsSync(join(dir, 'session', 'Default', 'cookies')));
  const result = await channel.unlink('dashboard:Ana Costa');
  assert.deepEqual(result, { loggedOut: true });
  assert.deepEqual(before.calls, ['logout', 'destroy'], 'logged out, then stopped');
  assert.equal(existsSync(join(dir, 'session')), false, 'the stored session, the only thing that keeps the account signed in, is gone');
  assert.deepEqual(after.calls, ['initialize'], 'a fresh client starts, so the link panel shows a new code');
  assert.equal(inner.state, 'initializing');
  assert.equal(inner.linkedAs, '');
  assert.deepEqual(channel.linkView(), { channel: 'WhatsApp', state: 'starting' });
  assert.equal(channel.directory().account?.(), null, 'no account is shown as linked');
});

test('WZP-85: a log out that fails (the phone is offline) is reported, and the stored session is deleted anyway', async () => {
  const { channel, before, dir } = linkedChannel({ logout: async () => { throw new Error('phone offline'); } });
  const result = await channel.unlink('dashboard:Ana Costa');
  assert.deepEqual(result, { loggedOut: false });
  assert.deepEqual(before.calls, ['destroy']);
  assert.equal(existsSync(join(dir, 'session')), false, 'this computer no longer holds the account');
});

test('WZP-85: there is nothing to unlink while the channel is not linked', async () => {
  const { channel, inner, before, dir } = linkedChannel();
  inner.state = 'qr';
  await assert.rejects(channel.unlink('x'), /not linked/);
  assert.deepEqual(before.calls, [], 'nothing was touched');
  assert.ok(existsSync(join(dir, 'session', 'Default', 'cookies')));
});
