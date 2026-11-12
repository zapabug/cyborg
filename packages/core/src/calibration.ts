// docs/06 PRF-30..38, 73..76: calibration of the confidence band, the monthly sample and report, and auto-reply eligibility.
import { BANDS, type Band, type Confidence, type SignalKind } from './confidence.ts';
import { MARKINGS, type Marking, type ShadowEntry } from './shadow-types.ts';
import type { Proposal, ProposalStore } from './types.ts';

export type BandVerdict = 'about_right' | 'too_high' | 'too_low';

// ---- calibration records (PRF-30, PRF-73) -----------------------------------------------------

export interface CalibrationRecord {
  handlerId: string;
  handlerVersion: string;
  model: string;
  endpoint: string;
  status: 'current' | 'stale';
  since: string;
  lastReviewAt: string | null;
}

export interface CalibrationStore {
  latestCalibration(handlerId: string): CalibrationRecord | null;
  insertCalibration(record: CalibrationRecord): void;
  markCalibrationStale(handlerId: string, handlerVersion: string, model: string, endpoint: string): void;
  recordReview(handlerId: string, handlerVersion: string, model: string, endpoint: string, at: string): void;
  listCalibrations(): CalibrationRecord[];
}

// ---- auto-reply eligibility and suspension (PRF-35, PRF-36, PRF-76) -------------------------------

export interface AutoReplyStore {
  getEligibleBand(handlerId: string): { band: Band; reportRef: string; setBy: string; setAt: string } | null;
  setEligibleBand(handlerId: string, band: Band, reportRef: string, actor: string, at: string): void;
  getSuspension(handlerId: string): { reason: string; at: string } | null;
  suspendAutoReply(handlerId: string, reason: string, at: string): void;
  reenableAutoReply(handlerId: string, actor: string, at: string): void;
}

const RANK: Record<Band, number> = { low: 0, medium: 1, high: 2 };

export class AutoReplyPolicy {
  constructor(
    private readonly store: AutoReplyStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** PRF-35: no eligibility by default; the band comes from a review report, never from code. */
  setEligibleBand(handlerId: string, band: Band, reportRef: string, actor: string): void {
    if (!reportRef.trim()) throw new Error('the eligible band must name the calibration report it came from (PRF-35)');
    this.store.setEligibleBand(handlerId, band, reportRef, actor, this.now().toISOString());
  }

  suspend(handlerId: string, reason: string): void {
    if (!this.store.getSuspension(handlerId)) this.store.suspendAutoReply(handlerId, reason, this.now().toISOString());
  }

  /** PRF-36: only a person re-enables, and nothing else changes. */
  reenable(handlerId: string, actor: string): void {
    if (!actor.trim()) throw new Error('a person must re-enable auto-reply');
    this.store.reenableAutoReply(handlerId, actor, this.now().toISOString());
  }

  /** May this proposal be sent without a person? Eligible band set, not suspended, and the band is at or above it. */
  decide(proposal: Pick<Proposal, 'handlerId' | 'confidence'>): { send: boolean; why: string } {
    const suspension = this.store.getSuspension(proposal.handlerId);
    if (suspension) return { send: false, why: `auto-reply is suspended: ${suspension.reason}` };
    const eligible = this.store.getEligibleBand(proposal.handlerId);
    if (!eligible) return { send: false, why: 'no eligible band is set; auto-reply is off by default (HDL-3)' };
    if (!proposal.confidence) return { send: false, why: 'the proposal carries no confidence record' };
    return RANK[proposal.confidence.band] >= RANK[eligible.band]
      ? { send: true, why: `band ${proposal.confidence.band} meets the eligible band ${eligible.band}` }
      : { send: false, why: `band ${proposal.confidence.band} is below the eligible band ${eligible.band}` };
  }
}

export class CalibrationTracker {
  constructor(
    private readonly store: CalibrationStore,
    private readonly audit: Pick<ProposalStore, 'appendAudit'>,
    private readonly policy?: AutoReplyPolicy,
  ) {}

