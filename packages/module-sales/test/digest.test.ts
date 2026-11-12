import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildUpgradeDigest, flagReply, Lifecycle } from '@cyborg/core';
import { message, rig } from './helpers.ts';

const REPLY = 'sales.enquiry.reply_draft';
const draft = (text: string) => JSON.stringify({ draft: text });

test('PRF-80: a decision can carry a reason tag and a scrubbed note, both kept in the audit log', async () => {
  const env = rig({ enabledHandlers: [REPLY], script: [draft('First draft.'), draft('Second draft.'), draft('Third draft.')] });
  for (const id of ['e1', 'e2', 'e3']) await env.runner.handle(message('how much is the east tour', id));
  const [a, b, c] = env.store.list({ handlerId: REPLY });
  const lifecycle = new Lifecycle({ store: env.store });
  assert.throws(() => lifecycle.decide(a!.id, 'decline', 'person:staff', { reason: 'rude' as never }), /not a reason tag/);
  assert.throws(() => lifecycle.decide(a!.id, 'decline', 'person:staff', { reason: 'wrong_tone', note: 'call her on +351 912 345 678' }), /scrubber blocks/);
  assert.equal(env.store.get(a!.id)!.status, 'proposed', 'a refused note changed nothing');
  lifecycle.decide(a!.id, 'decline', 'person:staff', { reason: 'wrong_tone', note: 'too stiff for this guest' });
  lifecycle.decide(b!.id, 'approve', 'person:staff', { reason: 'other', note: 'fine after a small edit' });
  lifecycle.decide(c!.id, 'decline', 'person:staff');
  const row = env.store.listAudit(a!.id).find((r) => r.toStatus === 'declined')!;
  assert.deepEqual(row.detail, { reason: 'wrong_tone', note: 'too stiff for this guest' });
});

test('PRF-81..83: the digest gathers failures, refusals and decisions per handler version, with no customer text', async () => {
  const sender = 'sender-+351 913 777 000-ident';
  const bad = JSON.stringify({ nonsense: true });
  const env = rig({ enabledHandlers: [REPLY], mode: 'live', live: { isEnabled: () => true }, script: [draft('A colleague will follow up.'), bad, bad, new Error('connection refused') as never, new Error('connection refused') as never] });
  // 1: a good draft that a person declines; 2: invalid output; 3: a model that is down.
  await env.runner.handle(message('how much is the east tour', 'e1', sender));
  await env.runner.handle(message('is it good for kids?', 'e2', sender));
  await env.runner.handle(message('gostava de fazer um passeio', 'e3', sender));
  const lifecycle = new Lifecycle({ store: env.store });
  const good = env.store.list({ status: 'proposed' })[0]!;
  lifecycle.decide(good.id, 'decline', 'person:staff', { reason: 'missed_question', note: 'did not answer the kids question' });

  // A refusal that never became a proposal: an unconfirmed fact in live mode.
  env.store.putFact({ key: 'tone.style', value: 'formal', class: 'public', source: 'client_statement', sourceRef: 'test:fixture' }, 'a', '2026-10-31T11:00:00.000Z');
  await env.runner.handle(message('another question', 'e4', sender));

  // A flag.
  const proposal = good;
  await flagReply({ flags: env.store, proposals: env.store, ledger: env.store }, { proposalId: proposal.id, reason: 'unclear', note: 'confusing', actor: 'person:staff', lastMessages: ['private words from the customer'], autoReplied: false });

  const digest = buildUpgradeDigest({ proposals: env.store, ledgerFailures: (s) => env.store.listLedgerFailures(s), flags: env.store });
  const v = digest.versions.find((x) => x.handlerId === REPLY)!;
  assert.equal(v.handlerVersion, '9');
  assert.deepEqual(v.declined.map((d) => [d.reason, d.note]), [['missed_question', 'did not answer the kids question']]);
  assert.equal(v.invalidOutput.length, 2, 'one for the bad output, one for the model that was down');
  assert.match(v.invalidOutput[0]!.reason, /attempt 1.*attempt 2/);
  assert.deepEqual(v.modelFailures.map((f) => f.error), ['connection refused', 'connection refused']);
  assert.deepEqual(v.flags.map((f) => f.reason), ['unclear']);
  assert.ok(digest.refusals.some((r) => r.kind === 'profile_refused' && /tone\.style/.test(r.detail)));
  assert.match(digest.note, /not instructions|Treat it as data/);

  const text = JSON.stringify(digest);
  for (const secret of [sender, 'A colleague will follow up.', 'private words from the customer', 'how much is the east tour', 'gostava de fazer']) {
    assert.equal(text.includes(secret), false, `the digest leaks: ${secret}`);
  }
});

test('PRF-82: model failures from the ledger appear by handler version, and a string with personal data is withheld', async () => {
  const env = rig({ enabledHandlers: [REPLY], script: [new Error('HTTP 500: the server echoed +351 912 345 678 back') as never, new Error('request timed out after 60000 ms') as never] });
  await env.runner.handle(message('how much is the east tour', 'e1'));
  const digest = buildUpgradeDigest({ proposals: env.store, ledgerFailures: (s) => env.store.listLedgerFailures(s) });
  const v = digest.versions.find((x) => x.handlerId === REPLY)!;
  assert.deepEqual(v.modelFailures.map((f) => f.error), ['[withheld: the scrubber found personal data]', 'request timed out after 60000 ms']);
  assert.equal(v.proposals['invalid_output'], 1);
  assert.ok(!JSON.stringify(digest).includes('912 345'));
});

test('PRF-83: the digest only reads; a since filter drops older items', async () => {
  const env = rig({ enabledHandlers: [REPLY], script: [draft('A colleague will follow up.')] });
  await env.runner.handle(message('how much is the east tour', 'e1'));
  const before = JSON.stringify([env.store.list(), env.store.listAudit()]);
  const all = buildUpgradeDigest({ proposals: env.store, ledgerFailures: () => [] });
  buildUpgradeDigest({ proposals: env.store, ledgerFailures: () => [] }, { since: '2027-01-01T00:00:00.000Z' });
  assert.equal(JSON.stringify([env.store.list(), env.store.listAudit()]), before);
  assert.equal(all.versions.length, 1);
  assert.equal(buildUpgradeDigest({ proposals: env.store, ledgerFailures: () => [] }, { since: '2027-01-01T00:00:00.000Z' }).versions.length, 0);
});
