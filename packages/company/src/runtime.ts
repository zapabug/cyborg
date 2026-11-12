import {
  ChannelGate,
  CORE_VERSION,
  fanOutNotifier,
  HandlerRegistry,
  Lifecycle,
  markEntry,
  N4_LEDGER_RETENTION_DAYS,
  type FlagReason,
  type Marking,
  type MarkingCounts,
  type ShadowEntry,
  loadModules,
  N17_TICKET_MESSAGES,
  nextOfficeChange,
  officeStatus,
  OpsChatNotifier,
  type OfficeSchedule,
  PRESENCE_FACT_KEY,
  presenceFactSource,
  Runner,
  ShadowController,
  StoreNotifier,
  buildUsageReport,
  type AdminNotifier,
  trackRecords,
  type TrackRecord,
  type AttentionItem,
  type AttentionSource,
  type AttentionToast,
  collectAttention,
  toastForItem,
  type CapabilityResult,
  type CyborgEvent,
  type GateDecision,
  type LanguageSource,
  type LoadReport,
  type ModelPort,
  type ModuleDefinition,
  type OutboundSink,
  type Proposal,
  type RunOutcome,
  type RuntimeFactSource,
  type StaffLanguage,
  type UsageReport,
} from '@cyborg/core';
import { OpenAIGateway, type Fetch } from '@cyborg/gateway';
import { bookingsModule } from '@cyborg/module-bookings';
import { feedbackModule, complaintsAttention, complaintsSection } from '@cyborg/module-feedback';
import { maintenanceModule } from '@cyborg/module-maintenance';
import { renderMorningSheet } from '@cyborg/module-admin';
import { officeAnswersSection, renderHandoffCard, salesModule } from '@cyborg/module-sales';
import { PackRegistry, ProfileFactProvider } from '@cyborg/profile';
import { purgeExpiredLedger, SqliteStore, SqliteVault } from '@cyborg/store-sqlite';
import { CHAT_CARD_MODULE, mergeIntoChatCard, readChatCard, renderChatCard } from './chat-card.ts';
import { buildChatBoard, deskAttention, proposalsOfChat, toastFor, type BoardRow, type Toast } from './board.ts';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { LoadedConfig } from './config.ts';

/** The folder a database lives in is made when it is missing, so a fresh customer repository (whose `data/` is not in git) just runs. */
function ensureFolder(path: string): string {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  return path;
}

/** CMP-9: the channel side belongs to the adapter. The core only ever sends through these. */
export interface CompanyAdapters {
  /** Command acknowledgements: the owner's self chat or the ops chat (ADM-8). */
  ack: OutboundSink;
  /** Shadow output goes here and nowhere else (PRF-15). */
  review: OutboundSink;
  /** Alerts and handoff cards. Optional: without it they only reach the dashboard list (ADM-45). */
  ops?: OutboundSink;
  /**
   * ADM-86: the recent lines of a chat for the dashboard's chat view. The core keeps no chat history, so the channel adapter supplies
   * it. Without it the view shows the lines this process saw since it started.
   */
  history?(chat: string, limit: number): Promise<{ from: 'customer' | 'bot' | 'staff'; text: string; at?: string }[]>;
}

