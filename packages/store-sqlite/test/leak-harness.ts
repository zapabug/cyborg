import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  HandlerRegistry,
  Runner,
  type CyborgEvent,
  type ModelHandler,
} from '@cyborg/core';
import { ScriptedModel } from '@cyborg/core/testing';
import { findLeaks, SqliteStore, SqliteVault, type LeakHit } from '../src/index.ts';

export const probeHandler: ModelHandler<
  { name: string; contact: string; note: string; topic: string },
  { summary: string }
> = {
  kind: 'model',
  id: 'leak.probe',
  version: '1',
  trigger: [{ type: 'event', kind: 'leak.probe' }],
  input: {
    schema: z.object({ name: z.string(), contact: z.string(), note: z.string(), topic: z.string() }),
    classes: { name: 'identity', contact: 'identity', note: 'freetext', topic: 'deal' },
    fromEvent: (event) => ({
      name: event.payload['name'] ?? '',
      contact: event.payload['contact'] ?? '',
      note: event.payload['note'] ?? '',
      topic: event.payload['topic'] ?? '',
    }),
  },
  profileKeys: [],
  packFacts: [],
  prompt: { template: 'Topic: {{topic}}\nNote: {{note}}', slots: { topic: 'topic', note: 'note' } },
  output: z.object({ summary: z.string() }),
  model: { level: 'json_object', name: 'scripted' },
  checks: () => [],
  toProposal: (output, input) => ({
    // `input.name` is a vault code here, never the raw value.
    subject: input.name,
    changes: [],
    draft: output.summary,
    findings: [],
    questions: [],
  }),
  effect: 'proposal',
  commitment: false,
  limits: {},
};

export interface LeakRunResult {
  hits: LeakHit[];
  proposals: number;
  modelCalls: number;
}

/**
 * PRV-13: runs real inputs through the probe handler with a scripted model and looks for the
 * identity values anywhere in the proposals, audit rows and ledger.
 */
export async function runLeakCheck(events: CyborgEvent[], identityValues: string[]): Promise<LeakRunResult> {
  const store = new SqliteStore(':memory:');
  const vault = new SqliteVault(':memory:');
  const registry = new HandlerRegistry({ autoReplyHandlers: [] });
  registry.registerHandler(probeHandler);
  const model = new ScriptedModel(events.map(() => JSON.stringify({ summary: 'ok' })));
  const runner = new Runner({ businessId: 'leak-test', registry, store, ledger: store, model, vault });
  for (const event of events) await runner.handle(event);
  const result = { hits: findLeaks(store, identityValues), proposals: store.list().length, modelCalls: model.calls.length };
  store.close();
  vault.close();
  return result;
}

export const token = (prefix: string) => `${prefix}-${randomUUID()}`;
