import { withBookings, listBookings, decideBooking } from '@cyborg/company/bookings';
import { HandlerRegistry, Lifecycle, PRESENCE_FACT_KEY, Runner, type CyborgEvent, type Proposal, type RunOutcome } from '@cyborg/core';
import { OpenAIGateway } from '@cyborg/gateway';
import { bookingsConfigSchema, READ_HANDLER_ID, readHandler, RECORD_HANDLER_ID, recordHandler } from '@cyborg/module-bookings';
import { handoffCardHandler, renderHandoffCard, replyDraftHandler, salesConfigSchema } from '@cyborg/module-sales';
import { PackRegistry, ProfileFactProvider } from '@cyborg/profile';
import { MemoryCapabilities, MemoryLedger, MemoryLessons, MemoryProfile, MemoryStore, MemoryVault } from './memory.ts';

// feat WZP-10..19: the demo company and the framework, in the page. The Runner, the handlers, the gateway, the fact provider and the booking step are the
// framework's own code; only the stores are in memory and the channel is the page. Nothing leaves the browser but the calls to the model.

export interface DemoCompany {
  /** Made-up facts, by profile key. They are the demo's and the page says so. */
  profile: Record<string, unknown>;
  label: string;
  enquiryFields: { name: string; description: string }[];
}

export interface Endpoint {
  baseUrl: string;
  model: string;
  /** The visitor's own key, or the one the site carries for a free model. It is a Bearer token sent to `baseUrl` and nowhere else. */
  apiKey?: string;
}

export interface DemoSettings {
  sales: Record<string, unknown>;
  bookings: Record<string, unknown>;
}

export type Band = 'high' | 'medium' | 'low';

export interface TurnView {
  /** What the customer typed. */
  text: string;
  /** The draft a person would approve; null when the checks blocked it or the model failed. */
  draft: string | null;
  band: Band | null;
  /** The profile facts the model was given, with whether each is still unconfirmed. */
  facts: { key: string; unconfirmed: boolean; value?: unknown }[];
  /** What the code's checks said. */
  checks: string[];
  /** What the code computed for this chat and put in front of the writer (the quote, the next step). */
  computed: string;
  /** Plain problems: a blocked draft, a refused call. */
  problems: string[];
  needsOffice: boolean;
  /** The exact prompt the reply model was given. */
  prompt: string | null;
  /** A booking request made this turn. */
  request: string | null;
}

const localDay = (d: Date): string => d.toISOString().slice(0, 10);

/** The text a model was given, from the request body the gateway sent. */
function promptOf(payload: unknown): string | null {
  const body = payload as { messages?: { content?: unknown }[]; prompt?: unknown };
  if (Array.isArray(body?.messages)) return body.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).filter(Boolean).join('\n\n');
  return typeof body?.prompt === 'string' ? body.prompt : null;
}

export class Demo {
  readonly store = new MemoryStore();
  readonly ledger = new MemoryLedger();
  readonly lessons = new MemoryLessons();
  private readonly profile = new MemoryProfile();
  private readonly vault = new MemoryVault();
  private readonly gateway: OpenAIGateway;
  private readonly runner: Runner;
  private readonly company: ReturnType<typeof withBookings>;
  private readonly state = new Map<string, { value: unknown; version: number; updatedAt: string }>();
  private readonly transcripts = new Map<string, string[]>();
  private readonly seen = new Set<string>();
  private counter = 0;
  private lastComputed = '';
  private readonly lifecycle: Lifecycle;
  private readonly now: () => Date;

