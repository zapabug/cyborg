import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SqliteStore } from '@cyborg/store-sqlite';
import { buildTree, exportTree, flattenTree, ImportError, importTree, onboardingReport, PackRegistry, renderOnboardingReport } from '../src/index.ts';
import { at, fact, packOf } from './helpers.ts';

// Structure typical of a business config file: nested maps, arrays of records with ids, arrays of
// scalars, empty containers, nulls, a mixed array, non-ASCII text. Values are structural.
const TREE = {
  currency: { code: 'EUR', symbol: '€' },
  store: { source: 'shop', sync_interval_minutes: 60, enabled: true, note: null },
  calendar: { closed_dates: ['12-25', '01-01'], extra: [] },
  tours: [
    { id: 'alpha-tour', name: 'Alpha', days: [2, 5, 0], keywords: ['a', 'b'], options: { sizes: [4, 6] } },
    { id: 'beta-tour', name: 'Beta ção', days: [], meta: {} },
  ],
  faqs: [{ questions: ['one', 'two'], answer: 'x' }, { questions: [], answer: 'y' }],
  mixed: [1, { a: 1 }, 'z'],
};

const sortKeys = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sortKeys(x)])) : v;

// M4-EC4 (machine part)
test('PRF-61: a parsed tree round-trips through facts without loss', () => {
  const store = new SqliteStore(':memory:');
  const result = importTree(store, TREE, { source: 'document', sourceRef: 'config/catalog.yaml', class: 'public', actor: 'cli', at });
  assert.ok(result.added > 20);
  assert.deepEqual(sortKeys(exportTree(store)), sortKeys(TREE));
  assert.deepEqual(sortKeys(buildTree(flattenTree(TREE))), sortKeys(TREE));
});

test('PRF-10, PRF-61: every imported fact is unconfirmed and carries its source', () => {
  const store = new SqliteStore(':memory:');
  importTree(store, TREE, { source: 'document', sourceRef: 'config/catalog.yaml', class: 'public', actor: 'cli', at });
  for (const f of store.listFacts()) {
    assert.equal(f.status, 'unconfirmed');
    assert.equal(f.source, 'document');
    assert.equal(f.sourceRef, `config/catalog.yaml#${f.key}`);
    assert.equal(f.confirmedBy, null);
  }
  assert.equal(store.getFact('tours.alpha-tour.days')!.sourceRef, 'config/catalog.yaml#tours.alpha-tour.days');
  assert.deepEqual(store.getFact('tours.$order')!.value, ['alpha-tour', 'beta-tour']);
  assert.deepEqual(store.getFact('faqs.$order')!.value, ['0', '1']);
});

test('a prefix scopes the import and the export', () => {
  const store = new SqliteStore(':memory:');
  importTree(store, TREE, { source: 'document', sourceRef: 'f', class: 'public', prefix: 'catalog', actor: 'cli', at });
  assert.ok(store.getFact('catalog.currency.code'));
  assert.deepEqual(sortKeys(exportTree(store, 'catalog')), sortKeys(TREE));
});

test('re-importing unchanged data keeps confirmations; changed data resets only that fact', () => {
  const store = new SqliteStore(':memory:');
  const options = { source: 'document' as const, sourceRef: 'f', class: 'public' as const, actor: 'cli', at };
  importTree(store, TREE, options);
  store.moveFact('currency.code', 'confirmed', { actor: 'p', at });
  store.moveFact('store.source', 'confirmed', { actor: 'p', at });
  const again = importTree(store, { ...TREE, store: { ...TREE.store, source: 'manual' } }, options);
  assert.equal(again.replaced, 1);
  assert.equal(again.added, 0);
  assert.equal(store.getFact('currency.code')!.status, 'confirmed');
  assert.equal(store.getFact('store.source')!.status, 'unconfirmed');
  assert.equal(store.getFact('store.source')!.value, 'manual');
});

