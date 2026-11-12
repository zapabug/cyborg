import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assetsIn, fold, hitsFor, issuesIn, redact, type Asset, type IssueWords, type Seen } from '../src/index.ts';

// feat WZP-60: the scan, with structural test inputs: made-up plates and nicknames, and a few of a team's words for a problem (Portuguese, as a Portuguese team
// writes them). No model is involved anywhere here.

const ASSETS: Asset[] = [
  { id: 'van-01', label: 'Minibus 01', identifiers: ['AA 12 BB', 'AA12BB'], aliases: ['van 1', 'le'], consumables: ['óleo', 'pastilhas'] },
  { id: 'van-02', identifiers: ['CC-34-DD'], aliases: ['van 2'] },
];
const ISSUES: IssueWords = { high: ['avariou', 'não arranca', 'nao arranca', 'fumo'], medium: ['barulho', 'furo'], low: ['revisão', 'revisao', 'desgaste'] };

test('a plate matches whatever the spacing, case or dashes, and an alias only as a whole word', () => {
  for (const text of ['a AA 12 BB avariou', 'aa-12-bb avariou', 'AA12BB avariou', 'a aa12bb avariou ontem']) assert.deepEqual(assetsIn(text, ASSETS).map((a) => a.id), ['van-01'], text);
  assert.deepEqual(assetsIn('a van 2 está ok', ASSETS).map((a) => a.id), ['van-02']);
  assert.deepEqual(assetsIn('o le avariou', ASSETS).map((a) => a.id), ['van-01']);
  assert.deepEqual(assetsIn('a leitura do contador', ASSETS), [], 'an alias inside another word is not the alias');
  assert.deepEqual(assetsIn('XAA12BBX', ASSETS), [], 'a plate inside a longer run is not the plate');
  assert.deepEqual(assetsIn('nada aqui', ASSETS), []);
});

test('problem words match as whole words, ignoring case and accents, at the highest level reached', () => {
  assert.deepEqual(issuesIn('A van NÃO ARRANCA', ISSUES), { priority: 'high', terms: ['não arranca', 'nao arranca'] }, 'accented and plain spellings are one');
  assert.deepEqual(issuesIn('tem um barulho e algum desgaste', ISSUES), { priority: 'medium', terms: ['barulho', 'desgaste'] });
  assert.deepEqual(issuesIn('precisa de revisão', ISSUES), { priority: 'low', terms: ['revisão', 'revisao'] });
  assert.equal(issuesIn('tudo bem com a van', ISSUES), null);
  assert.equal(issuesIn('fumou um cigarro', ISSUES), null, '"fumo" is not inside "fumou"');
  assert.equal(fold('Não ÓLEO'), 'nao oleo');
});

test('a consumable beside an asset is a low signal; words are matched, not guessed', () => {
  assert.deepEqual(issuesIn('o óleo da van 1', { high: [], medium: [], low: [] }, ['óleo']), { priority: 'low', terms: ['óleo'] });
  assert.equal(issuesIn('o oleo da van 1', { high: [], medium: [], low: [] }, []), null);
});

test('an asset and a problem together make a hit; either alone does not (the noise guard)', () => {
  const seen = (at: number, text: string): Seen => ({ at, assets: assetsIn(text, ASSETS).map((a) => a.id), issue: issuesIn(text, ISSUES) });
  const w = { messages: 3, ms: 10 * 60_000 };
  assert.deepEqual(hitsFor(seen(0, 'AA12BB avariou'), [], w), [{ asset: 'van-01', priority: 'high', terms: ['avariou'] }]);
  assert.deepEqual(hitsFor(seen(0, 'a van 1 está ótima'), [], w), []);
  assert.deepEqual(hitsFor(seen(0, 'avariou outra vez'), [], w), []);
  assert.deepEqual(hitsFor(seen(0, 'van 1 e van 2 com barulho'), [], w).map((h) => h.asset).sort(), ['van-01', 'van-02']);
});

test('across messages: the asset in one and the problem in a nearby one are one alert; far apart in messages or in time they are not', () => {
  const seen = (at: number, text: string): Seen => ({ at, assets: assetsIn(text, ASSETS).map((a) => a.id), issue: issuesIn(text, ISSUES) });
  const w = { messages: 3, ms: 10 * 60_000 };
  const m = 60_000;
  assert.deepEqual(hitsFor(seen(2 * m, 'não arranca'), [seen(0, 'a van 1'), seen(m, 'ok')], w), [{ asset: 'van-01', priority: 'high', terms: ['não arranca', 'nao arranca'] }], 'the problem after the asset');
  assert.deepEqual(hitsFor(seen(2 * m, 'a van 2'), [seen(0, 'barulho estranho')], w), [{ asset: 'van-02', priority: 'medium', terms: ['barulho'] }], 'the asset after the problem');
  assert.deepEqual(hitsFor(seen(20 * m, 'não arranca'), [seen(0, 'a van 1')], w), [], 'more than the window of minutes apart');
  assert.deepEqual(hitsFor(seen(5 * m, 'não arranca'), [seen(0, 'a van 1'), seen(m, 'a'), seen(2 * m, 'b'), seen(3 * m, 'c'), seen(4 * m, 'd')], w), [], 'more than the window of messages apart');
  assert.deepEqual(hitsFor(seen(m, 'não arranca'), [seen(0, 'a van 1')], { messages: 0, ms: 10 * m }), [], 'a window of no messages is the same message only');
});

test('a snippet is kept without a person\'s data: phones and emails are taken out', () => {
  assert.equal(redact('van 1 avariou, ligar +351 912 345 678 ou joao@example.com'), 'van 1 avariou, ligar [removed] ou [removed]');
  assert.equal(redact('van 1 avariou'), 'van 1 avariou');
});
