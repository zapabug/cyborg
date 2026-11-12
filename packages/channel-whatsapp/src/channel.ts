import { createHmac, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import wweb from 'whatsapp-web.js';
import type { Message } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { ReplyScheduler } from '@cyborg/core';
import type { ChatRole, CyborgEvent, OutboundSink } from '@cyborg/core';
import type { Company, CompanyAdapters } from '@cyborg/company';
import type { ChatDirectory, DirectoryChat, DirectoryChoice, DirectoryListing } from '@cyborg/dashboard';
import type { Agreement } from './agreement.ts';

// docs/10 ADM-102..109. The WhatsApp transport for a business (the framework's own, moved here from the first test business's repository on 2026-11-06): the pattern of wazaa's whatsapp/client.ts (read, not imported),
// cut down to the adapter shape. The core never sees a number or a JID; the thinking is the gate and the handlers.

const { Client, LocalAuth } = wweb;

/** ADM-111: the encoder qrcode-terminal draws with, so the dashboard can draw the same code with no new dependency. */
const require = createRequire(import.meta.url);
const QREncoder = require('qrcode-terminal/vendor/QRCode') as new (type: number, level: number) => { addData(s: string): void; make(): void; getModuleCount(): number; isDark(r: number, c: number): boolean };
const QR_LEVEL_L = (require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel') as { L: number }).L;

/** The code as rows of `0`/`1` modules, `1` dark (ADM-111). */
export function qrRows(text: string): string[] {
  const q = new QREncoder(-1, QR_LEVEL_L);
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => (q.isDark(r, c) ? '1' : '0')).join(''));
}

/** ADM-111: what the dashboard shows while the channel is being linked. */
export interface LinkView {
  channel: string;
  state: 'starting' | 'waiting' | 'linking' | 'linked' | 'error';
  qr?: string[];
  account?: string;
  hint?: { pt?: string; en?: string };
}

/** ADM-103: authenticated but not ready after this long restarts the client (wazaa docs/08). */
const READY_TIMEOUT_MS = 120_000;
const MAX_RESTARTS = 3;
const STUCK_RETRY_MS = 10 * 60_000;
/** ADM-107: how long the adapter remembers its own sends, because WhatsApp reports one send under two id forms. */
const OWN_SEND_MEMORY_MS = 120_000;

export interface ChannelFile {
  /** Digits (with country code) of the linked account; checked against the account at start. */
  ownNumber: string;
  replyChats: string[];
  monitorChats: string[];
  opsChat?: string;
  /** "self" is the account's own "message yourself" chat. */
  reviewChat: string;
  /** Numbers or "self". */
  authorisedSenders: string[];
  replyDelayMs?: number;
  pairNumber?: string;
  /** WZP-34: the intake tasks done in a chat, by the chat's key. Written by the picker; nothing here makes the bot do or skip anything. */
  chatTasks?: Record<string, string[]>;
  /** Where the session, salt and logs live. Relative to the file. */
  dataDir: string;
}

const strings = (v: unknown, name: string): string[] => {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || x.trim() === '')) throw new Error(`whatsapp.json: ${name} must be a list of text`);
  return v.map((x: string) => x.trim());
};

/** Groups keep their JID; a person is the digits of the number. */
export function chatKey(idOrNumber: string): string {
  const s = idOrNumber.trim();
  if (/@g\.us$/.test(s)) return s;
  return s.replace(/@.*$/, '').replace(/[^0-9]/g, '');
}

/** ADM-103 link-only: no channel file, so any account may link and no chat is watched. `ownNumber` is learnt at link time. */
export function linkOnlyFile(root: string): ChannelFile {
  return { ownNumber: '', replyChats: [], monitorChats: [], reviewChat: 'self', authorisedSenders: [], dataDir: resolve(root, 'data/whatsapp') };
}

export function loadChannelFile(file: string): ChannelFile {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`${file}: cannot read it (${e instanceof Error ? e.message : String(e)}). Copy whatsapp.example.json to whatsapp.json and fill it in.`);
  }
  if (JSON.stringify(raw).includes('<fill in')) throw new Error(`${file}: still has "<fill in" in it`);
  const ownNumber = chatKey(String(raw['ownNumber'] ?? ''));
  if (ownNumber === '') throw new Error('whatsapp.json: ownNumber is the digits of the linked account, with country code');
  const reviewChat = String(raw['reviewChat'] ?? 'self').trim();
  const replyChats = strings(raw['replyChats'], 'replyChats');
  const monitorChats = strings(raw['monitorChats'], 'monitorChats');
  const opsChat = typeof raw['opsChat'] === 'string' && raw['opsChat'].trim() !== '' ? raw['opsChat'].trim() : undefined;
  if (replyChats.length === 0 && monitorChats.length === 0 && !opsChat) throw new Error('whatsapp.json: no chat is watched (replyChats, monitorChats and opsChat are all empty), so the bot would look at no chat');
  const keyOf = (v: string) => (v === 'self' ? ownNumber : chatKey(v));
  const admin = new Set([keyOf(reviewChat), ...(opsChat ? [keyOf(opsChat)] : [])]);
  for (const c of replyChats) if (admin.has(keyOf(c))) throw new Error(`whatsapp.json: ${c} is both a customer chat and the review or ops chat; a draft would go to the customer's chat (ADM-8)`);
  const chatTasks: Record<string, string[]> = {};
  const rawTasks = raw['chatTasks'];
  if (rawTasks !== undefined) {
    if (typeof rawTasks !== 'object' || rawTasks === null || Array.isArray(rawTasks)) throw new Error('whatsapp.json: chatTasks must map a chat to a list of task names');
    for (const [chat, list] of Object.entries(rawTasks as Record<string, unknown>)) chatTasks[chatKey(chat)] = strings(list, `chatTasks.${chat}`);
  }
  const delay = raw['replyDelayMs'];
  if (delay !== undefined && (typeof delay !== 'number' || !Number.isFinite(delay) || delay < 0)) throw new Error('whatsapp.json: replyDelayMs must be a number of milliseconds');
  return {
    ownNumber,
    replyChats,
    monitorChats,
    ...(opsChat ? { opsChat } : {}),
    reviewChat,
    ...(Object.keys(chatTasks).length > 0 ? { chatTasks } : {}),
    authorisedSenders: strings(raw['authorisedSenders'], 'authorisedSenders'),
    ...(typeof delay === 'number' ? { replyDelayMs: delay } : {}),
    ...(typeof raw['pairNumber'] === 'string' && raw['pairNumber'] !== '' ? { pairNumber: chatKey(raw['pairNumber']) } : {}),
    dataDir: resolve(dirname(file), typeof raw['dataDir'] === 'string' ? raw['dataDir'] : './data/whatsapp'),
  };
}

