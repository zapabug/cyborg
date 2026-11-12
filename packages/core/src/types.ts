import type { z } from 'zod';
import type { DataClass } from './data-class.ts';
import type { Confidence, ConfidenceSpec } from './confidence.ts';
import type { ResolvedFacts } from './profile-types.ts';
import type { InitialStatus, ProposalStatus } from './status.ts';

// ---- events and triggers (docs/02 BEH-8..10) --------------------------------

export interface CyborgEvent {
  /** Unique within `source`; the runner is idempotent per (source, id, handler) (BEH-10). */
  id: string;
  source: string;
  /** `message.received`, `form.submitted`, `schedule:<name>`, `manual:<command>`, ... */
  kind: string;
  at: string;
  /** Adapter reference for the sender; never an identity value (PRV-2). */
  userRef?: string;
  payload: Record<string, unknown>;
}

export type Trigger =
  | { type: 'event'; kind: string }
  | { type: 'schedule'; name: string }
  | { type: 'manual'; command: string };

export function triggerKey(trigger: Trigger): string {
  switch (trigger.type) {
    case 'event':
      return trigger.kind;
    case 'schedule':
      return `schedule:${trigger.name}`;
    case 'manual':
      return `manual:${trigger.command}`;
  }
}

// ---- proposal (docs/03) ------------------------------------------------------

export type Scalar = string | number | boolean | null;

export interface Change {
  field: string;
  oldValue: Scalar;
  newValue: Scalar;
  /** Required for values extracted from input; must occur in the input (HDL-6). */
  sourcePhrase?: string;
}

export interface Finding {
  statement: string;
  evidence: string;
}

export interface ProposalBody {
  /** A reference code, never a name, phone, NIF or address. */
  subject: string;
  changes: Change[];
  draft?: string;
  /** Set when the handler's own code refused to offer what the model produced (a blocked draft): the confidence band must read low (PRF-29). */
  blocked?: boolean;
  findings: Finding[];
  questions: string[];
}

export interface NoProposal {
  none: string;
}

export interface AppliedChange {
  field: string;
  oldValue: Scalar;
  newValue: Scalar;
}

export interface Proposal extends ProposalBody {
  id: string;
  businessId: string;
  handlerId: string;
  handlerVersion: string;
  createdAt: string;
  status: ProposalStatus;
  modelCallId: string | null;
  eventSource: string | null;
  eventId: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  appliedChanges: AppliedChange[] | null;
  reason: string | null;
  /** PRF-27: for reply-type and classification handlers; null for the rest. */
  confidence: Confidence | null;
}

export interface NewProposal extends ProposalBody {
  businessId: string;
  handlerId: string;
  handlerVersion: string;
  status: InitialStatus;
  modelCallId: string | null;
  reason: string | null;
  confidence?: Confidence | null;
}

/** HDL-7: a change that replaces an existing value must be shown as such. */
export function isOverwrite(change: Change): boolean {
  return change.oldValue !== null;
}

// ---- handler contract (docs/03) ----------------------------------------------

export type ModelLevel = 'strict_schema' | 'json_object';
export type PackGrade = 'checked' | 'secondary' | 'unverified';

export interface HandlerInput<I> {
  schema: z.ZodObject;
  /** One class per schema field (HDL-1, PRV-1). */
  classes: Record<string, DataClass>;
  /** Input assembly: build the raw input from the event; the runner parses it with `schema`. */
  fromEvent(event: CyborgEvent): unknown;
  /** Type witness only; never read at runtime. */
  readonly _type?: I;
}

interface HandlerCommon<I> {
  id: string;
  version: string;
  trigger: Trigger[];
  input: HandlerInput<I>;
  profileKeys: string[];
  packFacts: { key: string; minGrade: PackGrade }[];
  effect: 'proposal' | 'auto_reply';
  /** True if the output may contain a commitment (booking, price promise, signing, filing, payment). */
  commitment: boolean;
  limits: { perUserPerDay?: number };
}

