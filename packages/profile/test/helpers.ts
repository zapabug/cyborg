import { HandlerRegistry, Runner, type AnyHandler, type NewFact, type RunMode } from '@cyborg/core';
import { echoHandler, ScriptedModel } from '@cyborg/core/testing';
import { SqliteStore } from '@cyborg/store-sqlite';
import { PackRegistry, ProfileFactProvider } from '../src/index.ts';

export const NOW = new Date('2026-10-31T10:00:00.000Z');
export const at = NOW.toISOString();

export const fact = (key: string, value: unknown, over: Partial<NewFact> = {}): NewFact => ({
  key,
  value,
  class: 'public',
  source: 'client_statement',
  sourceRef: 'test:ref',
  ...over,
});

/** A handler that reads one profile fact and one pack fact through prompt slots (PRF-56). */
export function factHandler(over: Partial<ReturnType<typeof echoHandler>> = {}): AnyHandler {
  return echoHandler({
    id: 'test.facts',
    profileKeys: ['rules.cutoff'],
    packFacts: [{ key: 'pack.alpha', minGrade: 'checked' }],
    prompt: {
      template: 'Cutoff: {{cutoff}} Rule: {{alpha}} Text: {{text}}',
      slots: { text: 'text' },
      factSlots: { cutoff: 'rules.cutoff' },
      packSlots: { alpha: 'pack.alpha' },
    },
    ...over,
  });
}

export function rig(mode: RunMode, handler: AnyHandler = factHandler(), script: string[] = ['{"value":"beta","phrase":"beta"}']) {
  const store = new SqliteStore(':memory:');
  const packs = new PackRegistry();
  const registry = new HandlerRegistry({ autoReplyHandlers: [] });
  registry.registerHandler(handler);
  const model = new ScriptedModel([...script]);
  const runner = new Runner({
    businessId: 'b',
    registry,
    store,
    ledger: store,
    model,
    facts: new ProfileFactProvider(store, packs),
    mode,
    now: () => NOW,
  });
  return { store, packs, model, runner };
}

export const packOf = (facts: Record<string, unknown>[]) => ({
  id: 'pack-test',
  version: '1',
  asOf: '2026-10-01',
  facts: facts.map((f) => ({ key: 'pack.alpha', value: 'rule alpha', grade: 'checked', sourceUrl: 'https://example.invalid/source', sourceDate: '2026-09-01', asOf: '2026-10-01', ...f })),
  openQuestions: ['Is the exemption threshold still current?'],
});