/** ADM-104: the reference the core sees. Owner-only salt, so a number cannot be turned into a reference by anyone else. */
export function loadSalt(dir: string): string {
  const file = resolve(dir, 'wa-salt');
  mkdirSync(dir, { recursive: true });
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const salt = randomBytes(32).toString('hex');
  writeFileSync(file, `${salt}\n`, { mode: 0o600 });
  return salt;
}

export const chatRef = (salt: string, key: string): string => `wa-${createHmac('sha256', salt).update(key).digest('hex').slice(0, 12)}`;

/** Every address WhatsApp puts inside a message id: `<fromMe>_<chat>_<hash>[_<group sender>]`. */
const ID_ADDRESS = /[^\s_@]+@(?:c\.us|lid|g\.us|s\.whatsapp\.net|broadcast|newsletter)/g;
/** ADM-106: what must never be left in a scrubbed id. */
const NUMBER_LIKE = /@|\d{7,}/;

/**
 * ADM-106 (the Letter Scrubber approach): the message id with each address swapped for the reference that address gets
 * under ADM-104, so the same chat always gives the same reference and the from-me flag and message hash are kept.
 * `known` maps an address the adapter has already resolved (an `@lid` looked up to its number) to its reference.
 * Anything number-like left over and the whole id is hashed instead.
 */
export function scrubId(salt: string, id: string, known: ReadonlyMap<string, string> = new Map()): string {
  // The fence checks only what is kept from WhatsApp's id: a reference is hex and can hold a run of digits by chance.
  if (!NUMBER_LIKE.test(id.replace(ID_ADDRESS, '_'))) return id.replace(ID_ADDRESS, (addr) => known.get(addr) ?? chatRef(salt, chatKey(addr)));
  return `wa-m-${createHmac('sha256', salt).update(id).digest('hex').slice(0, 24)}`;
}

/** The chats the channel file watches, by reference: what the company's config needs before it is created. */
export interface Plan {
  roles: Record<string, ChatRole>;
  /** Reference to the key it came from, so an inbound message can be matched without storing anything about other chats. */
  keys: Map<string, string>;
  authorisedSenders: string[];
  /** WZP-34: the intake tasks chosen for a chat, by reference. */
  tasks: Record<string, string[]>;
  ownRef: string;
  reviewRef: string;
  opsRef: string;
}

export function plan(file: ChannelFile, salt: string): Plan {
  const roles: Record<string, ChatRole> = {};
  const keys = new Map<string, string>();
  const add = (v: string, role: ChatRole): string => {
    const key = v === 'self' ? file.ownNumber : chatKey(v);
    const ref = chatRef(salt, key);
    keys.set(ref, key);
    roles[ref] = role;
    return ref;
  };
  for (const c of file.replyChats) add(c, 'reply');
  for (const c of file.monitorChats) add(c, 'monitor');
  const reviewRef = add(file.reviewChat, 'ops');
  const opsRef = file.opsChat ? add(file.opsChat, 'ops') : reviewRef;
  const ownRef = chatRef(salt, file.ownNumber);
  const tasks: Record<string, string[]> = {};
  for (const [key, list] of Object.entries(file.chatTasks ?? {})) tasks[chatRef(salt, key)] = [...list];
  const authorisedSenders = file.authorisedSenders.map((s) => chatRef(salt, s === 'self' ? file.ownNumber : chatKey(s)));
  return { roles, keys, authorisedSenders, tasks, ownRef, reviewRef, opsRef };
}

/** A chat the directory listed: what the adapter needs to act on a choice, kept in memory only and never shown. */
export interface KnownChat {
  jid: string;
  key: string;
  name: string | null;
  group: boolean;
}

/**
 * WZP-35, WZP-36: a person's choices applied to the plan in place (the company's gate and the adapter read the same object, so it takes effect
 * at once). The account's own chat receives the drafts and cannot be chosen. A new office chat replaces the old one. Returns every chat whose
 * role changed, so the company's store can be told the same.
 */
