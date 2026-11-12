import {
  HandlerRegistry,
  Lifecycle,
  Runner,
  type Applier,
  type AppliedChange,
  type NewProposal,
  type Proposal,
  type ProposalStatus,
} from '@cyborg/core';
import { echoHandler, deterministicHandler, ScriptedModel } from '@cyborg/core/testing';
import { SqliteStore } from '../src/index.ts';

export const BUSINESS = 'business-test';
export const fixedNow = () => new Date('2026-10-31T10:00:00.000Z');

export function setup(script: (string | Error)[] = [], handlers = [echoHandler(), deterministicHandler()]) {
  const store = new SqliteStore(':memory:');
  const registry = new HandlerRegistry({ autoReplyHandlers: [] });
  for (const handler of handlers) registry.registerHandler(handler);
  const model = new ScriptedModel(script);
  const runner = new Runner({ businessId: BUSINESS, registry, store, ledger: store, model, now: fixedNow });
  const lifecycle = new Lifecycle({ store, now: fixedNow });
  return { store, registry, model, runner, lifecycle };
}

/** A real in-memory target standing in for the adapter's system of record. */
export class MapApplier implements Applier {
  constructor(readonly target = new Map<string, string>()) {}

  async prepareApply(proposal: Proposal) {
    for (const change of proposal.changes) {
      const current = this.target.get(change.field) ?? null;
      if (current !== change.oldValue) return { stale: true as const, reason: `${change.field} is now "${current}"` };
    }
    return { stale: false as const };
  }

  async apply(proposal: Proposal): Promise<AppliedChange[]> {
    return proposal.changes.map((change) => {
      const oldValue = this.target.get(change.field) ?? null;
      this.target.set(change.field, String(change.newValue));
      return { field: change.field, oldValue, newValue: change.newValue };
    });
  }

  async revert(_proposal: Proposal, changes: AppliedChange[]) {
    for (const change of changes) {
      if (change.oldValue === null) this.target.delete(change.field);
      else this.target.set(change.field, String(change.oldValue));
    }
  }
}

export const newProposal = (status: 'proposed' | 'invalid_output' = 'proposed'): NewProposal => ({
  businessId: BUSINESS,
  handlerId: 'test.echo',
  handlerVersion: '1',
  status,
  subject: 'ref:test',
  changes: [{ field: 'summary', oldValue: null, newValue: 'beta', sourcePhrase: 'beta' }],
  findings: [],
  questions: [],
  modelCallId: null,
  reason: status === 'invalid_output' ? 'test' : null,
});

/** Drives a fresh proposal into `status` using only the public lifecycle operations. */
export async function reach(
  status: ProposalStatus,
  env: ReturnType<typeof setup>,
  eventId: string,
): Promise<Proposal> {
  const { store, lifecycle } = env;
  const key = { source: 'test-source', eventId, handlerId: 'test.echo' };
  if (status === 'invalid_output') return store.create(newProposal('invalid_output'), key, fixedNow().toISOString());
  const created = store.create(newProposal(), key, fixedNow().toISOString());
  const applier = new MapApplier();
  switch (status) {
    case 'proposed':
      return created;
    case 'approved':
      return lifecycle.decide(created.id, 'approve', 'actor:1');
    case 'declined':
      return lifecycle.decide(created.id, 'decline', 'actor:1');
    case 'superseded':
      return lifecycle.supersede(created.id, 'runner');
    case 'expired':
      return lifecycle.expire(created.id, 'system');
    case 'applied':
    case 'reverted':
    case 'apply_failed': {
      lifecycle.decide(created.id, 'approve', 'actor:1');
      if (status === 'apply_failed') applier.target.set('summary', 'someone else wrote this');
      const applied = await lifecycle.apply(created.id, applier, 'actor:1');
      return status === 'reverted' ? lifecycle.revert(created.id, applier, 'actor:1') : applied;
    }
  }
}
