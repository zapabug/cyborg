import { z } from 'zod';
import { DATA_CLASSES } from './data-class.ts';
import type { CapabilityResult, Pack, ProfileStore } from './profile-types.ts';
import { GRADE_ORDER } from './profile-types.ts';
import type { HandlerRegistry } from './registry.ts';
import { isValidRange, satisfies } from './semver.ts';
import type { AnyHandler } from './types.ts';

/** The running core's version (MOD-1); a test keeps it equal to packages/core/package.json. */
export const CORE_VERSION = '0.0.0';

const CAPABILITY_RANK = { json_object: 1, strict_schema: 2 } as const;

// ---- manifest (docs/07 MOD-10) ----------------------------------------------------

export const manifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'a lower-case id such as "sales" or "real-estate"'),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'a version like 1.2.3'),
  coreRange: z.string().refine(isValidRange, 'comparators such as ">=0.0.0 <1.0.0" or "^0.1.0"'),
  handlers: z.array(z.string().min(1)),
  profileKeys: z.array(z.object({ key: z.string().min(1), type: z.enum(['string', 'number', 'boolean', 'json']), optional: z.boolean().optional() })),
  packs: z.array(z.object({ id: z.string().min(1), minGrade: z.enum(['checked', 'secondary']) })),
  capabilities: z.array(z.enum(['strict_schema', 'json_object'])),
  privacy: z.object({
    classes: z.array(z.enum(DATA_CLASSES)),
    mechanisms: z.array(z.enum(['scrubber', 'vault'])),
  }),
  dependencies: z.array(
    z.object({
      kind: z.enum(['service', 'local_tool', 'model', 'connector']),
      name: z.string().min(1),
      how: z.string().min(1),
    }),
  ),
});
export type ModuleManifest = z.infer<typeof manifestSchema>;

export function validateManifest(input: unknown): { ok: true; manifest: ModuleManifest } | { ok: false; errors: string[] } {
  const parsed = manifestSchema.safeParse(input);
  if (parsed.success) return { ok: true, manifest: parsed.data };
  return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(manifest)'}: ${i.message}`) };
}

// ---- module definition and ctx (MOD-2, MOD-14) -------------------------------------

export interface ModuleContext {
  readonly moduleId: string;
  /** The adapter's configuration for this module (MOD-6); the module validates its own shape. */
  readonly config: unknown;
  /** Only connectors the manifest declared (`kind: connector`). */
  connector<T = unknown>(name: string): T;
}

export interface ModuleDefinition {
  manifest: unknown;
  create(ctx: ModuleContext): AnyHandler[];
}

export function defineModule(definition: ModuleDefinition): ModuleDefinition {
  return definition;
}

// ---- loader (MOD-1, MOD-12, MOD-13) --------------------------------------------------

export type DependencyCheck = () => { ok: true } | { ok: false; detail: string };

export interface LoadEnv {
  coreVersion: string;
  profile: Pick<ProfileStore, 'getFact'>;
  packs: readonly Pack[];
  capabilities: readonly CapabilityResult[];
  /** Connectors the adapter provides, by name. */
  connectors: Readonly<Record<string, unknown>>;
  /** Adapter-supplied checks, keyed `<kind>:<name>`. */
  dependencyChecks: Readonly<Record<string, DependencyCheck>>;
  /** Adapter configuration per module id, handed to the module as `ctx.config`. */
  moduleConfig?: Readonly<Record<string, unknown>>;
  /** MOD-6, MOD-15: per module, which handlers are on. Absent means all. */
  config?: Readonly<Record<string, { enabledHandlers?: readonly string[] }>>;
}

export interface Unmet {
  kind: 'manifest' | 'core_range' | 'profile_key' | 'pack' | 'capability' | 'dependency' | 'handler';
  item: string;
  detail: string;
}

export interface LoadReport {
  loaded: { moduleId: string; handlerIds: string[] }[];
  refused: { moduleId: string; unmet: Unmet[] }[];
}

