// docs/10 ADM-7..14, 23..37, 41: the manners a chat bot must have, enforced in code before any handler runs.
import type { AlertKind, SystemAlertKind } from './alerts.ts';
import { N14_HANDOFF_RESUME_MS } from './numbers.ts';
import { COMMAND_ALIASES, ENGLISH, STAFF_LANGUAGES, staffMessages, type LanguageSource, type StaffLanguage } from './messages.ts';
import { nextOfficeChange, type OfficeSchedule } from './office.ts';
import { officeStatus, PRESENCE_LABEL_PATTERN, type Presence } from './presence.ts';
import type { OutboundSink } from './shadow.ts';
import type { CyborgEvent, ProposalStore } from './types.ts';

export type ChatRole = 'reply' | 'ops' | 'monitor' | 'ignored';
export const CHAT_ROLES: readonly ChatRole[] = ['reply', 'ops', 'monitor', 'ignored'];
export type ChatState = 'bot' | 'handoff' | 'paused' | 'stopped';

export interface WaitingPeriod {
  chat: string;
  since: string;
  lastCustomerAt: string;
  pinged: boolean;
  endedAt: string | null;
  endReason: 'person_replied' | 'restarted' | 'auto_resume' | null;
}

/** Every change here is an audit row written by the implementation (ADM-9: role changes are audited). */
export interface ControlStore {
  getRole(chat: string): ChatRole | null;
  setRole(chat: string, role: ChatRole, actor: string, at: string): void;
  getChatState(chat: string): ChatState;
  setChatState(chat: string, state: ChatState, actor: string, at: string, reason?: string): void;
  getPresence(): Presence | null;
  setPresence(presence: Presence): void;
  /** ADM-77: the language the system speaks to staff in, set by `.lang`. Null until someone sets it; the company's default applies then. */
  getLanguage(): StaffLanguage | null;
  setLanguage(language: StaffLanguage, actor: string, at: string): void;
  getGlobalStop(): boolean;
  setGlobalStop(stopped: boolean, actor: string, at: string): void;
  getWaiting(chat: string): WaitingPeriod | null;
  openWaiting(chat: string, at: string): WaitingPeriod;
  touchWaiting(chat: string, at: string): void;
  markPinged(chat: string): void;
  closeWaiting(chat: string, reason: NonNullable<WaitingPeriod['endReason']>, at: string): WaitingPeriod | null;
  listOpenWaiting(): WaitingPeriod[];
  /** ADM-57: any person (staff, admin or owner) answering a chat, or a `.done`, settles what was pending in it. */
  recordSettled(chat: string, by: string, via: 'person_replied' | 'done', at: string): void;
  lastSettledAt(chat: string): string | null;
}

/** ADM-23, ADM-27: a toast or an ops-chat card. It carries a chat reference and a waiting time, never message text (ADM-25). */
export interface AdminNotifier {
  notify(ping: { chat: string; waitedMs: number; quiet?: boolean }): Promise<void>;
  /**
   * ADM-44: something outside a chat needs the admin (the inference key was rejected, or credit ran out). `detail` is a short
   * fixed sentence with no message text, no key and no provider response body.
   */
  alert?(alert: { kind: SystemAlertKind; detail: string }): Promise<void>;
  /** ADM-48: the thing the admin was told about is over (a person replied, the key was fixed). Clears it from the dashboard. */
  resolved?(what: { kind: AlertKind; ref: string }): Promise<void>;
}

/** ADM-28: local speech-to-text only. */
export interface SpeechToText {
  transcribe(media: { type: string; ref: string }): Promise<{ text: string }>;
  /** ADM-31: the audio is deleted after transcription, whether or not it worked. */
  discard?(media: { type: string; ref: string }): Promise<void>;
}

/** ADM-32: forwards the original non-text media to the admins. */
export interface MediaForward {
  channel: string;
  forward(chat: string, media: { type: string; ref: string }): Promise<void>;
}

