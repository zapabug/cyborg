import { dirname, resolve } from 'node:path';
import type { CyborgEvent, OutboundMessage, OutboundSink } from '@cyborg/core';
import type { LoadedConfig } from './config.ts';
import { withBookings } from './bookings.ts';
import { withDeskCommands } from './desk-commands.ts';
import { createCompany, testCapabilities, type Company, type CompanyDeps, type ProcessResult } from './runtime.ts';
import { seedProfile, type CompanyModelFile, type Script, type Step } from './simulate.ts';

// feat-wazaa-port WZP-10..19: the test chat. Someone types as a customer (or as the office) and the company answers through the same gate,
// handlers and checks as a real chat. The channel is the page: nothing is sent anywhere, and the only thing that leaves the process is
// the model calls the handlers make (WZP-15). It runs on a store and a vault of its own, never the install's.

/** The sender reference the test chat gives itself for owner commands (`.stop`, `.ooo`, ...). It exists only in the test chat's own copy of the config. */
export const TEST_OWNER = 'test-owner';
/** The test chat's office chat: what the page's office box types into. */
const TEST_OPS = 'test-ops';
/** WZP-4: the one origin the test chat's shadow guard knows, so a reply cannot be sent to a real channel. */
const TEST_ORIGIN = 'test-chat';
const SOURCE = 'test-chat';

export interface TestReply {
  /** The handler's short name, e.g. `reply_draft`. */
  handler: string;
  version: string;
  status: string;
  /** The text a customer would be shown if a person approved it; never sent from here. */
  draft: string | null;
  band: string | null;
  /** What the code checks said about the draft (WZP-12): findings that blocked it or that a person should read. */
  checks: string[];
  questions: string[];
  /** The profile facts the draft used, with their status; add-on facts are left out. */
  facts: { key: string; state: string; unconfirmed: boolean }[];
  reason: string | null;
}

export type TestTurnKind = 'reply' | 'command' | 'ignored' | 'stored' | 'waiting' | 'media' | 'new' | 'help';

export interface TestTurn {
  /** The test chat the line was typed in, as the page named it. */
  chat: string;
  kind: TestTurnKind;
  /** The command's acknowledgement, or why the gate did not run the handlers. */
  note: string | null;
  replies: TestReply[];
  /** What the company would have posted to the office (cards, alerts, acknowledgements), in order. */
  office: string[];
  /** A card built because the office was closed (ADM-64). */
  card: string | null;
  /** A refusal, an invalid output or a blocked draft, said plainly so a failure is not mistaken for a pass. */
  problems: string[];
  /** The reply was blocked and a person has to answer: the page offers to build the office card. */
  needsOffice: boolean;
  /** PRV-6: what the scrubber replaced in the line before the model saw it, in words, or null when nothing was. */
  replaced: string | null;
}

export interface TestChatOptions {
  /** CMP-18: the drafted company model, seeded as unconfirmed client statements (live mode refuses them, PRF-5). */
  company?: CompanyModelFile;
  /** WZP-16: set when the facts are a demo's; the page says so in its header. */
  demo?: string | null;
  /** Where the test chat keeps its store and vault. Default: beside the install's, under other names (WZP-15). */
  paths?: { store: string; vault: string };
  deps?: Omit<CompanyDeps, 'now' | 'beforeLoad'>;
  now?: () => Date;
}

export interface TestChat {
  /** The company the test chat runs on, so a dashboard can show its board, audit and sheet. */
  readonly company: Company;
  readonly demo: string | null;
  readonly commandPrefix: string;
  /** WZP-10: a line typed as a customer in a test chat. A line starting with the command prefix is an owner command (WZP-14). */
  customer(chat: string, text: string): Promise<TestTurn>;
  /** WZP-13: a line typed as the office. The command prefix is optional here. */
  office(text: string): Promise<TestTurn>;
  /** WZP-19: what was typed so far as a simulation script (docs/12), customer lines and commands in order, so the same chat can be replayed with `pnpm simulate`. */
  script(): Script;
  /** The office card for a test chat, built from what was typed in it; posted nowhere. */
  handoff(chat: string): Promise<{ card: string | null; note: string | null }>;
  /**
   * feat-desk DSK-75: the person says the bot's latest reply in this chat was right (marked `match`) or wrong (marked `worse`, with the correct answer, which is
   * saved beside the reply as the office's own, scrubbed). The same kind of entry the office's real answers make, so the counts are one record (DSK-76).
   */
  verdict(chat: string, verdict: 'right' | 'wrong' | 'undo', answer?: string): { marking: 'match' | 'worse' | null; entryId: string };
  close(): void;
}