test('an import that cannot be represented exactly is refused', () => {
  const store = new SqliteStore(':memory:');
  const o = { source: 'document' as const, sourceRef: 'f', class: 'public' as const, actor: 'cli', at };
  assert.throws(() => importTree(store, { 'a.b': 1 }, o), ImportError);
  assert.throws(() => importTree(store, { a: { '': 1 } }, o), ImportError);
  assert.throws(() => importTree(store, { a: { $order: 1 } }, o), ImportError);
  assert.throws(() => importTree(store, [1, 2], o), ImportError);
  assert.equal(store.listFacts().length, 0);
});

test('records without usable ids are keyed by index', () => {
  const dup = { items: [{ id: 'x', v: 1 }, { id: 'x', v: 2 }] };
  assert.deepEqual(flattenTree(dup).map((f) => f.key), ['items.$order', 'items.0.id', 'items.0.v', 'items.1.id', 'items.1.v']);
  assert.deepEqual(buildTree(flattenTree(dup)), dup);
});

// M4-EC6
test('PRF-3: the onboarding report lists missing, unconfirmed, contradicted and stale keys per module, with no score', () => {
  const store = new SqliteStore(':memory:');
  const packs = new PackRegistry();
  packs.add(packOf([{ key: 'pack.alpha', grade: 'secondary' }, ]));
  for (const k of ['k.confirmed', 'k.unconfirmed', 'k.contradicted', 'k.stale']) store.putFact(fact(k, 1, k === 'k.stale' ? { reviewBy: '2026-10-01T00:00:00.000Z' } : {}), 'a', at);
  store.moveFact('k.confirmed', 'confirmed', { actor: 'p', at });
  store.moveFact('k.contradicted', 'contradicted', { actor: 'p', at });
  store.moveFact('k.stale', 'confirmed', { actor: 'p', at });
  const report = onboardingReport({
    profile: store,
    packs,
    modules: [
      { moduleId: 'sales', profileKeys: ['k.confirmed', 'k.unconfirmed', 'k.contradicted', 'k.stale', 'k.absent'], packFacts: [{ key: 'pack.alpha', minGrade: 'checked' }, { key: 'pack.none', minGrade: 'checked' }] },
      { moduleId: 'admin', profileKeys: ['k.confirmed'] },
    ],
    capabilities: [],
    now: new Date(at),
  });
  const [sales, admin] = report.modules;
  assert.deepEqual(sales, {
    moduleId: 'sales',
    missing: ['k.absent'],
    unconfirmed: ['k.unconfirmed'],
    contradicted: ['k.contradicted'],
    stale: ['k.stale'],
    packIssues: [{ key: 'pack.alpha', reason: 'grade secondary below checked' }, { key: 'pack.none', reason: 'missing' }],
  });
  assert.deepEqual(admin, { moduleId: 'admin', missing: [], unconfirmed: [], contradicted: [], stale: [], packIssues: [] });
  assert.ok(!/score|ready|percent|%/i.test(JSON.stringify(report)), 'no readiness score');
  const text = renderOnboardingReport(report);
  assert.match(text, /missing \(1\): k\.absent/);
  assert.match(text, /none tested/);
});

test('GWY-10: stored capability results are shown in the onboarding report', () => {
  const store = new SqliteStore(':memory:');
  store.saveCapability({ baseUrl: 'http://x/v1', model: 'm', level: 'strict_schema', requestShape: 'json_schema_wrapped', logprobs: true, testedAt: at, attempts: [] });
  store.saveCapability({ baseUrl: 'http://x/v1', model: 'm', level: 'json_object', requestShape: 'json_object', logprobs: false, testedAt: at, attempts: [] });
  const report = onboardingReport({ profile: store, packs: new PackRegistry(), modules: [], capabilities: store.listCapabilities(), now: new Date(at) });
  assert.equal(report.capabilities.length, 1, 'only the newest result per base URL and model');
  assert.equal(report.capabilities[0]!.level, 'json_object');
});
