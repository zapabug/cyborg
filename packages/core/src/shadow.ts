import { effectiveStatus, type FactStatus, type ProfileStore } from './profile-types.ts';
import { redact, scrub } from './scrubber.ts';
import type { Runner, RunOutcome } from './runner.ts';
import type { AutoReplyPolicy } from './calibration.ts';
import type { Marking, ShadowEntry, ShadowLog, LessonStore, LiveStore } from './shadow-types.ts';
import { MARKINGS } from './shadow-types.ts';
import type { Applier, AppliedChange, CyborgEvent, FactUsed, PromptLedger, Proposal, ProposalBody, ProposalStore, Scalar } from './types.ts';

// ---- shadow controller (PRF-15, PRF-63..64) ---------------------------------------------

export interface OutboundMessage {
  text: string;
  /** Handler id and event reference, so a reviewer can find the entry. */
  ref?: string;
}

/** An outbound channel. The adapter implements `send`; the core only ever calls it through the controller. */
export interface OutboundSink {
  channel: string;
  send(message: OutboundMessage): Promise<void>;
}

export class ShadowViolation extends Error {
  constructor(channel: string) {
    super(`shadow mode: sending to the origin channel "${channel}" is refused (PRF-15)`);
    this.name = 'ShadowViolation';
  }
}

export interface ShadowDeps {
  runner: Runner;
  log: ShadowLog;
  store: ProposalStore;
  ledger: PromptLedger;
  /** The real channel being listened to. Nothing is ever sent here during a shadow run. */
  originChannel: string;
  /** Where the bot's output goes for review. */
  review: OutboundSink;
  now?: () => Date;
}

export class ShadowController {
  constructor(private readonly deps: ShadowDeps) {
    if (deps.runner.mode !== 'shadow') throw new Error('a shadow controller needs a runner in shadow mode');
    if (deps.review.channel === deps.originChannel) throw new ShadowViolation(deps.originChannel);
  }

  private at(): string {
    return (this.deps.now ?? (() => new Date()))().toISOString();
  }

  /** Every outbound message goes through here; the origin channel is refused and audited. */
  async deliver(sink: OutboundSink, message: OutboundMessage): Promise<void> {
    if (sink.channel === this.deps.originChannel) {
      this.deps.store.appendAudit({
        at: this.at(), proposalId: null, kind: 'shadow_violation', fromStatus: null, toStatus: null,
        actor: 'shadow', detail: { channel: sink.channel, ref: message.ref ?? null },
      });
      throw new ShadowViolation(sink.channel);
    }
    await sink.send(message);
  }

  /** Listen-only: run the handlers on an origin event, log each result, send the output to the review sink only. */
  async observe(event: CyborgEvent): Promise<RunOutcome[]> {
    const outcomes = await this.deps.runner.handle(event);
    for (const outcome of outcomes) {
      if (outcome.outcome !== 'proposal') continue;
      const { proposal } = outcome;
      const factsUsed: FactUsed[] = (proposal.modelCallId && this.deps.ledger.read(proposal.modelCallId)?.factsUsed) || [];
      const entry = this.deps.log.addEntry(
        {
          eventSource: event.source,
          eventId: event.id,
          handlerId: proposal.handlerId,
          handlerVersion: proposal.handlerVersion,
          proposalId: proposal.id,
          draft: proposal.draft ?? null,
          output: { status: proposal.status, changes: proposal.changes, findings: proposal.findings, questions: proposal.questions },
          input: outcome.input,
          factsUsed,
        },
        this.at(),
      );
      const body = proposal.draft ?? `${proposal.status}: ${JSON.stringify({ changes: proposal.changes, findings: proposal.findings.map((f) => f.statement), questions: proposal.questions })}`;
      await this.deliver(this.deps.review, { text: `[shadow ${proposal.handlerId} ${proposal.handlerVersion}] ${body}`, ref: entry.id });
    }
    return outcomes;
  }