/** WZP-15: the test chat's files are the install's names with `testchat-` in front, so the two can never be the same. */
export function testChatPaths(loaded: LoadedConfig): { store: string; vault: string } {
  const beside = (path: string, name: string) => (path === ':memory:' ? path : resolve(dirname(path), `testchat-${name}`));
  return { store: beside(loaded.paths.store, 'store.sqlite'), vault: beside(loaded.paths.vault, 'vault.sqlite') };
}

function capture(channel: string, log: string[]): OutboundSink {
  return { channel, send: async (message: OutboundMessage) => void log.push(message.text) };
}

const SAFE = /[^A-Za-z0-9_-]/g;

const WORDS = {
  pt: {
    fresh: 'Conversa nova: o bot esquece o que foi dito nesta.',
    help: (p: string) => `Comandos (escreva com ${p} à frente): ${p}stop, ${p}pause, ${p}start, ${p}restart e ${p}done (valem para esta conversa se não indicar outra), ${p}ooo e ${p}back, ${p}lang pt|en, ${p}new (conversa nova), ${p}guardar, ${p}erro, ${p}ideia, ${p}estado, ${p}perguntas, ${p}responder <n> <texto>, ${p}aprender <n> <texto>, ${p}ajuda.`,
    waiting: 'Uma pessoa tem esta conversa: o bot fica em silêncio até lha devolverem.',
    media: 'Não é texto: o bot não lê imagens nem ficheiros; iria para o escritório.',
    nothing: 'Nenhuma resposta: nenhum passo do bot tinha algo a fazer com esta linha.',
    noCard: 'Sem cartão: o passo não deu nada.',
    replaced: (what: string) => `Trocado antes do modelo: ${what}. O modelo viu marcas como [PHONE_1] no lugar; os dados originais ficam na conversa.`,
    held: (what: string) => `Retido antes do modelo: a linha tem ${what}. Nada foi enviado ao serviço de IA e uma pessoa responde a esta. (Escreva .new para uma conversa nova.)`,
    scrubbed: { email: 'um email', phone: 'um número de telefone', nif_or_phone: 'um número de telefone ou de contribuinte', long_number: 'um número longo', iban: 'um número de conta (IBAN)', id_number: 'um número de documento' } as Record<string, string>,
    notLoaded: (what: string) => `Nenhuma resposta: o bot ainda não tem este passo, porque falta: ${what}. Preencha na aba Negócio.`,
    aiService: 'um serviço de IA a funcionar',
    facts: 'dados do negócio',
    kinds: { offer: 'o que vende e quando', rules: 'as regras do negócio', tone: 'o tom de conversa', faq: 'as perguntas frequentes' } as Record<string, string>,
  },
  en: {
    fresh: 'New chat: the bot forgets what was said in this one.',
    help: (p: string) => `Commands (type them with ${p} in front): ${p}stop, ${p}pause, ${p}start, ${p}restart and ${p}done (they act on this chat unless you name another), ${p}ooo and ${p}back, ${p}lang pt|en, ${p}new (a fresh chat), ${p}save, ${p}bug, ${p}idea, ${p}status, ${p}questions, ${p}answer <n> <text>, ${p}learn <n> <text>, ${p}help.`,
    waiting: 'A person has this chat: the bot stays quiet until it is handed back.',
    media: 'Not text: the bot does not read images or files; it would go to the office.',
    nothing: 'No reply: no step of the bot had anything to do with this line.',
    noCard: 'No card: the step gave nothing.',
    replaced: (what: string) => `Replaced before the model: ${what}. The model saw placeholders such as [PHONE_1] instead; the original stays in the chat.`,
    held: (what: string) => `Held back before the model: the line has ${what}. Nothing went to the AI service and a person answers this one. (Type .new for a fresh chat.)`,
    scrubbed: { email: 'an email address', phone: 'a phone number', nif_or_phone: 'a phone or tax number', long_number: 'a long number', iban: 'a bank account number (IBAN)', id_number: 'an ID number' } as Record<string, string>,
    notLoaded: (what: string) => `No reply: the bot does not have this step yet, because something is missing: ${what}. Fill it in on the Business tab.`,
    aiService: 'a working AI service',
    facts: 'facts about the business',
    kinds: { offer: 'what you sell and when', rules: 'the business rules', tone: 'how you talk', faq: 'the common questions' } as Record<string, string>,
  },
} as const;

