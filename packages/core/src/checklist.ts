// docs/10 ADM-1..5, ADM-39: the deployment checklist model. The items themselves are data supplied by the admin module.
import type { ProposalStore } from './types.ts';

export type ItemStatus = 'unchecked' | 'passed_machine' | 'passed_person' | 'failed' | 'waived';
export type Verification = 'machine' | 'person' | 'both';

export interface ChecklistItemDef {
  id: string;
  rule: string;
  verification: Verification;
  /** ADM-3: an unwaivable item can never be waived. */
  unwaivable: boolean;
}

export interface ChecklistRow {
  channel: string;
  itemId: string;
  status: ItemStatus;
  /** Shadow-log entries, a test run or a person's note (ADM-2). */
  evidence: string | null;
  machineEvidence: string | null;
  personEvidence: string | null;
  waiver: { by: string; why: string; reviewBy: string } | null;
  changedBy: string;
  changedAt: string;
}

export interface Signoff {
  by: string;
  at: string;
}

export interface ChecklistStore {
  getRow(channel: string, itemId: string): ChecklistRow | null;
  putRow(row: ChecklistRow): void;
  listRows(channel: string): ChecklistRow[];
  getSignoff(channel: string, who: 'business' | 'supplier'): Signoff | null;
  putSignoff(channel: string, who: 'business' | 'supplier', signoff: Signoff | null): void;
}

export class ChecklistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChecklistError';
  }
}

export class Checklist {
  private readonly byId: Map<string, ChecklistItemDef>;

  constructor(
    readonly defs: readonly ChecklistItemDef[],
    private readonly store: ChecklistStore,
    private readonly audit: Pick<ProposalStore, 'appendAudit'>,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.byId = new Map(defs.map((d) => [d.id, d]));
  }

  private def(itemId: string): ChecklistItemDef {
    const def = this.byId.get(itemId);
    if (!def) throw new ChecklistError(`no checklist item "${itemId}"`);
    return def;
  }

  private row(channel: string, itemId: string): ChecklistRow {
    return (
      this.store.getRow(channel, itemId) ?? {
        channel, itemId, status: 'unchecked', evidence: null, machineEvidence: null, personEvidence: null, waiver: null,
        changedBy: 'system', changedAt: this.now().toISOString(),
      }
    );
  }

  /** ADM-2: every status change is an audit row with who, when and the evidence. */
  private write(row: ChecklistRow, previous: ItemStatus, reason: string): ChecklistRow {
    this.store.putRow(row);
    this.audit.appendAudit({
      at: row.changedAt, proposalId: null, kind: 'checklist', fromStatus: null, toStatus: null, actor: row.changedBy,
      detail: { channel: row.channel, item: row.itemId, from: previous, to: row.status, reason, evidence: row.evidence },
    });
    return row;
  }

  get(channel: string, itemId: string): ChecklistRow {
    this.def(itemId);
    return this.row(channel, itemId);
  }

  list(channel: string): ChecklistRow[] {
    return this.defs.map((d) => this.row(channel, d.id));
  }

  /** Records one part of the verification. `both` items pass only when both parts are recorded (ADM-39). */
  pass(channel: string, itemId: string, kind: 'machine' | 'person', actor: string, evidence: string): ChecklistRow {
    const def = this.def(itemId);
    if (!evidence.trim()) throw new ChecklistError(`item ${itemId}: a pass needs evidence (ADM-2)`);
    if (def.verification !== 'both' && def.verification !== kind) {
      throw new ChecklistError(`item ${itemId} is verified by ${def.verification}, not by ${kind}`);
    }
    const current = this.row(channel, itemId);
    const next: ChecklistRow = { ...current, changedBy: actor, changedAt: this.now().toISOString(), waiver: null };
    if (kind === 'machine') next.machineEvidence = evidence;
    else next.personEvidence = evidence;
    if (def.verification === 'both') {
      const both = next.machineEvidence !== null && next.personEvidence !== null;
      next.status = both ? 'passed_person' : 'unchecked';
      next.evidence = [next.machineEvidence, next.personEvidence].filter(Boolean).join(' | ');
    } else {
      next.status = kind === 'machine' ? 'passed_machine' : 'passed_person';
      next.evidence = evidence;
    }
    return this.write(next, current.status, `pass (${kind})`);
  }

  fail(channel: string, itemId: string, actor: string, evidence: string): ChecklistRow {
    this.def(itemId);
    const current = this.row(channel, itemId);
    return this.write({ ...current, status: 'failed', evidence, machineEvidence: null, personEvidence: null, waiver: null, changedBy: actor, changedAt: this.now().toISOString() }, current.status, 'fail');
  }

  /** ADM-3: who, why and a review-by date; unwaivable items refuse. */
  waive(channel: string, itemId: string, actor: string, why: string, reviewBy: string): ChecklistRow {
    const def = this.def(itemId);
    if (def.unwaivable) throw new ChecklistError(`item ${itemId} is unwaivable (ADM-3)`);
    if (!why.trim() || !reviewBy.trim() || !actor.trim()) throw new ChecklistError('a waiver records who, why and a review-by date (ADM-3)');
    const current = this.row(channel, itemId);
    return this.write(
      { ...current, status: 'waived', evidence: `waived: ${why}`, waiver: { by: actor, why, reviewBy }, changedBy: actor, changedAt: this.now().toISOString() },
      current.status,
      'waive',
    );
  }

  /** ADM-5: a change to roles, model, endpoint or handler version puts the affected items back to unchecked. */
  invalidate(channel: string, itemIds: readonly string[], actor: string, reason: string): ChecklistRow[] {
    const changed: ChecklistRow[] = [];
    for (const itemId of itemIds) {
      this.def(itemId);
      const current = this.row(channel, itemId);
      if (current.status === 'unchecked') continue;
      changed.push(
        this.write({ ...current, status: 'unchecked', machineEvidence: null, personEvidence: null, waiver: null, changedBy: actor, changedAt: this.now().toISOString() }, current.status, `invalidated: ${reason}`),
      );
    }
    if (changed.length > 0) {
      // A sign-off covered the old state.
      this.store.putSignoff(channel, 'business', null);
      this.store.putSignoff(channel, 'supplier', null);
    }
    return changed;
  }

  signOff(channel: string, who: 'business' | 'supplier', actor: string): Signoff {
    if (!actor.trim()) throw new ChecklistError('a sign-off names a person (ADM-4)');
    const signoff = { by: actor, at: this.now().toISOString() };
    this.store.putSignoff(channel, who, signoff);
    this.audit.appendAudit({ at: signoff.at, proposalId: null, kind: 'checklist_signoff', fromStatus: null, toStatus: null, actor, detail: { channel, who } });
    return signoff;
  }

  /** ADM-4, PRF-18: every item passed or waived and a named business sign-off. */
  status(channel: string): { complete: boolean; signedOffBy: string | null; supplierSignedOffBy: string | null; open: string[] } {
    const rows = this.list(channel);
    const open = rows.filter((r) => r.status === 'unchecked' || r.status === 'failed').map((r) => r.itemId);
    return {
      complete: open.length === 0,
      signedOffBy: this.store.getSignoff(channel, 'business')?.by ?? null,
      supplierSignedOffBy: this.store.getSignoff(channel, 'supplier')?.by ?? null,
      open,
    };
  }

  /** The callback `checkLiveGate` takes (docs/06 PRF-70). */
  gateFor(channel: string): () => { complete: boolean; signedOffBy: string | null } {
    return () => {
      const s = this.status(channel);
      return { complete: s.complete, signedOffBy: s.signedOffBy };
    };
  }
}
