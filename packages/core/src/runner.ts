import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CalibrationTracker } from './calibration.ts';
import type { AdminNotifier } from './control.ts';
import { staffMessages, type LanguageSource } from './messages.ts';
import { computeConfidence, type Confidence } from './confidence.ts';
import type { FactProvider, ResolvedFacts, RunMode } from './profile-types.ts';
import type { LessonStore, LiveStore } from './shadow-types.ts';
import { VAULT_CLASSES } from './data-class.ts';
import { N1_VALIDATION_RETRIES } from './numbers.ts';
import { buildPrompt, factPromptSlots, promptSlots, redactFreetextFields, scrubFreetextFields, type FreetextRedaction, type ScrubFinding } from './prompt.ts';
import { PLACEHOLDER } from './scrubber.ts';
import { PromptSafe, PromptSafetyError } from './prompt-safe.ts';
import { stripThinkBlocks, type Scratchpad } from './reasoning.ts';
import { sealInput } from './seal.ts';
import type { UsageStore } from './usage.ts';
import type { HandlerRegistry } from './registry.ts';
import { selectHandlers } from './router.ts';
import type {
  AnyHandler,
  CyborgEvent,
  DeterministicHandler,
  FactUsed,
  Finding,
  IdentityVault,
  ModelHandler,
  ModelPort,
  NewProposal,
  NoProposal,
  PromptLedger,
  Proposal,
  ProposalBody,
  ProposalStore,
  RunKey,
} from './types.ts';

export interface RunnerDeps {
  businessId: string;
  registry: HandlerRegistry;
  store: ProposalStore;
  ledger: PromptLedger;
  model: ModelPort;
  /** Resolves profile and pack facts; needed by any handler that declares them (PRF-4). */
  facts?: FactProvider;
  /** PRF-5, PRF-57: which statuses may reach a prompt. Defaults to `live`, the stricter one. */
  mode?: RunMode;
  /** ADM-44: told when the inference key is rejected or out of credit. */
  notifier?: Pick<AdminNotifier, 'alert' | 'resolved'>;
  /** PRF-30, PRF-73: told about each (version, model, endpoint) a confidence-bearing proposal came from. */
  calibration?: CalibrationTracker;
  /** ADM-6, ADM-40: where stripped reasoning and the routing trace go. Never a channel. */
  scratchpad?: Scratchpad;
  /** Approved lessons injected through `prompt.lessonsSlot` (PRF-67). */
  lessons?: Pick<LessonStore, 'activeLessonsFor'>;
  /** HR-8, PRF-70: in `live` mode, handlers that are not enabled here are refused. */
  live?: Pick<LiveStore, 'isEnabled'>;
  /** Needed by any handler with `identity` or `secret` fields (PRV-2). */
  vault?: IdentityVault;
  /** ADM-77: the language of the alerts staff are shown. Default English at this level. */
  language?: LanguageSource;
  /** GWY-31: at most this many model calls in any rolling 24 hours, counted from the ledger. Unset means no cap. */
  callCap?: { maxPer24h: number };
  usage?: Pick<UsageStore, 'countModelCalls'>;
  now?: () => Date;
  /** Validation retries before `invalid_output`; defaults to N-1 (BEH-13). */
  validationRetries?: number;
}

export type RunOutcome =
  | { handlerId: string; outcome: 'duplicate' }
  | { handlerId: string; outcome: 'none'; reason: string }
  | { handlerId: string; outcome: 'refused'; reason: string }
  | {
      handlerId: string;
      outcome: 'proposal';
      proposal: Proposal;
      /** The handler input after sealing (identity values are vault codes) and after the scrubber has replaced freetext hits with placeholders (PRV-6a); stored by shadow mode for replay. */
      input: Record<string, unknown>;
    };

export type ReplayResult =
  | { outcome: 'ok'; handlerVersion: string; body: ProposalBody | NoProposal }
  | { outcome: 'invalid'; handlerVersion: string; message: string }
  | { outcome: 'refused'; handlerVersion: string; reason: string };

type Validated = { ok: true; body: ProposalBody | NoProposal; output: unknown } | { ok: false; message: string };

export class Runner {
  private readonly inFlight = new Set<string>();
  /** Set after a credential failure: model handlers are refused, with no call made, until a person clears it (GWY-24). */
  private inferenceProblem: { detail: string; at: string } | null = null;

