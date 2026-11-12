import { FLAG_REASONS, type FlagReason } from './flags.ts';
import { scrub } from './scrubber.ts';
import type { AppliedChange, Applier, Proposal, ProposalStore } from './types.ts';

export interface LifecycleDeps {
  store: ProposalStore;
  now?: () => Date;
}

export class Lifecycle {
  constructor(private readonly deps: LifecycleDeps) {}

  private at(): string {
    return (this.deps.now ?? (() => new Date()))().toISOString();
  }

  /** HDL-9: the surface is the adapter's; the core defines only this operation (BEH-3). */
  decide(proposalId: string, decision: 'approve' | 'decline', actorRef: string, why: { reason?: FlagReason; note?: string } = {}): Proposal {
    // PRF-80: why a person said yes or no is kept for the upgrade review. The note is free text typed by staff,
    // so it must pass the scrubber (PRV-6) before it is written to the audit log (PRV-2).
    if (why.reason !== undefined && !FLAG_REASONS.includes(why.reason)) throw new Error(`"${why.reason}" is not a reason tag`);
    if (why.note !== undefined && scrub(why.note).length > 0) throw new Error('the note contains data the scrubber blocks; leave it out or rewrite it (PRV-6)');
    return this.deps.store.transition(proposalId, decision === 'approve' ? 'approved' : 'declined', {
      actor: actorRef,
      at: this.at(),
      decidedBy: actorRef,
      ...(why.reason !== undefined || why.note !== undefined ? { detail: { ...(why.reason !== undefined ? { reason: why.reason } : {}), ...(why.note !== undefined ? { note: why.note } : {}) } } : {}),
    });
  }

  supersede(proposalId: string, actor: string, detail?: unknown): Proposal {
    return this.deps.store.transition(proposalId, 'superseded', {
      actor,
      at: this.at(),
      ...(detail === undefined ? {} : { detail }),
    });
  }

  expire(proposalId: string, actor: string): Proposal {
    return this.deps.store.transition(proposalId, 'expired', { actor, at: this.at() });
  }

  /** BEH-4, BEH-5, HDL-8, HDL-10: only from `approved`; stale target or stray fields fail the apply. */
  async apply(proposalId: string, applier: Applier, actor: string): Promise<Proposal> {
    const { store } = this.deps;
    const proposal = store.get(proposalId);
    if (!proposal) throw new Error(`no proposal ${proposalId}`);
    if (proposal.status !== 'approved') {
      // Let the store raise the illegal transition for every other status (BEH-2).
      return store.transition(proposalId, 'applied', { actor, at: this.at() });
    }

    const failed = (reason: string, appliedChanges?: AppliedChange[]) =>
      store.transition(proposalId, 'apply_failed', {
        actor,
        at: this.at(),
        reason,
        ...(appliedChanges ? { appliedChanges } : {}),
      });

    let prepared;
    try {
      prepared = await applier.prepareApply(proposal);
    } catch (error) {
      return failed(`prepareApply threw: ${(error as Error).message}`);
    }
    if (prepared.stale) return failed(`target changed since the proposal: ${prepared.reason}`);

    let changes: AppliedChange[];
    try {
      changes = await applier.apply(proposal);
    } catch (error) {
      return failed(`apply threw: ${(error as Error).message}`);
    }
    const allowed = new Set(proposal.changes.map((c) => c.field));
    const stray = changes.filter((c) => !allowed.has(c.field)).map((c) => c.field);
    if (stray.length > 0) {
      return failed(`apply touched fields outside the proposal (HDL-8): ${stray.join(', ')}`, changes);
    }
    const unrecorded = changes.filter((c) => c.oldValue === undefined || c.newValue === undefined);
    if (unrecorded.length > 0) return failed('apply did not record old and new values (BEH-5)', changes);

    return store.transition(proposalId, 'applied', { actor, at: this.at(), appliedChanges: changes });
  }

  /** HDL-11: a person's action, only for `applied`, restoring from the recorded old values. */
  async revert(proposalId: string, applier: Applier, actor: string): Promise<Proposal> {
    const { store } = this.deps;
    const proposal = store.get(proposalId);
    if (!proposal) throw new Error(`no proposal ${proposalId}`);
    if (proposal.status !== 'applied') return store.transition(proposalId, 'reverted', { actor, at: this.at() });
    await applier.revert(proposal, proposal.appliedChanges ?? []);
    return store.transition(proposalId, 'reverted', { actor, at: this.at() });
  }
}
