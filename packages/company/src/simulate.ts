import { z } from 'zod';
import { selectHandlers, type CyborgEvent, type HandlerRegistry, type OutboundMessage, type OutboundSink } from '@cyborg/core';
import type { SqliteStore } from '@cyborg/store-sqlite';
import { createCompany, type Company, type CompanyDeps } from './runtime.ts';
import type { LoadedConfig } from './config.ts';

// docs/12 CMP-15..22: a simulated day for one company. Real handlers, real store, real model endpoint; the channel is a script.

const chat = z.string().min(1);
export const stepSchema = z.discriminatedUnion('do', [
  z.object({ do: z.literal('customer'), chat, text: z.string().min(1), sender: z.string().min(1).optional() }),
  z.object({ do: z.literal('staff'), chat, text: z.string().min(1), by: z.string().min(1).default('staff-1') }),
  z.object({ do: z.literal('admin'), text: z.string().min(1), chat: chat.optional() }),
  z.object({ do: z.literal('handoff'), chat }),
  z.object({ do: z.literal('review'), site: z.string().min(1), text: z.string().min(1), ref: z.string().optional() }),
  z.object({ do: z.literal('advance'), minutes: z.number().positive() }),
  z.object({ do: z.literal('sheet') }),
]);
export const scriptSchema = z.object({
  /** ISO time the simulated clock starts at. */
  start: z.string().datetime().default('2026-11-01T09:00:00.000Z'),
  steps: z.array(stepSchema).min(1),
});
export type Step = z.infer<typeof stepSchema>;
export type Script = z.infer<typeof scriptSchema>;

export function validateScript(raw: unknown): { script: Script | null; errors: string[] } {
  if (JSON.stringify(raw).includes('<fill in')) return { script: null, errors: ['the script still has "<fill in" in it'] };
  const parsed = scriptSchema.safeParse(raw);
  return parsed.success ? { script: parsed.data, errors: [] } : { script: null, errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
}

/** CMP-17: the model calls a script will make, counted from the handlers that match each step, before anything is sent anywhere. */
export function estimateModelCalls(script: Script, registry: HandlerRegistry): { calls: number; byStep: number[] } {
  const kinds: Record<string, string | null> = { customer: 'message.received', handoff: 'handoff.requested', review: 'review.received' };
  const byStep = script.steps.map((s) => {
    const kind = kinds[s.do];
    if (!kind) return 0;
    const event = { id: 'estimate', source: 'sim', kind, at: '', payload: {} } as CyborgEvent;
    return selectHandlers(registry, event).filter((h) => h.kind === 'model').length;
  });
  return { calls: byStep.reduce((a, b) => a + b, 0), byStep };
}

export interface CompanyModelFile {
  enquiryFields?: { name: string; description: string }[];
  profile: Record<string, unknown>;
  /** WZP-16: set on a demo base's made-up facts; their source reads `demo:company-model` and the test chat's page says so. */
  demo?: string;
}

/** CMP-18: facts from a drafted company model go in as `unconfirmed` client statements, which shadow mode accepts and live mode refuses (PRF-5). */
export function seedProfile(store: SqliteStore, model: CompanyModelFile, at: string): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(model.profile)) {
    if (store.getFact(key)) continue;
    store.putFact({ key, value, class: 'public', source: 'client_statement', sourceRef: model.demo ? 'demo:company-model' : 'simulation:company-model' }, 'simulation', at);
    keys.push(key);
  }
  return keys;
}

export interface Captured {
  channel: string;
  at: string;
  message: OutboundMessage;
}

export interface StepResult {
  n: number;
  at: string;
  step: Step;
  /** One line saying what the company did with it. */
  did: string;
  sent: Captured[];
  /** Model failures and refusals the step ran into. */
  problems: string[];
}

export interface SimulationReport {
  config: { id: string; mode: string };
  steps: StepResult[];
  sheets: { at: string; text: string }[];
  finalSheet: string;
  alerts: { kind: string; ref: string; detail: string }[];
  statuses: Record<string, number>;
  usage: ReturnType<Company['usage']>;
}

function capturingSink(channel: string, clock: { t: Date }, log: Captured[]): OutboundSink {
  return { channel, send: async (message) => void log.push({ channel, at: clock.t.toISOString(), message }) };
}

/**
 * CMP-19..22. Runs the script in order on a simulated clock. Customer lines go through the gate and the handlers; a staff line
 * settles the chat and, in shadow mode, is recorded against the customer's last message; an admin line is a command from the first
 * authorised sender. Nothing leaves the process except the model calls the handlers make.
 */