export function applyChoices(p: Plan, known: ReadonlyMap<string, KnownChat>, choices: readonly DirectoryChoice[]): DirectoryChoice[] {
  for (const c of choices) {
    if (!known.has(c.ref)) throw new Error('that chat is not in the list any more: look at the list again');
    if (c.ref === p.ownRef) throw new Error('your own chat receives the drafts and cannot be chosen');
  }
  const changed: DirectoryChoice[] = [];
  for (const c of choices) {
    const info = known.get(c.ref)!;
    if (c.role === 'ops' && p.opsRef !== p.reviewRef && p.opsRef !== c.ref) {
      delete p.roles[p.opsRef];
      delete p.tasks[p.opsRef];
      changed.push({ ref: p.opsRef, role: 'ignored' });
    }
    if (c.role === 'ignored') { delete p.roles[c.ref]; delete p.tasks[c.ref]; }
    else { p.roles[c.ref] = c.role; p.keys.set(c.ref, info.key); if (c.tasks !== undefined) p.tasks[c.ref] = [...c.tasks]; }
    if (c.role === 'ops') p.opsRef = c.ref;
    else if (p.opsRef === c.ref) p.opsRef = p.reviewRef;
    changed.push({ ref: c.ref, role: c.role });
  }
  return changed;
}

/** The channel file the plan describes, written by the adapter and never by hand (WZP-1); null when nothing is watched. `path` is where it will live. */
export function channelFileOf(file: ChannelFile, p: Plan, path: string): Record<string, unknown> | null {
  const keysOf = (role: ChatRole) => Object.entries(p.roles).filter(([ref, r]) => r === role && ref !== p.reviewRef && ref !== p.opsRef).map(([ref]) => p.keys.get(ref)!).filter((k) => k !== undefined);
  const replyChats = keysOf('reply');
  const monitorChats = keysOf('monitor');
  const opsChat = p.opsRef !== p.reviewRef ? p.keys.get(p.opsRef) : undefined;
  if (replyChats.length === 0 && monitorChats.length === 0 && !opsChat) return null;
  const dataDir = relative(dirname(path), file.dataDir);
  const chatTasks: Record<string, string[]> = {};
  for (const [ref, list] of Object.entries(p.tasks)) {
    const key = p.keys.get(ref);
    if (key && p.roles[ref] !== undefined && ref !== p.reviewRef) chatTasks[key] = list;
  }
  return {
    ownNumber: file.ownNumber,
    replyChats,
    monitorChats,
    ...(opsChat ? { opsChat } : {}),
    reviewChat: file.reviewChat,
    ...(Object.keys(chatTasks).length > 0 ? { chatTasks } : {}),
    authorisedSenders: file.authorisedSenders,
    ...(file.replyDelayMs !== undefined ? { replyDelayMs: file.replyDelayMs } : {}),
    ...(file.pairNumber ? { pairNumber: file.pairNumber } : {}),
    dataDir: dataDir.startsWith('.') ? dataDir : `./${dataDir}`,
  };
}

/** A chat's name that is only its number is not a name, and a number is never shown (WZP-31). */
const NUMBER_NAME = /^\+?[\d\s().-]{6,}$/;

export interface ChannelDeps {
  file: ChannelFile;
  plan: Plan;
  salt: string;
  commandPrefix: string;
  /** WZP-5: the client's written agreement. Until it is recorded the channel lists no chat, saves no choice and reads no message. */
  agreement: Agreement;
  /** Where the channel file lives. The directory writes it when a person chooses chats (WZP-35); without it a choice only lasts until the next start. */
  channelPath?: string;
}

type Log = (level: 'info' | 'warn' | 'error', text: string) => void;

export class WhatsAppChannel {
  readonly adapters: CompanyAdapters;
  private company: Company | null = null;
  private client: InstanceType<typeof Client>;
  private scheduler: ReplyScheduler | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private state: 'initializing' | 'qr' | 'connecting' | 'ready' | 'disconnected' | 'error' = 'initializing';
  private restarts = 0;
  private readyTimer: NodeJS.Timeout | null = null;
  private stuckTimer: NodeJS.Timeout | null = null;
  /** Reference to the JID that last wrote, for sending to the review chat and reading history. */
  private jids = new Map<string, string>();
  private lastCustomer = new Map<string, string>();
  private ownSendIds = new Map<string, number>();
  private ownSendBodies = new Map<string, number>();
  private handledOwn = new Map<string, number>();
  private unwatched = new Set<string>();
  private qrModules: string[] | null = null;
  private linkedAs = '';
  private readonly logFile: string;

  /** ADM-103: no channel file, so nothing is watched or sent whichever account links. */
  private get linkOnly(): boolean {
    return this.deps.file.ownNumber === '';
  }

  constructor(private readonly deps: ChannelDeps) {
    this.logFile = resolve(deps.file.dataDir, 'channel.log');
    mkdirSync(deps.file.dataDir, { recursive: true });
    this.client = this.build(process.env['WA_WEB_VERSION'] || undefined);
    this.wire();
    this.adapters = {
      ack: this.sink(() => deps.plan.reviewRef),
      review: this.sink(() => deps.plan.reviewRef),
      ops: this.sink(() => deps.plan.opsRef),
      history: (chat, limit) => this.history(chat, limit),
    };
  }