  /** The adapter reports what the business's human did for an origin event (PRF-16, PRF-20). */
  recordHuman(source: string, eventId: string, human: { reply?: string; action?: string }): ShadowEntry[] {
    // PRV-6a: the staff's words are saved after the scrubber has replaced phones, emails, IBANs, ids and long numbers with placeholders; the original stays in the chat.
    const counters: Record<string, number> = {};
    const replaced: { field: string; rule: string }[] = [];
    const clean = (field: 'reply' | 'action', value: string | undefined): string | undefined => {
      if (value === undefined) return undefined;
      const r = redact(value, counters);
      for (const x of r.replaced) replaced.push({ field, rule: x.rule });
      return r.text;
    };
    const safe: { reply?: string; action?: string } = {};
    const reply = clean('reply', human.reply);
    const action = clean('action', human.action);
    if (reply !== undefined) safe.reply = reply;
    if (action !== undefined) safe.action = action;
    if (replaced.length > 0) {
      this.deps.store.appendAudit({ at: this.at(), proposalId: null, kind: 'scrub_replaced', fromStatus: null, toStatus: null, actor: 'shadow', detail: { source, eventId, fields: replaced } });
    }
    return this.deps.log.recordHuman(source, eventId, safe, this.at());
  }
}

// ---- marking, wrong fact (PRF-16, PRF-17, PRF-65) ------------------------------------------

export interface EvalDeps {
  log: ShadowLog;
  profile: ProfileStore;
  proposals: ProposalStore;
  /** PRF-36: a `high`-band entry marked wrong suspends auto-reply for its handler. */
  policy?: AutoReplyPolicy;
  now?: () => Date;
}

/** Marks an entry. `wrong_fact` contradicts the fact used and opens a discrepancy item (PRF-65). */
export function markEntry(deps: EvalDeps, entryId: string, marking: Marking, actor: string, options: { factKeys?: string[] } = {}): ShadowEntry {
  if (!MARKINGS.includes(marking)) throw new Error(`"${marking}" is not a marking`);
  const at = (deps.now ?? (() => new Date()))().toISOString();
  const entry = deps.log.getEntry(entryId);
  if (!entry) throw new Error(`no shadow entry ${entryId}`);

  if (marking === 'wrong_fact') {
    const used = entry.factsUsed.filter((f) => f.kind === 'profile' && !f.runtime).map((f) => f.key);
    const keys = options.factKeys ?? (used.length === 1 ? used : []);
    if (keys.length === 0) throw new Error('a wrong_fact marking must name the fact (the entry used none or several)');
    for (const key of keys) {
      const fact = deps.profile.getFact(key);
      if (!fact) throw new Error(`no fact "${key}"`);
      const status: FactStatus = effectiveStatus(fact, new Date(at));
      if (status !== 'contradicted' && (status === 'unconfirmed' || status === 'confirmed')) {
        deps.profile.moveFact(key, 'contradicted', { actor, at, reason: `wrong_fact marking on shadow entry ${entryId}` });
      }
      deps.profile.addDiscrepancy({
        factKey: key, createdAt: at, status: 'open', factValue: fact.value,
        factSource: { kind: fact.source, ref: fact.sourceRef },
        evidence: [{ source: { kind: 'shadow_run', ref: entryId }, observed: entry.humanReply ?? entry.humanAction ?? null, note: 'marked wrong fact by a person' }],
        singleSource: true,
      });
    }
  }
  const marked = deps.log.mark(entryId, marking, actor, at);
  if ((marking === 'wrong_fact' || marking === 'worse') && entry.proposalId && deps.proposals.get(entry.proposalId)?.confidence?.band === 'high') {
    deps.policy?.suspend(entry.handlerId, `a high-band reply was marked ${marking} (entry ${entryId}); a person must review before re-enabling (PRF-36)`);
  }
  return marked;
}

// ---- improvement proposals and lessons (PRF-21, 22, 66, 67) ----------------------------------

export type ImprovementTarget =
  | { target: 'fact'; factKey: string; newValue: unknown; kind: 'add' | 'correct' | 'reconfirm'; reason: string }
  | { target: 'prompt'; handlerId: string; change: string }
  | { target: 'lesson'; handlerId: string | null; text: string }
  | { target: 'check'; handlerId: string; rule: string };

const toScalar = (v: unknown): Scalar => (v === null || ['string', 'number', 'boolean'].includes(typeof v) ? (v as Scalar) : JSON.stringify(v));

