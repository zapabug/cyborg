import { randomUUID } from 'node:crypto';
import { CORE_VERSION, HandlerRegistry, loadModules, Runner, type CapabilityResult, type CyborgEvent, type LoadEnv, type RunMode, type RunnerDeps } from '@cyborg/core';
import { ScriptedModel } from '@cyborg/core/testing';
import { AutoReplyPolicy, CalibrationTracker, PRESENCE_FACT_KEY, presenceFactSource } from '@cyborg/core';
import { PackRegistry, ProfileFactProvider } from '@cyborg/profile';
import { SqliteStore, SqliteVault } from '@cyborg/store-sqlite';
import { salesModule, type SalesConfig } from '../src/index.ts';

export const at = '2026-10-31T10:00:00.000Z';

/** Fields for a tour desk (the wazaa shape). */
export const tourDeskConfig = {
  enquiryFields: [
    { name: 'tour', description: 'which tour or activity the customer asks about' },
    { name: 'date', description: 'the day or period they want' },
    { name: 'party_size', description: 'how many people' },
    { name: 'language', description: 'the language the customer writes in or wants' },
    { name: 'constraints', description: 'anything that limits the choice (children, mobility, budget)' },
  ],
};

/** Fields for a buyer intake (the madrltr shape). */
export const buyerIntakeConfig = {
  enquiryFields: [
    { name: 'property_type', description: 'the kind of property wanted' },
    { name: 'area', description: 'where they want to buy' },
    { name: 'budget', description: 'what they can spend' },
    { name: 'financing', description: 'cash, mortgage or other' },
    { name: 'timeline', description: 'when they want to complete' },
  ],
};

// Profile values. Prices and capacity are the East Tour and Nuns Valley entries of wazaa's catalog
// (public product data). Availability days are structural: the store's Days field is unverified
// (planning.md, known issue), so nothing here claims to be a real schedule.
export const FACTS: Record<string, unknown> = {
  'business.name': 'Demo Tours',
  'offer.items': [
    { name: 'East Tour', price: 35, unit: 'per person', capacity: 80 },
    { name: 'Nuns Valley Tour', price: 25, unit: 'per person', capacity: 16 },
  ],
  'offer.availability': { days: [1, 3], closedDates: ['12-25', '01-01'] },
  'rules.commitments': ['never confirm a booking', 'never quote a price that is not listed'],
  'tone.style': 'warm, relaxed and easygoing',
  'faq.entries': [{ q: 'where do you pick up', a: 'We pick up from hotels in Funchal.' }],
  'sales.criteria': [{ id: 'knows_what_they_want', description: 'names a tour or activity' }, { id: 'has_a_date', description: 'gives a day or period' }],
  'sales.followup_after_hours': 24,
};

export function seedFacts(store: SqliteStore, facts: Record<string, unknown> = FACTS, confirm = true) {
  for (const [key, value] of Object.entries(facts)) {
    store.putFact({ key, value, class: 'public', source: 'client_statement', sourceRef: 'test:fixture' }, 'seed', at);
    if (confirm) store.moveFact(key, 'confirmed', { actor: 'person:1', at });
  }
}

const capability = (level: CapabilityResult['level']): CapabilityResult => ({
  baseUrl: 'http://x/v1', model: 'm', level, requestShape: 'json_schema_wrapped', logprobs: false, testedAt: at, attempts: [],
});

export interface RigOptions {
  config?: unknown;
  script?: string[];
  mode?: RunMode;
  facts?: Record<string, unknown>;
  autoReplyOptIn?: string[];
  enabledHandlers?: string[];
  now?: () => Date;
  runnerDeps?: Partial<RunnerDeps>;
  live?: { isEnabled(handlerId: string): boolean };
}

export function rig(options: RigOptions = {}) {
  const store = new SqliteStore(':memory:');
  const vault = new SqliteVault(':memory:');
  seedFacts(store, options.facts);
  const registry = new HandlerRegistry({ autoReplyHandlers: options.autoReplyOptIn ?? [] });
  const env: LoadEnv = {
    coreVersion: CORE_VERSION,
    profile: store,
    packs: [],
    capabilities: [capability('strict_schema')],
    connectors: { channel: {}, contacts: {} },
    dependencyChecks: { 'connector:channel': () => ({ ok: true }), 'connector:contacts': () => ({ ok: true }) },
    moduleConfig: { sales: options.config ?? tourDeskConfig },
    ...(options.enabledHandlers ? { config: { sales: { enabledHandlers: options.enabledHandlers } } } : {}),
  };
  const report = loadModules(registry, [salesModule], env);
  const model = new ScriptedModel([...(options.script ?? [])]);
  const nowFn = options.now ?? (() => new Date(at));
  const policy = new AutoReplyPolicy(store, nowFn);
  const tracker = new CalibrationTracker(store, store, policy);
  const runner = new Runner({
    businessId: 'b', registry, store, ledger: store, model, vault,
    facts: new ProfileFactProvider(store, new PackRegistry(), { [PRESENCE_FACT_KEY]: presenceFactSource(store) }),
    mode: options.mode ?? 'live',
    lessons: store,
    ...(options.live ? { live: options.live } : {}),
    now: nowFn,
    calibration: tracker,
    ...(options.runnerDeps ?? {}),
  });
  return { store, vault, registry, report, model, runner, policy, tracker };
}

export const message = (text: string, id = `m-${randomUUID()}`, sender = `sender-${randomUUID()}`, kind = 'message.received'): CyborgEvent => ({
  id, source: 'chat', kind, at, payload: { text, sender, first: false },
});

export type { SalesConfig };