  private log: Log = (level, text) => {
    const line = `${new Date().toISOString()} ${level} ${text}`;
    if (level !== 'info') console.log(`[whatsapp] ${text}`);
    try { appendFileSync(this.logFile, `${line}\n`); } catch { /* the log is a convenience */ }
  };

  // ---- ADM-103: linking and self-healing -------------------------------------------------------------------------------

  private userAgent(): string | undefined {
    if (process.env['WA_USER_AGENT']) return process.env['WA_USER_AGENT'];
    try {
      const v = /(\d+)\./.exec(execFileSync(this.browser(), ['--version'], { encoding: 'utf8' }))?.[1];
      return v ? `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.0.0 Safari/537.36` : undefined;
    } catch {
      return undefined;
    }
  }

  private browser(): string {
    return process.env['WA_CHROMIUM'] || '/usr/bin/chromium';
  }

  private cachedBuilds(): string[] {
    try {
      const names = readdirSync('./.wwebjs_cache').map((f) => /^(\d+\.\d+\.\d+)\.html$/.exec(f)?.[1]).filter((v): v is string => !!v);
      const n = (v: string) => v.split('.').map((x) => x.padStart(12, '0')).join('.');
      return names.sort((a, b) => (n(a) < n(b) ? 1 : -1));
    } catch {
      return [];
    }
  }

  private qrFile(): string {
    return resolve(this.deps.file.dataDir, 'qr.txt');
  }

  private goodVersionFile(): string {
    return resolve(this.deps.file.dataDir, 'last-good-version');
  }

