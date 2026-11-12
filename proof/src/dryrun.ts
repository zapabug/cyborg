// Dry run: a drafted company model plus your own test tasks, run in shadow mode against a real model.
// Nothing is sent anywhere. The point is to see where the bot fails (docs/11).
import {
  CORE_VERSION, HandlerRegistry, loadModules, PRESENCE_FACT_KEY, presenceFactSource, Runner, ShadowController, type CapabilityResult, type ModelPort, type OutboundSink, type RunOutcome,
} from '@cyborg/core';
import { PackRegistry, ProfileFactProvider } from '@cyborg/profile';
import { salesModule } from '@cyborg/module-sales';
import type { SqliteStore, SqliteVault } from '@cyborg/store-sqlite';

export interface CompanyModel {
  /** What an enquiry is broken into: the things your tasks need to know. */
  enquiryFields: { name: string; description: string }[];
  commitmentPhrases?: string[];
  selfAssessment?: boolean;
  /** One entry per profile key the sales module reads; each value is the fact as JSON. */
  profile: Record<string, unknown>;
}

export interface Task {
  text: string;
  /** Strings the draft must contain (case-insensitive). */
  mustInclude?: string[];
  /** Strings the draft must not contain (case-insensitive). */
  mustNotInclude?: string[];
  /** Enquiry fields the intake should find. */
  expectFields?: string[];
}

export const REQUIRED_KEYS = ['business.name', 'offer.items', 'offer.availability', 'rules.commitments', 'tone.style', 'faq.entries'] as const;
export const OPTIONAL_KEYS = ['sales.criteria', 'sales.followup_after_hours'] as const;

export interface ModelCheck {
  errors: string[];
  warnings: string[];
}

const isPlaceholder = (v: unknown): boolean => JSON.stringify(v).includes('<fill in');

/** Checks the drafted model before any model call, so a typo does not look like a bot failure. */
export function validateCompanyModel(model: unknown): ModelCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const m = model as Partial<CompanyModel> | null;
  if (!m || typeof m !== 'object') return { errors: ['the company model must be a JSON object'], warnings };
  if (!Array.isArray(m.enquiryFields) || m.enquiryFields.length === 0) errors.push('enquiryFields: list at least one thing your tasks need to know (name and description)');
  else for (const f of m.enquiryFields) if (!/^[a-z][a-z0-9_]*$/.test(f?.name ?? '') || !f?.description) errors.push(`enquiryFields: "${f?.name}" needs a lower_case name and a description`);
  const p = m.profile;
  if (!p || typeof p !== 'object') return { errors: [...errors, 'profile: missing'], warnings };
  for (const key of REQUIRED_KEYS) if (!(key in p)) errors.push(`profile.${key}: missing (the reply handler cannot run without it)`);
  for (const key of OPTIONAL_KEYS) if (!(key in p)) warnings.push(`profile.${key}: missing (${key === 'sales.criteria' ? 'qualify is skipped' : 'follow-ups are skipped'})`);
  for (const [key, value] of Object.entries(p)) if (isPlaceholder(value)) errors.push(`profile.${key}: still has "<fill in" in it`);

  const items = p['offer.items'];
  if (items !== undefined) {
    if (!Array.isArray(items) || items.length === 0) errors.push('profile.offer.items: a list of { name, price, unit?, capacity? }');
    else for (const [i, it] of (items as Record<string, unknown>[]).entries()) {
      if (typeof it?.['name'] !== 'string') errors.push(`profile.offer.items[${i}].name: missing`);
      if (typeof it?.['price'] !== 'number') errors.push(`profile.offer.items[${i}].price: a number (no currency symbol)`);
      if (it?.['capacity'] === undefined) warnings.push(`profile.offer.items[${i}]: no capacity, so any capacity the bot states will be blocked`);
      const days = it?.['days'];
      if (days !== undefined && !(Array.isArray(days) && days.every((d) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6))) errors.push(`profile.offer.items[${i}].days: weekday numbers 0 to 6 (0 = Sunday) this item runs, [] for any day, or leave it out to use offer.availability.days`);
      const kw = it?.['keywords'];
      if (kw !== undefined && !(Array.isArray(kw) && kw.every((k) => typeof k === 'string'))) errors.push(`profile.offer.items[${i}].keywords: a list of words a customer uses for this item`);
    }
  }
  const av = p['offer.availability'] as { days?: unknown; closedDates?: unknown } | undefined;
  if (av !== undefined) {
    if (!Array.isArray(av.days) || !(av.days as unknown[]).every((d) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6)) errors.push('profile.offer.availability.days: weekday numbers 0 to 6, 0 = Sunday, the days you RUN');
    if (av.closedDates !== undefined && !(Array.isArray(av.closedDates) && (av.closedDates as unknown[]).every((d) => /^\d{2}-\d{2}$/.test(String(d))))) errors.push('profile.offer.availability.closedDates: "MM-DD" strings');
  }
  if (p['rules.commitments'] !== undefined && !Array.isArray(p['rules.commitments'])) errors.push('profile.rules.commitments: a list of strings');
  if (p['faq.entries'] !== undefined && !(Array.isArray(p['faq.entries']) && (p['faq.entries'] as { q?: unknown; a?: unknown }[]).every((e) => typeof e?.q === 'string' && typeof e?.a === 'string'))) errors.push('profile.faq.entries: a list of { q, a }');
  if (p['sales.criteria'] !== undefined && !(Array.isArray(p['sales.criteria']) && (p['sales.criteria'] as { id?: unknown }[]).every((c) => typeof c?.id === 'string'))) errors.push('profile.sales.criteria: a list of { id, description }');
  return { errors, warnings };
}

