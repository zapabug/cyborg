import { DatabaseSync } from 'node:sqlite';
import { migrate, schemaVersion, type MigrateResult, type Migration } from './migrate.ts';
import {
  canTransition,
  IllegalTransitionError,
  STATUSES,
  type AdminAlert,
  type ChatIndex,
  type UsageRow,
  type UsageStore,
  type AlertKind,
  type AlertStore,
  type AppliedChange,
  type Presence,
  type StaffLanguage,
  type AuditRow,
  type CapabilityResult,
  type AutoReplyStore,
  type Band,
  type BandVerdict,
  type CalibrationRecord,
  type CalibrationStore,
  type CapabilityStore,
  type Flag,
  type FlagStore,
  type Ticket,
  type ChatRole,
  type ChatState,
  type ChecklistRow,
  type ChecklistStore,
  type ControlStore,
  type Signoff,
  type WaitingPeriod,
  type HumanAction,
  type Lesson,
  type LessonStore,
  type LiveRecord,
  type LiveStore,
  type Marking,
  type MarkingCounts,
  type NewShadowEntry,
  type ShadowEntry,
  type ShadowLog,
  MARKINGS,
  type CheckRecord,
  type Confidence,
  type Discrepancy,
  type Fact,
  type FactStatus,
  type FactUsed,
  type NewFact,
  type ProfileStore,
  canMoveFact,
  IllegalFactMoveError,
  type Change,
  type Finding,
  type LedgerEntry,
  type NewProposal,
  type PromptLedger,
  type Proposal,
  type ProposalStatus,
  type ProposalStore,
  type RunKey,
  type TransitionPatch,
} from '@cyborg/core';
import { randomUUID } from 'node:crypto';

