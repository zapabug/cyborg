import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { runCapabilityTest, type Fetch } from '@cyborg/gateway';
import type { CapabilityResult } from '@cyborg/core';
import type { LoadedConfig } from './config.ts';
import type { Company } from './runtime.ts';

// feat-model MDL-1..11. The AI service of an install is set in the dashboard: address, model and key. The values live in `model.json` in the install's
// data folder (outside the repository, owner-only), win over company.config.json at the next start, and apply to the running install at once. The key
// never reaches the config file, a log, the ledger or the page.

export const MODEL_KEY_ENV = 'CYBORG_MODEL_KEY';
const FILE = 'model.json';

/** MDL-3: presets fill the address and nothing else. A model is never preset. */
export const PRESETS: { id: string; label: { pt: string; en: string }; baseUrl: string; local: boolean }[] = [
  { id: 'openrouter', label: { pt: 'OpenRouter', en: 'OpenRouter' }, baseUrl: 'https://openrouter.ai/api/v1', local: false },
  { id: 'openai', label: { pt: 'OpenAI', en: 'OpenAI' }, baseUrl: 'https://api.openai.com/v1', local: false },
  { id: 'local', label: { pt: 'Neste computador', en: 'This computer' }, baseUrl: 'http://127.0.0.1:8081/v1', local: true },
  { id: 'custom', label: { pt: 'Outro endereço', en: 'Another address' }, baseUrl: '', local: false },
];

export interface ModelSettings {
  baseUrl: string;
  model: string;
  /** Absent when the service needs none (an address on this computer). */
  apiKey?: string;
}

export const isLocalAddress = (baseUrl: string): boolean => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(baseUrl);

export function readModelSettings(dataDir: string): ModelSettings | null {
  const file = resolve(dataDir, FILE);
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<ModelSettings>;
    if (typeof raw.baseUrl !== 'string' || typeof raw.model !== 'string' || raw.baseUrl === '' || raw.model === '') return null;
    return { baseUrl: raw.baseUrl, model: raw.model, ...(typeof raw.apiKey === 'string' && raw.apiKey !== '' ? { apiKey: raw.apiKey } : {}) };
  } catch {
    return null;
  }
}

