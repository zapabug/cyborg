import type { AdminNotifier, CyborgEvent, MediaForward, OutboundMessage, OutboundSink, SpeechToText } from '@cyborg/core';
import { ChannelGate, type GateConfig } from '@cyborg/core';
import { SqliteStore } from '@cyborg/store-sqlite';

export class Sink implements OutboundSink {
  sent: OutboundMessage[] = [];
  constructor(readonly channel: string) {}
  async send(m: OutboundMessage) {
    this.sent.push(m);
  }
}

export class Notifier implements AdminNotifier {
  pings: { chat: string; waitedMs: number }[] = [];
  fail = false;
  async notify(ping: { chat: string; waitedMs: number }) {
    if (this.fail) throw new Error('toast daemon is not running');
    this.pings.push(ping);
  }
}

export class Forward implements MediaForward {
  forwarded: { chat: string; type: string }[] = [];
  constructor(readonly channel: string) {}
  async forward(chat: string, media: { type: string; ref: string }) {
    this.forwarded.push({ chat, type: media.type });
  }
}

export class Stt implements SpeechToText {
  discarded: string[] = [];
  constructor(private result: string | Error) {}
  async transcribe() {
    if (this.result instanceof Error) throw this.result;
    return { text: this.result };
  }
  async discard(media: { ref: string }) {
    this.discarded.push(media.ref);
  }
}

export const clock = { now: new Date('2026-10-31T10:00:00.000Z') };
export const advance = (ms: number) => {
  clock.now = new Date(clock.now.getTime() + ms);
};

export const OWNER = 'owner-ref';
export const CUSTOMER_CHAT = 'chat-customer-1';
export const GROUP_CHAT = 'chat-group-1';

/** Opaque chat references stand in for the adapter's mapping of real chat ids (ADM-34). */
export function gateRig(over: { config?: Partial<GateConfig>; stt?: Stt; forward?: Forward; withNotifier?: boolean } = {}) {
  clock.now = new Date('2026-10-31T10:00:00.000Z');
  const store = new SqliteStore(':memory:');
  const ack = new Sink('owner-self-chat');
  const notifier = new Notifier();
  const forward = over.forward ?? new Forward('admin-review-chat');
  const gate = new ChannelGate({
    control: store,
    store,
    config: { commandPrefix: '.', authorisedSenders: [OWNER], ack, ...over.config },
    ...(over.withNotifier === false ? {} : { notifier }),
    ...(over.stt ? { transcriber: over.stt } : {}),
    forward,
    now: () => clock.now,
  });
  store.setRole(CUSTOMER_CHAT, 'reply', 'setup', clock.now.toISOString());
  store.setRole(GROUP_CHAT, 'reply', 'setup', clock.now.toISOString());
  return { store, gate, ack, notifier, forward };
}

let n = 0;
export const ev = (payload: Record<string, unknown>, id = `ev-${++n}`): CyborgEvent => ({
  id,
  source: 'chat',
  kind: 'message.received',
  at: clock.now.toISOString(),
  payload: { chat: CUSTOMER_CHAT, isGroup: false, addressed: true, sender: 'customer-ref', text: 'hello', ...payload },
});