export type GateDecision =
  | { kind: 'ignore'; reason: string }
  | { kind: 'store_only'; reason: string }
  | { kind: 'command'; command: string; ack: string }
  | { kind: 'waiting'; chat: string; pinged: boolean }
  | { kind: 'media_forwarded'; chat: string }
  | { kind: 'run'; event: CyborgEvent };

export interface GateConfig {
  /** Command prefix such as ".". */
  commandPrefix: string;
  /** Opaque sender references allowed to give commands (ADM-11). */
  authorisedSenders: readonly string[];
  /** The chat acknowledgements go to: the owner's self chat or the ops chat (ADM-8). */
  ack: OutboundSink;
  /** The real channel in a shadow run: nothing may be sent here. */
  originChannel?: string;
  /** N-14, set by the business admin; defaults to 12 h. */
  handoffResumeMs?: number;
}

export interface GateDeps {
  control: ControlStore;
  store: Pick<ProposalStore, 'appendAudit'>;
  config: GateConfig;
  notifier?: AdminNotifier;
  /** ADM-77: what language staff-facing sentences are in. Read each time, so `.lang` takes effect at once. Default English at this level; a company's config defaults to Portuguese. */
  language?: LanguageSource;
  /** ADM-60: office hours and holidays. With it, `.ooo` and `.back` hold until the schedule next changes. */
  office?: OfficeSchedule;
  transcriber?: SpeechToText;
  forward?: MediaForward;
  now?: () => Date;
}