export function writeModelSettings(dataDir: string, settings: ModelSettings): void {
  mkdirSync(dataDir, { recursive: true });
  const file = resolve(dataDir, FILE);
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

/** The environment variable that carries the key: ours when a key was saved in the dashboard (a deliberate choice wins), else the one the config names. */
function keyEnvFor(configured: string | undefined, hasFileKey: boolean): string | undefined {
  return hasFileKey ? MODEL_KEY_ENV : configured;
}

/**
 * MDL-7: at start, the saved settings replace the config's address and model, and the key is handed to the gateway through the environment
 * (never through the config). Returns what it applied, or null when there is no saved file.
 */
export function applyModelSettings(loaded: LoadedConfig, dataDir: string, env: NodeJS.ProcessEnv = process.env): ModelSettings | null {
  const saved = readModelSettings(dataDir);
  if (!saved) return null;
  loaded.config.inference.baseUrl = saved.baseUrl;
  loaded.config.inference.model = saved.model;
  if (saved.apiKey) env[MODEL_KEY_ENV] = saved.apiKey;
  const keyEnv = keyEnvFor(loaded.config.inference.apiKeyEnv, saved.apiKey !== undefined);
  if (keyEnv) loaded.config.inference.apiKeyEnv = keyEnv;
  else delete loaded.config.inference.apiKeyEnv;
  return saved;
}

export type ModelVerdictKind = 'works' | 'key_refused' | 'unreachable' | 'model_not_found' | 'busy' | 'no_structured';

export interface ModelVerdict {
  kind: ModelVerdictKind;
  ok: boolean;
  /** The capability level the endpoint reached, when it works. */
  level: CapabilityResult['level'];
}

/** MDL-4: the capability result in the words a person needs (GWY-24: a refused key is not evidence about the endpoint). */
export function verdictOf(result: CapabilityResult): ModelVerdict {
  const status = (n: number) => result.attempts.some((a) => a.httpStatus === n);
  const kind: ModelVerdictKind =
    result.level !== 'none' ? 'works'
    : [401, 402, 403].some(status) ? 'key_refused'
    : result.attempts.some((a) => a.httpStatus === null && a.error !== undefined) ? 'unreachable'
    : status(404) ? 'model_not_found'
    : status(429) || result.attempts.some((a) => a.httpStatus !== null && a.httpStatus >= 500) ? 'busy'
    : 'no_structured';
  return { kind, ok: kind === 'works', level: result.level };
}

export interface ModelView {
  baseUrl: string;
  model: string;
  /** Whether a key is set (in the environment or the file). The key itself is never given out. */
  keySet: boolean;
  local: boolean;
  presets: { id: string; label: { pt: string; en: string }; baseUrl: string; local: boolean }[];
  /** True when a module was refused at start only for lack of a tested endpoint: it loads at the next start (MDL-5). */
  needsRestart: boolean;
}

export interface ModelTestResult extends ModelVerdict {
  baseUrl: string;
  model: string;
}

export interface ModelControlDeps {
  company: Company;
  /** Other companies of the same install (the test chat's) that must use the new service from the next call too. */
  others?: readonly Company[];
  loaded: LoadedConfig;
  dataDir: string;
  env?: NodeJS.ProcessEnv;
  fetch?: Fetch;
  now?: () => Date;
}

const ADDRESS = /^https?:\/\/[^\s]+$/;

/** What the Model tab calls. It knows no channel and no page. */
export class ModelControl {
  private readonly env: NodeJS.ProcessEnv;
  /** MDL-5: the last Test that worked, so Save can be checked against it. */
  private tested: { baseUrl: string; model: string; apiKey: string; result: CapabilityResult } | null = null;

  constructor(private readonly deps: ModelControlDeps) {
    this.env = deps.env ?? process.env;
  }

  private current(): ModelSettings {
    const { inference } = this.deps.loaded.config;
    return { baseUrl: inference.baseUrl, model: inference.model };
  }

  private keyNow(): string | undefined {
    const name = this.deps.loaded.config.inference.apiKeyEnv;
    return name ? this.env[name] : undefined;
  }

  view(): ModelView {
    const { baseUrl, model } = this.current();
    return {
      baseUrl,
      model,
      keySet: !!this.keyNow(),
      local: isLocalAddress(baseUrl),
      presets: PRESETS,
      needsRestart: this.deps.company.loaded.refused.some((r) => r.unmet.some((u) => u.kind === 'capability')),
    };
  }

  private check(input: { baseUrl?: unknown; model?: unknown; apiKey?: unknown }): ModelSettings {
    const baseUrl = typeof input.baseUrl === 'string' ? input.baseUrl.trim() : '';
    const model = typeof input.model === 'string' ? input.model.trim() : '';
    if (!ADDRESS.test(baseUrl)) throw new Error('the address must start with http:// or https://');
    if (model === '' || model.length > 200) throw new Error('type the name of the model');
    const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
    if (apiKey.length > 500 || /\s/.test(apiKey)) throw new Error('that does not look like a key');
    return { baseUrl, model, ...(apiKey === '' ? {} : { apiKey }) };
  }

  /** The key to use: the one typed, else the one already in use for the same address (an empty box keeps the key). */
  private keyFor(typed: string | undefined, baseUrl: string): string {
    if (typed) return typed;
    return baseUrl === this.current().baseUrl ? (this.keyNow() ?? '') : '';
  }

  /** MDL-4: tries what is typed without saving it. */
  async test(input: { baseUrl?: unknown; model?: unknown; apiKey?: unknown }): Promise<ModelTestResult> {
    const s = this.check(input);
    const apiKey = this.keyFor(s.apiKey, s.baseUrl);
    const env = { ...this.env, [MODEL_KEY_ENV]: apiKey };
    const result = await runCapabilityTest({ baseUrl: s.baseUrl, ...(apiKey ? { apiKeyEnv: MODEL_KEY_ENV } : {}), ...(this.deps.loaded.config.inference.timeoutMs ? { timeoutMs: this.deps.loaded.config.inference.timeoutMs } : {}), ...(this.deps.loaded.config.inference.providerOptions ? { providerOptions: this.deps.loaded.config.inference.providerOptions } : {}) }, s.model, {
      fetch: this.deps.fetch ?? fetch,
      env,
      now: this.deps.now ?? (() => new Date()),
      timeoutMs: this.deps.loaded.config.inference.timeoutMs ?? 60_000,
      record: (entry) => { this.deps.company.store.write(entry); },
    });
    const verdict = verdictOf(result);
    this.tested = !verdict.ok ? null : { baseUrl: s.baseUrl, model: s.model, apiKey, result };
    return { ...verdict, baseUrl: s.baseUrl, model: s.model };
  }

  /** MDL-5..8: keeps what was tested, uses it from the next call, and records who changed it (never the key). */
  async save(input: { baseUrl?: unknown; model?: unknown; apiKey?: unknown }, by: string): Promise<ModelView> {
    const s = this.check(input);
    const apiKey = this.keyFor(s.apiKey, s.baseUrl);
    const t = this.tested;
    if (!t || t.baseUrl !== s.baseUrl || t.model !== s.model || t.apiKey !== apiKey) throw new Error('press Test first: only an address, model and key that were tested can be saved');
    const at = (this.deps.now ?? (() => new Date()))().toISOString();
    const all = [this.deps.company, ...(this.deps.others ?? [])];
    if (!t.result.inconclusive) for (const c of all) c.store.saveCapability(t.result);
    writeModelSettings(this.deps.dataDir, { baseUrl: s.baseUrl, model: s.model, ...(apiKey ? { apiKey } : {}) });
    if (apiKey) this.env[MODEL_KEY_ENV] = apiKey;
    const config = this.deps.loaded.config.inference;
    const keyEnv = keyEnvFor(config.apiKeyEnv, apiKey !== '');
    config.baseUrl = s.baseUrl;
    config.model = s.model;
    if (keyEnv) config.apiKeyEnv = keyEnv;
    else delete config.apiKeyEnv;
    for (const c of all) c.reconfigureModel({ baseUrl: s.baseUrl, model: s.model, ...(keyEnv ? { apiKeyEnv: keyEnv } : {}) });
    this.deps.company.store.recordModelChange(by, at, { baseUrl: s.baseUrl, model: s.model, keySet: apiKey !== '' });
    this.tested = null;
    return this.view();
  }
}