function checkRequirements(manifest: ModuleManifest, env: LoadEnv): Unmet[] {
  const unmet: Unmet[] = [];
  if (!satisfies(env.coreVersion, manifest.coreRange)) {
    unmet.push({ kind: 'core_range', item: manifest.coreRange, detail: `the running core is ${env.coreVersion}` });
  }
  for (const { key, optional } of manifest.profileKeys) {
    if (!optional && !key.endsWith('.*') && !env.profile.getFact(key)) unmet.push({ kind: 'profile_key', item: key, detail: 'no such fact in the business profile' });
  }
  for (const need of manifest.packs) {
    const pack = env.packs.find((p) => p.id === need.id);
    if (!pack) unmet.push({ kind: 'pack', item: need.id, detail: 'pack is not loaded' });
    else if (!pack.facts.some((f) => GRADE_ORDER[f.grade] >= GRADE_ORDER[need.minGrade])) {
      unmet.push({ kind: 'pack', item: need.id, detail: `no fact of grade ${need.minGrade} or better` });
    }
  }
  for (const level of manifest.capabilities) {
    const ok = env.capabilities.some((c) => c.level !== 'none' && CAPABILITY_RANK[c.level] >= CAPABILITY_RANK[level]);
    if (!ok) unmet.push({ kind: 'capability', item: level, detail: 'no tested endpoint at this level' });
  }
  for (const dep of manifest.dependencies) {
    const id = `${dep.kind}:${dep.name}`;
    if (dep.kind === 'connector' && !(dep.name in env.connectors)) {
      unmet.push({ kind: 'dependency', item: id, detail: 'the adapter did not supply this connector' });
    }
    const check = env.dependencyChecks[id];
    if (!check) unmet.push({ kind: 'dependency', item: id, detail: `no check supplied (${dep.how})` });
    else {
      const result = check();
      if (!result.ok) unmet.push({ kind: 'dependency', item: id, detail: result.detail });
    }
  }
  return unmet;
}

function contextFor(manifest: ModuleManifest, env: LoadEnv): ModuleContext {
  const declared = new Set(manifest.dependencies.filter((d) => d.kind === 'connector').map((d) => d.name));
  return {
    moduleId: manifest.id,
    config: env.moduleConfig?.[manifest.id],
    connector<T>(name: string): T {
      if (!declared.has(name)) throw new Error(`module "${manifest.id}" did not declare connector "${name}" (MOD-14)`);
      return env.connectors[name] as T;
    },
  };
}

function checkHandlers(manifest: ModuleManifest, handlers: AnyHandler[], registry: HandlerRegistry): Unmet[] {
  const unmet: Unmet[] = [];
  const ids = handlers.map((h) => h.id);
  for (const id of ids) {
    if (!id.startsWith(`${manifest.id}.`)) unmet.push({ kind: 'handler', item: id, detail: `handler ids must start with "${manifest.id}." (MOD-3)` });
    if (registry.get(id)) unmet.push({ kind: 'handler', item: id, detail: 'a handler with this id is already registered (MOD-3)' });
  }
  if (new Set(ids).size !== ids.length) unmet.push({ kind: 'handler', item: manifest.id, detail: 'the module creates the same handler id twice' });
  for (const id of manifest.handlers.filter((h) => !ids.includes(h))) {
    unmet.push({ kind: 'handler', item: id, detail: 'listed in the manifest but not created' });
  }
  for (const id of ids.filter((i) => !manifest.handlers.includes(i))) {
    unmet.push({ kind: 'handler', item: id, detail: 'created but not listed in the manifest' });
  }
  const keys = new Set(manifest.profileKeys.map((k) => k.key));
  // CMP-28: a manifest key ending in ".*" declares a family of run-time keys (such as "live.*") the company chooses per install.
  const families = manifest.profileKeys.map((k) => k.key).filter((k) => k.endsWith('.*')).map((k) => k.slice(0, -1));
  const declared = (key: string) => keys.has(key) || families.some((f) => key.startsWith(f) && key.length > f.length);
  const classes = new Set<string>(manifest.privacy.classes);
  for (const handler of handlers) {
    for (const key of handler.profileKeys.filter((k) => !declared(k))) {
      unmet.push({ kind: 'handler', item: handler.id, detail: `reads profile key "${key}" that the manifest does not list` });
    }
    for (const [field, cls] of Object.entries(handler.input.classes)) {
      if (!classes.has(cls)) unmet.push({ kind: 'handler', item: handler.id, detail: `field "${field}" is class ${cls}, not in the manifest's privacy.classes` });
    }
    if (handler.kind === 'model') {
      const covered = manifest.capabilities.some((c) => CAPABILITY_RANK[c] >= CAPABILITY_RANK[handler.model.level]);
      if (!covered) unmet.push({ kind: 'handler', item: handler.id, detail: `needs ${handler.model.level}, which the manifest does not declare` });
    }
  }
  return unmet;
}

