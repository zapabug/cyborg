// docs/10 ADM-96..99: how often a kind of reply has been right, as counts, so a person can see what might be automated.
import type { Marking, ShadowLog } from './shadow-types.ts';
import type { PromptLedger, ProposalStore } from './types.ts';

/** The marks and decisions that count as the bot having been right, and as wrong. `different_but_fine` is right: the reply was fine. */
export const RIGHT_MARKS: readonly Marking[] = ['match', 'better', 'different_but_fine'];
export const WRONG_MARKS: readonly Marking[] = ['worse', 'wrong_fact'];

export interface RecordCriteria {
  /** Of the last `of` decided replies, at least this many were right for the kind to be flagged. zapa's example is 9 of 10 (N-20). */
  minRight: number;
  of: number;
}
export const NINE_OF_TEN: RecordCriteria = { minRight: 9, of: 10 };

export interface TrackRecord {
  handlerId: string;
  handlerVersion: string;
  /** The model that wrote the replies: a different model starts a new record, as it does for calibration (PRF-30). */
  model: string;
  /** The most recent decided replies, up to `of`. */
  considered: number;
  right: number;
  wrong: number;
  of: number;
  /** True when `considered` reached `of` and `right` reached `minRight`. A flag for a person to review: nothing is switched on by it (HR-1, PRF-35). */
  candidate: boolean;
}

interface Verdict {
  handlerId: string;
  handlerVersion: string;
  model: string;
  at: string;
  right: boolean;
}

/**
 * ADM-96. One verdict per reply that a person judged: a shadow entry's marking, or, where there is none, the approval or decline of its
 * proposal. A reply with neither is not counted. The record is per (handler, version, model) and counts only the most recent `of`, so a
 * changed prompt, lesson or model starts again. Counts, never a single score (PRF-26).
 */
export function trackRecords(
  deps: { log: Pick<ShadowLog, 'listEntries'>; proposals: Pick<ProposalStore, 'list'>; ledger: Pick<PromptLedger, 'read'> },
  criteria: RecordCriteria = NINE_OF_TEN,
): TrackRecord[] {
  if (!(criteria.of > 0 && criteria.minRight > 0 && criteria.minRight <= criteria.of)) throw new Error('the record criteria need 0 < minRight <= of');
  const proposals = deps.proposals.list();
  const byId = new Map(proposals.map((p) => [p.id, p]));
  const modelOf = (modelCallId: string | null): string => (modelCallId ? (deps.ledger.read(modelCallId)?.model ?? 'unknown') : 'unknown');
  const verdicts: Verdict[] = [];
  const counted = new Set<string>();

  for (const e of deps.log.listEntries()) {
    if (e.draft === null) continue; // only replies: a draft is what a person could accept
    const p = e.proposalId ? byId.get(e.proposalId) : undefined;
    if (e.marking !== null) {
      verdicts.push({ handlerId: e.handlerId, handlerVersion: e.handlerVersion, model: modelOf(p?.modelCallId ?? null), at: e.createdAt, right: RIGHT_MARKS.includes(e.marking) });
      if (e.proposalId) counted.add(e.proposalId);
    }
  }
  for (const p of proposals) {
    if (counted.has(p.id) || p.draft == null || (p.status !== 'approved' && p.status !== 'declined' && p.status !== 'applied')) continue;
    verdicts.push({ handlerId: p.handlerId, handlerVersion: p.handlerVersion, model: modelOf(p.modelCallId), at: p.decidedAt ?? p.createdAt, right: p.status !== 'declined' });
  }

  const groups = new Map<string, Verdict[]>();
  for (const v of verdicts) {
    const k = `${v.handlerId}\n${v.handlerVersion}\n${v.model}`;
    groups.set(k, [...(groups.get(k) ?? []), v]);
  }
  return [...groups.values()]
    .map((list) => {
      const recent = list.sort((a, b) => b.at.localeCompare(a.at)).slice(0, criteria.of);
      const right = recent.filter((v) => v.right).length;
      const first = recent[0]!;
      return {
        handlerId: first.handlerId,
        handlerVersion: first.handlerVersion,
        model: first.model,
        considered: recent.length,
        right,
        wrong: recent.length - right,
        of: criteria.of,
        candidate: recent.length >= criteria.of && right >= criteria.minRight,
      };
    })
    .sort((a, b) => a.handlerId.localeCompare(b.handlerId) || a.handlerVersion.localeCompare(b.handlerVersion));
}