  /** PRF-30, PRF-38: a new (version, model, endpoint) makes the old calibration stale; a new model or endpoint also suspends auto-reply. */
  observe(handlerId: string, version: string, model: string, endpoint: string, at: string): { changed: boolean } {
    const latest = this.store.latestCalibration(handlerId);
    if (latest && latest.handlerVersion === version && latest.model === model && latest.endpoint === endpoint) return { changed: false };
    if (latest) {
      this.store.markCalibrationStale(handlerId, latest.handlerVersion, latest.model, latest.endpoint);
      this.audit.appendAudit({
        at, proposalId: null, kind: 'calibration_stale', fromStatus: null, toStatus: null, actor: 'calibration',
        detail: { handlerId, from: { version: latest.handlerVersion, model: latest.model, endpoint: latest.endpoint }, to: { version, model, endpoint } },
      });
      if (latest.model !== model || latest.endpoint !== endpoint) {
        this.policy?.suspend(handlerId, 'the model or endpoint changed; the shadow phase must repeat before auto-reply is re-enabled (PRF-38)');
      }
    }
    this.store.insertCalibration({ handlerId, handlerVersion: version, model, endpoint, status: 'current', since: at, lastReviewAt: null });
    return { changed: true };
  }

  /** Calibrations that need a review: stale ones that never had one, and current ones last reviewed over a month ago (N-9). */
  reviewDue(now: Date): CalibrationRecord[] {
    return this.store.listCalibrations().filter((c) => {
      const base = new Date(c.lastReviewAt ?? c.since);
      const due = new Date(base);
      due.setUTCMonth(due.getUTCMonth() + 1);
      return c.lastReviewAt === null && c.status === 'stale' ? true : due.getTime() <= now.getTime();
    });
  }
}

// ---- review entries and the sample (PRF-32, PRF-74) -----------------------------------------------------

export interface ReviewEntry {
  entry: ShadowEntry;
  band: Band | null;
  signals: Confidence['signals'];
  model: string | null;
  endpoint: string | null;
  autoReply: boolean;
  flagged: boolean;
}

/** Small seeded generator (mulberry32 over a string hash), so a sample can be reproduced. */
function seeded(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353), (h = (h << 13) | (h >>> 19));
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function isFalseConfidence(e: ReviewEntry): boolean {
  const checksPassed = e.signals.filter((s) => s.kind === 'checks').every((s) => s.passed === true) && e.signals.some((s) => s.kind === 'checks');
  return e.flagged && (e.band === 'medium' || e.band === 'high' || checksPassed);
}

export interface SampleConfig {
  /** N-10 is OPEN, so there is no default size: the draw sizes are explicit config. */
  seed: string;
  highDraw: number;
  mediumDraw: number;
}

export function buildSample(entries: readonly ReviewEntry[], config: SampleConfig): { sample: ReviewEntry[]; mandatory: number; drawn: number } {
  const wrong = (m: Marking | null) => m === 'wrong_fact' || m === 'worse';
  const mandatory = entries.filter((e) => e.autoReply || e.band === 'low' || wrong(e.entry.marking) || isFalseConfidence(e));
  const ids = new Set(mandatory.map((e) => e.entry.id));
  const rng = seeded(config.seed);
  const draw = (band: Band, n: number): ReviewEntry[] => {
    const pool = entries.filter((e) => e.band === band && !ids.has(e.entry.id)).sort((a, b) => a.entry.id.localeCompare(b.entry.id));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    return pool.slice(0, n);
  };
  const drawn = [...draw('high', config.highDraw), ...draw('medium', config.mediumDraw)];
  const sample = [...mandatory, ...drawn].sort((a, b) => a.entry.createdAt.localeCompare(b.entry.createdAt) || a.entry.id.localeCompare(b.entry.id));
  return { sample, mandatory: mandatory.length, drawn: drawn.length };
}

// ---- the calibration report (PRF-34, PRF-40..42, PRF-78) -----------------------------------------------------

type BandKey = Band | 'none';
const bandKey = (b: Band | null): BandKey => b ?? 'none';
const zeroMarkings = (): Record<Marking | 'unmarked', number> => ({ ...Object.fromEntries(MARKINGS.map((m) => [m, 0])), unmarked: 0 }) as Record<Marking | 'unmarked', number>;
const zeroVerdicts = (): Record<BandVerdict | 'none', number> => ({ about_right: 0, too_high: 0, too_low: 0, none: 0 });

export interface CalibrationReport {
  key: { handlerId: string; handlerVersion: string; model: string | null; endpoint: string | null };
  generatedAt: string;
  entries: number;
  perBand: Record<BandKey, { markings: Record<Marking | 'unmarked', number>; verdicts: Record<BandVerdict | 'none', number> }>;
  wrongFactEntryIds: string[];
  improvementProposals: number;
  /** Staff verdict against band (PRF-40). */
  flagView: { flagged: Record<BandKey, number>; notFlagged: Record<BandKey, number> };
  /** Not flagged but band low: over-caution (PRF-41). */
  overCaution: number;
  falseConfidence: { entryId: string; band: BandKey; signals: Confidence['signals'] }[];
  /** Per signal: how often it passed on flagged replies (PRF-42). A count, not a score. */
  signalPassCounts: Partial<Record<SignalKind, { passed: number; total: number }>>;
}

export function buildCalibrationReport(
  key: CalibrationReport['key'],
  entries: readonly ReviewEntry[],
  improvementProposals: number,
  now: Date,
): CalibrationReport {
  const bands: BandKey[] = [...BANDS, 'none'];
  const perBand = Object.fromEntries(bands.map((b) => [b, { markings: zeroMarkings(), verdicts: zeroVerdicts() }])) as CalibrationReport['perBand'];
  const flagView = {
    flagged: Object.fromEntries(bands.map((b) => [b, 0])) as Record<BandKey, number>,
    notFlagged: Object.fromEntries(bands.map((b) => [b, 0])) as Record<BandKey, number>,
  };
  const signalPassCounts: CalibrationReport['signalPassCounts'] = {};
  for (const e of entries) {
    const b = bandKey(e.band);
    perBand[b].markings[e.entry.marking ?? 'unmarked']++;
    perBand[b].verdicts[e.entry.bandVerdict ?? 'none']++;
    (e.flagged ? flagView.flagged : flagView.notFlagged)[b]++;
    if (e.flagged) {
      for (const s of e.signals) {
        const c = (signalPassCounts[s.kind] ??= { passed: 0, total: 0 });
        c.total++;
        if (s.passed === true) c.passed++;
      }
    }
  }
  return {
    key,
    generatedAt: now.toISOString(),
    entries: entries.length,
    perBand,
    wrongFactEntryIds: entries.filter((e) => e.entry.marking === 'wrong_fact').map((e) => e.entry.id),
    improvementProposals,
    flagView,
    overCaution: entries.filter((e) => !e.flagged && e.band === 'low').length,
    falseConfidence: entries.filter(isFalseConfidence).map((e) => ({ entryId: e.entry.id, band: bandKey(e.band), signals: e.signals })),
    signalPassCounts,
  };
}

/** PRF-37: what may leave the business: ids and counts. Signal details can quote draft text, so they are dropped. */
export function exportForSupplier(report: CalibrationReport): CalibrationReport {
  return { ...report, falseConfidence: report.falseConfidence.map((f) => ({ ...f, signals: f.signals.map(({ detail: _detail, ...rest }) => rest) })) };
}

/** PRF-37: the monthly report to the owner is a draft proposal a person sends; it carries counts, not customer text. */
export function proposeOwnerReport(proposals: ProposalStore, businessId: string, report: CalibrationReport, at: string): Proposal {
  const counts = (r: Record<string, number>) => Object.entries(r).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(', ') || 'none';
  const findings = (Object.keys(report.perBand) as BandKey[])
    .filter((b) => Object.values(report.perBand[b].markings).some((n) => n > 0))
    .map((b) => ({
      statement: `band ${b}: markings ${counts(report.perBand[b].markings)}; band verdicts ${counts(report.perBand[b].verdicts)}`,
      evidence: `${report.key.handlerId} ${report.key.handlerVersion}, ${report.key.model ?? 'unknown model'}`,
    }));
  findings.push({
    statement: `flagged replies by band: ${counts(report.flagView.flagged)}; not flagged: ${counts(report.flagView.notFlagged)}; false confidence ${report.falseConfidence.length}; over-caution ${report.overCaution}`,
    evidence: `${report.entries} reviewed entries`,
  });
  return proposals.create(
    {
      businessId, handlerId: 'calibration.owner_report', handlerVersion: '1', status: 'proposed', subject: `calibration:${report.key.handlerId}:${report.key.handlerVersion}`,
      changes: [], findings, questions: ['Which tuning proposals does the owner approve, and may the eligible auto-reply band change?'], modelCallId: null, reason: null,
    },
    null,
    at,
  );
}