  private build(pin?: string): InstanceType<typeof Client> {
    const ua = this.userAgent();
    return new Client({
      authStrategy: new LocalAuth({ dataPath: resolve(this.deps.file.dataDir, 'session') }),
      ...(pin ? { webVersion: pin, webVersionCache: { type: 'local' as const, path: './.wwebjs_cache' } } : {}),
      ...(ua ? { userAgent: ua } : {}),
      ...(this.deps.file.pairNumber ? { pairWithPhoneNumber: { phoneNumber: this.deps.file.pairNumber, showNotification: true } } : {}),
      puppeteer: { headless: true, executablePath: this.browser(), args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] },
    });
  }

  private async onReadyTimeout(): Promise<void> {
    if (this.state === 'ready') return;
    let good: string | undefined;
    try { good = readFileSync(this.goodVersionFile(), 'utf8').trim() || undefined; } catch { /* none yet */ }
    const pin = process.env['WA_WEB_VERSION'] || good || this.cachedBuilds()[0];
    if (this.restarts < MAX_RESTARTS) {
      this.restarts++;
      this.log('warn', `not ready ${READY_TIMEOUT_MS / 1000}s after authenticated: restart ${this.restarts}/${MAX_RESTARTS}${pin ? ` (WhatsApp Web ${pin})` : ''}`);
      await this.restart(pin);
      return;
    }
    if (!this.stuckTimer) this.log('error', `still not ready after ${this.restarts} restarts: retrying every ${STUCK_RETRY_MS / 60_000} min. Runbook: update whatsapp-web.js, set WA_WEB_VERSION, or re-link (delete ${resolve(this.deps.file.dataDir, 'session')}).`);
    if (this.stuckTimer) clearTimeout(this.stuckTimer);
    this.stuckTimer = setTimeout(() => {
      this.stuckTimer = null;
      if (this.state !== 'ready') void this.restart(pin);
    }, STUCK_RETRY_MS);
  }

  private async restart(pin?: string): Promise<void> {
    try { await this.client.destroy(); } catch { /* already gone */ }
    this.client = this.build(pin);
    this.wire();
    this.client.initialize().catch((e: unknown) => this.log('error', `restart failed: ${String(e).slice(0, 200)}`));
  }

  private wire(): void {
    this.client.on('qr', (qr: string) => {
      this.state = 'qr';
      try { this.qrModules = qrRows(qr); } catch { this.qrModules = null; }
      qrcode.generate(qr, { small: true });
      // The current code also as text, owner-only, for a viewer when the terminal is too small; removed once linked.
      try { writeFileSync(this.qrFile(), qr, { mode: 0o600 }); } catch { /* the terminal code is enough */ }
      this.log('info', 'QR code shown: scan it in WhatsApp > Linked devices');
      console.log('\nScan the code above: WhatsApp > Settings > Linked devices > Link a device\n');
    });
    this.client.on('code', (code: string) => {
      this.state = 'qr';
      console.log(`\n  PAIRING CODE: ${code}\n  WhatsApp > Linked devices > Link with phone number\n`);
    });
    this.client.on('authenticated', () => {
      this.state = 'connecting';
      this.qrModules = null;
      this.log('info', 'session authenticated');
      rmSync(this.qrFile(), { force: true });
      if (this.readyTimer) clearTimeout(this.readyTimer);
      this.readyTimer = setTimeout(() => void this.onReadyTimeout(), READY_TIMEOUT_MS);
    });
    this.client.on('auth_failure', (m: string) => {
      this.state = 'error';
      this.log('error', `auth failure: ${m}`);
    });
    this.client.on('ready', () => {
      void this.onReady();
    });
    this.client.on('disconnected', (reason: string) => {
      this.state = 'disconnected';
      this.log('warn', `disconnected: ${reason}`);
    });
    this.client.on('message', (msg: Message) => {
      this.onMessage(msg).catch((e: unknown) => this.log('error', `inbound failed: ${String(e).slice(0, 200)}`));
    });
    this.client.on('message_create', (msg: Message) => {
      if (!msg.fromMe) return;
      this.onOwn(msg).catch((e: unknown) => this.log('error', `own message failed: ${String(e).slice(0, 200)}`));
    });
  }

  private async onReady(): Promise<void> {
    if (this.readyTimer) { clearTimeout(this.readyTimer); this.readyTimer = null; }
    if (this.stuckTimer) { clearTimeout(this.stuckTimer); this.stuckTimer = null; }
    const own = chatKey(this.client.info?.wid?.user ?? '');
    if (this.linkOnly) {
      this.state = 'ready';
      this.linkedAs = own;
      this.log('info', 'linked in link-only mode; no chat is watched');
      console.log('\n[whatsapp] linked. No chat is watched and nothing is sent until you choose chats in the dashboard (Configurar).\n');
      return;
    }
    if (own !== this.deps.file.ownNumber) {
      // A different account is linked than the one the channel file was written for: refuse to look at its chats.
      this.state = 'error';
      this.log('error', `the linked account is not the one in whatsapp.json (ownNumber). Nothing is watched. Delete ${resolve(this.deps.file.dataDir, 'session')} and link the right phone.`);
      await this.stop();
      return;
    }
    this.state = 'ready';
    try {
      const v = await this.client.getWWebVersion();
      writeFileSync(this.goodVersionFile(), `${v}\n`);
      this.log('info', `ready (WhatsApp Web ${v}); watching ${Object.keys(this.deps.plan.roles).length} chats; every other chat is ignored`);
    } catch {
      this.log('info', 'ready');
    }
    console.log(`[whatsapp] ready: watching ${Object.keys(this.deps.plan.roles).length} chats, shadow mode, nothing is sent to a customer`);
  }

  // ---- ADM-105/106: inbound ----------------------------------------------------------------------------------------------

  /** A person's number from a message or chat, because WhatsApp may report an @lid id instead of the number. */
  private async keyOf(jid: string, ask: () => Promise<{ number?: string | undefined }>): Promise<string> {
    if (/@g\.us$/.test(jid)) return jid;
    if (/@c\.us$/.test(jid)) return chatKey(jid);
    try {
      const n = (await ask()).number;
      if (n) return chatKey(n);
    } catch { /* fall through to the id itself */ }
    return chatKey(jid);
  }

  private watched(key: string): string | null {
    if (!this.deps.agreement.agreed()) return null; // WZP-5: nothing is read, stored or logged before the client has agreed
    const ref = chatRef(this.deps.salt, key);
    if (this.deps.plan.roles[ref] !== undefined) return ref;
    if (!this.unwatched.has(ref)) {
      this.unwatched.add(ref);
      if (this.unwatched.size % 25 === 1) this.log('info', `${this.unwatched.size} chats seen outside the table, all ignored`);
    }
    return null;
  }

  private text(msg: Message): { text: string; media?: { type: string } } {
    const body = (msg.body ?? '').trim();
    if (!msg.hasMedia) return { text: body };
    const type = msg.type === 'ptt' ? 'audio' : String(msg.type);
    return { text: body, media: { type } };
  }

  private async onMessage(msg: Message): Promise<void> {
    if (!this.company || this.linkOnly || msg.from === 'status@broadcast' || msg.fromMe) return;
    const isGroup = msg.from.endsWith('@g.us');
    const key = await this.keyOf(msg.from, () => msg.getContact());
    const ref = this.watched(key);
    if (ref === null) return;
    this.jids.set(ref, msg.from);

    const { text, media } = this.text(msg);
    if (text === '' && !media) return;
    const authorKey = isGroup ? await this.keyOf(msg.author ?? msg.from, () => msg.getContact()) : key;
    const sender = chatRef(this.deps.salt, authorKey);
    let contactName: string | undefined;
    if (!isGroup) {
      try { contactName = ((await msg.getContact()).pushname ?? '').trim() || undefined; } catch { /* the name is only for staff */ }
    }
    const known = new Map([[msg.from, ref], ...(isGroup && msg.author ? [[msg.author, sender] as [string, string]] : [])]);
    const event: CyborgEvent = {
      id: scrubId(this.deps.salt, msg.id._serialized, known),
      source: 'whatsapp',
      kind: 'message.received',
      at: new Date(msg.timestamp * 1000).toISOString(),
      payload: {
        chat: ref,
        isGroup,
        addressed: !isGroup || text.startsWith(this.deps.commandPrefix) || (await this.addressed(msg)),
        sender,
        text,
        ...(media ? { media } : {}),
        ...(contactName ? { contactName } : {}),
      },
    };
    this.lastCustomer.set(ref, event.id);
    const command = text.startsWith(this.deps.commandPrefix) && this.deps.plan.authorisedSenders.includes(sender);
    const role = this.deps.plan.roles[ref];
    if (command || role !== 'reply') await this.company.process(event);
    else this.scheduler?.submit(event, Date.now());
  }

  private async addressed(msg: Message): Promise<boolean> {
    const me = this.client.info?.wid?._serialized;
    if (me && (msg.mentionedIds ?? []).some((m) => String(m) === me)) return true;
    try { return msg.hasQuotedMsg && !!(await msg.getQuotedMessage()).fromMe; } catch { return false; }
  }

  // ---- ADM-107: a person answers from the account ----------------------------------------------------------------------

  private forgetOldSends(now: number): void {
    for (const m of [this.ownSendIds, this.ownSendBodies, this.handledOwn]) for (const [k, t] of m) if (now - t > OWN_SEND_MEMORY_MS * 5) m.delete(k);
  }

  private async onOwn(msg: Message): Promise<void> {
    if (!this.company || this.linkOnly || msg.to === 'status@broadcast') return;
    const now = Date.now();
    this.forgetOldSends(now);
    const id = msg.id._serialized;
    const body = (msg.body ?? '').trim();
    if (body === '' || this.handledOwn.has(id)) return;
    this.handledOwn.set(id, now);
    if (this.ownSendIds.has(id) || (this.ownSendBodies.get(body) ?? 0) > now - OWN_SEND_MEMORY_MS) return;
    // WhatsApp can report our own send a moment before sendMessage returns its id; give it time, then check again.
    await new Promise((r) => setTimeout(r, 1500));
    if (this.ownSendIds.has(id)) return;

    const key = await this.keyOf(msg.to, async () => (await (await msg.getChat()).getContact()));
    const ref = this.watched(key);
    if (ref === null) return;
    this.jids.set(ref, msg.to);
    const role = this.deps.plan.roles[ref];
    const ownRef = this.deps.plan.ownRef;
    if (body.startsWith(this.deps.commandPrefix) && this.deps.plan.authorisedSenders.includes(ownRef)) {
      await this.company.process({
        id: scrubId(this.deps.salt, id, new Map([[msg.to, ref]])), source: 'whatsapp', kind: 'message.received', at: new Date(msg.timestamp * 1000).toISOString(),
        payload: { chat: ref, isGroup: msg.to.endsWith('@g.us'), addressed: true, sender: ownRef, text: body },
      });
      return;
    }
    if (role !== 'reply') return;
    const eventId = this.lastCustomer.get(ref);
    this.company.personReplied(ref, 'person', eventId ? { eventId, source: 'whatsapp', text: body } : undefined);
  }

  // ---- ADM-108: outbound, admin chats only -------------------------------------------------------------------------------

  /** The chat is looked up at send time: choosing the office chat from the dashboard changes it while the channel runs (WZP-38). */
  private sink(refOf: () => string): OutboundSink {
    return {
      // The core's guards compare a sink's channel with the chat's role and the origin (ADM-8, ADM-46), so it is the chat's reference, read when asked.
      get channel() { return refOf(); },
      send: async (message) => {
        const ref = refOf();
        if (this.linkOnly) throw new Error('link-only: nothing is sent until whatsapp.json names the account (ADM-103)');
        if (this.deps.plan.roles[ref] === 'reply') {
          this.log('error', 'refused a send to a customer chat (ADM-108)');
          throw new Error('the WhatsApp adapter never sends to a customer chat in shadow mode');
        }
        await this.sendTo(ref, message.text);
      },
    };
  }

  private async sendTo(ref: string, text: string): Promise<void> {
    const key = this.deps.plan.keys.get(ref);
    if (!key) throw new Error('send: unknown chat reference');
    let jid = this.jids.get(ref);
    if (!jid) {
      if (/@g\.us$/.test(key)) jid = key;
      else jid = (await this.client.getNumberId(key))?._serialized ?? `${key}@c.us`;
      this.jids.set(ref, jid);
    }
    const now = Date.now();
    this.ownSendBodies.set(text.trim(), now);
    const sent = await this.client.sendMessage(jid, text, { sendSeen: false });
    const id = sent?.id?._serialized;
    if (id) this.ownSendIds.set(id, now);
  }

  private async history(chat: string, limit: number): Promise<{ from: 'customer' | 'bot' | 'staff'; text: string; at?: string }[]> {
    const jid = this.jids.get(chat);
    if (!jid || this.state !== 'ready' || !this.deps.agreement.agreed()) return [];
    try {
      const c = await this.client.getChatById(jid);
      const messages = await c.fetchMessages({ limit });
      return messages
        .filter((m) => (m.body ?? '').trim() !== '')
        .map((m) => ({
          from: m.fromMe ? (this.ownSendIds.has(m.id._serialized) ? ('bot' as const) : ('staff' as const)) : ('customer' as const),
          text: m.body,
          at: new Date(m.timestamp * 1000).toISOString(),
        }));
    } catch {
      return [];
    }
  }

  // ---- WZP-30..39: the chats by name and the person's choice of what to read -------------------------------------------------

  private readonly known = new Map<string, KnownChat>();

  /** The Configurar tab's view of this account: chats and groups by name, and the choice of what the bot does in each. */
  /**
   * WZP-85: logs the linked account out of this computer, stops the client, deletes the stored session (the one thing on the machine that keeps the account
   * signed in), audits it, and starts a fresh client so the link panel shows a new code. The channel file, the roles, the agreement and every record stay.
   * A log out that fails (the phone is offline) is reported and the stored session is deleted anyway.
   */
  async unlink(by: string): Promise<{ loggedOut: boolean }> {
    if (this.state !== 'ready') throw new Error('WhatsApp is not linked');
    this.log('info', `unlinking the WhatsApp account (${by})`);
    let loggedOut = true;
    try {
      await this.client.logout();
    } catch (e) {
      loggedOut = false;
      this.log('warn', `the phone could not be told to end the session: ${String(e).slice(0, 160)}`);
    }
    try { await this.client.destroy(); } catch { /* already gone */ }
    if (this.readyTimer) clearTimeout(this.readyTimer);
    if (this.stuckTimer) clearTimeout(this.stuckTimer);
    rmSync(resolve(this.deps.file.dataDir, 'session'), { recursive: true, force: true });
    this.company?.store.appendAudit({ at: new Date().toISOString(), proposalId: null, kind: 'channel_unlinked', fromStatus: null, toStatus: null, actor: by, detail: { channel: 'whatsapp', loggedOut } });
    this.state = 'initializing';
    this.linkedAs = '';
    this.qrModules = null;
    this.restarts = 0;
    this.client = this.build(process.env['WA_WEB_VERSION'] || undefined);
    this.wire();
    this.client.initialize().catch((e: unknown) => this.log('error', `starting a new link failed: ${String(e).slice(0, 200)}`));
    return { loggedOut };
  }

  directory(): ChatDirectory {
    return {
      account: () => (this.state === 'ready' ? `+${this.linkedAs || chatKey(this.client.info?.wid?.user ?? '')}`.replace(/^\+$/, '') || null : null),
      unlink: (by) => this.unlink(by),
      chats: () => this.listChats(),
      save: (choices, by) => this.saveChoices(choices, by),
      agree: async (version, by) => {
        const record = this.deps.agreement.accept(version, by);
        this.log('info', `the client's agreement is recorded (version ${record.version})`);
      },
    };
  }

  /** wazaa's way (client.ts `listChats`): read the chat list from WhatsApp Web itself, which is fast and has the names; the library call is the fallback. */
  private async rawChats(): Promise<{ id: string; name: string; members?: number; t: number }[]> {
    const page = (this.client as unknown as { pupPage?: { evaluate: (fn: (limit: number) => unknown, arg: number) => Promise<unknown> } }).pupPage;
    if (page) {
      try {
        const rows = (await page.evaluate((limit: number) => {
          const g = globalThis as unknown as { require: (name: string) => any };
          const out: { id: string; name: string; members?: number; t: number }[] = [];
          try {
            for (const ch of g.require('WAWebCollections').Chat.getModelsArray() || []) {
              try {
                const id = ch.id && (ch.id._serialized || String(ch.id));
                if (!id) continue;
                const contact = ch.contact;
                const name = ch.formattedTitle || ch.name || (contact && (contact.pushname || contact.name || contact.formattedName)) || '';
                const parts = ch.groupMetadata && ch.groupMetadata.participants;
                const members = parts ? Number(parts.length ?? (parts._models && parts._models.length)) || undefined : undefined;
                out.push({ id, name: String(name || ''), ...(members ? { members } : {}), t: Number(ch.t) || 0 });
              } catch { /* skip this chat */ }
            }
          } catch { return null; }
          out.sort((a, b) => b.t - a.t);
          return out.slice(0, limit);
        }, 300)) as { id: string; name: string; members?: number; t: number }[] | null;
        if (rows && rows.length > 0) return rows;
      } catch { /* fall through to the library call */ }
    }
    const raw = await this.client.getChats();
    return raw.map((c) => ({ id: c.id._serialized, name: c.name ?? '', t: c.timestamp ?? 0 }));
  }

  private async listChats(): Promise<DirectoryListing> {
    if (this.state !== 'ready') return { ready: false, chats: [] };
    const view = this.deps.agreement.view();
    const agreement = { text: view.text, terms: view.terms, version: view.version, recorded: view.recorded ? { by: view.recorded.by, at: view.recorded.at } : null };
    if (agreement.recorded === null) return { ready: true, chats: [], agreement };
    const own = this.deps.file.ownNumber || this.linkedAs;
    const known = new Map<string, KnownChat>();
    const chats: DirectoryChat[] = [];
    for (const r of (await this.rawChats()).filter((x) => /@(?:c\.us|g\.us|lid)$/.test(x.id)).slice(0, 300)) {
      const group = /@g\.us$/.test(r.id);
      const key = await this.keyOf(r.id, () => this.client.getContactById(r.id));
      if (!group && own !== '' && key === own) continue;
      const ref = chatRef(this.deps.salt, key);
      if (known.has(ref)) continue;
      const name = r.name.trim() !== '' && !NUMBER_NAME.test(r.name.trim()) ? r.name.trim() : null;
      known.set(ref, { jid: r.id, key, name, group });
      this.jids.set(ref, r.id);
      chats.push({ ref, name, kind: group ? 'group' : 'person', ...(r.members ? { members: r.members } : {}), ...(r.t ? { lastAt: new Date(r.t * 1000).toISOString() } : {}), role: this.deps.plan.roles[ref] ?? 'ignored', ...(this.deps.plan.tasks[ref] ? { tasks: this.deps.plan.tasks[ref] } : {}) });
    }
    this.known.clear();
    for (const [ref, info] of known) this.known.set(ref, info);
    return { ready: true, chats, agreement };
  }

  /** ADM-103 link-only becomes a watching channel the moment a person chooses a chat: the linked account is the account, its own chat gets the drafts. */
  private promote(own: string): void {
    const file = this.deps.file;
    const p = this.deps.plan;
    delete p.roles[p.reviewRef];
    p.keys.delete(p.reviewRef);
    file.ownNumber = own;
    file.authorisedSenders = ['self'];
    const ownRef = chatRef(this.deps.salt, own);
    p.ownRef = ownRef;
    p.reviewRef = ownRef;
    p.opsRef = ownRef;
    p.keys.set(ownRef, own);
    p.roles[ownRef] = 'ops';
    if (!p.authorisedSenders.includes(ownRef)) p.authorisedSenders.push(ownRef);
    this.company?.store.setRole(ownRef, 'ops', 'dashboard', new Date().toISOString());
    this.log('info', 'a person chose chats from the dashboard: the channel now watches them');
  }

  private async saveChoices(choices: readonly DirectoryChoice[], by: string): Promise<{ watching: number }> {
    if (!this.deps.agreement.agreed()) throw new Error('the client has not agreed to the fine print yet');
    if (this.state !== 'ready' || !this.company) throw new Error('WhatsApp is not linked yet: scan the code first');
    const own = this.deps.file.ownNumber || this.linkedAs || chatKey(this.client.info?.wid?.user ?? '');
    if (own === '') throw new Error('the linked account is not known yet');
    const p = this.deps.plan;
    const before = { roles: { ...p.roles }, tasks: { ...p.tasks }, keys: new Map(p.keys), opsRef: p.opsRef };
    const wasLinkOnly = this.linkOnly;
    try {
      if (wasLinkOnly) this.promote(own);
      const changed = applyChoices(p, this.known, choices);
      const at = new Date().toISOString();
      for (const c of changed) this.company.store.setRole(c.ref, c.role, by, at);
      this.persist();
    } catch (error) {
      // A refused or failed save leaves the plan as it was.
      for (const ref of Object.keys(p.roles)) delete p.roles[ref];
      Object.assign(p.roles, before.roles);
      for (const ref of Object.keys(p.tasks)) delete p.tasks[ref];
      Object.assign(p.tasks, before.tasks);
      p.keys.clear();
      for (const [k, v] of before.keys) p.keys.set(k, v);
      p.opsRef = before.opsRef;
      throw error;
    }
    return { watching: Object.entries(p.roles).filter(([ref, role]) => role !== 'ignored' && (ref !== p.reviewRef || role !== 'ops')).length };
  }

  /** WZP-35: what was chosen is kept for the next start in the channel file, machine-written and only on this machine (it holds numbers, ADM-105). */
  private persist(): void {
    const path = this.deps.channelPath;
    if (!path) return;
    const body = channelFileOf(this.deps.file, this.deps.plan, path);
    if (body === null) rmSync(path, { force: true });
    else writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
  }

  // ---- life --------------------------------------------------------------------------------------------------------------

  /** Connects the channel to the company: roles are already in the config, so this only wires events and the reply delay. */
  async start(company: Company): Promise<void> {
    this.company = company;
    this.scheduler = new ReplyScheduler({
      run: async (event) => {
        const r = await company.process(event);
        return r.ran ? r.outcomes.flatMap((o) => (o.outcome === 'proposal' ? [o.proposal] : [])) : [];
      },
      // OPEN (ADM-109): a new message while a draft is open does not yet supersede it.
      supersede: () => undefined,
      isOpen: () => false,
      ...(this.deps.file.replyDelayMs !== undefined ? { delayMs: this.deps.file.replyDelayMs } : {}),
    });
    this.tickTimer = setInterval(() => {
      this.scheduler?.tick(Date.now()).catch((e: unknown) => this.log('error', `reply delay run failed: ${String(e).slice(0, 200)}`));
    }, 1000);
    if (!this.linkOnly && !this.deps.agreement.agreed()) this.log('warn', "the client's agreement is not recorded (WZP-5): the chats in the channel file are not read until a person agrees in the dashboard (Configurar)");
    this.log('info', 'starting the WhatsApp client');
    await this.client.initialize();
  }

  async stop(): Promise<void> {
    if (this.tickTimer) clearInterval(this.tickTimer);
    try { await this.client.destroy(); } catch { /* already gone */ }
  }

  /** ADM-111: the dashboard's link panel; null once linked with a channel file, so the panel goes away. */
  linkView(): LinkView | null {
    const channel = 'WhatsApp';
    switch (this.state) {
      case 'initializing': return { channel, state: 'starting' };
      case 'qr': return this.qrModules ? { channel, state: 'waiting', qr: this.qrModules } : { channel, state: 'starting' };
      case 'connecting': return { channel, state: 'linking' };
      case 'ready':
        if (!this.linkOnly) return null;
        return {
          channel, state: 'linked', account: `+${this.linkedAs}`,
          hint: {
            pt: 'Ligado. Nenhuma conversa é lida e nada é enviado até escolher as conversas em Configurar.',
            en: 'Linked. No chat is read and nothing is sent until you choose chats in Configure.',
          },
        };
      default: return { channel, state: 'error' };
    }
  }

  status(): { state: string; ignoredChats: number } {
    return { state: this.state, ignoredChats: this.unwatched.size };
  }
}
