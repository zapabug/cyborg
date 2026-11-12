import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  CORE_VERSION,
  defineModule,
  HandlerRegistry,
  loadModules,
  satisfies,
  scanModuleSources,
  unloadModule,
  validateManifest,
  type CapabilityResult,
  type LoadEnv,
  type ModuleDefinition,
  type Pack,
} from '@cyborg/core';
import { echoHandler, goodResponse, ScriptedModel, textEvent } from '@cyborg/core/testing';
import { Runner } from '@cyborg/core';
import { SqliteStore } from '../src/index.ts';

const at = '2026-10-31T10:00:00.000Z';
const baseManifest = {
  id: 'demo',
  version: '1.0.0',
  coreRange: '>=0.0.0 <1.0.0',
  handlers: ['demo.echo'],
  profileKeys: [],
  packs: [],
  capabilities: ['json_object'],
  privacy: { classes: ['public'], mechanisms: [] },
  dependencies: [],
};
const demo = (manifest: Record<string, unknown> = {}, handlerOver: Parameters<typeof echoHandler>[0] = {}): ModuleDefinition =>
  defineModule({
    manifest: { ...baseManifest, ...manifest },
    create: () => [echoHandler({ id: 'demo.echo', ...handlerOver })],
  });

const capability = (level: CapabilityResult['level']): CapabilityResult => ({
  baseUrl: 'http://x/v1', model: 'm', level, requestShape: level === 'none' ? null : 'json_object', logprobs: false, testedAt: at, attempts: [],
});
const pack: Pack = {
  id: 'pack-test', version: '1', asOf: at, openQuestions: [],
  facts: [{ key: 'p.a', value: 1, grade: 'secondary', sourceUrl: 'https://example.invalid', sourceDate: at, asOf: at }],
};

function env(store: SqliteStore, over: Partial<LoadEnv> = {}): LoadEnv {
  return { coreVersion: CORE_VERSION, profile: store, packs: [], capabilities: [capability('strict_schema')], connectors: {}, dependencyChecks: {}, ...over };
}
const registry = () => new HandlerRegistry({ autoReplyHandlers: [] });

// M5-EC1
test('M5-EC1: a valid manifest passes; an invalid one is rejected with every error listed', () => {
  assert.equal(validateManifest(baseManifest).ok, true);
  const bad = validateManifest({
    id: 'Bad Id',
    version: '1.0',
    coreRange: 'newer than 2',
    handlers: 'demo.echo',
    profileKeys: [{ key: 'a', type: 'date' }],
    packs: [{ id: 'p', minGrade: 'unverified' }],
    capabilities: ['tools'],
    privacy: { classes: ['private'], mechanisms: ['magic'] },
    dependencies: [{ kind: 'cloud', name: '', how: '' }],
  });
  assert.equal(bad.ok, false);
  const errors = (bad as { errors: string[] }).errors;
  for (const path of ['id', 'version', 'coreRange', 'handlers', 'profileKeys.0.type', 'packs.0.minGrade', 'capabilities.0', 'privacy.classes.0', 'privacy.mechanisms.0', 'dependencies.0.kind', 'dependencies.0.name', 'dependencies.0.how']) {
    assert.ok(errors.some((e) => e.startsWith(`${path}:`)), `error for ${path}`);
  }
  assert.equal(validateManifest(null).ok, false);
});

test('an invalid manifest refuses the module in the loader and registers nothing', () => {
  const reg = registry();
  const report = loadModules(reg, [defineModule({ manifest: { id: 'x' }, create: () => [echoHandler({ id: 'x.a' })] })], env(new SqliteStore(':memory:')));
  assert.equal(report.loaded.length, 0);
  assert.ok(report.refused[0]!.unmet.length > 3);
  assert.ok(report.refused[0]!.unmet.every((u) => u.kind === 'manifest'));
  assert.equal(reg.all().length, 0);
});