export interface ModelHandler<I = unknown, O = unknown> extends HandlerCommon<I> {
  kind: 'model';
  /** Fixed template; `{{slot}}` placeholders map to input fields through `slots`. */
  prompt: {
    template: string;
    /** slot -> input field */
    slots: Record<string, string>;
    /** slot -> profile key; each key must be in `profileKeys` (PRF-4, PRF-56) */
    factSlots?: Record<string, string>;
    /** slot -> how a fact's value is written into the prompt (for example day numbers as day names). Absent: the value as it is. */
    factRender?: Record<string, (value: unknown, input: Record<string, unknown>) => unknown>;
    /** slot -> pack key; each key must be in `packFacts` */
    packSlots?: Record<string, string>;
    /** Where approved lessons are inserted (PRF-67). Absent: the handler takes no lessons. */
    lessonsSlot?: string;
  };
  /** PRF-24b: profile keys whose value is a rule the prompt carries. A change in their text changes the version a run records (`+P<hash>`). */
  versionFacts?: readonly string[];
  output: z.ZodType<O>;
  model: { level: ModelLevel; name: string };
  /** Code validators run after schema validation; return failure messages, empty if ok. */
  checks(output: O, input: I, facts: ResolvedFacts): string[];
  toProposal(output: O, input: I, facts: ResolvedFacts): ProposalBody | NoProposal;
  /** PRF-72: opt in to a confidence record. Absent for extraction handlers. */
  confidence?: ConfidenceSpec;
}

/** HDL-13: no prompt, no gateway call, no ledger row. */
export interface DeterministicHandler<I = unknown> extends HandlerCommon<I> {
  kind: 'deterministic';
  run(input: I, event: CyborgEvent, facts: ResolvedFacts): ProposalBody | NoProposal;
}

export type AnyHandler = ModelHandler<any, any> | DeterministicHandler<any>;

// ---- ports -------------------------------------------------------------------

export interface ModelRequest {
  handlerId: string;
  handlerVersion: string;
  level: ModelLevel;
  modelName: string;
  prompt: string;
  outputJsonSchema: Record<string, unknown>;
  /** Ask for token log-probabilities if the endpoint returns them (GWY-17). */
  wantLogprobs?: boolean;
}

export interface ModelResult {
  endpoint: string;
  model: string;
  /** The exact request body that was sent (HR-6). */
  requestPayload: unknown;
  /** The message text the runner validates. */
  rawResponse: string;
  /** The whole HTTP response body, stored in the ledger when present (GWY-21). */
  rawHttpBody?: string;
  usage?: unknown;
  /** Mean token log-probability of the answer, when asked for and returned. */
  meanLogprob?: number;
}

/**
 * `credential`: the endpoint rejected the key or reports no credit or quota (HTTP 401, 402, 403, or a 429 that says so).
 * Retrying cannot help and a person must act (GWY-24). Anything else is a transient or ordinary failure.
 */
export type ModelCallErrorKind = 'credential' | 'other';

export class ModelCallError extends Error {
  constructor(
    message: string,
    readonly detail: { endpoint?: string; model?: string; requestPayload?: unknown; kind?: ModelCallErrorKind; status?: number } = {},
  ) {
    super(message);
    this.name = 'ModelCallError';
  }
}

/** The gateway (M3) implements this; tests drive it with a scripted model (HR-4). */
export interface ModelPort {
  call(request: ModelRequest): Promise<ModelResult>;
  /**
   * GWY-22: asked before any input is assembled. A refusal is audited and the event stays
   * unhandled. Absent on a scripted model, which has no capability to test.
   */
  checkCapability?(request: Pick<ModelRequest, 'handlerId' | 'level' | 'modelName'>): { ok: true } | { ok: false; reason: string };
}

// ---- endpoint capability (docs/05 GWY-9..12, 17..19) -----------------------------

export type CapabilityLevel = 'strict_schema' | 'json_object' | 'none';
export type RequestShape = 'json_schema_wrapped' | 'json_schema_direct' | 'json_object_schema' | 'json_object';