/** Same idea for the tasks: an unfilled template must not run. */
export function validateTasks(tasks: unknown): string[] {
  if (!Array.isArray(tasks) || tasks.length === 0) return ['the tasks file must be a list with at least one task'];
  return tasks.flatMap((t, i) => {
    const text = typeof t === 'string' ? t : (t as Task)?.text;
    if (typeof text !== 'string' || text.trim() === '') return [`task ${i + 1}: no text`];
    return JSON.stringify(t).includes('<fill in') ? [`task ${i + 1}: still has "<fill in" in it`] : [];
  });
}

export interface TaskResult {
  index: number;
  text: string;
  /** What the bot did, per handler. */
  intake: { outcome: string; fields: Record<string, string>; notStated: string[]; detail?: string };
  reply: { outcome: string; draft: string | null; band: string | null; blockedBecause: string[]; detail?: string };
  qualify: { outcome: string; findings: string[]; questions: string[]; detail?: string } | null;
  /** Where the bot failed this task. Empty means nothing failed that the code can see. */
  failures: string[];
  /** Things worth a look that are not failures. */
  watch: string[];
  entryIds: string[];
}

export interface DryRunReport {
  generatedAt: string;
  modelCheck: ModelCheck;
  tasks: TaskResult[];
  summary: { tasks: number; withFailures: number; byKind: Record<string, number> };
}

const countKind = (acc: Record<string, number>, kind: string) => (acc[kind] = (acc[kind] ?? 0) + 1);

function summarise(outcomes: RunOutcome[], id: string) {
  const o = outcomes.find((x) => x.handlerId === id);
  return o;
}