export async function runSimulation(
  loaded: LoadedConfig,
  script: Script,
  options: { company?: CompanyModelFile; deps?: Omit<CompanyDeps, 'now'> } = {},
): Promise<SimulationReport> {
  const clock = { t: new Date(script.start) };
  const sent: Captured[] = [];
  const company = createCompany(
    loaded,
    {
      ack: capturingSink('sim-ack', clock, sent),
      review: capturingSink('sim-review', clock, sent),
      ops: capturingSink('sim-ops', clock, sent),
    },
    { ...(options.deps ?? {}), now: () => clock.t, ...(options.company ? { beforeLoad: (store: SqliteStore) => void seedProfile(store, options.company!, clock.t.toISOString()) } : {}) },
  );
  try {
    const sender = loaded.config.chat.authorisedSenders[0];
    const opsChat = Object.entries(loaded.config.chat.roles).find(([, r]) => r === 'ops')?.[0] ?? Object.keys(loaded.config.chat.roles)[0];
    const transcripts = new Map<string, string[]>();
    const lastCustomer = new Map<string, string>();
    const results: StepResult[] = [];
    const sheets: { at: string; text: string }[] = [];
    let counter = 0;

    for (const [index, step] of script.steps.entries()) {
      const before = sent.length;
      const problems: string[] = [];
      let did = '';
      const line = (c: string, text: string) => transcripts.set(c, [...(transcripts.get(c) ?? []), text]);

      if (step.do === 'advance') {
        clock.t = new Date(clock.t.getTime() + step.minutes * 60_000);
        const resumed = company.gate.resumeDue();
        did = `clock moved on ${step.minutes} min${resumed.length ? `; handed back to the bot: ${resumed.join(', ')}` : ''}`;
      } else if (step.do === 'customer') {
        const id = `sim-${++counter}`;
        const event: CyborgEvent = {
          id, source: 'sim', kind: 'message.received', at: clock.t.toISOString(),
          payload: { chat: step.chat, isGroup: false, addressed: true, sender: step.sender ?? `${step.chat}-customer`, text: step.text },
        };
        line(step.chat, `customer: ${step.text}`);
        lastCustomer.set(step.chat, id);
        const result = await company.process(event);
        if (!result.ran) {
          did = `gate: ${result.decision.kind}${'reason' in result.decision ? ` (${result.decision.reason})` : ''}`;
        } else {
          did = [...result.outcomes
            .map((o) => {
              if (o.outcome === 'refused') problems.push(`${o.handlerId}: refused: ${o.reason}`);
              if (o.outcome === 'proposal' && o.proposal.status === 'invalid_output') problems.push(`${o.handlerId}: invalid output: ${o.proposal.reason ?? ''}`);
              // A draft the code blocked is a reply nobody can send: the report shows why, so a failure is not mistaken for a pass.
              if (o.outcome === 'proposal' && o.proposal.status === 'proposed' && o.proposal.draft == null && o.handlerId.endsWith('reply_draft') && o.proposal.questions.length > 0) {
                problems.push(`${o.handlerId}: reply blocked: ${o.proposal.findings.map((f) => f.statement.replace(/^the drafted reply was blocked: /, '')).join('; ') || (o.proposal.reason ?? 'a person must answer')}`);
              }
              return `${o.handlerId.replace(/^sales\.enquiry\./, '')}: ${o.outcome === 'proposal' ? o.proposal.status : o.outcome}`;
            })
            , ...(result.card ? ['office closed: card sent to the ops chat'] : [])].join('; ');
          // PRV-6: the scrubber swaps a number or an address for a placeholder before the model; the step says which rules matched and how many.
          // Every handler that read the line wrote its own row; one line's replaced spans are the largest of them.
          const perHandler = company.store.listAudit().filter((r) => r.kind === 'scrub_replaced' && (r.detail as { eventId?: string } | null)?.eventId === id).map((r) => (r.detail as { fields: { rule: string }[] }).fields.map((f) => f.rule));
          const swapped = perHandler.reduce<string[]>((best, rules) => (rules.length > best.length ? rules : best), []);
          if (swapped.length > 0) did += `; scrubbed before the model: ${[...new Set(swapped)].join(', ')} (${swapped.length} replaced by placeholders)`;
        }
      } else if (step.do === 'staff') {
        line(step.chat, `staff: ${step.text}`);
        const eventId = lastCustomer.get(step.chat);
        company.personReplied(step.chat, step.by, eventId ? { eventId, source: 'sim', text: step.text } : undefined);
        did = `${step.by} answered in ${step.chat}${eventId ? ' (recorded against the customer\'s last message)' : ' (no customer message to record it against)'}`;
      } else if (step.do === 'admin') {
        if (!sender) throw new Error('an admin step needs chat.authorisedSenders in the config');
        const target = step.chat ?? opsChat;
        if (!target) throw new Error('an admin step needs a chat: give "chat" or set chat.roles');
        const event: CyborgEvent = { id: `sim-${++counter}`, source: 'sim', kind: 'message.received', at: clock.t.toISOString(), payload: { chat: target, isGroup: false, addressed: true, sender, text: step.text } };
        const result = await company.process(event);
        did = result.decision.kind === 'command' ? `command ${result.decision.command}: ${result.decision.ack}` : `gate: ${result.decision.kind}`;
      } else if (step.do === 'handoff') {
        const { proposal, card } = await company.handoff(step.chat, (transcripts.get(step.chat) ?? []).join('\n'));
        did = card ? 'card built and sent to the ops chat' : proposal ? `no card: ${proposal.status}${proposal.reason ? ` (${proposal.reason})` : ''}` : 'no card: the handler gave nothing';
        if (!card) problems.push(`handoff ${step.chat}: ${did}`);
      } else if (step.do === 'review') {
        const outcomes = await company.review(step.site, step.text, step.ref);
        did = outcomes.length === 0 ? 'no handler for reviews is on' : outcomes.map((o) => `${o.handlerId}: ${o.outcome === 'proposal' ? o.proposal.status : o.outcome}`).join('; ');
        for (const o of outcomes) if (o.outcome === 'refused') problems.push(`${o.handlerId}: refused: ${o.reason}`);
      } else {
        const text = company.morningSheet();
        sheets.push({ at: clock.t.toISOString(), text });
        did = 'morning sheet printed below';
      }
      results.push({ n: index + 1, at: clock.t.toISOString(), step, did, sent: sent.slice(before), problems });
    }

    const statuses: Record<string, number> = {};
    for (const p of company.store.list()) statuses[p.status] = (statuses[p.status] ?? 0) + 1;
    return {
      config: { id: loaded.config.id, mode: loaded.config.mode },
      steps: results,
      sheets,
      finalSheet: company.morningSheet(),
      alerts: company.store.listOpenAlerts().map((a) => ({ kind: a.kind, ref: a.ref, detail: a.detail })),
      statuses,
      usage: company.usage(1),
    };
  } finally {
    company.close();
  }
}