  get inferenceBlocked(): { detail: string; at: string } | null {
    return this.inferenceProblem;
  }

  private capAlerted = false;

  /** GWY-31: refuse a model call when the ledger already shows the cap used; the event stays unhandled. Returns the reason, or null. */
  private async checkCallCap(key: RunKey): Promise<string | null> {
    const { maxPer24h } = this.deps.callCap!;
    const at = this.now();
    const used = this.deps.usage!.countModelCalls(new Date(at.getTime() - 86_400_000).toISOString());
    if (used < maxPer24h) {
      if (this.capAlerted) {
        this.capAlerted = false;
        this.deps.store.appendAudit({ at: at.toISOString(), proposalId: null, kind: 'call_cap_cleared', fromStatus: null, toStatus: null, actor: 'runner', detail: { used, cap: maxPer24h } });
        await this.deps.notifier?.resolved?.({ kind: 'call_cap', ref: '' }).catch(() => undefined);
      }
      return null;
    }
    this.deps.store.appendAudit({ at: at.toISOString(), proposalId: null, kind: 'call_cap_blocked', fromStatus: null, toStatus: null, actor: 'runner', detail: { ...key, used, cap: maxPer24h } });
    if (!this.capAlerted) {
      this.capAlerted = true;
      try {
        await this.deps.notifier?.alert?.({ kind: 'call_cap', detail: staffMessages(this.deps.language).callCap(maxPer24h) });
      } catch (error) {
        this.deps.store.appendAudit({ at: at.toISOString(), proposalId: null, kind: 'admin_ping_failed', fromStatus: null, toStatus: null, actor: 'runner', detail: { kind: 'call_cap', error: (error as Error).message } });
      }
    }
    return `the limit of ${maxPer24h} model calls in 24 hours is used (${used}); the event is kept and runs when the count drops or the limit is raised (GWY-31)`;
  }

  /** The admin fixed the key or the credit. No timer, no guess: a person says so. */
  resetInferenceProblem(actor: string): void {
    if (!this.inferenceProblem) return;
    this.deps.store.appendAudit({ at: this.now().toISOString(), proposalId: null, kind: 'inference_problem_cleared', fromStatus: null, toStatus: null, actor, detail: { was: this.inferenceProblem.detail } });
    this.inferenceProblem = null;
    // ADM-48: the dashboard stops showing it. Not awaited; a failure is an audit row.
    void this.deps.notifier?.resolved?.({ kind: 'inference_key', ref: '' }).catch((error: Error) => {
      this.deps.store.appendAudit({ at: this.now().toISOString(), proposalId: null, kind: 'admin_ping_failed', fromStatus: null, toStatus: null, actor: 'runner', detail: { kind: 'inference_key', resolved: true, error: error.message } });
    });
  }


  constructor(private readonly deps: RunnerDeps) {
    if (deps.callCap && !deps.usage) throw new Error('a call cap needs a usage counter (the SQLite store provides one)');
  }

  get mode(): RunMode {
    return this.deps.mode ?? 'live';
  }

  /** PRF-67, PRF-24: the handler version plus the newest active lesson that applies to it. */
  versionOf(handler: AnyHandler, resolved?: ResolvedFacts): string {
    const lessons = this.deps.lessons?.activeLessonsFor(handler.id) ?? [];
    let version = handler.version;
    if (handler.kind === 'model' && handler.prompt.lessonsSlot && lessons.length > 0) version += `+L${Math.max(...lessons.map((l) => l.version))}`;
    // PRF-24b, DSK-10: a rule held in a profile fact (the company's principles) is part of the prompt, so its text is part of the version.
    if (handler.kind === 'model' && handler.versionFacts?.length && resolved) {
      const rules = resolved.profile.filter((f) => handler.versionFacts!.includes(f.key)).sort((a, b) => a.key.localeCompare(b.key)).map((f) => [f.key, f.value]);
      if (rules.length > 0) version += `+P${createHash('sha256').update(JSON.stringify(rules)).digest('hex').slice(0, 8)}`;
    }
    return version;
  }

