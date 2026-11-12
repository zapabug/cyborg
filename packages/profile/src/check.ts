import {
  canMoveFact,
  type Discrepancy,
  type Fact,
  type FactSourceInfo,
  type ProfileStore,
  type Proposal,
  type ProposalStore,
} from '@cyborg/core';

export class NotIndependentError extends Error {
  constructor(factKey: string, source: FactSourceInfo) {
    super(`ground-truth check for "${factKey}" rejected: "${source.kind}" at "${source.ref}" is the fact's own source (PRF-8)`);
    this.name = 'NotIndependentError';
  }
}

export interface Comparison {
  match: boolean;
  note?: string;
}
export type Comparator = (factValue: unknown, observed: unknown) => Comparison;

/** Default comparison: JSON equality. */
export const compareExact: Comparator = (factValue, observed) => ({ match: JSON.stringify(factValue) === JSON.stringify(observed) });

/**
 * Day sets within a known universe (for example weekdays 0..6). Reports when the observed days are
 * exactly the complement of the fact's days: the shape of the first test business's "Days" inversion.
 */
export function compareDaySets(universe: readonly number[]): Comparator {
  return (factValue, observed) => {
    if (!Array.isArray(factValue) || !Array.isArray(observed)) return { match: false, note: 'day sets must be arrays' };
    const a = new Set(factValue as number[]);
    const b = new Set(observed as number[]);
    const same = a.size === b.size && [...a].every((d) => b.has(d));
    if (same) return { match: true };
    const complement = new Set(universe.filter((d) => !a.has(d)));
    const inverted = complement.size === b.size && [...complement].every((d) => b.has(d));
    return inverted
      ? { match: false, note: "the observed days are the complement of the fact's days: the field may list closed days, not running days" }
      : { match: false };
  };
}

/** PRF-7, PRF-8: independent means a different source kind or a different origin. */
export function isIndependent(fact: Fact, source: FactSourceInfo): boolean {
  return fact.source !== source.kind || fact.sourceRef !== source.ref;
}

export interface GroundTruthCheck {
  factKey: string;
  independent: FactSourceInfo;
  observed: unknown;
  compare?: Comparator;
}

export interface CheckOutcome {
  outcome: 'pass' | 'fail';
  fact: Fact;
  note?: string;
  discrepancy?: Discrepancy;
}

/**
 * PRF-7..9. A source equal to the fact's own is rejected. A pass is recorded as evidence and does
 * not confirm (only a person does, PRF-59). A fail contradicts the fact and opens a discrepancy.
 */
export function runGroundTruthCheck(store: ProfileStore, check: GroundTruthCheck, actor: string, at: string): CheckOutcome {
  const fact = store.getFact(check.factKey);
  if (!fact) throw new Error(`no fact "${check.factKey}"`);
  if (!isIndependent(fact, check.independent)) throw new NotIndependentError(fact.key, check.independent);

  const comparison = (check.compare ?? compareExact)(fact.value, check.observed);
  store.recordCheck({
    factKey: fact.key,
    checkedAt: at,
    independent: check.independent,
    observed: check.observed,
    outcome: comparison.match ? 'pass' : 'fail',
    note: comparison.note ?? null,
  });
  if (comparison.match) return { outcome: 'pass', fact };

  // PRF-2 does not allow stale -> contradicted: a stale fact is already not used as true (PRF-13), so its status stays and the discrepancy is what records the failure (same as markEntry, PRF-17)
  const moved = fact.status === 'contradicted' || !canMoveFact(fact.status, 'contradicted') ? fact : store.moveFact(fact.key, 'contradicted', { actor, at, reason: comparison.note ?? 'failed an independent check' });
  const discrepancy = store.addDiscrepancy({
    factKey: fact.key,
    createdAt: at,
    status: 'open',
    factValue: fact.value,
    factSource: { kind: fact.source, ref: fact.sourceRef },
    evidence: [{ source: check.independent, observed: check.observed, ...(comparison.note ? { note: comparison.note } : {}) }],
    singleSource: true,
  });
  return { outcome: 'fail', fact: moved, ...(comparison.note ? { note: comparison.note } : {}), discrepancy };
}

/**
 * PRF-9, PRF-60: the report to the client is a proposal a person sends. Evidence is listed per
 * discrepancy, and "single source" is said when one independent source backs the claim.
 */
export function proposeDiscrepancyReport(
  profile: ProfileStore,
  proposals: ProposalStore,
  businessId: string,
  at: string,
): Proposal | null {
  const open = profile.listDiscrepancies('open');
  if (open.length === 0) return null;
  const byFact = new Map<string, Discrepancy[]>();
  for (const d of open) byFact.set(d.factKey, [...(byFact.get(d.factKey) ?? []), d]);

  const findings = [...byFact.entries()].map(([factKey, group]) => {
    const first = group[0]!;
    const sources = new Set(group.flatMap((d) => d.evidence.map((e) => `${e.source.kind}@${e.source.ref}`)));
    const single = sources.size === 1;
    const lines = group.flatMap((d) =>
      d.evidence.map((e) => `${e.source.kind} at ${e.source.ref} observed ${JSON.stringify(e.observed)}${e.note ? ` (${e.note})` : ''}`),
    );
    return {
      statement:
        `fact "${factKey}" = ${JSON.stringify(first.factValue)} (from ${first.factSource.kind} at ${first.factSource.ref}) ` +
        `conflicts with independent evidence.${single ? ' The evidence is a single source.' : ''}`,
      evidence: lines.join(' | '),
    };
  });
  const questions = [...byFact.keys()].map((key) => `Which is correct for "${key}"? A person who knows the business must confirm.`);

  return proposals.create(
    {
      businessId,
      handlerId: 'profile.discrepancy_report',
      handlerVersion: '1',
      status: 'proposed',
      subject: `discrepancies:${open.length}`,
      changes: [],
      findings,
      questions,
      modelCallId: null,
      reason: null,
    },
    null,
    at,
  );
}