export interface CapabilityAttempt {
  shape: RequestShape;
  /** Last HTTP status seen for this shape, or null if the request failed before a response. */
  httpStatus: number | null;
  trials: number;
  validJson: number;
  conforming: number;
  error?: string;
}

export interface CapabilityResult {
  baseUrl: string;
  model: string;
  level: CapabilityLevel;
  /** The shape the gateway uses for this endpoint; null when the level is `none`. */
  requestShape: RequestShape | null;
  /** Whether the endpoint returns token log-probabilities (GWY-17). */
  logprobs: boolean;
  testedAt: string;
  attempts: CapabilityAttempt[];
  /** True when a rate limit, server error or transport failure stopped the test, so `none` says nothing about the endpoint. Not stored. */
  inconclusive?: boolean;
}

export interface CapabilityStore {
  saveCapability(result: CapabilityResult): void;
  /** The newest result for this base URL and model. */
  latestCapability(baseUrl: string, model: string): CapabilityResult | null;
}

export interface LedgerEntry {
  handlerId: string;
  handlerVersion: string;
  at: string;
  endpoint: string | null;
  model: string | null;
  requestPayload: unknown;
  rawResponse: string | null;
  error: string | null;
  durationMs: number;
  usage?: unknown;
  /** Every profile and pack fact supplied to the call (PRF-58). */
  factsUsed?: FactUsed[];
}

export interface FactUsed {
  kind: 'profile' | 'pack';
  key: string;
  /** Profile status or pack grade. */
  state: string;
  /** True for an `unconfirmed` profile fact used in shadow mode. */
  unconfirmed?: boolean;
  /** True for a fact computed at run time by an add-on (CMP-27); it is not in the profile and is not checked by the live gate. */
  runtime?: boolean;
}

export interface PromptLedger {
  write(entry: LedgerEntry): string;
  read(id: string): (LedgerEntry & { id: string }) | null;
}

export interface VaultEntry {
  code: string;
  class: 'identity' | 'secret';
  value: string;
  createdAt: string;
}

/** PRV-11: the vault is a separate store; everything else refers to its codes. */
export interface IdentityVault {
  /** Stores a value and returns its code; the same value gets the same code. */
  put(cls: 'identity' | 'secret', value: string): string;
  get(code: string): VaultEntry | null;
}

export interface RunKey {
  source: string;
  eventId: string;
  handlerId: string;
}

export interface AuditRow {
  id: number;
  at: string;
  proposalId: string | null;
  kind: string;
  fromStatus: ProposalStatus | null;
  toStatus: ProposalStatus | null;
  actor: string;
  detail: unknown;
}

export interface TransitionPatch {
  actor: string;
  at: string;
  detail?: unknown;
  /** Set on approve and decline (BEH-3). */
  decidedBy?: string;
  appliedChanges?: AppliedChange[];
  reason?: string;
}

/** BEH-7: there is deliberately no update or delete method for audit rows. */
export interface ProposalStore {
  hasRun(key: RunKey): boolean;
  /** Inserts the proposal, its audit row and the run marker in one transaction. */
  create(proposal: NewProposal, run: RunKey | null, at: string): Proposal;
  /** Records "no proposal" with the reason, and the run marker, in one transaction. */
  recordNoProposal(run: RunKey, reason: string, at: string): void;
  get(id: string): Proposal | null;
  list(filter?: { status?: ProposalStatus; handlerId?: string }): Proposal[];
  /** Validates against docs/02, updates and audits in one transaction; throws and writes nothing if illegal. */
  transition(id: string, to: ProposalStatus, patch: TransitionPatch): Proposal;
  appendAudit(row: Omit<AuditRow, 'id'>): void;
  listAudit(proposalId?: string): AuditRow[];
}

/** Implemented by the business adapter (HDL-9..11). */
export interface Applier {
  /** Re-read the target's current state; `stale` means it changed since the proposal (BEH-4). */
  prepareApply(proposal: Proposal): Promise<{ stale: false } | { stale: true; reason: string }>;
  apply(proposal: Proposal): Promise<AppliedChange[]>;
  revert(proposal: Proposal, changes: AppliedChange[]): Promise<void>;
}