  private lessonSlots(handler: ModelHandler, extra: readonly string[] = []): Record<string, PromptSafe> {
    const slot = handler.prompt.lessonsSlot;
    if (!slot) return {};
    const lessons = this.deps.lessons?.activeLessonsFor(handler.id) ?? [];
    const text = [...lessons.map((l) => l.text), ...extra].map((t) => `- ${t}`).join('\n');
    // Lessons were scrubbed when proposed; scrub again at the point of use (PRV-6, fail closed).
    const safe = PromptSafe.ofScrubbedFreetext(text);
    if ('hits' in safe) throw new PromptSafetyError(`lesson text for ${handler.id} has scrubber hits; the call must not be made`);
    return { [slot]: safe };
  }

  private now(): Date {
    return (this.deps.now ?? (() => new Date()))();
  }

  /** Runs every handler the event selects, in registration order (BEH-9). */
  async handle(event: CyborgEvent): Promise<RunOutcome[]> {
    const outcomes: RunOutcome[] = [];
    for (const handler of selectHandlers(this.deps.registry, event)) {
      const outcome = await this.runOne(handler, event);
      outcomes.push(outcome);
      this.deps.scratchpad?.write({ at: this.now().toISOString(), kind: 'route', ref: `${event.source}:${event.id}`, text: `${handler.id} -> ${outcome.outcome}` });
    }
    return outcomes;
  }

  /**
   * PRF-68: runs a stored, already sealed input through the current handler (prompt, lessons,
   * checks) without creating a proposal or a run marker. A model call is still recorded in the ledger.
   */
  async replay(handlerId: string, input: Record<string, unknown>, options: { extraLessons?: readonly string[] } = {}): Promise<ReplayResult> {
    const handler = this.deps.registry.get(handlerId);
    if (!handler) throw new Error(`no handler "${handlerId}"`);
    let resolved: ResolvedFacts = { profile: [], pack: [] };
    if (handler.profileKeys.length > 0 || handler.packFacts.length > 0) {
      if (!this.deps.facts) throw new Error(`handler "${handler.id}" declares profile or pack facts but no fact provider is configured`);
      const outcome = this.deps.facts.resolve({ profileKeys: handler.profileKeys, packFacts: handler.packFacts, mode: this.mode, now: this.now() });
      if (!outcome.ok) {
        return { outcome: 'refused', handlerVersion: this.versionOf(handler), reason: outcome.blocked.map((b) => `${b.kind} fact "${b.key}": ${b.reason}`).join('; ') };
      }
      resolved = outcome.facts;
    }
    const version = this.versionOf(handler, resolved);
    const event: CyborgEvent = { id: 'replay', source: 'replay', kind: 'replay', at: this.now().toISOString(), payload: {} };
    if (handler.kind === 'model') {
      const modelInput = redactFreetextFields(handler, input).input;
      if (scrubFreetextFields(handler, modelInput).length > 0) return { outcome: 'refused', handlerVersion: version, reason: 'scrubber hit in the stored input' };
      const result = await this.runModel(handler, modelInput, event, resolved, version, options.extraLessons ?? []);
      return result.ok ? { outcome: 'ok', handlerVersion: version, body: result.body } : { outcome: 'invalid', handlerVersion: version, message: result.message };
    }
    const result = this.runDeterministic(handler, input, event, resolved);
    return result.ok ? { outcome: 'ok', handlerVersion: version, body: result.body } : { outcome: 'invalid', handlerVersion: version, message: result.message };
  }