/** MOD-1: every unmet item is listed. A module with any is refused whole; nothing of it is registered. */
export function loadModules(registry: HandlerRegistry, definitions: readonly ModuleDefinition[], env: LoadEnv): LoadReport {
  const report: LoadReport = { loaded: [], refused: [] };
  for (const definition of definitions) {
    const validated = validateManifest(definition.manifest);
    if (!validated.ok) {
      const id = (definition.manifest as { id?: unknown } | null)?.id;
      report.refused.push({
        moduleId: typeof id === 'string' ? id : '(unknown)',
        unmet: validated.errors.map((e) => ({ kind: 'manifest' as const, item: 'manifest', detail: e })),
      });
      continue;
    }
    const manifest = validated.manifest;
    const unmet = checkRequirements(manifest, env);

    let handlers: AnyHandler[] = [];
    const connectorsReady = manifest.dependencies.filter((d) => d.kind === 'connector').every((d) => d.name in env.connectors);
    if (connectorsReady) {
      try {
        handlers = definition.create(contextFor(manifest, env));
        unmet.push(...checkHandlers(manifest, handlers, registry));
      } catch (error) {
        unmet.push({ kind: 'handler', item: manifest.id, detail: `create() threw: ${(error as Error).message}` });
      }
    }
    if (unmet.length > 0) {
      report.refused.push({ moduleId: manifest.id, unmet });
      continue;
    }

    const enabled = env.config?.[manifest.id]?.enabledHandlers;
    const selected = enabled ? handlers.filter((h) => enabled.includes(h.id)) : handlers;
    const registered: string[] = [];
    try {
      for (const handler of selected) {
        registry.registerHandler(handler);
        registered.push(handler.id);
      }
    } catch (error) {
      for (const id of registered) registry.unregister(id);
      report.refused.push({ moduleId: manifest.id, unmet: [{ kind: 'handler', item: manifest.id, detail: (error as Error).message }] });
      continue;
    }
    report.loaded.push({ moduleId: manifest.id, handlerIds: registered });
  }
  return report;
}

/** MOD-5, MOD-16: removes handlers only; proposals, audit rows and the ledger are untouched. */
export function unloadModule(registry: HandlerRegistry, moduleId: string): string[] {
  const ids = registry.all().filter((h) => h.id.startsWith(`${moduleId}.`)).map((h) => h.id);
  for (const id of ids) registry.unregister(id);
  return ids;
}

// ---- boundary scan (MOD-2, MOD-14) -----------------------------------------------------

const FORBIDDEN: { pattern: RegExp; why: string }[] = [
  { pattern: /from\s+['"]@cyborg\/store-sqlite['"]/, why: 'imports a store implementation' },
  { pattern: /from\s+['"]node:sqlite['"]/, why: 'imports node:sqlite' },
  { pattern: /from\s+['"]node:(http|https|http2|net|tls|dgram|dns|child_process|worker_threads)['"]/, why: 'imports a network or process module' },
  { pattern: /from\s+['"]@cyborg\/gateway['"]/, why: 'imports the gateway; model calls go through the runner' },
  { pattern: /from\s+['"][^'"]*adapter[^'"]*['"]/i, why: 'imports an adapter' },
  { pattern: /\bfetch\s*\(/, why: 'calls fetch' },
  { pattern: /\bnew\s+(WebSocket|XMLHttpRequest)\b/, why: 'opens a network connection' },
];

export interface BoundaryViolation {
  path: string;
  line: number;
  why: string;
}

/** Flags module source that reaches an adapter, a store, the network or a process directly. */
export function scanModuleSources(files: readonly { path: string; text: string }[]): BoundaryViolation[] {
  const out: BoundaryViolation[] = [];
  for (const file of files) {
    file.text.split('\n').forEach((line, i) => {
      for (const { pattern, why } of FORBIDDEN) if (pattern.test(line)) out.push({ path: file.path, line: i + 1, why });
    });
  }
  return out;
}