// M5-EC2
test('M5-EC2: the loader refuses a module with unmet requirements and lists every one', () => {
  const store = new SqliteStore(':memory:');
  const module = defineModule({
    manifest: {
      ...baseManifest,
      coreRange: '>=1.0.0',
      profileKeys: [{ key: 'k.a', type: 'string' }, { key: 'k.b', type: 'string' }],
      packs: [{ id: 'pack-test', minGrade: 'checked' }, { id: 'pack-missing', minGrade: 'secondary' }],
      capabilities: ['strict_schema'],
      dependencies: [
        { kind: 'connector', name: 'channel', how: 'adapter supplies it' },
        { kind: 'local_tool', name: 'whisper', how: 'binary on PATH' },
        { kind: 'service', name: 'shop', how: 'HTTP 200 on /health' },
      ],
    },
    create: () => [echoHandler({ id: 'demo.echo', model: { level: 'strict_schema', name: 'm' } })],
  });
  const reg = registry();
  store.putFact({ key: 'k.a', value: 1, class: 'public', source: 'document', sourceRef: 'f' }, 'a', at);
  const report = loadModules(reg, [module], env(store, {
    packs: [pack],
    capabilities: [capability('json_object')],
    connectors: {},
    dependencyChecks: { 'local_tool:whisper': () => ({ ok: false, detail: 'not found on PATH' }) },
  }));
  assert.equal(report.loaded.length, 0);
  assert.equal(reg.all().length, 0, 'nothing of a refused module is registered');
  const unmet = report.refused[0]!.unmet.map((u) => `${u.kind}:${u.item}`);
  assert.deepEqual(unmet.sort(), [
    'capability:strict_schema',
    'core_range:>=1.0.0',
    'dependency:connector:channel',
    'dependency:connector:channel',
    'dependency:local_tool:whisper',
    'dependency:service:shop',
    'pack:pack-missing',
    'pack:pack-test',
    'profile_key:k.b',
  ].sort());
});

test('M5-EC2: a module whose requirements are met loads and its handlers are registered', () => {
  const store = new SqliteStore(':memory:');
  store.putFact({ key: 'k.a', value: 1, class: 'public', source: 'document', sourceRef: 'f' }, 'a', at);
  const reg = registry();
  const module = demo({ coreRange: '^0.0.0', profileKeys: [{ key: 'k.a', type: 'string' }], packs: [{ id: 'pack-test', minGrade: 'secondary' }], dependencies: [{ kind: 'local_tool', name: 'whisper', how: 'binary on PATH' }] }, { profileKeys: ['k.a'], prompt: { template: '{{text}}', slots: { text: 'text' } } });
  const report = loadModules(reg, [module], env(store, { packs: [pack], dependencyChecks: { 'local_tool:whisper': () => ({ ok: true }) } }));
  assert.deepEqual(report.refused, []);
  assert.deepEqual(report.loaded, [{ moduleId: 'demo', handlerIds: ['demo.echo'] }]);
  assert.equal(reg.get('demo.echo')?.id, 'demo.echo');
});

test('MOD-11: the range grammar', () => {
  assert.equal(satisfies('0.1.5', '>=0.1.0 <0.2.0'), true);
  assert.equal(satisfies('0.2.0', '>=0.1.0 <0.2.0'), false);
  assert.equal(satisfies('0.1.5', '^0.1.2'), true);
  assert.equal(satisfies('0.2.0', '^0.1.2'), false);
  assert.equal(satisfies('1.9.0', '^1.2.0'), true);
  assert.equal(satisfies('2.0.0', '^1.2.0'), false);
  assert.equal(satisfies('3.0.0', '*'), true);
  assert.equal(satisfies('1.0.0', '=1.0.0'), true);
  assert.throws(() => satisfies('1.0.0', '~1'));
});

test('CORE_VERSION equals the core package version', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../core/package.json', import.meta.url), 'utf8')) as { version: string };
  assert.equal(CORE_VERSION, pkg.version);
});

// M5-EC3
test('MOD-14: ctx.connector returns only declared connectors', () => {
  const store = new SqliteStore(':memory:');
  const channel = { send: () => 'sent' };
  let seen: { declared?: unknown; undeclared?: string } = {};
  const module = defineModule({
    manifest: { ...baseManifest, dependencies: [{ kind: 'connector', name: 'channel', how: 'adapter' }] },
    create: (ctx) => {
      seen.declared = ctx.connector('channel');
      try { ctx.connector('contacts'); } catch (e) { seen.undeclared = (e as Error).message; }
      return [echoHandler({ id: 'demo.echo' })];
    },
  });
  const report = loadModules(registry(), [module], env(store, { connectors: { channel, contacts: {} }, dependencyChecks: { 'connector:channel': () => ({ ok: true }) } }));
  assert.equal(report.loaded.length, 1);
  assert.equal(seen.declared, channel);
  assert.match(seen.undeclared ?? '', /did not declare connector "contacts"/);
});