  private async runOne(handler: AnyHandler, event: CyborgEvent): Promise<RunOutcome> {
    const key: RunKey = { source: event.source, eventId: event.id, handlerId: handler.id };
    const flightKey = JSON.stringify(key);
    // BEH-10: idempotent per event id.
    if (this.deps.store.hasRun(key) || this.inFlight.has(flightKey)) {
      return { handlerId: handler.id, outcome: 'duplicate' };
    }
    if (this.mode === 'live' && handler.effect === 'auto_reply' && !this.deps.live) {
      // HR-8: a handler that answers customers by itself can never run live without the live registry.
      const reason = `handler "${handler.id}" auto-replies and needs a live registry; none is configured (HR-8)`;
      this.deps.store.appendAudit({ at: this.now().toISOString(), proposalId: null, kind: 'live_refused', fromStatus: null, toStatus: null, actor: 'runner', detail: { ...key } });
      return { handlerId: handler.id, outcome: 'refused', reason };
    }
    if (this.mode === 'live' && this.deps.live && !this.deps.live.isEnabled(handler.id)) {
      const reason = `handler "${handler.id}" is not enabled for live use; it needs a shadow run and the deployment checklist (HR-8, PRF-70)`;
      this.deps.store.appendAudit({
        at: this.now().toISOString(), proposalId: null, kind: 'live_refused', fromStatus: null, toStatus: null,
        actor: 'runner', detail: { ...key },
      });
      return { handlerId: handler.id, outcome: 'refused', reason };
    }
    if (handler.kind === 'model' && this.inferenceProblem) {
      const reason = `inference is blocked: ${this.inferenceProblem.detail}; a person must fix the key or the credit and clear it (GWY-24)`;
      this.deps.store.appendAudit({ at: this.now().toISOString(), proposalId: null, kind: 'inference_blocked', fromStatus: null, toStatus: null, actor: 'runner', detail: { ...key, reason: this.inferenceProblem.detail } });
      return { handlerId: handler.id, outcome: 'refused', reason };
    }
    if (handler.kind === 'model' && this.deps.callCap) {
      const blocked = await this.checkCallCap(key);
      if (blocked) return { handlerId: handler.id, outcome: 'refused', reason: blocked };
    }
    if (handler.kind === 'model' && this.deps.model.checkCapability) {
      // GWY-11, GWY-22: refuse before any input is assembled; the event stays unhandled.
      const verdict = this.deps.model.checkCapability({
        handlerId: handler.id,
        level: handler.model.level,
        modelName: handler.model.name,
      });
      if (!verdict.ok) {
        this.deps.store.appendAudit({
          at: this.now().toISOString(),
          proposalId: null,
          kind: 'capability_refused',
          fromStatus: null,
          toStatus: null,
          actor: 'runner',
          detail: { ...key, level: handler.model.level, reason: verdict.reason },
        });
        return { handlerId: handler.id, outcome: 'refused', reason: verdict.reason };
      }
    }
    let resolved: ResolvedFacts = { profile: [], pack: [] };
    if (handler.profileKeys.length > 0 || handler.packFacts.length > 0) {
      if (!this.deps.facts) {
        throw new Error(`handler "${handler.id}" declares profile or pack facts but no fact provider is configured`);
      }
      const outcome = this.deps.facts.resolve({
        profileKeys: handler.profileKeys,
        packFacts: handler.packFacts,
        mode: this.deps.mode ?? 'live',
        now: this.now(),
      });
      if (!outcome.ok) {
        // PRF-57: refused like a capability refusal; the event stays unhandled.
        const reason = outcome.blocked.map((b) => `${b.kind} fact "${b.key}": ${b.reason}`).join('; ');
        this.deps.store.appendAudit({
          at: this.now().toISOString(),
          proposalId: null,
          kind: 'profile_refused',
          fromStatus: null,
          toStatus: null,
          actor: 'runner',
          detail: { ...key, blocked: outcome.blocked },
        });
        return { handlerId: handler.id, outcome: 'refused', reason };
      }
      resolved = outcome.facts;
    }
    this.inFlight.add(flightKey);
    try {
      return await this.execute(handler, event, key, resolved);
    } finally {
      this.inFlight.delete(flightKey);
    }
  }