/** PRF-21: only an entry marked anything other than `match` can produce one. A person approves it like any proposal. */
export function proposeImprovement(deps: EvalDeps & { businessId: string }, entryId: string, request: ImprovementTarget): Proposal {
  const entry = deps.log.getEntry(entryId);
  if (!entry) throw new Error(`no shadow entry ${entryId}`);
  if (entry.marking === null || entry.marking === 'match') {
    throw new Error('an improvement proposal needs an entry marked other than "match" (PRF-21)');
  }
  const at = (deps.now ?? (() => new Date()))().toISOString();
  const evidence = `shadow entry ${entryId} (${entry.handlerId} ${entry.handlerVersion}, marked ${entry.marking})`;
  const body: ProposalBody = { subject: `improvement:${request.target}:${entryId}`, changes: [], findings: [], questions: [] };

  switch (request.target) {
    case 'fact': {
      const current = deps.profile.getFact(request.factKey);
      body.changes.push({ field: request.factKey, oldValue: current ? toScalar(current.value) : null, newValue: toScalar(request.newValue) });
      body.findings.push({ statement: `${request.kind} profile fact "${request.factKey}": ${request.reason}`, evidence });
      break;
    }
    case 'prompt':
      body.findings.push({ statement: `change the prompt of ${request.handlerId}: ${request.change}`, evidence });
      body.questions.push('Approve a new handler version with this prompt change?');
      break;
    case 'lesson': {
      // PRV-6: a lesson goes into prompts, so it must pass the scrubber. Fail closed.
      if (scrub(request.text).length > 0) throw new Error('the lesson text contains data the scrubber blocks (PRV-6)');
      body.changes.push({ field: 'lesson.handler', oldValue: null, newValue: request.handlerId ?? '*' });
      body.changes.push({ field: 'lesson.text', oldValue: null, newValue: request.text });
      body.findings.push({ statement: 'add a lesson for the handler', evidence });
      break;
    }
    case 'check':
      body.findings.push({ statement: `add a code check to ${request.handlerId}: ${request.rule}`, evidence });
      body.questions.push('Who will write and review this check?');
      break;
  }
  return deps.proposals.create(
    { businessId: deps.businessId, handlerId: 'shadow.improvement', handlerVersion: '1', status: 'proposed', ...body, modelCallId: null, reason: null },
    null,
    at,
  );
}

/** Applies an approved lesson proposal: lessons are core data, so the core supplies this applier (PRF-67). */
export function lessonApplier(lessons: LessonStore, now: () => Date = () => new Date()): Applier {
  return {
    async prepareApply() {
      return { stale: false };
    },
    async apply(proposal): Promise<AppliedChange[]> {
      const handler = proposal.changes.find((c) => c.field === 'lesson.handler');
      const text = proposal.changes.find((c) => c.field === 'lesson.text');
      if (!handler || !text || typeof text.newValue !== 'string') throw new Error('not a lesson proposal');
      const origin = /^improvement:lesson:(.+)$/.exec(proposal.subject)?.[1] ?? null;
      const lesson = lessons.addLesson({ handlerId: handler.newValue === '*' ? null : String(handler.newValue), text: text.newValue, originEntryId: origin }, now().toISOString());
      return [
        { field: 'lesson.handler', oldValue: null, newValue: handler.newValue },
        { field: 'lesson.text', oldValue: null, newValue: lesson.text },
      ];
    },
    async revert(proposal) {
      const text = proposal.changes.find((c) => c.field === 'lesson.text');
      const match = lessons.listLessons().find((l) => l.text === text?.newValue && l.status === 'active');
      if (match) lessons.retireLesson(match.id, now().toISOString());
    },
  };
}

// ---- replay (PRF-25, PRF-68) ------------------------------------------------------------------

export interface ReplayReportEntry {
  entryId: string;
  handlerId: string;
  oldVersion: string;
  newVersion: string;
  oldDraft: string | null;
  newDraft: string | null;
  draftChanged: boolean;
  oldMarking: Marking | null;
  /** A `match` whose draft changed: the fix may have broken something that was right. */
  markingAtRisk: boolean;
  status: 'ok' | 'invalid' | 'refused';
  note?: string;
}

