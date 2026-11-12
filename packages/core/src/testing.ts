// Structural test fixtures for the handler contract. They carry no business or customer
// content (HR-4); real inputs arrive with the sales module proofs (M6, M7).
import { z } from 'zod';
import type {
  CyborgEvent,
  DeterministicHandler,
  ModelHandler,
  ModelPort,
  ModelRequest,
  ModelResult,
} from './index.ts';

export const inputSchema = z.object({ text: z.string() });

export function echoHandler(overrides: Partial<ModelHandler<{ text: string }, { value: string; phrase: string }>> = {}) {
  const handler: ModelHandler<{ text: string }, { value: string; phrase: string }> = {
    kind: 'model',
    id: 'test.echo',
    version: '1',
    trigger: [{ type: 'event', kind: 'text.received' }],
    input: {
      schema: inputSchema,
      classes: { text: 'public' },
      fromEvent: (event) => ({ text: event.payload['text'] }),
    },
    profileKeys: [],
    packFacts: [],
    prompt: { template: 'Extract from: {{text}}', slots: { text: 'text' } },
    output: z.object({ value: z.string(), phrase: z.string() }),
    model: { level: 'json_object', name: 'scripted' },
    checks: (output) => (output.value.length === 0 ? ['value is empty'] : []),
    toProposal: (output) => ({
      subject: 'ref:test',
      changes: [{ field: 'summary', oldValue: null, newValue: output.value, sourcePhrase: output.phrase }],
      findings: [],
      questions: [],
    }),
    effect: 'proposal',
    commitment: false,
    limits: {},
    ...overrides,
  };
  return handler;
}

export function deterministicHandler(overrides: Partial<DeterministicHandler<{ text: string }>> = {}) {
  const handler: DeterministicHandler<{ text: string }> = {
    kind: 'deterministic',
    id: 'test.check',
    version: '1',
    trigger: [{ type: 'event', kind: 'text.received' }],
    input: {
      schema: inputSchema,
      classes: { text: 'public' },
      fromEvent: (event) => ({ text: event.payload['text'] }),
    },
    profileKeys: [],
    packFacts: [],
    effect: 'proposal',
    commitment: false,
    limits: {},
    run: (input) => ({
      subject: 'ref:check',
      changes: [],
      findings: [{ statement: `input has ${input.text.length} characters`, evidence: 'length' }],
      questions: [],
    }),
    ...overrides,
  };
  return handler;
}

export function textEvent(id: string, text = 'alpha beta gamma', kind = 'text.received'): CyborgEvent {
  return { id, source: 'test-source', kind, at: '2026-10-31T10:00:00.000Z', payload: { text } };
}

/** The model's side of a test, driven by a script (allowed by HR-4). Counts calls. */
export class ScriptedModel implements ModelPort {
  calls: ModelRequest[] = [];
  constructor(private script: (string | Error)[]) {}

  async call(request: ModelRequest): Promise<ModelResult> {
    this.calls.push(request);
    const next = this.script.shift();
    if (next === undefined) throw new Error('scripted model has no more responses');
    if (next instanceof Error) throw next;
    return {
      endpoint: 'scripted://local',
      model: request.modelName,
      requestPayload: { prompt: request.prompt, schema: request.outputJsonSchema },
      rawResponse: next,
    };
  }
}

export const goodResponse = JSON.stringify({ value: 'beta', phrase: 'beta' });