export async function runDryRun(options: {
  company: CompanyModel;
  tasks: Task[];
  model: ModelPort;
  store: SqliteStore;
  vault: SqliteVault;
  capabilities: CapabilityResult[];
  now?: () => Date;
}): Promise<DryRunReport> {
  const now = options.now ?? (() => new Date());
  const modelCheck = validateCompanyModel(options.company);
  if (modelCheck.errors.length > 0) return { generatedAt: now().toISOString(), modelCheck, tasks: [], summary: { tasks: 0, withFailures: 0, byKind: {} } };

  const { company, store } = options;
  for (const [key, value] of Object.entries(company.profile)) {
    store.putFact({ key, value, class: 'public', source: 'client_statement', sourceRef: 'dryrun:company-model' }, 'dryrun', now().toISOString());
  }
  const hasCriteria = 'sales.criteria' in company.profile;
  const enabled = ['sales.enquiry.intake', 'sales.enquiry.reply_draft', ...(hasCriteria ? ['sales.enquiry.qualify'] : [])];
  const registry = new HandlerRegistry({ autoReplyHandlers: [] });
  const report = loadModules(registry, [salesModule], {
    coreVersion: CORE_VERSION, profile: store, packs: [], capabilities: options.capabilities,
    connectors: { channel: {}, contacts: {} },
    dependencyChecks: { 'connector:channel': () => ({ ok: true }), 'connector:contacts': () => ({ ok: true }) },
    moduleConfig: { sales: { enquiryFields: company.enquiryFields, commitmentPhrases: company.commitmentPhrases ?? [], selfAssessment: company.selfAssessment ?? false } },
    config: { sales: { enabledHandlers: enabled } },
  });
  if (report.refused.length > 0) {
    return { generatedAt: now().toISOString(), modelCheck: { errors: [...modelCheck.errors, ...report.refused[0]!.unmet.map((u) => `module refused: ${u.kind} ${u.item}: ${u.detail}`)], warnings: modelCheck.warnings }, tasks: [], summary: { tasks: 0, withFailures: 0, byKind: {} } };
  }

  // Shadow mode accepts unconfirmed facts (PRF-5): the drafted model is not confirmed yet, which is the point.
  const runner = new Runner({
    businessId: 'dryrun', registry, store, ledger: store, model: options.model, vault: options.vault,
    facts: new ProfileFactProvider(store, new PackRegistry(), { [PRESENCE_FACT_KEY]: presenceFactSource(store) }), mode: 'shadow', lessons: store, now,
  });
  const reviewSent: string[] = [];
  const review: OutboundSink = { channel: 'dryrun-review', send: async (m) => void reviewSent.push(m.text) };
  const controller = new ShadowController({ runner, log: store, store, ledger: store, originChannel: 'dryrun-origin', review, now });

  const results: TaskResult[] = [];
  const byKind: Record<string, number> = {};
  for (const [index, task] of options.tasks.entries()) {
    const outcomes = await controller.observe({
      id: `task-${index}`, source: 'dryrun', kind: 'message.received', at: now().toISOString(),
      payload: { text: task.text, sender: `dryrun-sender-${index}` },
    });
    const failures: string[] = [];
    const watch: string[] = [];
    const fail = (kind: string, detail: string) => (failures.push(`${kind}: ${detail}`), countKind(byKind, kind));

    const one = (id: string) => {
      const o = summarise(outcomes, id);
      if (!o) return { outcome: 'not run' as const };
      if (o.outcome === 'refused') return { outcome: 'refused' as const, detail: o.reason };
      if (o.outcome === 'none') return { outcome: 'none' as const, detail: o.reason };
      if (o.outcome === 'duplicate') return { outcome: 'duplicate' as const };
      return { outcome: o.proposal.status, proposal: o.proposal };
    };

    const i = one('sales.enquiry.intake');
    const r = one('sales.enquiry.reply_draft');
    const q = hasCriteria ? one('sales.enquiry.qualify') : null;

    const fields: Record<string, string> = {};
    if ('proposal' in i && i.proposal) for (const c of i.proposal.changes) fields[c.field] = String(c.newValue);
    const notStated = company.enquiryFields.map((f) => f.name).filter((n) => !(n in fields));
    if (i.outcome === 'refused') fail('refused', `intake: ${i.detail}`);
    if (i.outcome === 'invalid_output') fail('invalid_output', `intake: ${'proposal' in i ? i.proposal?.reason : ''}`);
    if ('proposal' in i && i.proposal?.reason?.startsWith('manual_handling')) watch.push('the scrubber stopped this message: a person must handle it (personal data in the text)');
    for (const f of task.expectFields ?? []) if (!(f in fields)) fail('missing_field', `the intake did not find "${f}"`);

    let draft: string | null = null;
    let band: string | null = null;
    const blockedBecause: string[] = [];
    if (r.outcome === 'refused') fail('refused', `reply: ${r.detail}`);
    else if (r.outcome === 'invalid_output') fail('invalid_output', `reply: ${'proposal' in r ? r.proposal?.reason : ''}`);
    else if ('proposal' in r && r.proposal) {
      draft = r.proposal.draft ?? null;
      band = r.proposal.confidence?.band ?? null;
      if (draft === null && !r.proposal.reason) {
        blockedBecause.push(...r.proposal.findings.map((f) => f.statement.replace(/^the drafted reply was blocked: /, '')));
        fail('draft_blocked', blockedBecause.join('; '));
      }
      if (band === 'low') watch.push(`low confidence: ${r.proposal.confidence!.signals.filter((s) => s.passed === false || (s.kind === 'self_assessment' && s.value !== 'high')).map((s) => `${s.kind} ${s.kind === 'self_assessment' ? `(${s.value}) ` : ''}${s.detail ?? ''}`.trim()).join('; ')}`);
      if (r.proposal.reason?.startsWith('manual_handling')) watch.push('the scrubber stopped the reply too');
    }
    if (draft !== null) {
      for (const s of task.mustInclude ?? []) if (!draft.toLowerCase().includes(s.toLowerCase())) fail('expectation', `the draft should include "${s}"`);
      for (const s of task.mustNotInclude ?? []) if (draft.toLowerCase().includes(s.toLowerCase())) fail('expectation', `the draft should not include "${s}"`);
    } else if ((task.mustInclude?.length ?? 0) > 0 && failures.every((f) => !f.startsWith('draft_blocked') && !f.startsWith('refused') && !f.startsWith('invalid_output'))) {
      fail('expectation', 'there is no draft to check against mustInclude');
    }

    let qualify: TaskResult['qualify'] = null;
    if (q) {
      if (q.outcome === 'invalid_output') fail('invalid_output', `qualify: ${'proposal' in q ? q.proposal?.reason : ''}`);
      if (q.outcome === 'refused') fail('refused', `qualify: ${q.detail}`);
      qualify = {
        outcome: q.outcome,
        findings: 'proposal' in q && q.proposal ? q.proposal.findings.map((f) => f.statement) : [],
        questions: 'proposal' in q && q.proposal ? q.proposal.questions : [],
        ...('detail' in q && q.detail ? { detail: q.detail } : {}),
      };
    }

    results.push({
      index, text: task.text,
      intake: { outcome: i.outcome, fields, notStated, ...('detail' in i && i.detail ? { detail: i.detail } : {}) },
      reply: { outcome: r.outcome, draft, band, blockedBecause, ...('detail' in r && r.detail ? { detail: r.detail } : {}) },
      qualify, failures, watch,
      entryIds: store.listEntries().filter((e) => e.eventId === `task-${index}`).map((e) => e.id),
    });
  }
  return {
    generatedAt: now().toISOString(),
    modelCheck,
    tasks: results,
    summary: { tasks: results.length, withFailures: results.filter((t) => t.failures.length > 0).length, byKind },
  };
}

