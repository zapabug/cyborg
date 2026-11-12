import {
  canTransition, IllegalTransitionError, STATUSES,
  type AuditRow, type CapabilityResult, type CapabilityStore, type Fact, type IdentityVault, type Lesson, type LedgerEntry, type NewFact, type NewProposal,
  type ProfileStore, type PromptLedger, type Proposal, type ProposalStatus, type ProposalStore, type RunKey, type TransitionPatch, type VaultEntry,
} from '@cyborg/core';

// feat WZP-10..19, the browser demo: the framework's own Runner, handlers and gateway run in the page, and these are the stores they sit on. Everything is
// kept in memory for the life of the page: nothing is sent anywhere but the model calls, and a reload starts clean.

const id = (): string => crypto.randomUUID();
const runKey = (k: RunKey): string => `${k.source}\u0000${k.eventId}\u0000${k.handlerId}`;

export class MemoryStore implements ProposalStore {
  private readonly proposals = new Map<string, Proposal>();
  private readonly runs = new Set<string>();
  private readonly audit: AuditRow[] = [];

  hasRun(key: RunKey): boolean {
    return this.runs.has(runKey(key));
  }

  create(p: NewProposal, run: RunKey | null, at: string): Proposal {
    if (p.status !== 'proposed' && p.status !== 'invalid_output') throw new IllegalTransitionError(null, p.status);
    if (run) this.runs.add(runKey(run));
    const proposal: Proposal = {
      ...p, id: id(), createdAt: at, eventSource: run?.source ?? null, eventId: run?.eventId ?? null,
      decidedBy: null, decidedAt: null, appliedChanges: null, confidence: p.confidence ?? null,
    };
    this.proposals.set(proposal.id, proposal);
    this.appendAudit({ at, proposalId: proposal.id, kind: 'created', fromStatus: null, toStatus: proposal.status, actor: 'runner', detail: p.reason === null ? undefined : { reason: p.reason } });
    return { ...proposal };
  }

  recordNoProposal(run: RunKey, reason: string, at: string): void {
    this.runs.add(runKey(run));
    this.appendAudit({ at, proposalId: null, kind: 'no_proposal', fromStatus: null, toStatus: null, actor: 'runner', detail: { handler: run.handlerId, reason } });
  }

  get(pid: string): Proposal | null {
    const p = this.proposals.get(pid);
    return p ? { ...p } : null;
  }

  list(filter: { status?: ProposalStatus; handlerId?: string } = {}): Proposal[] {
    return [...this.proposals.values()].filter((p) => (!filter.status || p.status === filter.status) && (!filter.handlerId || p.handlerId === filter.handlerId)).map((p) => ({ ...p }));
  }

  transition(pid: string, to: ProposalStatus, patch: TransitionPatch): Proposal {
    if (!STATUSES.includes(to)) throw new IllegalTransitionError(null, to);
    const current = this.proposals.get(pid);
    if (!current) throw new Error(`no proposal ${pid}`);
    if (!canTransition(current.status, to)) throw new IllegalTransitionError(current.status, to);
    const next: Proposal = {
      ...current, status: to, decidedBy: patch.decidedBy ?? current.decidedBy, decidedAt: patch.decidedBy ? patch.at : current.decidedAt,
      appliedChanges: patch.appliedChanges ?? current.appliedChanges, reason: patch.reason ?? current.reason,
    };
    this.proposals.set(pid, next);
    this.appendAudit({ at: patch.at, proposalId: pid, kind: 'transition', fromStatus: current.status, toStatus: to, actor: patch.actor, detail: patch.detail });
    return { ...next };
  }

  appendAudit(row: Omit<AuditRow, 'id'>): void {
    this.audit.push({ ...row, id: this.audit.length + 1 });
  }

  listAudit(proposalId?: string): AuditRow[] {
    return this.audit.filter((r) => proposalId === undefined || r.proposalId === proposalId);
  }
}

export class MemoryLedger implements PromptLedger {
  private readonly entries: (LedgerEntry & { id: string })[] = [];

  write(entry: LedgerEntry): string {
    const row = { ...entry, id: id() };
    this.entries.push(row);
    return row.id;
  }

  read(ledgerId: string): (LedgerEntry & { id: string }) | null {
    return this.entries.find((e) => e.id === ledgerId) ?? null;
  }

  /** The prompts sent so far, newest last: the demo shows exactly what the model was given. */
  all(): readonly (LedgerEntry & { id: string })[] {
    return this.entries;
  }
}

export class MemoryVault implements IdentityVault {
  private readonly byCode = new Map<string, VaultEntry>();
  private readonly byValue = new Map<string, string>();

  put(cls: 'identity' | 'secret', value: string): string {
    const key = `${cls}\u0000${value}`;
    const known = this.byValue.get(key);
    if (known) return known;
    const code = `vault-${this.byCode.size + 1}`;
    this.byCode.set(code, { code, class: cls, value, createdAt: new Date().toISOString() });
    this.byValue.set(key, code);
    return code;
  }

  get(code: string): VaultEntry | null {
    return this.byCode.get(code) ?? null;
  }
}

/** Only what the fact provider reads. The profile here is the demo company's made-up facts, every one unconfirmed. */
export class MemoryProfile implements ProfileStore {
  private readonly facts = new Map<string, Fact>();

  putFact(fact: NewFact, _actor: string, at: string): Fact {
    const stored: Fact = { ...fact, status: 'unconfirmed', confirmedBy: null, confirmedAt: null, reviewBy: fact.reviewBy ?? null, updatedAt: at };
    this.facts.set(fact.key, stored);
    return { ...stored };
  }

  getFact(key: string): Fact | null {
    const f = this.facts.get(key);
    return f ? { ...f } : null;
  }

  listFacts(prefix?: string): Fact[] {
    return [...this.facts.values()].filter((f) => !prefix || f.key.startsWith(prefix)).map((f) => ({ ...f }));
  }

  moveFact(): Fact { throw new Error('not used in the browser demo'); }
  recordCheck(): void { throw new Error('not used in the browser demo'); }
  listChecks(): never[] { return []; }
  addDiscrepancy(): never { throw new Error('not used in the browser demo'); }
  listDiscrepancies(): never[] { return []; }
}

export class MemoryCapabilities implements CapabilityStore {
  private readonly results: CapabilityResult[] = [];

  saveCapability(result: CapabilityResult): void {
    this.results.push(result);
  }

  latestCapability(baseUrl: string, model: string): CapabilityResult | null {
    return [...this.results].reverse().find((r) => r.baseUrl === baseUrl && r.model === model) ?? null;
  }
}

/** PRF-67: lessons a person adds; the runner puts the active ones into the reply prompt. */
export class MemoryLessons {
  private readonly lessons: Lesson[] = [];

  addLesson(lesson: { handlerId: string | null; text: string; originEntryId: string | null }, at: string): Lesson {
    const l: Lesson = { id: id(), ...lesson, version: this.lessons.length + 1, status: 'active', createdAt: at };
    this.lessons.push(l);
    return { ...l };
  }

  retireLesson(lessonId: string): Lesson {
    const l = this.lessons.find((x) => x.id === lessonId);
    if (!l) throw new Error(`no lesson ${lessonId}`);
    l.status = 'retired';
    return { ...l };
  }

  activeLessonsFor(handlerId: string): Lesson[] {
    return this.lessons.filter((l) => l.status === 'active' && (l.handlerId === null || l.handlerId === handlerId)).map((l) => ({ ...l }));
  }

  listLessons(): Lesson[] {
    return this.lessons.map((l) => ({ ...l }));
  }
}