export interface CompanyDeps {
  /** Replaces the gateway; tests and the simulation use it. */
  model?: ModelPort;
  /**
   * Runs once the store is open and before the modules load. A module is refused when a profile fact it needs is missing
   * (MOD-8), so facts that arrive with the run (a simulation's company model) have to be in by then.
   */
  beforeLoad?: (store: SqliteStore) => void;
  /**
   * CMP-29: the company's add-ons, by key (`live.<name>`). Each becomes a fact the reply handler is shown when the sales config lists
   * the key in `contextKeys`.
   */
  runtimeFacts?: Readonly<Record<string, RuntimeFactSource>>;
  /**
   * ADM-92: more plug-ins for the dashboard and the toast (a fleet module's inspections due, say). The desk and the feedback module
   * contribute theirs by themselves when they are switched on.
   */
  attentionSources?: readonly AttentionSource[];
  /** Replaces the stored capability results, for a scripted model that has no endpoint to test. */
  capabilities?: readonly CapabilityResult[];
  fetch?: Fetch;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

/**
 * CMP-12: the capability test for every model this install uses, stored with its date (GWY-9). It runs before `createCompany`,
 * because a module whose handlers need an untested endpoint is refused at load (MOD-8).
 */
export async function testCapabilities(loaded: LoadedConfig, deps: Pick<CompanyDeps, 'fetch' | 'env' | 'now'> = {}): Promise<CapabilityResult[]> {
  const { config } = loaded;
  const store = new SqliteStore(ensureFolder(loaded.paths.store), { ...(deps.now ? { now: deps.now } : {}) });
  try {
    const gateway = new OpenAIGateway(
      {
        endpoint: {
          baseUrl: config.inference.baseUrl,
          ...(config.inference.apiKeyEnv ? { apiKeyEnv: config.inference.apiKeyEnv } : {}),
          ...(config.inference.timeoutMs ? { timeoutMs: config.inference.timeoutMs } : {}),
          ...(config.inference.providerOptions ? { providerOptions: config.inference.providerOptions } : {}),
          ...(config.inference.reasoning ? { reasoning: config.inference.reasoning } : {}),
        },
      },
      { capabilities: store, ledger: store, ...(deps.fetch ? { fetch: deps.fetch } : {}), ...(deps.env ? { env: deps.env } : {}), ...(deps.now ? { now: deps.now } : {}) },
    );
    const results: CapabilityResult[] = [];
    for (const name of modelsInUse(config)) results.push(await gateway.runCapabilityTest(name));
    return results;
  } finally {
    store.close();
  }
}

export type ProcessResult =
  | { ran: false; decision: Exclude<GateDecision, { kind: 'run' }> }
  /** `card` is set when nobody was assumed at the office and a handoff card went to the ops chat (ADM-64). */
  | { ran: true; decision: Extract<GateDecision, { kind: 'run' }>; outcomes: RunOutcome[]; card: string | null };

export interface ChatView {
  chat: string;
  name: string | null;
  state: string;
  colour: BoardRow['colour'];
  reasons: BoardRow['reasons'];
  /** The handoff card as staff read it, or null when there is none. */
  card: string | null;
  /** Replies and other proposals waiting for a person; the text is for staff to read, never sent from here. */
  pending: { id: string; handler: string; draft: string | null; band: string | null; status: string; createdAt: string }[];
  history: { from: 'customer' | 'bot' | 'staff'; text: string; at?: string }[];
}

/** ADM-91: one shadow entry as a person auditing it sees it: what the customer wrote, what the bot drafted, what the human did. */
export interface AuditRow {
  id: string;
  createdAt: string;
  chat: string | null;
  name: string | null;
  handlerId: string;
  handlerVersion: string;
  customerText: string | null;
  draft: string | null;
  band: string | null;
  humanReply: string | null;
  humanAction: string | null;
  marking: Marking | null;
  /** The profile facts the draft used (runtime facts left out), for a `wrong_fact` marking. */
  factKeys: string[];
}

export interface Company {
  /** The staff language the config starts in; `.lang` overrides it (ADM-77). */
  readonly defaultLanguage: StaffLanguage;
  readonly store: SqliteStore;
  readonly vault: SqliteVault;
  /** ADM-115: drops this install's own copies of one chat (see `SqliteStore.forgetChat`); a person's act, never automatic. */
  forgetChat(chat: string, by: string): { entries: number; links: number; states: number; nameRemoved: boolean };
  /** ADM-116, N-19: the timed work of a running install: handed-off chats back to the bot after N-14 of silence, ledger rows older than N-4 dropped (PRV-10). Safe to call at any time. */
  housekeeping(): { resumed: string[]; purged: number };
  /** MDL-5: the next model call uses this address, key name and model. Throws when the company was given a model of its own (a test's scripted one). */
  reconfigureModel(next: { baseUrl: string; apiKeyEnv?: string; model: string }): void;
  readonly runner: Runner;
  readonly gate: ChannelGate;
  readonly registry: HandlerRegistry;
  readonly loaded: LoadReport;
  /** An origin event: through the gate, then the handlers. Shadow mode logs it and sends output to the review sink only. */
  process(event: CyborgEvent): Promise<ProcessResult>;
  /** The adapter saw a person answer in a chat: settles what was pending there and, in shadow mode, records what they said. */
  personReplied(chat: string, by: string, reply?: { eventId: string; source: string; text: string }): void;
  /** A person takes over: builds the handoff card and posts it to the ops chat (ADM-56). */
  handoff(chat: string, transcript: string, options?: { post?: boolean }): Promise<{ proposal: Proposal | null; card: string | null }>;
  /** A review handed over by a connector or pasted in (ADM-58). */
  review(site: string, text: string, ref?: string): Promise<RunOutcome[]>;
  morningSheet(): string;
  /** ADM-82: the chats that need a person, red first. */
  board(options?: { includeComplete?: boolean }): BoardRow[];
  /** ADM-83: the toast for a board row, in the staff language, with the detail the company chose. */
  toast(row: BoardRow): Toast;
  /** ADM-86: everything the dashboard shows for one chat. */
  chatView(chat: string): Promise<ChatView>;
  /** ADM-91: a person approves or declines a waiting proposal, with a reason tag and a note kept for the next upgrade review (PRF-80). */
  decide(proposalId: string, decision: 'approve' | 'decline', by: string, why?: { reason?: FlagReason; note?: string }): Proposal;
  /** ADM-91: the shadow entries to audit, unmarked first. */
  auditQueue(options?: { onlyUnmarked?: boolean; limit?: number }): AuditRow[];
  /** ADM-91: marks an entry (match, better, worse, different but fine, wrong fact). A wrong-fact mark contradicts the fact and opens a discrepancy (PRF-65). */
  mark(entryId: string, marking: Marking, by: string, options?: { factKeys?: string[] }): ShadowEntry;
  /** ADM-91: counts per handler version, never a single score (PRF-26). */
  auditCounts(): MarkingCounts[];
  /** ADM-96: how often each kind of reply (handler, version, model) has been right, from the markings and the decisions. */
  trackRecords(): TrackRecord[];
  /** ADM-92: every plug-in's items that need a person, red first. */
  attention(): AttentionItem[];
  /** The plug-ins in the order they were added. */
  readonly sources: readonly AttentionSource[];
  /** ADM-92: the toast for any item, with the detail the company chose. */
  attentionToast(item: AttentionItem): AttentionToast;
  /** ADM-92: a person pressed one of an item's buttons. */
  actOnItem(itemKey: string, actionId: string, by: string): void;
  /** ADM-84: a person takes the chat: the bot stops answering in it. */
  takeOver(chat: string, by: string): void;
  /** A person hands the chat back to the bot and the chat is settled. */
  handBack(chat: string, by: string): void;
  usage(days: number): UsageReport;
  close(): void;
}

const SALES_DEFAULT_OFF: string[] = [];

/**
 * CMP-9..14: the operations layer. It wires one company's config to the store, the vault, the gateway, the modules, the
 * runner, the channel gate and the notifiers. It holds no business rule of its own.
 */
export function createCompany(loaded: LoadedConfig, adapters: CompanyAdapters, deps: CompanyDeps = {}): Company {
  const { config } = loaded;
  const now = deps.now ?? (() => new Date());
  const store = new SqliteStore(ensureFolder(loaded.paths.store), { now });
  const vault = new SqliteVault(ensureFolder(loaded.paths.vault), now);

  deps.beforeLoad?.(store);

  const gateway =
    deps.model === undefined
      ? new OpenAIGateway(
          {
            endpoint: {
              baseUrl: config.inference.baseUrl,
              ...(config.inference.apiKeyEnv ? { apiKeyEnv: config.inference.apiKeyEnv } : {}),
              ...(config.inference.timeoutMs ? { timeoutMs: config.inference.timeoutMs } : {}),
              ...(config.inference.providerOptions ? { providerOptions: config.inference.providerOptions } : {}),
              ...(config.inference.reasoning ? { reasoning: config.inference.reasoning } : {}),
            },
            defaultModel: config.inference.model,
            models: modelsFor(config),
          },
          { capabilities: store, ledger: store, ...(deps.fetch ? { fetch: deps.fetch } : {}), ...(deps.env ? { env: deps.env } : {}), now },
        )
      : null;
  const model: ModelPort = deps.model ?? gateway!;

  const definitions: ModuleDefinition[] = [];
  const moduleConfig: Record<string, unknown> = {};
  const enabled: Record<string, { enabledHandlers: string[] }> = {};
  if (config.modules.sales) {
    definitions.push(salesModule);
    moduleConfig['sales'] = config.modules.sales;
  }
  if (config.modules.feedback) definitions.push(feedbackModule);
  if (config.modules.maintenance) {
    definitions.push(maintenanceModule);
    moduleConfig['maintenance'] = config.modules.maintenance;
  }
  if (config.modules.bookings) {
    definitions.push(bookingsModule);
    moduleConfig['bookings'] = config.modules.bookings;
  }
  for (const [moduleId, ids] of Object.entries(config.modules.enabledHandlers ?? {})) enabled[moduleId] = { enabledHandlers: ids };

  const registry = new HandlerRegistry({ autoReplyHandlers: config.modules.sales?.autoReply ?? SALES_DEFAULT_OFF });
  const loadedReport = loadModules(registry, definitions, {
    coreVersion: CORE_VERSION,
    profile: store,
    packs: [],
    capabilities: deps.capabilities ?? store.listCapabilities(),
    connectors: { channel: adapters, contacts: {}, reviews: {} },
    dependencyChecks: Object.fromEntries(['channel', 'contacts', 'reviews'].map((n) => [`connector:${n}`, () => ({ ok: true as const })])),
    moduleConfig,
    config: enabled,
  });

  // Roles from the file are applied once and audited as `config` (ADM-9); later changes are `.role` commands.
  for (const [chat, role] of Object.entries(config.chat.roles)) {
    if (store.getRole(chat) === null) store.setRole(chat, role as 'reply' | 'ops' | 'monitor' | 'ignored', 'config', now().toISOString());
  }

  // ADM-77: read at the moment a sentence is made, so `.lang` takes effect at once. The toggle beats the file; the file defaults to Portuguese.
  const language: LanguageSource = () => store.getLanguage() ?? config.language;
  const stored = new StoreNotifier(store, now, language);
  const notifier: AdminNotifier = adapters.ops ? fanOutNotifier(stored, new OpsChatNotifier(adapters.ops, store, config.chat.originChannel, language)) : stored;
  const ops = adapters.ops ? new OpsChatNotifier(adapters.ops, store, config.chat.originChannel, language) : null;

  const runner = new Runner({
    businessId: config.id,
    registry,
    store,
    ledger: store,
    model,
    vault,
    facts: new ProfileFactProvider(store, new PackRegistry(), { ...(deps.runtimeFacts ?? {}), [PRESENCE_FACT_KEY]: presenceFactSource(store, config.office, config.wording, language) }),
    mode: config.mode,
    lessons: store,
    notifier,
    language,
    ...(config.mode === 'live' ? { live: store } : {}),
    ...(config.limits.maxModelCallsPer24h ? { callCap: { maxPer24h: config.limits.maxModelCallsPer24h }, usage: store } : {}),
    now,
  });

  const lifecycle = new Lifecycle({ store, now });
  const gate = new ChannelGate({
    control: store,
    store,
    config: {
      commandPrefix: config.chat.commandPrefix,
      authorisedSenders: config.chat.authorisedSenders,
      ack: adapters.ack,
      ...(config.chat.originChannel ? { originChannel: config.chat.originChannel } : {}),
      ...(config.chat.handoffResumeHours ? { handoffResumeMs: config.chat.handoffResumeHours * 3_600_000 } : {}),
    },
    notifier,
    language,
    ...(config.office ? { office: config.office as OfficeSchedule } : {}),
    now,
  });

  const controller =
    config.mode === 'shadow'
      ? new ShadowController({ runner, log: store, store, ledger: store, originChannel: config.chat.originChannel ?? '(none)', review: adapters.review, now })
      : null;

  let handoffs = 0;
  // ADM-64: the last lines of each chat, in memory only (the core keeps no chat history). N-17 sets how many, as for flag tickets.
  const lines = new Map<string, string[]>();
  const remember = (chat: string, line: string) => lines.set(chat, [...(lines.get(chat) ?? []), line].slice(-N17_TICKET_MESSAGES));
  const posted = new Set<string>();
  const onDuty = () => officeStatus(store.getPresence(), config.office as OfficeSchedule | undefined, now(), config.wording, language).onDuty;
  const sections = [
    ...(config.modules.sales ? [officeAnswersSection({ proposals: store, vault, control: store }, language)] : []),
    ...(config.modules.feedback ? [complaintsSection(store, language)] : []),
  ];

  const records = () => trackRecords({ log: store, proposals: store, ledger: store }, config.automation.candidate);
  /** ADM-97: puts the record of a row's reply kind on the row, when there is one. */
  const withRecords = (rows: BoardRow[]): BoardRow[] => {
    const all = records();
    return rows.map((row) => {
      if (!row.reply) return row;
      const model = row.reply.modelCallId ? (store.read(row.reply.modelCallId)?.model ?? 'unknown') : 'unknown';
      const r = all.find((x) => x.handlerId === row.reply!.handlerId && x.handlerVersion === row.reply!.handlerVersion && x.model === model);
      return r ? { ...row, record: { right: r.right, considered: r.considered, of: r.of, candidate: r.candidate } } : row;
    });
  };
  const staleAfterMs = config.board.staleAfterHours === undefined ? undefined : config.board.staleAfterHours * 3_600_000;
  const takeOver = (chat: string, by: string) => store.setChatState(chat, 'handoff', by, now().toISOString(), 'taken over from the board');
  const handBack = (chat: string, by: string) => {
    store.setChatState(chat, 'bot', by, now().toISOString(), 'handed back from the board');
    gate.personReplied(chat, by); // settles the chat, ends its waiting period and clears the waiting alert
  };
  const leaveToBot = (chat: string, by: string) => {
    // A chat a person holds goes back; a chat the bot already has is only dismissed, so a waiting reply or office question is never hidden.
    if (store.getChatState(chat) !== 'bot') handBack(chat, by);
    else store.appendAudit({ at: now().toISOString(), proposalId: null, kind: 'board_dismissed', fromStatus: null, toStatus: null, actor: by, detail: { chat } });
  };
  const sources: AttentionSource[] = [
    deskAttention({ board: () => withRecords(buildChatBoard({ proposals: store, index: store, control: store, vault, language, staleAfterMs, now })), language, takeOver, leaveToBot }),
    ...(config.modules.feedback ? [complaintsAttention(store, language)] : []),
    ...(deps.attentionSources ?? []),
  ];

  return {
    defaultLanguage: config.language,
    sources,
    trackRecords: records,
    attention: () => collectAttention(sources),
    attentionToast: (item) => toastForItem(item, config.toast.detail),
    actOnItem(itemKey, actionId, by) {
      const source = sources.find((s) => itemKey.startsWith(`${s.id}:`));
      if (!source?.act) throw new Error(`no plug-in can act on "${itemKey}"`);
      source.act(itemKey, actionId, by);
    },
    store,
    vault,
    housekeeping() {
      const at = now();
      const resumed = gate.resumeDue();
      const purged = purgeExpiredLedger(store, at);
      if (purged > 0) store.appendAudit({ at: at.toISOString(), proposalId: null, kind: 'ledger_purged', fromStatus: null, toStatus: null, actor: 'housekeeping', detail: { rows: purged, retentionDays: N4_LEDGER_RETENTION_DAYS } });
      return { resumed, purged };
    },
    reconfigureModel(next) {
      if (!gateway) throw new Error('this company has a model of its own: nothing to reconfigure');
      gateway.reconfigure(next);
    },
    runner,
    gate,
    registry,
    loaded: loadedReport,
    async process(event) {
      const decision = await gate.admit(event);
      // ADM-81: remember which chat this came from, and the customer's name for staff (identity: kept in the vault, never in a prompt).
      if (decision.kind === 'run' || decision.kind === 'waiting' || decision.kind === 'media_forwarded') {
        const from = String(event.payload['chat'] ?? '');
        if (from) {
          store.linkEvent(event.source, event.id, from, event.at);
          const contact = event.payload['contactName'];
          if (typeof contact === 'string' && contact.trim() !== '') store.setContact(from, vault.put('identity', contact.trim()), event.at);
        }
      }
      if (decision.kind !== 'run') return { ran: false, decision };
      const chat = String(decision.event.payload['chat'] ?? '');
      // CMP-32: the first line of a chat gets the introduction. A restart starts the memory again, which only repeats an introduction.
      const first = (lines.get(chat) ?? []).length === 0;
      remember(chat, `customer: ${String(decision.event.payload['text'] ?? '')}`);
      // DSK-79..82: this chat's card (what the customer has told us here, and what is still missing) goes in front of the code-computed facts, so the writer does not re-ask.
      const sales = config.modules.sales;
      const cardOn = Boolean(sales?.conversationContext) && chat !== '';
      const cardText = cardOn ? renderChatCard(readChatCard(store, chat, now(), sales?.chatCardIdleHours), sales!.enquiryFields) : '';
      const computed = typeof decision.event.payload['conversation'] === 'string' ? (decision.event.payload['conversation'] as string) : '';
      // DSK-8: the stage is set by code from the chat's state, never by the model: the first line greets, then the chat qualifies until every field is told, then it offers.
      const stage = !cardOn ? '' : first ? 'greet' : sales!.enquiryFields.some((f) => !readChatCard(store, chat, now(), sales?.chatCardIdleHours).fields[f.name]) ? 'qualify' : 'offer';
      const payload = { ...decision.event.payload, first, ...(cardOn ? { conversation: [cardText, computed].filter((x) => x !== '').join('\n'), stage } : {}) };
      const withFirst = { ...decision.event, payload };
      const outcomes = controller ? await controller.observe(withFirst) : await runner.handle(withFirst);
      // The extraction of this message (validated: every value has a source phrase in the message) goes into the chat's card for the next one.
      if (cardOn) {
        for (const o of outcomes) {
          if (o.outcome === 'proposal' && o.handlerId === 'sales.enquiry.intake') mergeIntoChatCard(store, chat, o.proposal.changes, sales!.enquiryFields.map((f) => f.name), now(), sales?.chatCardIdleHours);
        }
      }
      // ADM-110: personal data in the customer's message stopped the model (PRV-6), so the chat goes to a person and staff are pinged.
      if (chat && outcomes.some((o) => o.outcome === 'proposal' && o.proposal.reason === 'manual_handling: scrubber hit')) await gate.handOff(chat, 'scrubber hit');
      // ADM-64: nobody is assumed at the office, so the bot gathers what it can and puts it on a card in the office chat.
      // The ops chat gets the first card of a closed period for each chat; later messages refresh the stored card, which the morning sheet shows, without another message (ADM-64).
      let card: string | null = null;
      if (config.office?.cardsOutsideHours !== false && config.office && !onDuty()) {
        const closure = `${chat}|${nextOfficeChange(config.office as OfficeSchedule, now())?.toISOString() ?? store.getPresence()?.since ?? ''}`;
        const first = !posted.has(closure);
        posted.add(closure);
        card = (await this.handoff(chat, (lines.get(chat) ?? []).join('\n'), { post: first })).card;
      }
      return { ran: true, decision, outcomes, card };
    },
    forgetChat(chat, by) {
      const r = store.forgetChat(chat, by, now().toISOString());
      const nameRemoved = r.contactCode !== null && !store.contactCodeInUse(r.contactCode, chat) ? vault.remove(r.contactCode) : false;
      lines.delete(chat);
      for (const closure of [...posted]) if (closure.startsWith(`${chat}|`)) posted.delete(closure);
      return { entries: r.entries, links: r.links, states: r.states, nameRemoved };
    },
    personReplied(chat, by, reply) {
      if (reply) remember(chat, `staff: ${reply.text}`);
      gate.personReplied(chat, by);
      if (controller && reply) controller.recordHuman(reply.source, reply.eventId, { reply: reply.text });
    },
    async handoff(chat, transcript, options = {}) {
      handoffs += 1;
      const event: CyborgEvent = {
        id: `handoff-${chat}-${now().toISOString()}-${handoffs}`,
        source: 'company',
        kind: 'handoff.requested',
        at: now().toISOString(),
        payload: { chat, transcript },
      };
      store.linkEvent(event.source, event.id, chat, event.at);
      const outcome = (await runner.handle(event)).find((o) => o.handlerId === 'sales.handoff.card');
      if (!outcome || outcome.outcome !== 'proposal' || outcome.proposal.status !== 'proposed') return { proposal: outcome?.outcome === 'proposal' ? outcome.proposal : null, card: null };
      const card = renderHandoffCard(outcome.proposal, { chat, language });
      if (options.post !== false) await ops?.card(chat, card);
      return { proposal: outcome.proposal, card };
    },
    async review(site, text, ref) {
      const { reviewEvent } = await import('@cyborg/module-feedback');
      return runner.handle(reviewEvent({ site, text, at: now().toISOString(), ...(ref ? { ref } : {}) }));
    },
    morningSheet() {
      return renderMorningSheet({ sections, control: store, now, language });
    },
    decide(proposalId, decision, by, why) {
      return lifecycle.decide(proposalId, decision, by, why);
    },
    auditQueue(options = {}) {
      const entries = store.listEntries().filter((e) => !options.onlyUnmarked || e.marking === null);
      entries.sort((a, b) => Number(a.marking !== null) - Number(b.marking !== null) || b.createdAt.localeCompare(a.createdAt));
      return entries.slice(0, options.limit ?? 200).map((e) => {
        const chat = store.chatOfEvent(e.eventSource, e.eventId);
        const code = chat ? store.getContact(chat) : null;
        const full = code ? vault.get(code)?.value ?? null : null;
        const text = e.input['text'];
        return {
          id: e.id, createdAt: e.createdAt, chat, name: full ? (full.trim().split(/\s+/)[0] ?? null) : null,
          handlerId: e.handlerId, handlerVersion: e.handlerVersion,
          customerText: typeof text === 'string' ? text : null,
          draft: e.draft, band: e.proposalId ? (store.get(e.proposalId)?.confidence?.band ?? null) : null,
          humanReply: e.humanReply, humanAction: e.humanAction, marking: e.marking,
          factKeys: e.factsUsed.filter((f) => f.kind === 'profile' && !f.runtime).map((f) => f.key),
        };
      });
    },
    mark(entryId, marking, by, options) {
      return markEntry({ log: store, profile: store, proposals: store, now }, entryId, marking, by, options);
    },
    auditCounts() {
      return store.markingCounts();
    },
    async chatView(chat) {
      const row = buildChatBoard({ proposals: store, index: store, control: store, vault, language, staleAfterMs, now }, { includeComplete: true }).find((r) => r.chat === chat);
      const mine = proposalsOfChat({ proposals: store, index: store }, chat);
      const card = [...mine].filter((p) => p.handlerId === 'sales.handoff.card' && p.status !== 'invalid_output').sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
      const history = adapters.history
        ? await adapters.history(chat, N17_TICKET_MESSAGES)
        : (lines.get(chat) ?? []).map((l) => ({ from: (l.startsWith('staff: ') ? 'staff' : 'customer') as 'customer' | 'staff', text: l.replace(/^(customer|staff): /, '') }));
      return {
        chat,
        name: row?.name ?? null,
        state: store.getChatState(chat),
        colour: row?.colour ?? 'none',
        reasons: row?.reasons ?? [],
        card: card ? renderHandoffCard(card, { chat, language }) : null,
        pending: mine
          .filter((p) => p.status === 'proposed' && p.handlerId !== 'sales.handoff.card')
          .map((p) => ({ id: p.id, handler: p.handlerId, draft: p.draft ?? null, band: p.confidence?.band ?? null, status: p.status, createdAt: p.createdAt })),
        history,
      };
    },
    board(options) {
      return withRecords(buildChatBoard({ proposals: store, index: store, control: store, vault, language, staleAfterMs, now }, options));
    },
    toast(row) {
      return toastFor(row, { detail: config.toast.detail, language });
    },
    takeOver,
    handBack,
    usage(days) {
      const until = now();
      const since = new Date(until.getTime() - days * 86_400_000).toISOString();
      const cap = config.limits.maxModelCallsPer24h;
      return buildUsageReport(store.usageRows(since), {
        since,
        until: until.toISOString(),
        ...(config.prices ? { prices: config.prices } : {}),
        ...(cap ? { cap: { maxPer24h: cap, usedLast24h: store.countModelCalls(new Date(until.getTime() - 86_400_000).toISOString()) } } : {}),
      });
    },
    close() {
      store.close();
      vault.close();
    },
  };
}

/**
 * CMP-3: the model a handler uses when the file names one for it. Every other handler of every loaded module gets
 * `inference.model` through the gateway's `defaultModel`, so no list of handler ids lives here (audit F-7).
 */
export function modelsFor(config: LoadedConfig['config']): Record<string, string> {
  return Object.fromEntries(Object.entries(config.inference.handlers ?? {}).map(([id, h]) => [id, h.model]));
}

/** Every distinct model this install calls: the default and each per-handler one. */
export function modelsInUse(config: LoadedConfig['config']): string[] {
  return [...new Set([config.inference.model, ...Object.values(modelsFor(config))])];
}