/** ARC-9: version 1 is the schema as it stood when versioning began. It is idempotent, so it also adopts files made before. */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  handler_id TEXT NOT NULL,
  handler_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL,
  subject TEXT NOT NULL,
  changes TEXT NOT NULL,
  draft TEXT,
  findings TEXT NOT NULL,
  questions TEXT NOT NULL,
  model_call_id TEXT,
  event_source TEXT,
  event_id TEXT,
  decided_by TEXT,
  decided_at TEXT,
  applied_changes TEXT,
  reason TEXT,
  confidence TEXT
);
CREATE TABLE IF NOT EXISTS runs (
  source TEXT NOT NULL,
  event_id TEXT NOT NULL,
  handler_id TEXT NOT NULL,
  PRIMARY KEY (source, event_id, handler_id)
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  proposal_id TEXT,
  kind TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  actor TEXT NOT NULL,
  detail TEXT
);
-- BEH-7: append-only. The store has no update or delete method; the database refuses them too.
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit
BEGIN SELECT RAISE(ABORT, 'audit is append-only (BEH-7)'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit
BEGIN SELECT RAISE(ABORT, 'audit is append-only (BEH-7)'); END;
CREATE TABLE IF NOT EXISTS endpoint_capabilities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  tested_at TEXT NOT NULL,
  result TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS profile_facts (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  class TEXT NOT NULL CHECK (class IN ('public', 'deal')),
  source TEXT NOT NULL CHECK (length(source) > 0),
  source_ref TEXT NOT NULL CHECK (length(source_ref) > 0),
  status TEXT NOT NULL,
  confirmed_by TEXT,
  confirmed_at TEXT,
  review_by TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ground_truth_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fact_key TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  independent_kind TEXT NOT NULL,
  independent_ref TEXT NOT NULL,
  observed TEXT,
  outcome TEXT NOT NULL,
  note TEXT
);
CREATE TABLE IF NOT EXISTS discrepancies (
  id TEXT PRIMARY KEY,
  fact_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL,
  body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS shadow_entries (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  event_source TEXT NOT NULL,
  event_id TEXT NOT NULL,
  handler_id TEXT NOT NULL,
  handler_version TEXT NOT NULL,
  proposal_id TEXT,
  draft TEXT,
  output TEXT NOT NULL,
  input TEXT NOT NULL,
  facts_used TEXT NOT NULL,
  human_reply TEXT,
  human_action TEXT,
  human_at TEXT,
  marking TEXT,
  marked_by TEXT,
  marked_at TEXT,
  band_verdict TEXT
);
CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY,
  handler_id TEXT,
  text TEXT NOT NULL,
  origin_entry_id TEXT,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS live_handlers (
  handler_id TEXT PRIMARY KEY,
  enabled_at TEXT NOT NULL,
  enabled_by TEXT NOT NULL,
  evidence TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS checklist_rows (
  channel TEXT NOT NULL,
  item_id TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (channel, item_id)
);
CREATE TABLE IF NOT EXISTS checklist_signoffs (
  channel TEXT NOT NULL,
  who TEXT NOT NULL,
  by_ TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (channel, who)
);
CREATE TABLE IF NOT EXISTS chat_roles (chat TEXT PRIMARY KEY, role TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chat_states (chat TEXT PRIMARY KEY, state TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS control_flags (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS waiting_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat TEXT NOT NULL,
  since TEXT NOT NULL,
  last_customer_at TEXT NOT NULL,
  pinged INTEGER NOT NULL DEFAULT 0,
  ended_at TEXT,
  end_reason TEXT
);
CREATE TABLE IF NOT EXISTS settlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat TEXT NOT NULL,
  at TEXT NOT NULL,
  by TEXT NOT NULL,
  via TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  detail TEXT NOT NULL,
  raised_at TEXT NOT NULL,
  seen_at TEXT,
  seen_by TEXT,
  cleared_at TEXT,
  cleared_by TEXT
);
CREATE TABLE IF NOT EXISTS calibrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  handler_id TEXT NOT NULL,
  handler_version TEXT NOT NULL,
  model TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  status TEXT NOT NULL,
  since TEXT NOT NULL,
  last_review_at TEXT
);
CREATE TABLE IF NOT EXISTS auto_reply_policy (
  handler_id TEXT PRIMARY KEY,
  band TEXT NOT NULL,
  report_ref TEXT NOT NULL,
  set_by TEXT NOT NULL,
  set_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auto_reply_suspensions (
  handler_id TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS flags (id TEXT PRIMARY KEY, handler_id TEXT NOT NULL, handler_version TEXT NOT NULL, status TEXT NOT NULL, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS heads_ups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  handler_id TEXT NOT NULL,
  handler_version TEXT NOT NULL,
  open_flags INTEGER NOT NULL,
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS prompt_ledger (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  handler_id TEXT NOT NULL,
  handler_version TEXT NOT NULL,
  endpoint TEXT,
  model TEXT,
  request_payload TEXT,
  raw_response TEXT,
  error TEXT,
  duration_ms REAL NOT NULL,
  usage TEXT,
  facts_used TEXT
);
`;

/** ARC-9: append here, never edit an entry that has shipped. */
export const STORE_MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'baseline schema', up: (db) => db.exec(SCHEMA) },
  {
    // ADM-81: the first change after versioning began. A copy of the file is taken before it runs (ARC-10).
    version: 2,
    name: 'chat index: event to chat links and customer contacts',
    up: (db) =>
      db.exec(`
        CREATE TABLE IF NOT EXISTS event_chats (
          event_source TEXT NOT NULL,
          event_id TEXT NOT NULL,
          chat TEXT NOT NULL,
          at TEXT NOT NULL,
          PRIMARY KEY (event_source, event_id)
        );
        CREATE INDEX IF NOT EXISTS event_chats_by_chat ON event_chats (chat, at);
        CREATE TABLE IF NOT EXISTS chat_contacts (
          chat TEXT PRIMARY KEY,
          name_code TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `),
  },
];

type Row = Record<string, unknown>;
export type StoredTable = 'proposals' | 'audit' | 'prompt_ledger' | 'shadow_entries' | 'lessons' | 'flags' | 'tickets';

const json = (value: unknown): string => JSON.stringify(value);
const parse = <T>(text: unknown): T => JSON.parse(text as string) as T;
const parseOrNull = <T>(text: unknown): T | null => (text === null || text === undefined ? null : parse<T>(text));

/** Business store on `node:sqlite`: proposals, audit, run markers and the prompt ledger. */
export class SqliteStore implements ProposalStore, PromptLedger, CapabilityStore, ProfileStore, ShadowLog, LessonStore, LiveStore, ChecklistStore, ControlStore, CalibrationStore, AutoReplyStore, FlagStore, AlertStore, UsageStore, ChatIndex {
  private readonly db: DatabaseSync;

  /** `path` is config per business (ARC-8); `:memory:` is for tests. */
  constructor(path: string, options: { migrations?: readonly Migration[]; backup?: boolean; now?: () => Date } = {}) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    this.migration = migrate(this.db, options.migrations ?? STORE_MIGRATIONS, {
      path, label: 'business store', ...(options.backup !== undefined ? { backup: options.backup } : {}), ...(options.now ? { now: options.now } : {}),
    });
  }

  /** What opening this file did (ARC-9): the version it was at, what ran, and where the copy went. */
  readonly migration: MigrateResult;

  schemaVersion(): number {
    return schemaVersion(this.db);
  }

  close(): void {
    this.db.close();
  }

  private tx<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private audit(row: Omit<AuditRow, 'id'>): void {
    this.db
      .prepare(
        'INSERT INTO audit (at, proposal_id, kind, from_status, to_status, actor, detail) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(row.at, row.proposalId, row.kind, row.fromStatus, row.toStatus, row.actor, row.detail === undefined ? null : json(row.detail));
  }

  hasRun(key: RunKey): boolean {
    return (
      this.db
        .prepare('SELECT 1 FROM runs WHERE source = ? AND event_id = ? AND handler_id = ?')
        .get(key.source, key.eventId, key.handlerId) !== undefined
    );
  }

  private markRun(key: RunKey): void {
    this.db.prepare('INSERT INTO runs (source, event_id, handler_id) VALUES (?, ?, ?)').run(key.source, key.eventId, key.handlerId);
  }

  create(proposal: NewProposal, run: RunKey | null, at: string): Proposal {
    // BEH-1: a proposal starts in `proposed` or `invalid_output` only.
    if (proposal.status !== 'proposed' && proposal.status !== 'invalid_output') {
      throw new IllegalTransitionError(null, proposal.status);
    }
    const id = randomUUID();
    return this.tx(() => {
      if (run) this.markRun(run);
      this.db
        .prepare(
          `INSERT INTO proposals (id, business_id, handler_id, handler_version, created_at, status, subject, changes,
             draft, findings, questions, model_call_id, event_source, event_id, reason, confidence)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          proposal.businessId,
          proposal.handlerId,
          proposal.handlerVersion,
          at,
          proposal.status,
          proposal.subject,
          json(proposal.changes),
          proposal.draft ?? null,
          json(proposal.findings),
          json(proposal.questions),
          proposal.modelCallId,
          run?.source ?? null,
          run?.eventId ?? null,
          proposal.reason,
          proposal.confidence ? json(proposal.confidence) : null,
        );
      this.audit({
        at,
        proposalId: id,
        kind: 'created',
        fromStatus: null,
        toStatus: proposal.status,
        actor: 'runner',
        detail: proposal.reason === null ? undefined : { reason: proposal.reason },
      });
      return this.get(id)!;
    });
  }

  recordNoProposal(run: RunKey, reason: string, at: string): void {
    this.tx(() => {
      this.markRun(run);
      this.audit({ at, proposalId: null, kind: 'no_proposal', fromStatus: null, toStatus: null, actor: 'runner', detail: { ...run, reason } });
    });
  }

  get(id: string): Proposal | null {
    const row = this.db.prepare('SELECT * FROM proposals WHERE id = ?').get(id);
    return row ? toProposal(row) : null;
  }

  list(filter: { status?: ProposalStatus; handlerId?: string } = {}): Proposal[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM proposals WHERE (? IS NULL OR status = ?) AND (? IS NULL OR handler_id = ?)
         ORDER BY created_at, rowid`,
      )
      .all(filter.status ?? null, filter.status ?? null, filter.handlerId ?? null, filter.handlerId ?? null);
    return rows.map(toProposal);
  }

  transition(id: string, to: ProposalStatus, patch: TransitionPatch): Proposal {
    if (!STATUSES.includes(to)) throw new IllegalTransitionError(null, to);
    return this.tx(() => {
      const current = this.get(id);
      if (!current) throw new Error(`no proposal ${id}`);
      // BEH-2: checked before any write; the transaction also rolls back on a throw.
      if (!canTransition(current.status, to)) throw new IllegalTransitionError(current.status, to);
      this.db
        .prepare(
          `UPDATE proposals SET status = ?,
             decided_by = COALESCE(?, decided_by),
             decided_at = CASE WHEN ? IS NULL THEN decided_at ELSE ? END,
             applied_changes = COALESCE(?, applied_changes),
             reason = COALESCE(?, reason)
           WHERE id = ?`,
        )
        .run(
          to,
          patch.decidedBy ?? null,
          patch.decidedBy ?? null,
          patch.at,
          patch.appliedChanges ? json(patch.appliedChanges) : null,
          patch.reason ?? null,
          id,
        );
      this.audit({
        at: patch.at,
        proposalId: id,
        kind: 'transition',
        fromStatus: current.status,
        toStatus: to,
        actor: patch.actor,
        detail: patch.detail,
      });
      return this.get(id)!;
    });
  }

  appendAudit(row: Omit<AuditRow, 'id'>): void {
    this.audit(row);
  }

  listAudit(proposalId?: string): AuditRow[] {
    const rows =
      proposalId === undefined
        ? this.db.prepare('SELECT * FROM audit ORDER BY id').all()
        : this.db.prepare('SELECT * FROM audit WHERE proposal_id = ? ORDER BY id').all(proposalId);
    return rows.map((r) => ({
      id: r['id'] as number,
      at: r['at'] as string,
      proposalId: r['proposal_id'] as string | null,
      kind: r['kind'] as string,
      fromStatus: r['from_status'] as ProposalStatus | null,
      toStatus: r['to_status'] as ProposalStatus | null,
      actor: r['actor'] as string,
      detail: parseOrNull(r['detail']),
    }));
  }

  // ---- CapabilityStore (GWY-10) -----------------------------------------------

  saveCapability(result: CapabilityResult): void {
    this.db
      .prepare('INSERT INTO endpoint_capabilities (base_url, model, tested_at, result) VALUES (?, ?, ?, ?)')
      .run(result.baseUrl, result.model, result.testedAt, json(result));
  }

  latestCapability(baseUrl: string, model: string): CapabilityResult | null {
    const row = this.db
      .prepare('SELECT result FROM endpoint_capabilities WHERE base_url = ? AND model = ? ORDER BY id DESC LIMIT 1')
      .get(baseUrl, model);
    return row ? parse<CapabilityResult>(row['result']) : null;
  }

  listCapabilities(): CapabilityResult[] {
    return this.db
      .prepare('SELECT result FROM endpoint_capabilities WHERE id IN (SELECT MAX(id) FROM endpoint_capabilities GROUP BY base_url, model) ORDER BY id')
      .all()
      .map((r) => parse<CapabilityResult>(r['result']));
  }

  // ---- ProfileStore (docs/06) ---------------------------------------------------

  putFact(fact: NewFact, actor: string, at: string): Fact {
    // PRF-1: a fact without a source is rejected (the table also checks it).
    if (!fact.source || !fact.sourceRef || !fact.key) throw new Error(`fact "${fact.key}" needs a key, a source and a source reference (PRF-1)`);
    return this.tx(() => {
      const existing = this.getFact(fact.key);
      this.db
        .prepare(
          `INSERT INTO profile_facts (key, value, class, source, source_ref, status, confirmed_by, confirmed_at, review_by, updated_at)
           VALUES (?, ?, ?, ?, ?, 'unconfirmed', NULL, NULL, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, class = excluded.class, source = excluded.source,
             source_ref = excluded.source_ref, status = 'unconfirmed', confirmed_by = NULL, confirmed_at = NULL,
             review_by = excluded.review_by, updated_at = excluded.updated_at`,
        )
        .run(fact.key, json(fact.value), fact.class, fact.source, fact.sourceRef, fact.reviewBy ?? null, at);
      this.audit({
        at,
        proposalId: null,
        kind: existing ? 'fact_replaced' : 'fact_added',
        fromStatus: null,
        toStatus: null,
        actor,
        detail: existing
          ? { key: fact.key, previous: { value: existing.value, source: existing.source, sourceRef: existing.sourceRef, status: existing.status } }
          : { key: fact.key, source: fact.source, sourceRef: fact.sourceRef },
      });
      return this.getFact(fact.key)!;
    });
  }

  getFact(key: string): Fact | null {
    const row = this.db.prepare('SELECT * FROM profile_facts WHERE key = ?').get(key);
    return row ? toFact(row) : null;
  }

  listFacts(prefix?: string): Fact[] {
    const rows =
      prefix === undefined
        ? this.db.prepare('SELECT * FROM profile_facts ORDER BY key').all()
        : this.db.prepare("SELECT * FROM profile_facts WHERE key = ? OR key LIKE ? ESCAPE '\\' ORDER BY key").all(prefix, `${prefix.replace(/[%_\\]/g, '\\$&')}.%`);
    return rows.map(toFact);
  }

  moveFact(key: string, to: FactStatus, change: { actor: string; at: string; reason?: string }): Fact {
    return this.tx(() => {
      const current = this.getFact(key);
      if (!current) throw new Error(`no fact "${key}"`);
      if (!canMoveFact(current.status, to)) throw new IllegalFactMoveError(key, current.status, to);
      const confirming = to === 'confirmed';
      this.db
        .prepare('UPDATE profile_facts SET status = ?, confirmed_by = ?, confirmed_at = ?, updated_at = ? WHERE key = ?')
        .run(to, confirming ? change.actor : current.confirmedBy, confirming ? change.at : current.confirmedAt, change.at, key);
      this.audit({
        at: change.at,
        proposalId: null,
        kind: 'fact_status',
        fromStatus: null,
        toStatus: null,
        actor: change.actor,
        detail: { key, from: current.status, to, ...(change.reason ? { reason: change.reason } : {}) },
      });
      return this.getFact(key)!;
    });
  }

  recordCheck(record: Omit<CheckRecord, 'id'>): void {
    this.db
      .prepare('INSERT INTO ground_truth_checks (fact_key, checked_at, independent_kind, independent_ref, observed, outcome, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(record.factKey, record.checkedAt, record.independent.kind, record.independent.ref, json(record.observed ?? null), record.outcome, record.note);
  }

  listChecks(factKey?: string): CheckRecord[] {
    const rows =
      factKey === undefined
        ? this.db.prepare('SELECT * FROM ground_truth_checks ORDER BY id').all()
        : this.db.prepare('SELECT * FROM ground_truth_checks WHERE fact_key = ? ORDER BY id').all(factKey);
    return rows.map((r) => ({
      id: r['id'] as number,
      factKey: r['fact_key'] as string,
      checkedAt: r['checked_at'] as string,
      independent: { kind: r['independent_kind'] as string, ref: r['independent_ref'] as string },
      observed: parseOrNull(r['observed']),
      outcome: r['outcome'] as 'pass' | 'fail',
      note: r['note'] as string | null,
    }));
  }

  addDiscrepancy(discrepancy: Omit<Discrepancy, 'id'>): Discrepancy {
    const id = randomUUID();
    const full: Discrepancy = { ...discrepancy, id };
    this.db
      .prepare('INSERT INTO discrepancies (id, fact_key, created_at, status, body) VALUES (?, ?, ?, ?, ?)')
      .run(id, full.factKey, full.createdAt, full.status, json(full));
    return full;
  }

  listDiscrepancies(status?: 'open' | 'resolved'): Discrepancy[] {
    const rows =
      status === undefined
        ? this.db.prepare('SELECT body FROM discrepancies ORDER BY created_at, rowid').all()
        : this.db.prepare('SELECT body FROM discrepancies WHERE status = ? ORDER BY created_at, rowid').all(status);
    return rows.map((r) => parse<Discrepancy>(r['body']));
  }

  // ---- ShadowLog (PRF-16, PRF-64) --------------------------------------------------

  addEntry(entry: NewShadowEntry, at: string): ShadowEntry {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO shadow_entries (id, created_at, event_source, event_id, handler_id, handler_version, proposal_id, draft,
           output, input, facts_used) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, at, entry.eventSource, entry.eventId, entry.handlerId, entry.handlerVersion, entry.proposalId, entry.draft, json(entry.output), json(entry.input), json(entry.factsUsed));
    return this.getEntry(id)!;
  }

  /** ADM-114: a person changes a mark. The mark is cleared (and the answer a Wrong saved, when asked), audited, so the entry can be marked again. */
  unmarkEntry(entryId: string, clearReply: boolean, actor: string, at: string): void {
    this.tx(() => {
      this.db.prepare(`UPDATE shadow_entries SET marking = NULL, marked_by = NULL, marked_at = NULL${clearReply ? ', human_reply = NULL, human_at = NULL' : ''} WHERE id = ?`).run(entryId);
      this.audit({ at, proposalId: null, kind: 'mark_undone', fromStatus: null, toStatus: null, actor, detail: { entryId, clearedReply: clearReply } });
    });
  }

  recordHuman(source: string, eventId: string, human: HumanAction, at: string): ShadowEntry[] {
    return this.tx(() => {
      const rows = this.db.prepare('SELECT id FROM shadow_entries WHERE event_source = ? AND event_id = ?').all(source, eventId);
      for (const row of rows) {
        this.db
          .prepare('UPDATE shadow_entries SET human_reply = COALESCE(?, human_reply), human_action = COALESCE(?, human_action), human_at = ? WHERE id = ?')
          .run(human.reply ?? null, human.action ?? null, at, row['id'] as string);
      }
      return rows.map((r) => this.getEntry(r['id'] as string)!);
    });
  }

  mark(entryId: string, marking: Marking, actor: string, at: string): ShadowEntry {
    if (!MARKINGS.includes(marking)) throw new Error(`"${marking}" is not a marking`);
    return this.tx(() => {
      if (!this.getEntry(entryId)) throw new Error(`no shadow entry ${entryId}`);
      this.db.prepare('UPDATE shadow_entries SET marking = ?, marked_by = ?, marked_at = ? WHERE id = ?').run(marking, actor, at, entryId);
      this.audit({ at, proposalId: null, kind: 'shadow_marking', fromStatus: null, toStatus: null, actor, detail: { entryId, marking } });
      return this.getEntry(entryId)!;
    });
  }

  setBandVerdict(entryId: string, verdict: BandVerdict, actor: string, at: string): ShadowEntry {
    return this.tx(() => {
      if (!this.getEntry(entryId)) throw new Error(`no shadow entry ${entryId}`);
      this.db.prepare('UPDATE shadow_entries SET band_verdict = ? WHERE id = ?').run(verdict, entryId);
      this.audit({ at, proposalId: null, kind: 'band_verdict', fromStatus: null, toStatus: null, actor, detail: { entryId, verdict } });
      return this.getEntry(entryId)!;
    });
  }

  getEntry(id: string): ShadowEntry | null {
    const row = this.db.prepare('SELECT * FROM shadow_entries WHERE id = ?').get(id);
    return row ? toEntry(row) : null;
  }

  listEntries(filter: { handlerId?: string; handlerVersion?: string } = {}): ShadowEntry[] {
    return this.db
      .prepare('SELECT * FROM shadow_entries WHERE (? IS NULL OR handler_id = ?) AND (? IS NULL OR handler_version = ?) ORDER BY created_at, rowid')
      .all(filter.handlerId ?? null, filter.handlerId ?? null, filter.handlerVersion ?? null, filter.handlerVersion ?? null)
      .map(toEntry);
  }

  markingCounts(): MarkingCounts[] {
    const out = new Map<string, MarkingCounts>();
    for (const e of this.listEntries()) {
      const key = `${e.handlerId}\u0000${e.handlerVersion}`;
      let row = out.get(key);
      if (!row) {
        row = { handlerId: e.handlerId, handlerVersion: e.handlerVersion, counts: { match: 0, better: 0, worse: 0, different_but_fine: 0, wrong_fact: 0, unmarked: 0 } };
        out.set(key, row);
      }
      row.counts[e.marking ?? 'unmarked']++;
    }
    return [...out.values()];
  }

  // ---- LessonStore (PRF-67) -----------------------------------------------------------

  addLesson(lesson: { handlerId: string | null; text: string; originEntryId: string | null }, at: string): Lesson {
    const id = randomUUID();
    return this.tx(() => {
      const next = Number(this.db.prepare('SELECT COALESCE(MAX(version), 0) + 1 AS v FROM lessons').get()!['v']);
      this.db.prepare("INSERT INTO lessons (id, handler_id, text, origin_entry_id, version, status, created_at) VALUES (?, ?, ?, ?, ?, 'active', ?)")
        .run(id, lesson.handlerId, lesson.text, lesson.originEntryId, next, at);
      this.audit({ at, proposalId: null, kind: 'lesson_added', fromStatus: null, toStatus: null, actor: 'lessons', detail: { id, version: next, handlerId: lesson.handlerId, originEntryId: lesson.originEntryId } });
      return toLesson(this.db.prepare('SELECT * FROM lessons WHERE id = ?').get(id)!);
    });
  }

  retireLesson(id: string, at: string): Lesson {
    return this.tx(() => {
      const row = this.db.prepare('SELECT * FROM lessons WHERE id = ?').get(id);
      if (!row) throw new Error(`no lesson ${id}`);
      this.db.prepare("UPDATE lessons SET status = 'retired' WHERE id = ?").run(id);
      this.audit({ at, proposalId: null, kind: 'lesson_retired', fromStatus: null, toStatus: null, actor: 'lessons', detail: { id } });
      return toLesson(this.db.prepare('SELECT * FROM lessons WHERE id = ?').get(id)!);
    });
  }

  activeLessonsFor(handlerId: string): Lesson[] {
    return this.db
      .prepare("SELECT * FROM lessons WHERE status = 'active' AND (handler_id IS NULL OR handler_id = ?) ORDER BY version")
      .all(handlerId)
      .map(toLesson);
  }

  listLessons(): Lesson[] {
    return this.db.prepare('SELECT * FROM lessons ORDER BY version').all().map(toLesson);
  }

  // ---- LiveStore (HR-8) -------------------------------------------------------------

  enable(record: LiveRecord): void {
    this.db
      .prepare('INSERT INTO live_handlers (handler_id, enabled_at, enabled_by, evidence) VALUES (?, ?, ?, ?) ON CONFLICT(handler_id) DO UPDATE SET enabled_at = excluded.enabled_at, enabled_by = excluded.enabled_by, evidence = excluded.evidence')
      .run(record.handlerId, record.enabledAt, record.enabledBy, json(record.evidence));
  }

  isEnabled(handlerId: string): boolean {
    return this.db.prepare('SELECT 1 FROM live_handlers WHERE handler_id = ?').get(handlerId) !== undefined;
  }

  listEnabled(): LiveRecord[] {
    return this.db.prepare('SELECT * FROM live_handlers ORDER BY enabled_at').all().map((r) => ({
      handlerId: r['handler_id'] as string,
      enabledAt: r['enabled_at'] as string,
      enabledBy: r['enabled_by'] as string,
      evidence: parse(r['evidence']),
    }));
  }

  // ---- ChecklistStore (ADM-1..5) -------------------------------------------------------

  getRow(channel: string, itemId: string): ChecklistRow | null {
    const r = this.db.prepare('SELECT body FROM checklist_rows WHERE channel = ? AND item_id = ?').get(channel, itemId);
    return r ? parse<ChecklistRow>(r['body']) : null;
  }

  putRow(row: ChecklistRow): void {
    this.db
      .prepare('INSERT INTO checklist_rows (channel, item_id, body) VALUES (?, ?, ?) ON CONFLICT(channel, item_id) DO UPDATE SET body = excluded.body')
      .run(row.channel, row.itemId, json(row));
  }

  listRows(channel: string): ChecklistRow[] {
    return this.db.prepare('SELECT body FROM checklist_rows WHERE channel = ? ORDER BY item_id').all(channel).map((r) => parse<ChecklistRow>(r['body']));
  }

  getSignoff(channel: string, who: 'business' | 'supplier'): Signoff | null {
    const r = this.db.prepare('SELECT by_, at FROM checklist_signoffs WHERE channel = ? AND who = ?').get(channel, who);
    return r ? { by: r['by_'] as string, at: r['at'] as string } : null;
  }

  putSignoff(channel: string, who: 'business' | 'supplier', signoff: Signoff | null): void {
    if (signoff === null) this.db.prepare('DELETE FROM checklist_signoffs WHERE channel = ? AND who = ?').run(channel, who);
    else
      this.db
        .prepare('INSERT INTO checklist_signoffs (channel, who, by_, at) VALUES (?, ?, ?, ?) ON CONFLICT(channel, who) DO UPDATE SET by_ = excluded.by_, at = excluded.at')
        .run(channel, who, signoff.by, signoff.at);
  }

  // ---- ControlStore (ADM-9, ADM-12, ADM-23..27) -----------------------------------------

  getRole(chat: string): ChatRole | null {
    const r = this.db.prepare('SELECT role FROM chat_roles WHERE chat = ?').get(chat);
    return r ? (r['role'] as ChatRole) : null;
  }

  setRole(chat: string, role: ChatRole, actor: string, at: string): void {
    this.tx(() => {
      const before = this.getRole(chat);
      this.db.prepare('INSERT INTO chat_roles (chat, role) VALUES (?, ?) ON CONFLICT(chat) DO UPDATE SET role = excluded.role').run(chat, role);
      this.audit({ at, proposalId: null, kind: 'chat_role', fromStatus: null, toStatus: null, actor, detail: { chat, from: before, to: role } });
    });
  }

  /** MDL-8: the AI service was changed from the dashboard. The detail holds the address and model, never a key. */
  recordModelChange(actor: string, at: string, detail: { baseUrl: string; model: string; keySet: boolean }): void {
    this.tx(() => this.audit({ at, proposalId: null, kind: 'model_changed', fromStatus: null, toStatus: null, actor, detail }));
  }

  getChatState(chat: string): ChatState {
    const r = this.db.prepare('SELECT state FROM chat_states WHERE chat = ?').get(chat);
    return r ? (r['state'] as ChatState) : 'bot';
  }

  setChatState(chat: string, state: ChatState, actor: string, at: string, reason?: string): void {
    this.tx(() => {
      const before = this.getChatState(chat);
      this.db.prepare('INSERT INTO chat_states (chat, state) VALUES (?, ?) ON CONFLICT(chat) DO UPDATE SET state = excluded.state').run(chat, state);
      this.audit({ at, proposalId: null, kind: 'chat_state', fromStatus: null, toStatus: null, actor, detail: { chat, from: before, to: state, ...(reason ? { reason } : {}) } });
    });
  }

  getPresence(): Presence | null {
    const raw = this.db.prepare("SELECT value FROM control_flags WHERE key = 'presence'").get()?.['value'];
    return typeof raw === 'string' ? (JSON.parse(raw) as Presence) : null;
  }

  setPresence(presence: Presence): void {
    this.tx(() => {
      const before = this.getPresence();
      this.db.prepare("INSERT INTO control_flags (key, value) VALUES ('presence', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(presence));
      this.audit({ at: presence.since, proposalId: null, kind: 'presence', fromStatus: null, toStatus: null, actor: presence.by, detail: { from: before?.state ?? null, to: presence.state, label: presence.label } });
    });
  }

  getLanguage(): StaffLanguage | null {
    const raw = this.db.prepare("SELECT value FROM control_flags WHERE key = 'language'").get()?.['value'];
    return raw === 'pt' || raw === 'en' ? raw : null;
  }

  setLanguage(language: StaffLanguage, actor: string, at: string): void {
    this.tx(() => {
      const before = this.getLanguage();
      this.db.prepare("INSERT INTO control_flags (key, value) VALUES ('language', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(language);
      this.audit({ at, proposalId: null, kind: 'language', fromStatus: null, toStatus: null, actor, detail: { from: before, to: language } });
    });
  }

  getGlobalStop(): boolean {
    return this.db.prepare("SELECT value FROM control_flags WHERE key = 'global_stop'").get()?.['value'] === '1';
  }

  // ---- ModuleStateStore (WZP-50): a module's own state by key, on the control table, so no schema change ----------------------------

  getModuleState<T = unknown>(module: string, key: string): { value: T; version: number; updatedAt: string } | null {
    const raw = this.db.prepare('SELECT value FROM control_flags WHERE key = ?').get(`state:${module}:${key}`)?.['value'];
    return typeof raw === 'string' ? (JSON.parse(raw) as { value: T; version: number; updatedAt: string }) : null;
  }

  setModuleState(module: string, key: string, value: unknown, actor: string, at: string): { version: number } {
    return this.tx(() => {
      const version = (this.getModuleState(module, key)?.version ?? 0) + 1;
      this.db
        .prepare('INSERT INTO control_flags (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .run(`state:${module}:${key}`, JSON.stringify({ value, version, updatedAt: at }));
      this.audit({ at, proposalId: null, kind: 'module_state', fromStatus: null, toStatus: null, actor, detail: { module, key, version } });
      return { version };
    });
  }

  listModuleState<T = unknown>(module: string): { key: string; record: { value: T; version: number; updatedAt: string } }[] {
    const prefix = `state:${module}:`;
    return this.db
      .prepare('SELECT key, value FROM control_flags WHERE substr(key, 1, ?) = ? ORDER BY key')
      .all(prefix.length, prefix)
      .map((row) => ({ key: String(row['key']).slice(prefix.length), record: JSON.parse(String(row['value'])) as { value: T; version: number; updatedAt: string } }));
  }

  setGlobalStop(stopped: boolean, actor: string, at: string): void {
    this.tx(() => {
      this.db.prepare("INSERT INTO control_flags (key, value) VALUES ('global_stop', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(stopped ? '1' : '0');
      this.audit({ at, proposalId: null, kind: 'global_stop', fromStatus: null, toStatus: null, actor, detail: { stopped } });
    });
  }

  getWaiting(chat: string): WaitingPeriod | null {
    const r = this.db.prepare('SELECT * FROM waiting_periods WHERE chat = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1').get(chat);
    return r ? toWaiting(r) : null;
  }

  openWaiting(chat: string, at: string): WaitingPeriod {
    this.db.prepare('INSERT INTO waiting_periods (chat, since, last_customer_at) VALUES (?, ?, ?)').run(chat, at, at);
    return this.getWaiting(chat)!;
  }

  touchWaiting(chat: string, at: string): void {
    this.db.prepare('UPDATE waiting_periods SET last_customer_at = ? WHERE chat = ? AND ended_at IS NULL').run(at, chat);
  }

  markPinged(chat: string): void {
    this.db.prepare('UPDATE waiting_periods SET pinged = 1 WHERE chat = ? AND ended_at IS NULL').run(chat);
  }

  closeWaiting(chat: string, reason: NonNullable<WaitingPeriod['endReason']>, at: string): WaitingPeriod | null {
    const open = this.getWaiting(chat);
    if (!open) return null;
    this.db.prepare('UPDATE waiting_periods SET ended_at = ?, end_reason = ? WHERE chat = ? AND ended_at IS NULL').run(at, reason, chat);
    return { ...open, endedAt: at, endReason: reason };
  }

  listOpenWaiting(): WaitingPeriod[] {
    return this.db.prepare('SELECT * FROM waiting_periods WHERE ended_at IS NULL ORDER BY id').all().map(toWaiting);
  }

  recordSettled(chat: string, by: string, via: 'person_replied' | 'done', at: string): void {
    this.tx(() => {
      this.db.prepare('INSERT INTO settlements (chat, at, by, via) VALUES (?, ?, ?, ?)').run(chat, at, by, via);
      this.audit({ at, proposalId: null, kind: 'settled', fromStatus: null, toStatus: null, actor: by, detail: { chat, via } });
    });
  }

  lastSettledAt(chat: string): string | null {
    const raw = this.db.prepare('SELECT MAX(at) AS at FROM settlements WHERE chat = ?').get(chat)?.['at'];
    return typeof raw === 'string' ? raw : null;
  }

  // ---- ChatIndex (ADM-81) ----------------------------------------------------------------

  linkEvent(source: string, eventId: string, chat: string, at: string): void {
    this.db.prepare('INSERT OR IGNORE INTO event_chats (event_source, event_id, chat, at) VALUES (?, ?, ?, ?)').run(source, eventId, chat, at);
  }

  chatOfEvent(source: string, eventId: string): string | null {
    const raw = this.db.prepare('SELECT chat FROM event_chats WHERE event_source = ? AND event_id = ?').get(source, eventId)?.['chat'];
    return typeof raw === 'string' ? raw : null;
  }

  listChats(): { chat: string; lastAt: string }[] {
    return this.db
      .prepare('SELECT chat, MAX(at) AS last_at FROM event_chats GROUP BY chat ORDER BY last_at DESC')
      .all()
      .map((r) => ({ chat: r['chat'] as string, lastAt: r['last_at'] as string }));
  }

  /** feat-desk DSK-42: how many saved exchanges this install holds for a chat (what `.forget` would drop). */
  chatEntryCount(chat: string): number {
    return this.listEntries().filter((e) => this.chatOfEvent(e.eventSource, e.eventId) === chat).length;
  }

  /** Whether another chat still uses this vault code for its customer's name. */
  contactCodeInUse(code: string, exceptChat: string): boolean {
    return this.db.prepare('SELECT 1 FROM chat_contacts WHERE name_code = ? AND chat <> ? LIMIT 1').get(code, exceptChat) !== undefined;
  }

  /**
   * feat-desk DSK-42 (ADM-115): drops this install's own copies of one chat: its saved shadow entries, its link to those events (the chat index), its contact
   * mapping, its per-chat module state (the chat card, a booking funnel's state) and its own chat state. Proposals, bookings, decisions and the prompt ledger are
   * the business's records and stay. One audit row with counts and no text. Returns the vault code of the customer's name, for the caller to remove if no other
   * chat uses it.
   */
  forgetChat(chat: string, by: string, at: string): { entries: number; links: number; states: number; contactCode: string | null } {
    return this.tx(() => {
      const events = this.db.prepare('SELECT event_source, event_id FROM event_chats WHERE chat = ?').all(chat);
      let entries = 0;
      for (const e of events) entries += Number(this.db.prepare('DELETE FROM shadow_entries WHERE event_source = ? AND event_id = ?').run(e['event_source'] as string, e['event_id'] as string).changes);
      const links = Number(this.db.prepare('DELETE FROM event_chats WHERE chat = ?').run(chat).changes);
      const contactCode = (this.db.prepare('SELECT name_code FROM chat_contacts WHERE chat = ?').get(chat)?.['name_code'] as string | undefined) ?? null;
      this.db.prepare('DELETE FROM chat_contacts WHERE chat = ?').run(chat);
      let states = 0;
      for (const row of this.db.prepare("SELECT key FROM control_flags WHERE key LIKE 'state:%'").all()) {
        const key = row['key'] as string;
        // `state:<module>:<chat>`: a module name has no colon, so the chat is everything after the second one.
        if (key.split(':').slice(2).join(':') === chat) states += Number(this.db.prepare('DELETE FROM control_flags WHERE key = ?').run(key).changes);
      }
      states += Number(this.db.prepare('DELETE FROM chat_states WHERE chat = ?').run(chat).changes);
      this.audit({ at, proposalId: null, kind: 'chat_forgotten', fromStatus: null, toStatus: null, actor: by, detail: { entries, links, states } });
      return { entries, links, states, contactCode };
    });
  }

  setContact(chat: string, nameCode: string, at: string): void {
    this.db
      .prepare('INSERT INTO chat_contacts (chat, name_code, updated_at) VALUES (?, ?, ?) ON CONFLICT(chat) DO UPDATE SET name_code = excluded.name_code, updated_at = excluded.updated_at')
      .run(chat, nameCode, at);
  }

  getContact(chat: string): string | null {
    const raw = this.db.prepare('SELECT name_code FROM chat_contacts WHERE chat = ?').get(chat)?.['name_code'];
    return typeof raw === 'string' ? raw : null;
  }

  // ---- UsageStore (GWY-28) --------------------------------------------------------------

  usageRows(since: string): UsageRow[] {
    return this.db
      .prepare('SELECT at, handler_id, handler_version, model, endpoint, usage, error FROM prompt_ledger WHERE at >= ? AND endpoint IS NOT NULL ORDER BY at')
      .all(since)
      .map((r) => ({
        at: r['at'] as string,
        handlerId: r['handler_id'] as string,
        handlerVersion: r['handler_version'] as string,
        model: r['model'] as string | null,
        endpoint: r['endpoint'] as string | null,
        usage: typeof r['usage'] === 'string' ? (JSON.parse(r['usage']) as unknown) : null,
        error: r['error'] as string | null,
      }));
  }

  countModelCalls(since: string): number {
    return Number(this.db.prepare('SELECT COUNT(*) AS n FROM prompt_ledger WHERE at >= ? AND endpoint IS NOT NULL').get(since)?.['n'] ?? 0);
  }

  // ---- AlertStore (ADM-45..48) ---------------------------------------------------------

  raiseAlert(a: { kind: AlertKind; ref: string; detail: string; at: string }): { alert: AdminAlert; created: boolean } {
    return this.tx(() => {
      const open = this.db.prepare('SELECT * FROM alerts WHERE kind = ? AND ref = ? AND cleared_at IS NULL').get(a.kind, a.ref);
      if (open) return { alert: toAlert(open), created: false };
      const { lastInsertRowid } = this.db.prepare('INSERT INTO alerts (kind, ref, detail, raised_at) VALUES (?, ?, ?, ?)').run(a.kind, a.ref, a.detail, a.at);
      return { alert: toAlert(this.db.prepare('SELECT * FROM alerts WHERE id = ?').get(lastInsertRowid)!), created: true };
    });
  }

  listOpenAlerts(): AdminAlert[] {
    return this.db.prepare('SELECT * FROM alerts WHERE cleared_at IS NULL ORDER BY id').all().map(toAlert);
  }

  markAlertSeen(id: number, actor: string, at: string): void {
    this.db.prepare('UPDATE alerts SET seen_at = ?, seen_by = ? WHERE id = ? AND seen_at IS NULL').run(at, actor, id);
  }

  clearAlerts(kind: AlertKind, ref: string, actor: string, at: string): number {
    return Number(this.db.prepare('UPDATE alerts SET cleared_at = ?, cleared_by = ? WHERE kind = ? AND ref = ? AND cleared_at IS NULL').run(at, actor, kind, ref).changes);
  }

  // ---- CalibrationStore (PRF-30) -------------------------------------------------------

  latestCalibration(handlerId: string): CalibrationRecord | null {
    const r = this.db.prepare('SELECT * FROM calibrations WHERE handler_id = ? ORDER BY id DESC LIMIT 1').get(handlerId);
    return r ? toCalibration(r) : null;
  }

  insertCalibration(rec: CalibrationRecord): void {
    this.db
      .prepare('INSERT INTO calibrations (handler_id, handler_version, model, endpoint, status, since, last_review_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(rec.handlerId, rec.handlerVersion, rec.model, rec.endpoint, rec.status, rec.since, rec.lastReviewAt);
  }

  markCalibrationStale(handlerId: string, handlerVersion: string, model: string, endpoint: string): void {
    this.db.prepare("UPDATE calibrations SET status = 'stale' WHERE handler_id = ? AND handler_version = ? AND model = ? AND endpoint = ?").run(handlerId, handlerVersion, model, endpoint);
  }

  recordReview(handlerId: string, handlerVersion: string, model: string, endpoint: string, at: string): void {
    this.db.prepare('UPDATE calibrations SET last_review_at = ? WHERE handler_id = ? AND handler_version = ? AND model = ? AND endpoint = ?').run(at, handlerId, handlerVersion, model, endpoint);
  }

  listCalibrations(): CalibrationRecord[] {
    return this.db.prepare('SELECT * FROM calibrations ORDER BY id').all().map(toCalibration);
  }

  // ---- AutoReplyStore (PRF-35, PRF-36) ---------------------------------------------------

  getEligibleBand(handlerId: string) {
    const r = this.db.prepare('SELECT * FROM auto_reply_policy WHERE handler_id = ?').get(handlerId);
    return r ? { band: r['band'] as Band, reportRef: r['report_ref'] as string, setBy: r['set_by'] as string, setAt: r['set_at'] as string } : null;
  }

  setEligibleBand(handlerId: string, band: Band, reportRef: string, actor: string, at: string): void {
    this.tx(() => {
      this.db
        .prepare('INSERT INTO auto_reply_policy (handler_id, band, report_ref, set_by, set_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(handler_id) DO UPDATE SET band = excluded.band, report_ref = excluded.report_ref, set_by = excluded.set_by, set_at = excluded.set_at')
        .run(handlerId, band, reportRef, actor, at);
      this.audit({ at, proposalId: null, kind: 'auto_reply_band', fromStatus: null, toStatus: null, actor, detail: { handlerId, band, reportRef } });
    });
  }

  getSuspension(handlerId: string) {
    const r = this.db.prepare('SELECT reason, at FROM auto_reply_suspensions WHERE handler_id = ?').get(handlerId);
    return r ? { reason: r['reason'] as string, at: r['at'] as string } : null;
  }

  suspendAutoReply(handlerId: string, reason: string, at: string): void {
    this.tx(() => {
      this.db.prepare('INSERT OR REPLACE INTO auto_reply_suspensions (handler_id, reason, at) VALUES (?, ?, ?)').run(handlerId, reason, at);
      this.audit({ at, proposalId: null, kind: 'auto_reply_suspended', fromStatus: null, toStatus: null, actor: 'policy', detail: { handlerId, reason } });
    });
  }

  reenableAutoReply(handlerId: string, actor: string, at: string): void {
    this.tx(() => {
      this.db.prepare('DELETE FROM auto_reply_suspensions WHERE handler_id = ?').run(handlerId);
      this.audit({ at, proposalId: null, kind: 'auto_reply_reenabled', fromStatus: null, toStatus: null, actor, detail: { handlerId } });
    });
  }

  // ---- FlagStore (PRF-39, PRF-47, PRF-51) ---------------------------------------------------

  addFlag(flag: Omit<Flag, 'id' | 'ticketId'>, ticket: Omit<Ticket, 'id' | 'flagId'>): { flag: Flag; ticket: Ticket } {
    const flagId = randomUUID();
    const ticketId = randomUUID();
    const fullFlag: Flag = { ...flag, id: flagId, ticketId };
    const fullTicket: Ticket = { ...ticket, id: ticketId, flagId };
    this.tx(() => {
      this.db.prepare('INSERT INTO flags (id, handler_id, handler_version, status, body) VALUES (?, ?, ?, ?, ?)').run(flagId, flag.handlerId, flag.handlerVersion, flag.status, json(fullFlag));
      this.db.prepare('INSERT INTO tickets (id, body) VALUES (?, ?)').run(ticketId, json(fullTicket));
    });
    return { flag: fullFlag, ticket: fullTicket };
  }

  getFlag(id: string): Flag | null {
    const r = this.db.prepare('SELECT body FROM flags WHERE id = ?').get(id);
    return r ? parse<Flag>(r['body']) : null;
  }

  listFlags(filter: { handlerId?: string; handlerVersion?: string; status?: 'open' | 'closed' } = {}): Flag[] {
    return this.db
      .prepare('SELECT body FROM flags WHERE (? IS NULL OR handler_id = ?) AND (? IS NULL OR handler_version = ?) AND (? IS NULL OR status = ?) ORDER BY rowid')
      .all(filter.handlerId ?? null, filter.handlerId ?? null, filter.handlerVersion ?? null, filter.handlerVersion ?? null, filter.status ?? null, filter.status ?? null)
      .map((r) => parse<Flag>(r['body']));
  }

  getTicket(id: string): Ticket | null {
    const r = this.db.prepare('SELECT body FROM tickets WHERE id = ?').get(id);
    return r ? parse<Ticket>(r['body']) : null;
  }

  fixTicket(id: string, at: string): Ticket {
    return this.tx(() => {
      const ticket = this.getTicket(id);
      if (!ticket) throw new Error(`no ticket ${id}`);
      const fixed: Ticket = { ...ticket, transcript: null, transcriptClearedAt: at, status: 'fixed', closedAt: at };
      this.db.prepare('UPDATE tickets SET body = ? WHERE id = ?').run(json(fixed), id);
      const flag = this.getFlag(ticket.flagId)!;
      this.db.prepare("UPDATE flags SET status = 'closed', body = ? WHERE id = ?").run(json({ ...flag, status: 'closed' }), flag.id);
      return fixed;
    });
  }

  lastHeadsUp(handlerId: string, handlerVersion: string) {
    const r = this.db.prepare('SELECT open_flags, at FROM heads_ups WHERE handler_id = ? AND handler_version = ? ORDER BY id DESC LIMIT 1').get(handlerId, handlerVersion);
    return r ? { openFlagsAtAlert: Number(r['open_flags']), at: r['at'] as string } : null;
  }

  recordHeadsUp(handlerId: string, handlerVersion: string, openFlagsAtAlert: number, at: string): void {
    this.db.prepare('INSERT INTO heads_ups (handler_id, handler_version, open_flags, at) VALUES (?, ?, ?, ?)').run(handlerId, handlerVersion, openFlagsAtAlert, at);
  }

  /** Failed model calls (HR-6 keeps them): for the upgrade digest (PRF-81). */
  listLedgerFailures(since?: string): { id: string; at: string; handlerId: string; handlerVersion: string; model: string | null; endpoint: string | null; error: string }[] {
    return this.db
      .prepare('SELECT id, at, handler_id, handler_version, model, endpoint, error FROM prompt_ledger WHERE error IS NOT NULL AND (? IS NULL OR at >= ?) ORDER BY at, rowid')
      .all(since ?? null, since ?? null)
      .map((r) => ({ id: r['id'] as string, at: r['at'] as string, handlerId: r['handler_id'] as string, handlerVersion: r['handler_version'] as string, model: r['model'] as string | null, endpoint: r['endpoint'] as string | null, error: r['error'] as string }));
  }

  // ---- retention and export ---------------------------------------------------

  /** PRV-10, N-4: deletes ledger rows written before `cutoff` (ISO time); returns how many. Audit is never purged. */
  purgeLedgerBefore(cutoff: string): number {
    return Number(this.db.prepare('DELETE FROM prompt_ledger WHERE at < ?').run(cutoff).changes);
  }

  /** Every stored text a leak could sit in: proposals, audit rows and ledger rows (PRV-13). */
  exportStoredText(): { table: StoredTable; id: string; text: string }[] {
    const out: { table: StoredTable; id: string; text: string }[] = [];
    for (const table of ['proposals', 'audit', 'prompt_ledger', 'shadow_entries', 'lessons', 'flags', 'tickets'] as const) {
      for (const row of this.db.prepare(`SELECT rowid AS rid, * FROM ${table}`).all()) {
        out.push({ table, id: String(row['rid']), text: JSON.stringify(row) });
      }
    }
    return out;
  }

  // ---- PromptLedger -----------------------------------------------------------

  write(entry: LedgerEntry): string {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO prompt_ledger (id, at, handler_id, handler_version, endpoint, model, request_payload, raw_response,
           error, duration_ms, usage, facts_used) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        entry.at,
        entry.handlerId,
        entry.handlerVersion,
        entry.endpoint,
        entry.model,
        entry.requestPayload === null ? null : json(entry.requestPayload),
        entry.rawResponse,
        entry.error,
        entry.durationMs,
        entry.usage === undefined ? null : json(entry.usage),
        entry.factsUsed === undefined ? null : json(entry.factsUsed),
      );
    return id;
  }

  read(id: string): (LedgerEntry & { id: string }) | null {
    const r = this.db.prepare('SELECT * FROM prompt_ledger WHERE id = ?').get(id);
    if (!r) return null;
    return {
      id: r['id'] as string,
      at: r['at'] as string,
      handlerId: r['handler_id'] as string,
      handlerVersion: r['handler_version'] as string,
      endpoint: r['endpoint'] as string | null,
      model: r['model'] as string | null,
      requestPayload: parseOrNull(r['request_payload']),
      rawResponse: r['raw_response'] as string | null,
      error: r['error'] as string | null,
      durationMs: r['duration_ms'] as number,
      ...(r['usage'] === null ? {} : { usage: parse(r['usage']) }),
      ...(r['facts_used'] === null ? {} : { factsUsed: parse<FactUsed[]>(r['facts_used']) }),
    };
  }
}

function toCalibration(r: Row): CalibrationRecord {
  return {
    handlerId: r['handler_id'] as string,
    handlerVersion: r['handler_version'] as string,
    model: r['model'] as string,
    endpoint: r['endpoint'] as string,
    status: r['status'] as 'current' | 'stale',
    since: r['since'] as string,
    lastReviewAt: r['last_review_at'] as string | null,
  };
}

function toAlert(r: Row): AdminAlert {
  return {
    id: Number(r['id']),
    kind: r['kind'] as AlertKind,
    ref: r['ref'] as string,
    detail: r['detail'] as string,
    raisedAt: r['raised_at'] as string,
    seenAt: r['seen_at'] as string | null,
    seenBy: r['seen_by'] as string | null,
    clearedAt: r['cleared_at'] as string | null,
    clearedBy: r['cleared_by'] as string | null,
  };
}

function toWaiting(r: Row): WaitingPeriod {
  return {
    chat: r['chat'] as string,
    since: r['since'] as string,
    lastCustomerAt: r['last_customer_at'] as string,
    pinged: r['pinged'] === 1,
    endedAt: r['ended_at'] as string | null,
    endReason: r['end_reason'] as WaitingPeriod['endReason'],
  };
}

function toEntry(r: Row): ShadowEntry {
  return {
    id: r['id'] as string,
    createdAt: r['created_at'] as string,
    eventSource: r['event_source'] as string,
    eventId: r['event_id'] as string,
    handlerId: r['handler_id'] as string,
    handlerVersion: r['handler_version'] as string,
    proposalId: r['proposal_id'] as string | null,
    draft: r['draft'] as string | null,
    output: parse(r['output']),
    input: parse<Record<string, unknown>>(r['input']),
    factsUsed: parse<FactUsed[]>(r['facts_used']),
    humanReply: r['human_reply'] as string | null,
    humanAction: r['human_action'] as string | null,
    humanAt: r['human_at'] as string | null,
    marking: r['marking'] as Marking | null,
    markedBy: r['marked_by'] as string | null,
    markedAt: r['marked_at'] as string | null,
    bandVerdict: r['band_verdict'] as BandVerdict | null,
  };
}

function toLesson(r: Row): Lesson {
  return {
    id: r['id'] as string,
    handlerId: r['handler_id'] as string | null,
    text: r['text'] as string,
    originEntryId: r['origin_entry_id'] as string | null,
    version: Number(r['version']),
    status: r['status'] as 'active' | 'retired',
    createdAt: r['created_at'] as string,
  };
}

function toFact(r: Row): Fact {
  return {
    key: r['key'] as string,
    value: parse(r['value']),
    class: r['class'] as 'public' | 'deal',
    source: r['source'] as Fact['source'],
    sourceRef: r['source_ref'] as string,
    status: r['status'] as FactStatus,
    confirmedBy: r['confirmed_by'] as string | null,
    confirmedAt: r['confirmed_at'] as string | null,
    reviewBy: r['review_by'] as string | null,
    updatedAt: r['updated_at'] as string,
  };
}

function toProposal(r: Row): Proposal {
  return {
    id: r['id'] as string,
    businessId: r['business_id'] as string,
    handlerId: r['handler_id'] as string,
    handlerVersion: r['handler_version'] as string,
    createdAt: r['created_at'] as string,
    status: r['status'] as ProposalStatus,
    subject: r['subject'] as string,
    changes: parse<Change[]>(r['changes']),
    ...(r['draft'] === null ? {} : { draft: r['draft'] as string }),
    findings: parse<Finding[]>(r['findings']),
    questions: parse<string[]>(r['questions']),
    modelCallId: r['model_call_id'] as string | null,
    eventSource: r['event_source'] as string | null,
    eventId: r['event_id'] as string | null,
    decidedBy: r['decided_by'] as string | null,
    decidedAt: r['decided_at'] as string | null,
    appliedChanges: parseOrNull<AppliedChange[]>(r['applied_changes']),
    reason: r['reason'] as string | null,
    confidence: parseOrNull<Confidence>(r['confidence']),
  };
}
