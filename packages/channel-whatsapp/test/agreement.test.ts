import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Agreement, FINE_PRINT, readTerms, versionOf } from '../src/agreement.ts';

// feat-wazaa-port WZP-5: the client's written agreement is on record before any chat is read.

const dir = () => mkdtempSync(join(tmpdir(), 'wa-agree-'));

test('WZP-5: nobody has agreed until a person presses agree for the text that was shown', () => {
  const d = dir();
  const a = new Agreement(d, null);
  assert.equal(a.agreed(), false);
  assert.equal(a.view().recorded, null);
  assert.throws(() => a.accept('not-the-version', 'Ana Costa'), /has changed/);
  assert.equal(a.agreed(), false, 'a refused attempt records nothing');
  assert.equal(existsSync(join(d, 'agreement.json')), false);
});

test('WZP-5: the record keeps when, which text and the operator label; it is private to the machine and survives a restart', () => {
  const d = dir();
  const a = new Agreement(d, null);
  const rec = a.accept(a.version, '  dashboard:Ana ', new Date('2026-11-06T10:00:00.000Z'));
  assert.deepEqual(rec, { by: 'dashboard:Ana', at: '2026-11-06T10:00:00.000Z', version: a.version });
  assert.equal(statSync(join(d, 'agreement.json')).mode & 0o777, 0o600);
  assert.equal(new Agreement(d, null).agreed(), true, 'a new start reads the same record');
  assert.deepEqual(new Agreement(d, null).view().recorded, rec);
});

test('WZP-5: a changed text (the fine print or the business\'s own terms) asks again', () => {
  const d = dir();
  new Agreement(d, null).accept(new Agreement(d, null).version);
  assert.equal(new Agreement(d, 'Our own terms.').agreed(), false, 'the business added terms');
  const other = { en: [...FINE_PRINT.en, 'One more sentence.'], pt: FINE_PRINT.pt };
  assert.equal(new Agreement(d, null, other).agreed(), false, 'the framework text changed');
  assert.notEqual(versionOf(FINE_PRINT, null), versionOf(FINE_PRINT, 'terms'));
  assert.equal(versionOf(FINE_PRINT, null), versionOf(FINE_PRINT, null));
});

test('WZP-5: a damaged or hand-made record is no record', () => {
  const d = dir();
  const a = new Agreement(d, null);
  writeFileSync(join(d, 'agreement.json'), '{not json');
  assert.equal(a.agreed(), false);
  writeFileSync(join(d, 'agreement.json'), JSON.stringify({ by: '', version: a.version }));
  assert.equal(a.agreed(), false, 'no time');
  writeFileSync(join(d, 'agreement.json'), JSON.stringify({ by: 'Ana', at: 'x', version: 'old' }));
  assert.equal(a.agreed(), false, 'another version');
});

test('WZP-5: the business\'s own terms come from terms.md in the business folder, when there is one', () => {
  const root = dir();
  assert.equal(readTerms(root), null);
  writeFileSync(join(root, 'terms.md'), '  \n');
  assert.equal(readTerms(root), null, 'an empty file is none');
  writeFileSync(join(root, 'terms.md'), 'We keep messages for 30 days.\n');
  assert.equal(readTerms(root), 'We keep messages for 30 days.');
});

test('WZP-5: the fine print is in both staff languages and says what is read, what the AI service gets and that nothing goes to customers', () => {
  assert.equal(FINE_PRINT.en.length, FINE_PRINT.pt.length);
  const en = FINE_PRINT.en.join(' ');
  assert.match(en, /only those/);
  assert.match(en, /phone numbers/);
  assert.match(en, /nothing is sent to your customers/);
  assert.equal(readFileSync(new URL('../src/agreement.ts', import.meta.url), 'utf8').includes('351'), false, 'no number in the source');
});

test('WZP-5 (audit 2026-11-10): the fine print never claims names are replaced (PRV-7), and says a name in a message reaches the AI service', () => {
  const en = FINE_PRINT.en.join(' ');
  const pt = FINE_PRINT.pt.join(' ');
  assert.doesNotMatch(en, /names,/, 'no list that starts with names');
  assert.match(en, /Names are not replaced/);
  assert.match(pt, /Os nomes não são trocados/);
});

// The channel itself: constructing it does not start a browser (that happens in start()), so the gate can be tried on the real class.
import { WhatsAppChannel, linkOnlyFile, loadSalt, plan } from '../src/channel.ts';

function channelIn(root: string): { channel: WhatsAppChannel; agreement: Agreement } {
  const file = linkOnlyFile(root);
  const salt = loadSalt(file.dataDir);
  const agreement = new Agreement(file.dataDir, null);
  return { channel: new WhatsAppChannel({ file, plan: plan(file, salt), salt, commandPrefix: '!', agreement }), agreement };
}

test('WZP-5: the channel shows the fine print and no chats until the agreement is recorded, and refuses a choice', async () => {
  const { channel, agreement } = channelIn(dir());
  (channel as unknown as { state: string }).state = 'ready';
  const listing = await channel.directory().chats();
  assert.equal(listing.ready, true);
  assert.deepEqual(listing.chats, []);
  assert.equal(listing.agreement?.recorded, null);
  assert.equal(listing.agreement?.version, agreement.version);
  await assert.rejects(channel.directory().save([{ ref: 'wa-aaaaaaaaaaaa', role: 'reply' }], 'Ana'), /not agreed|has not agreed/);
  await assert.rejects(channel.directory().agree!('an-old-version', 'Ana'), /has changed/);
  assert.equal(agreement.agreed(), false);
  await channel.directory().agree!(agreement.version, 'Ana');
  assert.equal(agreement.agreed(), true);
});

test('WZP-5: with no agreement a message from a chat in the table is not read (nothing stored, nothing logged)', async () => {
  const root = dir();
  const { channel, agreement } = channelIn(root);
  const watched = (channel as unknown as { watched(key: string): string | null }).watched.bind(channel);
  const p = (channel as unknown as { deps: { plan: { roles: Record<string, string> }; salt: string } }).deps;
  const { chatRef } = await import('../src/channel.ts');
  const ref = chatRef(p.salt, '351900000002');
  p.plan.roles[ref] = 'reply';
  assert.equal(watched('351900000002'), null, 'in the table but not agreed');
  agreement.accept(agreement.version);
  assert.equal(watched('351900000002'), ref, 'the same chat once a person has agreed');
});