  constructor(readonly demo: DemoCompany, readonly endpoint: Endpoint, settings: DemoSettings, options: { now?: () => Date; fetch?: typeof fetch } = {}) {
    this.now = options.now ?? (() => new Date());
    const at = this.now().toISOString();
    for (const [key, value] of Object.entries(demo.profile)) this.profile.putFact({ key, value, class: 'public', source: 'client_statement', sourceRef: 'demo:company-model' }, 'demo', at);

    const sales = salesConfigSchema.parse({ enquiryFields: demo.enquiryFields, ...settings.sales });
    const bookings = bookingsConfigSchema.parse(settings.bookings);
    const registry = new HandlerRegistry({ autoReplyHandlers: [] });
    // The read asks for plain JSON: a free model may not enforce a schema, and the code re-checks every field it gives anyway.
    registry.registerHandler({ ...readHandler(), model: { level: 'json_object', name: 'default' } });
    registry.registerHandler(recordHandler(bookings));
    registry.registerHandler(replyDraftHandler(sales));
    registry.registerHandler(handoffCardHandler(sales));

    this.gateway = new OpenAIGateway(
      { endpoint: { baseUrl: endpoint.baseUrl, ...(endpoint.apiKey ? { apiKeyEnv: 'DEMO_KEY' } : {}) }, defaultModel: endpoint.model },
      { capabilities: new MemoryCapabilities(), ledger: this.ledger, fetch: (options.fetch ?? fetch).bind(globalThis), env: { DEMO_KEY: endpoint.apiKey ?? '' }, now: this.now },
    );
    this.runner = new Runner({
      businessId: 'demo', registry, store: this.store, ledger: this.ledger, model: this.gateway, vault: this.vault, mode: 'shadow', lessons: this.lessons,
      // The one add-on fact the reply asks for: who is at the office. The demo office is always staffed.
      facts: new ProfileFactProvider(this.profile, new PackRegistry(), { [PRESENCE_FACT_KEY]: { class: 'public', maxAgeMs: null, read: (now) => ({ sentence: 'The office is staffed: a colleague answers what the bot cannot.', asOf: now.toISOString() }) } }),
      now: this.now,
    });
    this.lifecycle = new Lifecycle({ store: this.store, now: this.now });

    // The booking step expects a company; this is the part of one it uses, over the in-memory stores.
    const store = Object.assign(this.store, {
      getFact: (key: string) => this.profile.getFact(key),
      getRole: () => 'reply' as const,
      getChatState: () => 'bot' as const,
      getGlobalStop: () => false,
      getContact: () => null,
      getModuleState: (module: string, key: string) => this.state.get(`${module}:${key}`) ?? null,
      setModuleState: (module: string, key: string, value: unknown, _actor: string, when: string) => {
        const version = (this.state.get(`${module}:${key}`)?.version ?? 0) + 1;
        this.state.set(`${module}:${key}`, { value, version, updatedAt: when });
        return { version };
      },
    });
    const base = {
      registry, runner: this.runner, store, vault: this.vault, defaultLanguage: 'en' as const,
      decide: (id: string, decision: 'approve' | 'decline', by: string, why?: { note?: string }) => this.lifecycle.decide(id, decision, by, why),
      process: async (event: CyborgEvent) => {
        this.lastComputed = typeof event.payload['conversation'] === 'string' ? event.payload['conversation'] : '';
        const outcomes: RunOutcome[] = await this.runner.handle(event);
        return { ran: true as const, decision: { kind: 'run' as const, event }, outcomes, card: null };
      },
    };
    this.company = withBookings(base as never, { config: bookings, commandPrefix: '.', now: this.now });
  }

  /** The real capability test of the model, a few calls once, so the framework knows what the endpoint can do (MOD-8). */
  async prepare(): Promise<string> {
    const result = await this.gateway.runCapabilityTest(this.endpoint.model);
    if (result.level === 'none') throw new Error('That model cannot return the JSON the handlers need. Try another model.');
    return result.level;
  }

