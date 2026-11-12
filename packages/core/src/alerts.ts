// docs/10 ADM-45..48: where an admin alert goes. The store keeps it for the dashboard, the ops chat pushes it, the browser shows it.
import type { AdminNotifier, ControlStore } from './control.ts';
import { ENGLISH, staffMessages, type LanguageSource } from './messages.ts';
import type { OutboundSink } from './shadow.ts';

export type AlertKind = 'inference_key' | 'call_cap' | 'customer_waiting';

/** The alerts that are not about one chat (ADM-44, GWY-31). */
export type SystemAlertKind = Exclude<AlertKind, 'customer_waiting'>;

export interface AdminAlert {
  id: number;
  kind: AlertKind;
  /** The chat for `customer_waiting`; empty for alerts that are not about one chat. */
  ref: string;
  /** A fixed sentence. Never message text, a key or a provider response (ADM-25, ADM-44). */
  detail: string;
  raisedAt: string;
  seenAt: string | null;
  seenBy: string | null;
  clearedAt: string | null;
  clearedBy: string | null;
}

/** One open alert per (kind, ref): raising it again while it is open changes nothing (ADM-47). */
export interface AlertStore {
  raiseAlert(alert: { kind: AlertKind; ref: string; detail: string; at: string }): { alert: AdminAlert; created: boolean };
  listOpenAlerts(): AdminAlert[];
  markAlertSeen(id: number, actor: string, at: string): void;
  clearAlerts(kind: AlertKind, ref: string, actor: string, at: string): number;
}

/** ADM-45: the dashboard's source. It is also the only notifier that cannot be down while the bot is up. */
export class StoreNotifier implements AdminNotifier {
  constructor(
    private readonly store: AlertStore,
    private readonly now: () => Date = () => new Date(),
    private readonly language: LanguageSource = ENGLISH,
  ) {}

  async notify(ping: { chat: string; waitedMs: number; quiet?: boolean }): Promise<void> {
    this.store.raiseAlert({ kind: 'customer_waiting', ref: ping.chat, detail: waitingText(ping.chat, this.language), at: this.now().toISOString() });
  }

  async alert(alert: { kind: SystemAlertKind; detail: string }): Promise<void> {
    this.store.raiseAlert({ kind: alert.kind, ref: '', detail: alert.detail, at: this.now().toISOString() });
  }

  async resolved(what: { kind: AlertKind; ref: string }): Promise<void> {
    this.store.clearAlerts(what.kind, what.ref, 'system', this.now().toISOString());
  }
}

export const waitingText = (chat: string, language: LanguageSource = ENGLISH): string => staffMessages(language).waiting(chat);

/**
 * ADM-46: a card in an admin chat. The sink must be an admin chat: never the origin channel, never a customer (`reply`) chat
 * (ADM-8). The role is read at send time because roles can change.
 */
export class OpsChatNotifier implements AdminNotifier {
  constructor(
    private readonly sink: OutboundSink,
    private readonly control: Pick<ControlStore, 'getRole'>,
    private readonly originChannel?: string,
    private readonly language: LanguageSource = ENGLISH,
  ) {}

  private assertAdminChat(): void {
    if (this.sink.channel === this.originChannel || this.control.getRole(this.sink.channel) === 'reply') {
      throw new Error(`"${this.sink.channel}" is the origin or a customer chat; alerts go to admins only (ADM-8, ADM-46)`);
    }
  }

  async notify(ping: { chat: string; waitedMs: number; quiet?: boolean }): Promise<void> {
    if (ping.quiet) return; // ADM-53: out of office, the stored alert is enough
    this.assertAdminChat();
    await this.sink.send({ text: `${staffMessages(this.language).prefixPerson} ${waitingText(ping.chat, this.language)}`, ref: `waiting:${ping.chat}` });
  }

  /** ADM-56: a handoff card. Unlike a ping it may carry message text, because it goes only to an admin chat (ADM-8). */
  async card(chat: string, text: string): Promise<void> {
    this.assertAdminChat();
    await this.sink.send({ text, ref: `card:${chat}` });
  }

  async alert(alert: { kind: SystemAlertKind; detail: string }): Promise<void> {
    this.assertAdminChat();
    await this.sink.send({ text: `${staffMessages(this.language).prefixAttention} ${alert.detail}`, ref: `alert:${alert.kind}` });
  }
}

/**
 * ADM-47: every notifier is tried. The call fails only when every notifier that supports it failed, so one path being down
 * (WhatsApp dropped, a tab closed) does not hide the alert, and the caller still logs a total failure.
 */
export function fanOutNotifier(...notifiers: AdminNotifier[]): AdminNotifier {
  async function each<K extends 'notify' | 'alert' | 'resolved'>(method: K, ...args: Parameters<NonNullable<AdminNotifier[K]>>): Promise<void> {
    const attempts = notifiers.flatMap((n) => {
      const fn = n[method] as ((...a: unknown[]) => Promise<void>) | undefined;
      return fn ? [fn.apply(n, args)] : [];
    });
    if (attempts.length === 0) return;
    const settled = await Promise.allSettled(attempts);
    const failures = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected');
    if (failures.length === settled.length) {
      throw new Error(failures.map((f) => (f.reason as Error).message).join('; '));
    }
  }
  return {
    notify: (ping) => each('notify', ping),
    alert: (alert) => each('alert', alert),
    resolved: (what) => each('resolved', what),
  };
}