export function renderDryRun(report: DryRunReport): string {
  const lines: string[] = [];
  for (const w of report.modelCheck.warnings) lines.push(`warning: ${w}`);
  if (report.modelCheck.errors.length > 0) {
    lines.push('The company model cannot run yet:');
    for (const e of report.modelCheck.errors) lines.push(`  - ${e}`);
    return lines.join('\n');
  }
  for (const t of report.tasks) {
    lines.push(`\n#${t.index + 1} "${t.text}"  ${t.failures.length ? 'FAILED' : 'ok'}`);
    lines.push(`  intake (${t.intake.outcome}): ${Object.entries(t.intake.fields).map(([k, v]) => `${k}=${v}`).join(', ') || 'nothing found'}${t.intake.notStated.length ? `  | not stated: ${t.intake.notStated.join(', ')}` : ''}`);
    lines.push(`  reply  (${t.reply.outcome}${t.reply.band ? `, band ${t.reply.band}` : ''}): ${t.reply.draft ?? (t.reply.blockedBecause.length ? `no draft, blocked: ${t.reply.blockedBecause.join('; ')}` : t.reply.detail ?? '-')}`);
    if (t.qualify) lines.push(`  qualify (${t.qualify.outcome}): ${t.qualify.findings.join(' | ') || t.qualify.detail || '-'}${t.qualify.questions.length ? `  | questions: ${t.qualify.questions.join(' | ')}` : ''}`);
    for (const f of t.failures) lines.push(`  FAIL ${f}`);
    for (const w of t.watch) lines.push(`  watch ${w}`);
  }
  lines.push(`\n${report.summary.withFailures} of ${report.summary.tasks} tasks failed. By kind: ${Object.entries(report.summary.byKind).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`);
  return lines.join('\n');
}