const RULE = '────────────────────────────────────────';

/** CMP-22: the report in zapa's Status layout. */
export function renderSimulation(report: SimulationReport): string {
  const steps = report.steps.map((r) => {
    const stepText = r.step.do === 'customer' || r.step.do === 'staff' || r.step.do === 'admin' ? `${r.step.do}${'chat' in r.step && r.step.chat ? ` ${r.step.chat}` : ''}: ${r.step.text}` : r.step.do === 'advance' ? `advance ${r.step.minutes} min` : r.step.do === 'review' ? `review ${r.step.site}: ${r.step.text}` : r.step.do === 'handoff' ? `handoff ${r.step.chat}` : 'sheet';
    const out = r.sent.map((s) => `       -> ${s.channel}: ${s.message.text.replace(/\n/g, '\n          ')}`);
    return `Spec: ${r.n}. ${r.at.slice(11, 16)} ${stepText}\nState: ${[r.did, ...r.problems.map((p) => `PROBLEM ${p}`)].join('\n       ')}${out.length ? `\n${out.join('\n')}` : ''}`;
  });
  const blocks = [
    `Simulation: ${report.config.id} (${report.config.mode}) · ${report.steps.length} steps · ${report.steps.reduce((n, r) => n + r.problems.length, 0)} problems`,
    steps.join(`\n${RULE}\n`),
    ...report.sheets.map((s) => `Spec: morning sheet printed at ${s.at.slice(11, 16)}\nState:\n${s.text}`),
    `Spec: end of the day\nState: ${report.alerts.length ? `open alerts: ${report.alerts.map((a) => `${a.kind}${a.ref ? ` ${a.ref}` : ''}`).join(', ')}` : 'no open alerts'}\n       proposals: ${Object.entries(report.statuses).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}\n       model calls: ${report.usage.totals.calls} (${report.usage.totals.failed} failed), ${report.usage.totals.promptTokens} in / ${report.usage.totals.completionTokens} out`,
    `Spec: morning sheet at the end\nState:\n${report.finalSheet}`,
  ];
  return blocks.join(`\n${RULE}\n`);
}