/**
 * Builds a test chat for one company. The company's own config is copied: the same model, persona, wording and modules as the install
 * (WZP-18), but always in shadow, with no chat roles of the install's and with the test chat's own store and vault.
 */
export function createTestChat(loaded: LoadedConfig, options: TestChatOptions = {}): TestChat {
  const now = options.now ?? (() => new Date());
  const paths = options.paths ?? testChatPaths(loaded);
  if (paths.store !== ':memory:' && (paths.store === loaded.paths.store || paths.vault === loaded.paths.vault)) {
    throw new Error('the test chat must not use the install\'s store or vault (WZP-15)');
  }
  const config = structuredClone(loaded.config);
  config.mode = 'shadow';
  config.chat = { ...config.chat, originChannel: TEST_ORIGIN, authorisedSenders: [...new Set([...config.chat.authorisedSenders, TEST_OWNER])], roles: { [TEST_OPS]: 'ops' } };
  const prefix = config.chat.commandPrefix;

  const ops: string[] = [];
  const ack = capture('test-ack', ops);
  const base = createCompany(
    { ...loaded, config, paths },
    { ack, review: capture('test-review', []), ops: capture('test-ops', ops) },
    { ...(options.deps ?? {}), now, beforeLoad: (store) => { if (options.company) seedProfile(store, options.company, now().toISOString()); } },
  );
  // WZP-48: save, bug, idea, status, questions, answer, learn and help work in a test chat as in a real one.
  const desk = withDeskCommands(base, { commandPrefix: prefix, authorisedSenders: config.chat.authorisedSenders, ack, ...(config.modules.bookings ? { bookings: { config: config.modules.bookings, ...(config.office?.timezone ? { timezone: config.office.timezone } : {}), now } } : {}) });
  // WZP-50..55: the booking step, when the company has the booking module on.
  const company = config.modules.bookings ? withBookings(desk, { config: config.modules.bookings, commandPrefix: prefix, ...(config.office?.timezone ? { timezone: config.office.timezone } : {}), now }) : desk;

  const startedAt = now().toISOString();
  const steps: Step[] = [];
  const generation = new Map<string, number>();
  const lines = new Map<string, string[]>();
  let counter = 0;
  // The store outlives the process and the runner marks each (source, event, handler) as done, so an id that restarted at 1 would make every
  // line of a later session a duplicate of an earlier one's. The start time keeps the ids apart.
  const session = now().getTime().toString(36);
  const language = () => company.store.getLanguage() ?? company.defaultLanguage;
  const say = () => WORDS[language()];
  /** One test chat is a chat id plus a generation: `.new` moves to the next generation, so the bot starts without what it saw. */
  const internal = (chat: string) => {
    const key = chat.replace(SAFE, '').slice(0, 60);
    if (key === '') throw new Error('a test chat needs a name');
    if (!generation.has(key)) generation.set(key, 0);
    return { key, id: `test-${key}-${generation.get(key)}` };
  };
  const ensureRole = (id: string) => { if (company.store.getRole(id) === null) company.store.setRole(id, 'reply', 'test-chat', now().toISOString()); };
  /** The company knows a test chat by its generation's id; the person typing knows it by the name the page gave it (DSH-7: no internal names). */
  const visible = (text: string): string => [...generation.keys()].reduce((t, key) => t.replace(new RegExp(`test-${key}-\\d+`, 'g'), key), text);
  const take = () => ops.splice(0, ops.length).map(visible);

  const empty = (chat: string, kind: TestTurnKind, note: string | null): TestTurn => ({ chat, kind, note: note === null ? null : visible(note), replies: [], office: take(), card: null, problems: [], needsOffice: false, replaced: null });

  function describe(chat: string, event: CyborgEvent, result: ProcessResult): TestTurn {
    if (!result.ran) {
      const d = result.decision;
      if (d.kind === 'command') return empty(chat, 'command', d.ack);
      if (d.kind === 'waiting') return empty(chat, 'waiting', say().waiting);
      if (d.kind === 'media_forwarded') return empty(chat, 'media', say().media);
      return empty(chat, d.kind === 'store_only' ? 'stored' : 'ignored', d.reason);
    }
    const entries = company.store.listEntries().filter((e) => e.eventSource === SOURCE && e.eventId === event.id);
    const replies: TestReply[] = [];
    const problems: string[] = [];
    let needsOffice = false;
    // PRV-6: the test chat runs the same scrubber as a real chat. A line with a number or an address stops before the model; say so in words, once.
    const scrubbed = new Set<string>();
    for (const o of result.outcomes) {
      const name = o.handlerId.replace(/^[a-z]+\.[a-z]+\./, '');
      if (o.outcome === 'refused') { problems.push(`${name}: refused: ${o.reason}`); continue; }
      if (o.outcome !== 'proposal') continue;
      const p = o.proposal;
      if (p.reason === 'manual_handling: scrubber hit') {
        for (const f of p.findings) for (const rule of /rule\(s\) ([a-z_, ]+);/.exec(f.statement)?.[1]?.split(', ') ?? []) scrubbed.add(rule);
        needsOffice = true;
        continue;
      }
      const entry = entries.find((e) => e.handlerId === o.handlerId);
      const checks = p.findings.map((f) => f.statement);
      if (p.status === 'invalid_output') problems.push(`${name}: invalid output: ${p.reason ?? ''}`);
      const blocked = o.handlerId.endsWith('reply_draft') && p.draft == null && p.questions.length > 0;
      if (blocked) { problems.push(`${name}: reply blocked: ${checks.map((c) => c.replace(/^the drafted reply was blocked: /, '')).join('; ') || (p.reason ?? 'a person must answer')}`); needsOffice = true; }
      replies.push({
        handler: name, version: p.handlerVersion, status: p.status, draft: p.draft ?? null, band: p.confidence?.band ?? null, checks, questions: p.questions,
        facts: (entry?.factsUsed ?? []).filter((f) => !f.runtime).map((f) => ({ key: f.key, state: f.state, unconfirmed: f.unconfirmed === true })),
        reason: p.reason,
      });
    }
    if (scrubbed.size > 0) problems.push(say().held([...new Set([...scrubbed].map((r) => say().scrubbed[r] ?? r))].join(', ')));
    // PRV-6: what the scrubber swapped for placeholders in this line, from the audit rows the runner wrote.
    const swapped = new Set<string>();
    for (const row of company.store.listAudit()) {
      const d = row.detail as { eventId?: string; fields?: { rule: string }[] } | null;
      if (row.kind === 'scrub_replaced' && d?.eventId === event.id) for (const f of d.fields ?? []) swapped.add(say().scrubbed[f.rule] ?? f.rule);
    }
    // A module that did not load (a fact or a tested endpoint missing, MOD-1) is the usual reason nothing ran: say that, not "nothing to do".
    const missing = [...new Set(company.loaded.refused.flatMap((r) => r.unmet.map((u) => (u.kind === 'capability' ? say().aiService : u.kind === 'profile_key' ? (say().kinds[u.item.split('.')[0]!] ?? say().facts) : say().facts))))];
    const none = replies.length === 0 && problems.length === 0;
    return { chat, kind: 'reply', note: none ? (missing.length > 0 ? say().notLoaded(missing.join(', ')) : say().nothing) : null, replies, office: take(), card: result.card === null ? null : visible(result.card), problems: problems.map(visible), needsOffice, replaced: swapped.size > 0 ? say().replaced([...swapped].join(', ')) : null };
  }

  const event = (chat: string, sender: string, text: string): CyborgEvent => ({
    id: `test-${session}-${++counter}`, source: SOURCE, kind: 'message.received', at: now().toISOString(),
    payload: { chat, isGroup: false, addressed: true, sender, text },
  });

  /** WZP-14: owner commands in a test chat. `new` and `help` are the test chat's own; the gate's commands act on this chat when none is named. */
  async function command(chat: string, key: string, id: string, text: string): Promise<TestTurn> {
    const [word = '', ...args] = text.slice(prefix.length).trim().split(/\s+/);
    const w = word.toLowerCase();
    if (w === 'new') { generation.set(key, (generation.get(key) ?? 0) + 1); lines.delete(id); return empty(chat, 'new', say().fresh); }
    if (w === 'help') return empty(chat, 'help', say().help(prefix));
    const acts = ['stop', 'pause', 'start', 'restart', 'done'];
    const named = args[0] === undefined ? id : generation.has(args[0]) ? internal(args[0]).id : args[0];
    const line = `${prefix}${[w, ...(acts.includes(w) ? [named, ...args.slice(1)] : args)].join(' ')}`;
    steps.push({ do: 'admin', text: `${prefix}${[w, ...(acts.includes(w) ? [args[0] ?? key, ...args.slice(1)] : args)].join(' ')}` });
    ensureRole(id);
    const e = event(id, TEST_OWNER, line);
    return describe(chat, e, await company.process(e));
  }

  return {
    company,
    demo: options.demo ?? null,
    commandPrefix: prefix,
    async customer(chat, raw) {
      const text = raw.trim();
      if (text === '') throw new Error('empty text');
      const { key, id } = internal(chat);
      if (text.startsWith(prefix)) return command(chat, key, id, text);
      ensureRole(id);
      const e = event(id, `${id}-customer`, text);
      lines.set(id, [...(lines.get(id) ?? []), `customer: ${text}`]);
      steps.push({ do: 'customer', chat: key, text });
      return describe(chat, e, await company.process(e));
    },
    async office(raw) {
      const text = raw.trim();
      if (text === '') throw new Error('empty text');
      const line = text.startsWith(prefix) ? text : `${prefix}${text}`;
      const [word = '', ...args] = line.slice(prefix.length).trim().split(/\s+/);
      // The page names a chat by the name it gave it; the company knows it by the generation's id.
      const fixed = args.map((a) => (generation.has(a) ? internal(a).id : a));
      steps.push({ do: 'admin', text: `${prefix}${[word, ...args].join(' ')}` });
      const e = event(TEST_OPS, TEST_OWNER, `${prefix}${[word, ...fixed].join(' ')}`);
      return describe('office', e, await company.process(e));
    },
    verdict(chat, verdict, answer) {
      const { id } = internal(chat);
      const last = company.store.listEntries()
        .filter((e) => e.handlerId === 'sales.enquiry.reply_draft' && company.store.chatOfEvent(e.eventSource, e.eventId) === id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (!last) throw new Error('the bot has not replied in this chat yet');
      // ADM-114: a person can change a mark. Undo clears it (and the answer a Wrong saved) so the reply can be marked again.
      if (verdict === 'undo') {
        if (last.marking === null) throw new Error('that reply has no mark to change');
        company.store.unmarkEntry(last.id, last.marking === 'worse' && last.markedBy === 'test', 'test', new Date().toISOString());
        return { marking: null, entryId: last.id };
      }
      if (last.marking !== null) throw new Error('that reply has already been marked; change the mark first');
      if (verdict === 'wrong') {
        const text = (answer ?? '').trim();
        if (text === '') throw new Error('write the correct answer first');
        if (text.length > 1000) throw new Error('an answer is at most 1000 characters');
        company.personReplied(id, TEST_OWNER, { eventId: last.eventId, source: last.eventSource, text });
      }
      const marking = verdict === 'right' ? 'match' : 'worse';
      company.mark(last.id, marking, 'test');
      return { marking, entryId: last.id };
    },
    script: () => ({ start: startedAt, steps: structuredClone(steps) }),
    async handoff(chat) {
      const { id } = internal(chat);
      const { card } = await company.handoff(id, (lines.get(id) ?? []).join('\n'), { post: false });
      return { card: card === null ? null : visible(card), note: card ? null : say().noCard };
    },
    close: () => company.close(),
  };
}

/**
 * Opens a test chat that can run: a module whose handlers need an untested endpoint is refused at load (MOD-8), and the test chat's store is its
 * own, so the endpoint is tested into it once (a few real calls) when the modules are refused.
 */
export async function openTestChat(loaded: LoadedConfig, options: TestChatOptions = {}, log: (line: string) => void = () => undefined): Promise<TestChat> {
  let chat = createTestChat(loaded, options);
  if (chat.company.loaded.refused.length > 0 && options.deps?.model === undefined) {
    chat.close();
    log('Testing the model endpoint once (a few real calls) so the test chat can use it...');
    const results = await testCapabilities({ ...loaded, paths: options.paths ?? testChatPaths(loaded) });
    log(results.map((r) => `  ${r.model}: ${r.level}`).join('\n'));
    chat = createTestChat(loaded, options);
  }
  return chat;
}
