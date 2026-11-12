// docs/06 PRF-43, PRF-44, PRF-78: improvements from a flagged reply name the signal that missed it, and show their effect first.
import { isFalseConfidence, type ReviewEntry } from './calibration.ts';
import type { SignalKind } from './confidence.ts';
import { replayEntries, proposeImprovement, type EvalDeps, type ImprovementTarget, type ReplayReportEntry } from './shadow.ts';
import type { Runner } from './runner.ts';
import type { Proposal } from './types.ts';

/** PRF-43: from a `false confidence` entry the proposal must name the signal that missed the problem. */
export function proposeFlagImprovement(
  deps: EvalDeps & { businessId: string },
  review: ReviewEntry,
  request: ImprovementTarget,
  missedBySignal: SignalKind | undefined,
): Proposal {
  if (isFalseConfidence(review) && !missedBySignal) {
    throw new Error('an improvement from a false-confidence entry must name the signal that missed it (PRF-43)');
  }
  const proposal = proposeImprovement(deps, review.entry.id, request);
  if (!missedBySignal) return proposal;
  // Record the link on the proposal itself, in the audit trail, so the approver and the review can find it.
  deps.proposals.appendAudit({
    at: (deps.now ?? (() => new Date()))().toISOString(), proposalId: proposal.id, kind: 'missed_by_signal', fromStatus: null, toStatus: null,
    actor: 'review', detail: { entryId: review.entry.id, signal: missedBySignal },
  });
  return proposal;
}

export interface LessonPreview {
  flagged: ReplayReportEntry;
  /** `match` entries whose draft the candidate lesson would change (PRF-44). */
  matchEntriesChanged: ReplayReportEntry[];
  matchEntriesChecked: number;
}

/** PRF-44: replays a candidate lesson against the flagged entry and against every stored entry marked `match`. */
export async function previewLesson(
  runner: Runner,
  candidateText: string,
  flagged: ReviewEntry,
  allEntries: readonly ReviewEntry[],
): Promise<LessonPreview> {
  const matches = allEntries.filter((e) => e.entry.marking === 'match' && e.entry.handlerId === flagged.entry.handlerId && e.entry.id !== flagged.entry.id);
  const replay = async (e: ReviewEntry): Promise<ReplayReportEntry> => (await replayEntries(runner, [e.entry], { extraLessons: [candidateText] }))[0]!;
  const flaggedResult = await replay(flagged);
  const changed: ReplayReportEntry[] = [];
  for (const m of matches) {
    const r = await replay(m);
    if (r.draftChanged) changed.push(r);
  }
  return { flagged: flaggedResult, matchEntriesChanged: changed, matchEntriesChecked: matches.length };
}

export interface CheckPreview {
  /** Would the candidate check have blocked the flagged reply? */
  wouldBlockFlagged: boolean;
  /** `match` entries the check would also block (PRF-44). */
  matchEntriesBlocked: string[];
  matchEntriesChecked: number;
}

/** PRF-44: runs a candidate code check over the stored outputs of the flagged entry and of every `match` entry. */
export function previewCheck(
  check: (draft: string) => string[],
  flagged: ReviewEntry,
  allEntries: readonly ReviewEntry[],
): CheckPreview {
  const blocks = (e: ReviewEntry) => e.entry.draft !== null && check(e.entry.draft).length > 0;
  const matches = allEntries.filter((e) => e.entry.marking === 'match' && e.entry.handlerId === flagged.entry.handlerId && e.entry.id !== flagged.entry.id);
  return { wouldBlockFlagged: blocks(flagged), matchEntriesBlocked: matches.filter(blocks).map((e) => e.entry.id), matchEntriesChecked: matches.length };
}