  private async execute(handler: AnyHandler, event: CyborgEvent, key: RunKey, resolved: ResolvedFacts): Promise<RunOutcome> {
    const { store } = this.deps;
    const at = () => this.now().toISOString();
    const version = this.versionOf(handler, resolved);

    const parsed = handler.input.schema.safeParse(handler.input.fromEvent(event));
    if (!parsed.success) {
      // Issue codes and paths only: a message can quote the offending value (PRV-2).
      const reason = `input_rejected: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(input)'}: ${i.code}`).join('; ')}`;
      store.recordNoProposal(key, reason, at());
      return { handlerId: handler.id, outcome: 'none', reason };
    }
    const input = sealInput(handler, parsed.data as Record<string, unknown>, this.deps.vault);

    // PRV-6 (zapa, 2026-11-08): a scrubber hit is replaced by a placeholder and the call goes ahead; the original stays in the chat.
    // PRV-6a: what is stored with the outcome (the shadow entry) is the redacted form for every handler kind, never the original.
    const storedRedaction = redactFreetextFields(handler, input);
    const stored = storedRedaction.input;
    let modelInput = input;
    let redaction: FreetextRedaction | null = null;
    if (handler.kind === 'model') {
      redaction = storedRedaction;
      modelInput = redaction.input;
      if (redaction.replaced.length > 0) {
        store.appendAudit({ at: at(), proposalId: null, kind: 'scrub_replaced', fromStatus: null, toStatus: null, actor: 'runner', detail: { ...key, handlerId: handler.id, fields: redaction.replaced.map((r) => ({ field: r.field, rule: r.rule })) } });
      }
      // Fail closed: if anything still matches after replacing, the call stops and a person handles the message.
      const findings = scrubFreetextFields(handler, modelInput);
      if (findings.length > 0) {
        const proposal = store.create(manualHandlingProposal(this.deps.businessId, handler, version, event, findings), key, at());
        return { handlerId: handler.id, outcome: 'proposal', proposal, input: stored };
      }
    }

    const result =
      handler.kind === 'deterministic'
        ? this.runDeterministic(handler, input, event, resolved)
        : await this.runModel(handler, modelInput, event, resolved, version);

    const credential = (result as { credential?: string }).credential;
    if (credential !== undefined) {
      this.inferenceProblem = { detail: credential, at: at() };
      store.appendAudit({ at: at(), proposalId: null, kind: 'inference_key_problem', fromStatus: null, toStatus: null, actor: 'runner', detail: { ...key, reason: credential } });
      try {
        await this.deps.notifier?.alert?.({ kind: 'inference_key', detail: staffMessages(this.deps.language).keyRejected(/HTTP (\d{3})/.exec(credential)?.[1] ?? null) });
      } catch (error) {
        store.appendAudit({ at: at(), proposalId: null, kind: 'admin_ping_failed', fromStatus: null, toStatus: null, actor: 'runner', detail: { kind: 'inference_key', error: (error as Error).message } });
      }
      return { handlerId: handler.id, outcome: 'refused', reason: credential };
    }
    if ('none' in result.body) {
      store.recordNoProposal(key, result.body.none, at()); // HDL-4: none, with a recorded reason
      return { handlerId: handler.id, outcome: 'none', reason: result.body.none };
    }
    if (!result.ok) {
      const proposal = store.create(
        {
          businessId: this.deps.businessId,
          handlerId: handler.id,
          handlerVersion: version,
          status: 'invalid_output', // BEH-6: never offered for approval
          subject: `event:${event.id}`,
          changes: [],
          findings: [],
          questions: [],
          modelCallId: result.modelCallId,
          reason: result.message,
        },
        key,
        at(),
      );
      return { handlerId: handler.id, outcome: 'proposal', proposal, input: stored };
    }
    // PRV-6: say what the model did not see, and flag a draft that repeats a placeholder so nobody sends "[PHONE_1]" to a customer.
    const body = result.body;
    const extra: Finding[] = [];
    if (redaction && redaction.replaced.length > 0) {
      const m = staffMessages(this.deps.language).redacted;
      const words = [...new Set(redaction.replaced.map((r) => ({ email: m.email, phone: m.phone, nif_or_phone: m.number, long_number: m.number, iban: m.iban, card: m.card, id_number: m.id } as Record<string, string>)[r.rule] ?? m.number))];
      extra.push({ statement: `in the chat: ${words.join(', ')}`, evidence: m.seeChat });
    }
    const used = [body.draft, ...body.changes.map((c) => String(c.newValue ?? ''))].join('\n').match(PLACEHOLDER);
    if (used) extra.push({ statement: `the reply contains ${[...new Set(used)].join(', ')}: those stand for details the customer wrote, which the bot did not see; fill them in from the chat before sending`, evidence: 'placeholder' });
    const proposal = store.create(
      {
        businessId: this.deps.businessId,
        handlerId: handler.id,
        handlerVersion: version,
        status: 'proposed',
        ...body,
        findings: [...body.findings, ...extra],
        modelCallId: result.modelCallId,
        reason: null,
        confidence: result.confidence,
      },
      key,
      at(),
    );
    if (result.confidence && result.modelInfo) this.deps.calibration?.observe(handler.id, version, result.modelInfo.model, result.modelInfo.endpoint, at());
    return { handlerId: handler.id, outcome: 'proposal', proposal, input: stored };
  }

  private runDeterministic(
    handler: DeterministicHandler,
    input: Record<string, unknown>,
    event: CyborgEvent,
    resolved: ResolvedFacts,
  ): { ok: true; body: ProposalBody | NoProposal; modelCallId: null; confidence: null } | { ok: false; message: string; body: ProposalBody; modelCallId: null } {
    const body = handler.run(input, event, resolved);
    const failure = 'none' in body ? null : sourcePhraseFailure(handler, input, body);
    if (failure) return { ok: false, message: failure, body: emptyBody(event), modelCallId: null };
    return { ok: true, body, modelCallId: null, confidence: null };
  }

  private async runModel(
    handler: ModelHandler,
    input: Record<string, unknown>,
    event: CyborgEvent,
    resolved: ResolvedFacts,
    version: string,
    extraLessons: readonly string[] = [],
  ): Promise<
    | { ok: true; body: ProposalBody | NoProposal; modelCallId: string | null; confidence: Confidence | null; modelInfo?: { model: string; endpoint: string } }
    | { ok: false; message: string; body: ProposalBody; modelCallId: string | null }
    | { ok: false; credential: string; message: string; body: ProposalBody; modelCallId: string | null }
  > {
    const prompt = buildPrompt(handler.prompt.template, {
      ...promptSlots(handler, input),
      ...factPromptSlots(handler, resolved, input),
      ...this.lessonSlots(handler, extraLessons),
    });
    const factsUsed: FactUsed[] = [
      ...resolved.profile.map((f) => ({
        kind: 'profile' as const,
        key: f.key,
        state: f.status,
        ...(f.status === 'unconfirmed' ? { unconfirmed: true } : {}),
        ...(f.runtime ? { runtime: true } : {}),
      })),
      ...resolved.pack.map((f) => ({ kind: 'pack' as const, key: f.key, state: f.grade })),
    ];
    const outputJsonSchema = z.toJSONSchema(handler.output) as Record<string, unknown>;
    const attempts = 1 + (this.deps.validationRetries ?? N1_VALIDATION_RETRIES);
    const failures: string[] = [];
    let modelCallId: string | null = null;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const started = performance.now();
      let result;
      try {
        result = await this.deps.model.call({
          handlerId: handler.id,
          handlerVersion: version,
          level: handler.model.level,
          modelName: handler.model.name,
          prompt,
          outputJsonSchema,
          ...(handler.confidence ? { wantLogprobs: true } : {}),
        });
      } catch (error) {
        const detail = (error as { detail?: { endpoint?: string; model?: string; requestPayload?: unknown } }).detail ?? {};
        const message = error instanceof Error ? error.message : String(error);
        modelCallId = this.deps.ledger.write({
          handlerId: handler.id,
          handlerVersion: version,
          at: this.now().toISOString(),
          endpoint: detail.endpoint ?? null,
          model: detail.model ?? null,
          requestPayload: detail.requestPayload ?? null,
          rawResponse: null,
          error: message,
          durationMs: performance.now() - started,
          factsUsed,
        });
        failures.push(`attempt ${attempt}: model call failed: ${message}`);
        // GWY-24: a rejected key or an empty account is not retried and does not use up the customer's message.
        if ((error as { detail?: { kind?: string; status?: number } }).detail?.kind === 'credential') {
          const status = (error as { detail: { status?: number } }).detail.status;
          return { ok: false, credential: `the endpoint rejected the key or reports no credit${status ? ` (HTTP ${status})` : ''}`, message: failures.join(' | '), body: emptyBody(event), modelCallId };
        }
        continue;
      }
      // HR-6, PRV-8: the ledger row is written before the response is used. If the write
      // fails the error propagates and the response is never used.
      modelCallId = this.deps.ledger.write({
        handlerId: handler.id,
        handlerVersion: version,
        at: this.now().toISOString(),
        endpoint: result.endpoint,
        model: result.model,
        requestPayload: result.requestPayload,
        rawResponse: result.rawHttpBody ?? result.rawResponse,
        error: null,
        durationMs: performance.now() - started,
        ...(result.usage === undefined ? {} : { usage: result.usage }),
        factsUsed,
      });
      // ADM-40: reasoning in the response goes to the scratchpad and is never parsed or posted.
      const stripped = stripThinkBlocks(result.rawResponse);
      if (stripped.reasoning.length > 0) {
        this.deps.scratchpad?.write({ at: this.now().toISOString(), kind: 'reasoning', ref: handler.id, text: stripped.reasoning.join('\n---\n') });
      }
      const raw = stripped.text;

      const validated = validateModelOutput(handler, input, raw, resolved);
      if (validated.ok) {
        if (!('none' in validated.body)) {
          // PRF-12, PRF-58: a secondary-grade pack fact must be visible to the approver.
          for (const fact of resolved.pack.filter((f) => f.grade === 'secondary')) {
            const finding: Finding = {
              statement: `pack fact "${fact.key}" of grade secondary was supplied to the model`,
              evidence: fact.sourceUrl,
            };
            validated.body.findings.push(finding);
          }
        }
        const confidence =
          handler.confidence && !('none' in validated.body)
            ? computeConfidence({ spec: handler.confidence, output: validated.output, input, facts: resolved, meanLogprob: result.meanLogprob, viaVoice: event.payload['source'] === 'voice', blocked: validated.body.blocked === true })
            : null;
        return { ok: true, body: validated.body, modelCallId, confidence, modelInfo: { model: result.model, endpoint: result.endpoint } };
      }
      failures.push(`attempt ${attempt}: ${validated.message}`);
    }
    return { ok: false, message: failures.join(' | '), body: emptyBody(event), modelCallId };
  }
}

function manualHandlingProposal(
  businessId: string,
  handler: ModelHandler,
  version: string,
  event: CyborgEvent,
  findings: ScrubFinding[],
): NewProposal {
  return {
    businessId,
    handlerId: handler.id,
    handlerVersion: version,
    status: 'proposed',
    subject: `event:${event.id}`,
    changes: [],
    // Rule names and positions only: the matched text is an identity value (PRV-2).
    findings: findings.map((f) => ({
      statement: `field "${f.field}" matched scrubber rule(s) ${[...new Set(f.hits.map((h) => h.rule))].join(', ')}; no model call was made`,
      evidence: f.hits.map((h) => `${h.rule}@${h.start}-${h.end}`).join(', '),
    })),
    questions: ['A person must handle this message: it contains data the model must not receive (PRV-6).'],
    modelCallId: null,
    reason: 'manual_handling: scrubber hit',
  };
}

function emptyBody(event: CyborgEvent): ProposalBody {
  return { subject: `event:${event.id}`, changes: [], findings: [], questions: [] };
}

function validateModelOutput(handler: ModelHandler, input: Record<string, unknown>, raw: string, facts: ResolvedFacts): Validated {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return { ok: false, message: `response is not JSON: ${(error as Error).message}` };
  }
  const output = handler.output.safeParse(json);
  if (!output.success) return { ok: false, message: `output schema: ${output.error.message}` };
  const checkFailures = handler.checks(output.data, input, facts);
  if (checkFailures.length > 0) return { ok: false, message: `checks: ${checkFailures.join('; ')}` };
  const body = handler.toProposal(output.data, input, facts);
  if ('none' in body) return { ok: true, body, output: output.data };
  const phrase = sourcePhraseFailure(handler, input, body);
  if (phrase) return { ok: false, message: phrase };
  return { ok: true, body, output: output.data };
}

/** HDL-6, BEH-12: a sourcePhrase must occur in the input; identity/secret values do not count. */
function sourcePhraseFailure(handler: AnyHandler, input: Record<string, unknown>, body: ProposalBody): string | null {
  const haystack = Object.entries(input)
    .filter(([field]) => !VAULT_CLASSES.includes(handler.input.classes[field]!))
    .map(([, value]) => (typeof value === 'string' ? value : JSON.stringify(value)))
    .join('\n');
  for (const change of body.changes) {
    if (change.sourcePhrase !== undefined && !haystack.includes(change.sourcePhrase)) {
      return `sourcePhrase for "${change.field}" does not occur in the input (HDL-6)`;
    }
  }
  return null;
}
