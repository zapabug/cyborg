// docs/06 PRF-27..29, 71, 72: a band derived by a fixed rule from code-side signals.
import type { ResolvedFacts } from './profile-types.ts';

export const BANDS = ['low', 'medium', 'high'] as const;
export type Band = (typeof BANDS)[number];
const RANK: Record<Band, number> = { low: 0, medium: 1, high: 2 };
const lower = (a: Band, b: Band): Band => (RANK[a] <= RANK[b] ? a : b);

export const BAND_RULE_VERSION = 'band-rule-1';

export type SignalKind = 'checks' | 'grounding' | 'language' | 'self_assessment' | 'logprob' | 'voice_transcript' | 'verifier';

export interface Signal {
  kind: SignalKind;
  /** True/false for pass/fail signals; null for a recorded value that is not a pass/fail. */
  passed: boolean | null;
  value: string | number | boolean | null;
  detail?: string;
}

export interface Confidence {
  band: Band;
  rule: string;
  signals: Signal[];
}

/** What a handler supplies to opt in (PRF-72). */
export interface ConfidenceSpec {
  /** ADM-75: does the reply follow the language of the customer's message? Null when it cannot tell; a clear mismatch lowers the band. */
  language?(output: never, input: never): { ok: boolean; detail: string } | null;
  /** Reads the model's own assessment from the output; recorded but weak, and can only lower the band. */
  selfAssessment?(output: never): { band: Band; reason: string } | null;
  /** Do all business facts stated in the output trace to a supplied fact? */
  grounding?(output: never, input: never, facts: ResolvedFacts): { ok: boolean; untraced: string[] };
  /** Set from a calibration review only (HR-10). Without it the log-probability is recorded, not used. */
  logprobFloor?: number;
}

export interface ConfidenceInput {
  spec: ConfidenceSpec;
  output: unknown;
  input: unknown;
  facts: ResolvedFacts;
  /** Mean token log-probability of the answer, when the endpoint returned them (GWY-17). */
  meanLogprob: number | undefined;
  viaVoice: boolean;
  /** The handler's code blocked the output when it built the proposal (PRF-29: a failed check caps the band at low). */
  blocked?: boolean;
}

/** PRF-29, PRF-71: starts at `high` and only goes down. */
export function computeConfidence(i: ConfidenceInput): Confidence {
  const blocked = i.blocked === true;
  const signals: Signal[] = [{ kind: 'checks', passed: !blocked, value: blocked ? 'a code check blocked the output' : 'all code checks passed' }];
  let band: Band = blocked ? 'low' : 'high';

  if (i.spec.grounding) {
    const g = i.spec.grounding(i.output as never, i.input as never, i.facts);
    signals.push({ kind: 'grounding', passed: g.ok, value: g.ok ? 'all stated facts traced' : `${g.untraced.length} untraced`, ...(g.ok ? {} : { detail: g.untraced.join('; ') }) });
    if (!g.ok) band = 'low';
  }
  if (i.spec.language) {
    const l = i.spec.language(i.output as never, i.input as never);
    if (l) {
      signals.push({ kind: 'language', passed: l.ok, value: l.ok ? 'reply follows the customer\'s language' : 'reply is in another language', ...(l.ok ? {} : { detail: l.detail }) });
      if (!l.ok) band = 'low';
    }
  }
  if (i.spec.selfAssessment) {
    const s = i.spec.selfAssessment(i.output as never);
    if (s) {
      signals.push({ kind: 'self_assessment', passed: null, value: s.band, detail: s.reason });
      band = s.band === 'low' ? 'low' : lower(band, s.band); // it can lower, never raise
    }
  }
  if (i.meanLogprob !== undefined) {
    const floor = i.spec.logprobFloor;
    const below = floor !== undefined && i.meanLogprob < floor;
    signals.push({ kind: 'logprob', passed: floor === undefined ? null : !below, value: i.meanLogprob, ...(floor === undefined ? { detail: 'recorded only: no floor configured from a review' } : {}) });
    if (below) band = lower(band, 'medium');
  }
  if (i.viaVoice) {
    signals.push({ kind: 'voice_transcript', passed: null, value: true, detail: 'transcription errors are invisible to the other signals (ADM-30)' });
    band = lower(band, 'medium');
  }
  return { band, rule: BAND_RULE_VERSION, signals };
}
