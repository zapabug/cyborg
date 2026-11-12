export * from './morning.ts';
import { z } from 'zod';
import { defineModule, type AuditRow, type ChatRole, type DeterministicHandler, type ModuleDefinition, type ShadowEntry } from '@cyborg/core';
import { runAllChecks, type VerificationData } from './checks.ts';

export * from './checks.ts';
export * from './items.ts';
export * from './verify.ts';

export const adminManifest = {
  id: 'admin',
  version: '0.1.0',
  coreRange: '^0.0.0',
  handlers: ['admin.check.manners'],
  profileKeys: [],
  packs: [],
  capabilities: [],
  privacy: { classes: ['deal'], mechanisms: [] },
  dependencies: [{ kind: 'connector', name: 'verification-data', how: 'the adapter supplies the shadow log, gate audit rows and roles for a channel' }],
} as const;

export interface VerificationSource {
  /** Builds the data the checks read, for one channel. */
  load(channel: string): VerificationData;
}

/**
 * ADM-21, ADM-22: a model-free handler (HDL-13) that runs the machine checks over the shadow log and returns
 * findings and questions as one proposal. It records nothing in the checklist (see `recordResults`).
 */
export function mannersHandler(source: VerificationSource): DeterministicHandler<{ channel: string }> {
  return {
    kind: 'deterministic',
    id: 'admin.check.manners',
    version: '1',
    trigger: [{ type: 'manual', command: 'admin.check' }],
    input: {
      schema: z.object({ channel: z.string() }),
      classes: { channel: 'deal' },
      fromEvent: (event) => ({ channel: event.payload['channel'] }),
    },
    profileKeys: [],
    packFacts: [],
    effect: 'proposal',
    commitment: false,
    limits: {},
    run: (input) => {
      const results = runAllChecks(source.load(input.channel));
      return {
        // ADM-22: findings carry the reason tag `manners` so the flag system (M8) can count repeated breaches.
        subject: `admin.check:manners:${input.channel}`,
        changes: [],
        findings: results.flatMap((r) => r.findings.map((f) => ({ statement: `${r.itemId} [manners]: ${f.statement}`, evidence: f.evidence }))),
        questions: results.filter((r) => r.outcome === 'insufficient').map((r) => `${r.itemId}: not enough real traffic yet (${r.evidence}); a person must decide whether to keep watching`),
      };
    },
  };
}

export const adminModule: ModuleDefinition = defineModule({
  manifest: adminManifest,
  create: (ctx) => [mannersHandler(ctx.connector<VerificationSource>('verification-data'))],
});

export type { AuditRow, ChatRole, ShadowEntry };