/** Runs the stored real inputs through the current handlers and reports, per entry, what changed. */
export async function replayEntries(runner: Runner, entries: readonly ShadowEntry[], options: { extraLessons?: readonly string[] } = {}): Promise<ReplayReportEntry[]> {
  const report: ReplayReportEntry[] = [];
  for (const entry of entries) {
    const result = await runner.replay(entry.handlerId, entry.input, options);
    const newDraft = result.outcome === 'ok' && !('none' in result.body) ? (result.body.draft ?? null) : null;
    const changed = result.outcome !== 'ok' || newDraft !== entry.draft;
    report.push({
      entryId: entry.id,
      handlerId: entry.handlerId,
      oldVersion: entry.handlerVersion,
      newVersion: result.handlerVersion,
      oldDraft: entry.draft,
      newDraft,
      draftChanged: changed,
      oldMarking: entry.marking,
      markingAtRisk: entry.marking === 'match' && changed,
      status: result.outcome,
      ...(result.outcome === 'ok' ? ('none' in result.body ? { note: result.body.none } : {}) : { note: result.outcome === 'invalid' ? result.message : result.reason }),
    });
  }
  return report;
}

// ---- the live gate (HR-8, PRF-18, PRF-70) -----------------------------------------------------

export interface LiveGateDeps {
  log: ShadowLog;
  profile: ProfileStore;
  /** N-7: the minimum recorded shadow run. OPEN in the spec, so there is no default (HR-10). */
  minimum: { entries: number; days: number } | undefined;
  /** The deployment checklist result for the channel (docs/10). Absent until M7b: the gate fails closed. */
  checklist: (() => { complete: boolean; signedOffBy: string | null }) | undefined;
  now?: () => Date;
}

export interface LiveGateResult {
  ok: boolean;
  failures: string[];
  evidence: { entries: number; days: number; factsChecked: string[] };
}

export function checkLiveGate(deps: LiveGateDeps, handlerId: string): LiveGateResult {
  const now = (deps.now ?? (() => new Date()))();
  const entries = deps.log.listEntries({ handlerId });
  const failures: string[] = [];

  const times = entries.map((e) => new Date(e.createdAt).getTime());
  const days = times.length ? (Math.max(...times) - Math.min(...times)) / 86_400_000 : 0;
  if (!deps.minimum) failures.push('N-7 (the minimum shadow run) is not configured, so no shadow run can meet it');
  else {
    if (entries.length < deps.minimum.entries) failures.push(`the shadow run has ${entries.length} entries, the minimum is ${deps.minimum.entries}`);
    if (days < deps.minimum.days) failures.push(`the shadow run spans ${days.toFixed(1)} days, the minimum is ${deps.minimum.days}`);
  }
  if (entries.length === 0) failures.push('there is no recorded shadow run for this handler');

  const factKeys = [...new Set(entries.flatMap((e) => e.factsUsed.filter((f) => f.kind === 'profile' && !f.runtime).map((f) => f.key)))].sort(); // CMP-27: computed at run time, not stored
  for (const key of factKeys) {
    const fact = deps.profile.getFact(key);
    const status = fact ? effectiveStatus(fact, now) : 'missing';
    if (status !== 'confirmed') failures.push(`profile fact "${key}" used in the shadow run is ${status}, not confirmed`);
  }

  if (!deps.checklist) failures.push('the deployment checklist is not available (docs/10, M7b)');
  else {
    const result = deps.checklist();
    if (!result.complete) failures.push('the deployment checklist for the channel is not complete');
    else if (!result.signedOffBy) failures.push('the deployment checklist has no named sign-off');
  }
  return { ok: failures.length === 0, failures, evidence: { entries: entries.length, days, factsChecked: factKeys } };
}

export class LiveGateError extends Error {
  constructor(readonly failures: string[]) {
    super(`not enabled for live use: ${failures.join('; ')}`);
    this.name = 'LiveGateError';
  }
}

/** Enables a handler for live use only if the gate passes; records who, when and the evidence. */
export function enableLive(deps: LiveGateDeps & { live: LiveStore; store: ProposalStore }, handlerId: string, actor: string): void {
  const result = checkLiveGate(deps, handlerId);
  const at = (deps.now ?? (() => new Date()))().toISOString();
  if (!result.ok) {
    deps.store.appendAudit({ at, proposalId: null, kind: 'live_enable_refused', fromStatus: null, toStatus: null, actor, detail: { handlerId, failures: result.failures } });
    throw new LiveGateError(result.failures);
  }
  deps.live.enable({ handlerId, enabledAt: at, enabledBy: actor, evidence: result.evidence });
  deps.store.appendAudit({ at, proposalId: null, kind: 'live_enabled', fromStatus: null, toStatus: null, actor, detail: { handlerId, ...result.evidence } });
}