  /** One customer line, through the booking step and the reply handler, as a real chat would be. */
  async customer(chat: string, text: string): Promise<TurnView> {
    const line = text.trim();
    if (line === '') throw new Error('write something first');
    const id = `c${++this.counter}`;
    const first = !this.seen.has(chat);
    this.seen.add(chat);
    this.transcripts.set(chat, [...(this.transcripts.get(chat) ?? []), `customer: ${line}`]);
    const before = this.ledger.all().length;
    this.lastComputed = '';
    const result = await this.company.process({
      id, source: 'demo', kind: 'message.received', at: this.now().toISOString(),
      payload: { chat, isGroup: false, addressed: true, sender: `${chat}-customer`, text: line, first },
    });
    const outcomes = result.ran ? result.outcomes : [];
    const problems: string[] = [];
    let reply: Proposal | null = null;
    for (const o of outcomes) {
      if (o.outcome === 'refused') problems.push(this.plain(o.reason));
      else if (o.outcome === 'proposal' && o.handlerId === 'sales.enquiry.reply_draft') reply = o.proposal;
    }
    const entries = this.ledger.all().slice(before);
    const replyEntry = [...entries].reverse().find((e) => e.handlerId === 'sales.enquiry.reply_draft');
    for (const e of entries) if (e.error) problems.push(this.plain(e.error));
    const blocked = reply !== null && (reply.draft === undefined || reply.draft === null) && reply.questions.length > 0;
    if (blocked) problems.push(...reply!.findings.map((f) => f.statement.replace(/^the drafted reply was blocked: /, '')));
    const request = /Request (B-\d+) was sent/.exec(this.lastComputed)?.[1] ?? null;
    return {
      text: line, draft: reply?.draft ?? null, band: (reply?.confidence?.band as Band | undefined) ?? null,
      facts: (replyEntry?.factsUsed ?? []).filter((f) => !f.runtime).map((f) => ({ key: f.key, unconfirmed: f.unconfirmed === true, value: this.profile.getFact(f.key)?.value })),
      checks: reply?.findings.map((f) => f.statement) ?? [], computed: this.lastComputed, problems: [...new Set(problems)], needsOffice: blocked,
      prompt: replyEntry ? promptOf(replyEntry.requestPayload) : null, request,
    };
  }

  private plain(reason: string): string {
    if (/401|403|credential|key/i.test(reason)) return 'The model refused the key. Check it, or use a free model.';
    if (/429|rate|limit|quota/i.test(reason)) return 'The free model is busy or its limit is reached. Try again in a minute.';
    return reason.length > 200 ? `${reason.slice(0, 200)}…` : reason;
  }

  /** The office card for a chat: what the customer wants and what is still open (one more model call). */
  async handoff(chat: string): Promise<string> {
    const transcript = (this.transcripts.get(chat) ?? []).join('\n');
    const outcomes = await this.runner.handle({ id: `h${++this.counter}`, source: 'demo', kind: 'handoff.requested', at: this.now().toISOString(), payload: { chat, transcript } });
    const card = outcomes.find((o) => o.handlerId === 'sales.handoff.card');
    if (!card || card.outcome !== 'proposal' || card.proposal.status !== 'proposed') return 'No card: the model gave nothing the code could check against the conversation.';
    return renderHandoffCard(card.proposal, { chat, language: () => 'en' });
  }

  bookings(): ReturnType<typeof listBookings> {
    return listBookings(this.company);
  }

  /** The office's commands, as in a real chat: what waits, confirm and decline by reference. */
  office(input: string): string {
    const text = input.trim().replace(/^\./, '');
    const [word = '', ...rest] = text.split(/\s+/);
    const open = () => listBookings(this.company).filter((b) => b.status === 'proposed').reverse();
    if (word === 'bookings') return open().map((b) => `${b.ref} · ${b.service} × ${b.partySize}, ${b.date}, ${b.total} · ${b.status}`).join('\n') || 'No booking request is waiting.';
    if (word === 'confirm' || word === 'decline') {
      const m = /^(?:B-)?0*(\d+)\s*([\s\S]*)$/i.exec(rest.join(' '));
      if (!m) return `Use: .${word} <reference, for example B-000001> [note]`;
      const b = listBookings(this.company).find((x) => x.ref === `B-${m[1]!.padStart(6, '0')}`);
      if (!b || b.status !== 'proposed') return 'That request does not exist or has already been decided.';
      decideBooking(this.company, b.id, word === 'confirm' ? 'approve' : 'decline', 'office', m[2]!.trim() || undefined);
      return `${b.ref} ${word === 'confirm' ? 'confirmed' : 'declined'}. Nothing was sent to the customer: tell them as usual.`;
    }
    return 'Commands: .bookings, .confirm <B-n> [note], .decline <B-n> [note]';
  }

  addLesson(text: string): void {
    if (text.trim().length < 5) throw new Error('a lesson is a short sentence');
    this.lessons.addLesson({ handlerId: null, text: text.trim(), originEntryId: null }, this.now().toISOString());
  }

  retireLesson(id: string): void {
    this.lessons.retireLesson(id);
  }

  today(): string {
    return localDay(this.now());
  }
}

export { RECORD_HANDLER_ID, READ_HANDLER_ID };