test('MOD-2: the source scan flags adapters, stores, the network and processes', () => {
  const violations = scanModuleSources([
    { path: 'a.ts', text: "import { SqliteStore } from '@cyborg/store-sqlite';\nconst x = 1;" },
    { path: 'b.ts', text: "import http from 'node:http';\nawait fetch('https://example.invalid');" },
    { path: 'c.ts', text: "import { wazaa } from '../adapters/wazaa-adapter.ts';" },
    { path: 'd.ts', text: "import { DatabaseSync } from 'node:sqlite';\nimport { exec } from 'node:child_process';" },
    { path: 'ok.ts', text: "import { z } from 'zod';\nimport type { AnyHandler } from '@cyborg/core';" },
  ]);
  assert.deepEqual(violations.map((v) => `${v.path}:${v.line}`), ['a.ts:1', 'b.ts:1', 'b.ts:2', 'c.ts:1', 'd.ts:1', 'd.ts:2']);
});

test('MOD-2: no module package in this repository breaks the boundary', () => {
  const root = new URL('../../', import.meta.url).pathname;
  const files: { path: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith('.ts')) files.push({ path, text: readFileSync(path, 'utf8') });
    }
  };
  for (const pkg of readdirSync(root).filter((n) => n.startsWith('module-'))) walk(join(root, pkg, 'src'));
  assert.deepEqual(scanModuleSources(files), []);
});

// M5-EC4
test('MOD-3: two modules cannot register colliding handler ids; ids must be namespaced', () => {
  const store = new SqliteStore(':memory:');
  const reg = registry();
  const second = defineModule({ manifest: { ...baseManifest, id: 'other', handlers: ['demo.echo'] }, create: () => [echoHandler({ id: 'demo.echo' })] });
  const report = loadModules(reg, [demo(), second], env(store));
  assert.deepEqual(report.loaded.map((l) => l.moduleId), ['demo']);
  const unmet = report.refused[0]!.unmet.map((u) => u.detail);
  assert.ok(unmet.some((d) => /must start with "other\."/.test(d)));
  assert.ok(unmet.some((d) => /already registered/.test(d)));
  assert.equal(reg.all().length, 1);
});

test('MOD-5, MOD-16: unloading removes handlers and keeps stored proposals and audit rows', async () => {
  const store = new SqliteStore(':memory:');
  const reg = registry();
  loadModules(reg, [demo()], env(store));
  const runner = new Runner({ businessId: 'b', registry: reg, store, ledger: store, model: new ScriptedModel([goodResponse]), now: () => new Date(at) });
  await runner.handle(textEvent('e1'));
  const proposals = store.list();
  const audit = store.listAudit();
  assert.equal(proposals.length, 1);
  assert.deepEqual(unloadModule(reg, 'demo'), ['demo.echo']);
  assert.equal(reg.all().length, 0);
  assert.deepEqual(store.list(), proposals);
  assert.deepEqual(store.listAudit(), audit);
  assert.deepEqual(await runner.handle(textEvent('e2')), [], 'an unloaded module no longer handles events');
});

test('MOD-13: the module is checked against its own manifest', () => {
  const store = new SqliteStore(':memory:');
  const cases: [string, ModuleDefinition, RegExp][] = [
    ['unlisted handler', defineModule({ manifest: { ...baseManifest, handlers: [] }, create: () => [echoHandler({ id: 'demo.echo' })] }), /created but not listed/],
    ['listed but absent', defineModule({ manifest: { ...baseManifest, handlers: ['demo.echo', 'demo.ghost'] }, create: () => [echoHandler({ id: 'demo.echo' })] }), /listed in the manifest but not created/],
    ['profile key not in manifest', demo({}, { profileKeys: ['k.x'], prompt: { template: '{{text}}', slots: { text: 'text' } } }), /profile key "k\.x"/],
    ['class not in privacy', demo({ privacy: { classes: ['deal'], mechanisms: [] } }), /is class public, not in the manifest/],
    ['level not covered', demo({ capabilities: [] }), /needs json_object, which the manifest does not declare/],
  ];
  for (const [name, module, pattern] of cases) {
    const report = loadModules(registry(), [module], env(store));
    assert.equal(report.loaded.length, 0, name);
    assert.ok(report.refused[0]!.unmet.some((u) => pattern.test(u.detail)), `${name}: ${JSON.stringify(report.refused[0]!.unmet)}`);
  }
});

test('MOD-15: adapter config selects which handlers of a module are on', () => {
  const store = new SqliteStore(':memory:');
  const two = defineModule({
    manifest: { ...baseManifest, handlers: ['demo.a', 'demo.b'] },
    create: () => [echoHandler({ id: 'demo.a' }), echoHandler({ id: 'demo.b' })],
  });
  const reg = registry();
  const report = loadModules(reg, [two], env(store, { config: { demo: { enabledHandlers: ['demo.b'] } } }));
  assert.deepEqual(report.loaded[0]!.handlerIds, ['demo.b']);
  assert.deepEqual(reg.all().map((h) => h.id), ['demo.b']);
});
