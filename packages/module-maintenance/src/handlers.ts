import { z } from 'zod';
import type { DeterministicHandler } from '@cyborg/core';

export const RECORD_HANDLER_ID = 'maintenance.record.create';
export const HIT_EVENT = 'maintenance.hit';

interface HitInput {
  chat: string;
  asset: string;
  priority: string;
  terms: string;
  snippet: string;
}

/**
 * WZP-60: a maintenance record for an asset, for a person to deal with. No model call: the scan found the asset and the problem words in code. It is a
 * proposal like any other: `proposed` is open, `approved` is scheduled, `applied` is done, `declined` is dismissed. The snippet is scrubbed before it gets here.
 */
export function recordHandler(): DeterministicHandler<HitInput> {
  return {
    kind: 'deterministic',
    id: RECORD_HANDLER_ID,
    version: '1',
    trigger: [{ type: 'event', kind: HIT_EVENT }],
    input: {
      schema: z.object({ chat: z.string(), asset: z.string(), priority: z.string(), terms: z.string(), snippet: z.string() }),
      classes: { chat: 'public', asset: 'public', priority: 'public', terms: 'public', snippet: 'public' } as const,
      fromEvent: (event: { payload: Record<string, unknown> }) => event.payload,
    },
    profileKeys: [],
    packFacts: [],
    run: (input) => ({
      subject: input.asset,
      changes: [
        { field: 'asset', oldValue: null, newValue: input.asset },
        { field: 'priority', oldValue: null, newValue: input.priority },
        { field: 'issue', oldValue: null, newValue: input.terms },
        { field: 'note', oldValue: null, newValue: input.snippet },
      ],
      findings: [],
      questions: [],
    }),
    effect: 'proposal',
    commitment: false,
    limits: {},
  };
}