type Traffic = 'group' | 'direct' | 'command' | 'handoff' | 'media' | 'ignored' | 'stored';

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export class ChannelGate {
  private readonly seen = new Set<string>();

  constructor(private readonly deps: GateDeps) {}

  private at(): string {
    return (this.deps.now ?? (() => new Date()))().toISOString();
  }

  private record(decision: string, traffic: Traffic, detail: Record<string, unknown> = {}): void {
    this.deps.store.appendAudit({
      at: this.at(), proposalId: null, kind: 'gate', fromStatus: null, toStatus: null, actor: 'gate',
      detail: { decision, traffic, ...detail },
    });
  }

  /** ADM-8: acknowledgements and forwards never go to the origin channel or to a customer (`reply`) chat. */
  private assertAdminSink(channel: string): void {
    if (channel === this.deps.config.originChannel || this.deps.control.getRole(channel) === 'reply') {
      throw new Error(`"${channel}" is the origin or a customer chat; acknowledgements and forwards go to admins only (ADM-8, ADM-33)`);
    }
  }

  async admit(event: CyborgEvent): Promise<GateDecision> {
    const p = event.payload;
    const chat = str(p['chat']);
    const dedupe = `${event.source}:${event.id}`;

    // ADM-10: never answer ourselves, other bots or system messages; one trigger, one output.
    if (p['system'] === true || p['fromSelf'] === true || p['fromBot'] === true) {
      this.record('ignore', 'ignored', { chat, reason: 'own, bot or system message' });
      return { kind: 'ignore', reason: 'own, bot or system message' };
    }
    if (this.seen.has(dedupe)) {
      this.record('ignore', 'ignored', { chat, reason: 'duplicate event' });
      return { kind: 'ignore', reason: 'duplicate event' };
    }
    this.seen.add(dedupe);

    // ADM-9: an unknown chat is ignored.
    const role = this.deps.control.getRole(chat) ?? 'ignored';
    if (role === 'ignored') {
      this.record('ignore', 'ignored', { chat, reason: 'chat role is ignored' });
      return { kind: 'ignore', reason: 'chat role is ignored' };
    }

    const text = str(p['text']);
    const { commandPrefix, authorisedSenders } = this.deps.config;
    // ADM-11: a command counts only from an authorised sender; the same text from anyone else is ordinary text.
    if (commandPrefix && text.startsWith(commandPrefix) && authorisedSenders.includes(str(p['sender']))) {
      const ack = await this.execute(text.slice(commandPrefix.length).trim(), str(p['sender']));
      this.record('command', 'command', { chat, command: ack.command });
      return { kind: 'command', command: ack.command, ack: ack.text };
    }

    // ADM-12: after stop-all nothing is created for any chat; the message is still stored.
    if (this.deps.control.getGlobalStop()) {
      this.record('store_only', 'stored', { chat, reason: 'global stop' });
      return { kind: 'store_only', reason: 'global stop' };
    }
    if (role === 'monitor') {
      this.record('store_only', 'stored', { chat, reason: 'monitor chat' });
      return { kind: 'store_only', reason: 'monitor chat' };
    }
    if (role === 'ops') {
      this.record('ignore', 'ignored', { chat, reason: 'ops chat accepts commands only' });
      return { kind: 'ignore', reason: 'ops chat accepts commands only' };
    }

    // ADM-7: in a group the bot speaks only when addressed.
    const isGroup = p['isGroup'] === true;
    if (isGroup && p['addressed'] !== true) {
      this.record('ignore', 'ignored', { chat, reason: 'group message not addressed to the bot', group: true });
      return { kind: 'ignore', reason: 'group message not addressed to the bot' };
    }
    const traffic: Traffic = isGroup ? 'group' : 'direct';

    // ADM-14, ADM-23: a chat the bot does not hold starts or extends a waiting period.
    const state = this.deps.control.getChatState(chat);
    const media = p['media'] as { type?: string; ref?: string } | undefined;
    if (state !== 'bot') {
      const pinged = await this.waitingPing(chat);
      this.record('waiting', 'handoff', { chat, state });
      return { kind: 'waiting', chat, pinged };
    }

    // ADM-28..33: voice becomes text; everything else that is not text goes to the admins.
    if (media && typeof media.type === 'string') {
      const ref = str(media.ref);
      if (media.type === 'audio') {
        const transcript = await this.transcribe(chat, { type: 'audio', ref });
        if (transcript === null) {
          this.deps.control.setChatState(chat, 'handoff', 'gate', this.at(), 'transcription failed');
          const pinged = await this.waitingPing(chat);
          this.record('waiting', 'media', { chat, reason: 'transcription failed' });
          return { kind: 'waiting', chat, pinged };
        }
        this.record('run', traffic, { chat, source: 'voice' });
        return { kind: 'run', event: { ...event, payload: { ...p, text: transcript, source: 'voice', media: undefined } } };
      }
      if (text.trim() === '') {
        if (this.deps.forward) {
          this.assertAdminSink(this.deps.forward.channel);
          await this.deps.forward.forward(chat, { type: media.type, ref });
        }
        this.deps.store.appendAudit({ at: this.at(), proposalId: null, kind: 'media_forwarded', fromStatus: null, toStatus: null, actor: 'gate', detail: { chat, type: media.type } });
        await this.waitingPing(chat);
        this.record('media_forwarded', 'media', { chat, type: media.type });
        return { kind: 'media_forwarded', chat };
      }
      // Text with an image: the text goes to the bot, the image to the admins (ADM-33).
      if (this.deps.forward) {
        this.assertAdminSink(this.deps.forward.channel);
        await this.deps.forward.forward(chat, { type: media.type, ref });
      }
      this.deps.store.appendAudit({ at: this.at(), proposalId: null, kind: 'media_forwarded', fromStatus: null, toStatus: null, actor: 'gate', detail: { chat, type: media.type, withText: true } });
    }

    this.record('run', traffic, { chat });
    return { kind: 'run', event: { ...event, payload: { ...p, media: undefined } } };
  }

  private async transcribe(chat: string, media: { type: string; ref: string }): Promise<string | null> {
    const stt = this.deps.transcriber;
    if (!stt) {
      this.deps.store.appendAudit({ at: this.at(), proposalId: null, kind: 'transcription_failed', fromStatus: null, toStatus: null, actor: 'gate', detail: { chat, reason: 'no speech-to-text configured' } });
      return null;
    }
    try {
      const { text } = await stt.transcribe(media);
      return text.trim() === '' ? (this.failedTranscription(chat, 'empty transcript'), null) : text;
    } catch (error) {
      this.failedTranscription(chat, (error as Error).message);
      return null;
    } finally {
      await stt.discard?.(media).catch(() => undefined); // ADM-31
    }
  }

  private failedTranscription(chat: string, reason: string): void {
    this.deps.store.appendAudit({ at: this.at(), proposalId: null, kind: 'transcription_failed', fromStatus: null, toStatus: null, actor: 'gate', detail: { chat, reason } });
  }

  /** ADM-23..27: one ping per waiting period; a failing notifier is logged and never stops the bot. */
  private async waitingPing(chat: string): Promise<boolean> {
    const now = this.at();
    const existing = this.deps.control.getWaiting(chat);
    if (existing) {
      this.deps.control.touchWaiting(chat, now);
      return false;
    }
    this.deps.control.openWaiting(chat, now);
    try {
      // ADM-53: nobody is on duty, so a push is held back; the stored alert is still raised for the dashboard.
      const quiet = !officeStatus(this.deps.control.getPresence(), this.deps.office, new Date(now)).onDuty;
      await this.deps.notifier?.notify({ chat, waitedMs: 0, ...(quiet ? { quiet } : {}) });
      this.deps.control.markPinged(chat);
      this.deps.store.appendAudit({ at: now, proposalId: null, kind: 'admin_ping', fromStatus: null, toStatus: null, actor: 'gate', detail: { chat } });
      return true;
    } catch (error) {
      this.deps.store.appendAudit({ at: now, proposalId: null, kind: 'admin_ping_failed', fromStatus: null, toStatus: null, actor: 'gate', detail: { chat, error: (error as Error).message } });
      return false;
    }
  }

  /**
   * ADM-110: a handler could not run for this chat's message and a person must answer (a scrubber hit, PRV-6): the chat
   * goes to a person like a failed transcription (ADM-28) and staff are pinged once for the waiting period.
   */
  async handOff(chat: string, reason: string): Promise<boolean> {
    if (this.deps.control.getChatState(chat) === 'bot') this.deps.control.setChatState(chat, 'handoff', 'gate', this.at(), reason);
    const pinged = await this.waitingPing(chat);
    this.record('waiting', 'handoff', { chat, reason });
    return pinged;
  }

  /** ADM-61: a toggle ends when the schedule next changes; without a schedule it holds until the other command. */
  private holdUntil(at: string): string | null {
    return this.deps.office ? (nextOfficeChange(this.deps.office, new Date(at))?.toISOString() ?? null) : null;
  }

  /** ADM-26: a person replied in the chat. */
  personReplied(chat: string, by = 'staff'): void {
    this.deps.control.recordSettled(chat, by, 'person_replied', this.at());
    if (this.deps.control.closeWaiting(chat, 'person_replied', this.at())) this.auditEnd(chat, 'person_replied');
  }

  private auditEnd(chat: string, reason: string): void {
    this.deps.store.appendAudit({ at: this.at(), proposalId: null, kind: 'admin_ping_ended', fromStatus: null, toStatus: null, actor: 'gate', detail: { chat, reason } });
    // ADM-48: not awaited (callers are synchronous); a failure is an audit row and changes nothing else.
    void this.deps.notifier?.resolved?.({ kind: 'customer_waiting', ref: chat }).catch((error: Error) => {
      this.deps.store.appendAudit({ at: this.at(), proposalId: null, kind: 'admin_ping_failed', fromStatus: null, toStatus: null, actor: 'gate', detail: { chat, resolved: true, error: error.message } });
    });
  }

  /** ADM-26, N-14: returns chats to the bot after the customer has been silent for the admin's interval. */
  resumeDue(): string[] {
    const now = (this.deps.now ?? (() => new Date()))().getTime();
    const interval = this.deps.config.handoffResumeMs ?? N14_HANDOFF_RESUME_MS;
    const resumed: string[] = [];
    for (const waiting of this.deps.control.listOpenWaiting()) {
      if (now - new Date(waiting.lastCustomerAt).getTime() < interval) continue;
      this.deps.control.closeWaiting(waiting.chat, 'auto_resume', this.at());
      this.deps.control.setChatState(waiting.chat, 'bot', 'gate', this.at(), `auto-resume after ${interval} ms of customer silence`);
      this.auditEnd(waiting.chat, 'auto_resume');
      resumed.push(waiting.chat);
    }
    return resumed;
  }

  /** ADM-11, ADM-12, ADM-36: runs a command and acknowledges it to the self or ops chat. */
  private async execute(line: string, actor: string): Promise<{ command: string; text: string }> {
    const [raw = '', ...args] = line.split(/\s+/);
    const command = COMMAND_ALIASES[raw.toLowerCase()] ?? raw.toLowerCase();
    const at = this.at();
    const control = this.deps.control;
    const m = staffMessages(this.deps.language ?? ENGLISH).commands;
    let text: string;
    switch (command) {
      case 'stop': case 'pause': case 'start': {
        const chat = args[0];
        if (!chat) { text = m.usage(command, '<chat>'); break; }
        control.setChatState(chat, command === 'start' ? 'bot' : command === 'stop' ? 'stopped' : 'paused', actor, at, `command ${command}`);
        if (command === 'start' && control.closeWaiting(chat, 'restarted', at)) this.auditEnd(chat, 'restarted');
        text = m.simple(command, chat);
        break;
      }
      case 'restart': {
        const chat = args[0];
        if (!chat) { text = m.usage('restart', '<chat>'); break; }
        control.setChatState(chat, 'bot', actor, at, 'command restart');
        if (control.closeWaiting(chat, 'restarted', at)) this.auditEnd(chat, 'restarted');
        text = m.simple('restart', chat);
        break;
      }
      case 'ooo': {
        const label = args.join(' ');
        if (!PRESENCE_LABEL_PATTERN.test(label)) { text = m.oooUsage; break; }
        const until = this.holdUntil(at);
        control.setPresence({ state: 'out_of_office', label, since: at, by: actor, until });
        text = m.ooo(label, this.deps.config.commandPrefix, until !== null);
        break;
      }
      case 'back': {
        control.setPresence({ state: 'in_office', label: '', since: at, by: actor, until: this.holdUntil(at) });
        const waiting = control.listOpenWaiting();
        text = waiting.length === 0 ? m.backNobody : m.back(waiting.map((w) => w.chat).join(', '));
        break;
      }
      case 'done': {
        const chat = args[0];
        if (!chat) { text = m.usage('done', '<chat>'); break; }
        control.recordSettled(chat, actor, 'done', at);
        text = m.done(chat);
        break;
      }
      case 'stopall': control.setGlobalStop(true, actor, at); text = m.stoppedAll; break;
      case 'startall': control.setGlobalStop(false, actor, at); text = m.startedAll; break;
      case 'role': {
        const [chat, role] = args;
        if (!chat || !CHAT_ROLES.includes(role as ChatRole)) { text = m.usage('role', `<chat> <${CHAT_ROLES.join('|')}>`); break; }
        control.setRole(chat, role as ChatRole, actor, at);
        text = m.role(chat, role!);
        break;
      }
      case 'lang': {
        const wanted = args[0]?.toLowerCase();
        if (!wanted || !STAFF_LANGUAGES.includes(wanted as StaffLanguage)) { text = m.languageUsage; break; }
        control.setLanguage(wanted as StaffLanguage, actor, at);
        // The acknowledgement is already in the new language, so the person sees the toggle worked.
        text = staffMessages(() => wanted as StaffLanguage).commands.language(wanted as StaffLanguage);
        break;
      }
      default: text = m.unknown(command);
    }
    this.assertAdminSink(this.deps.config.ack.channel);
    await this.deps.config.ack.send({ text, ref: `command:${command}` });
    return { command, text };
  }
}
