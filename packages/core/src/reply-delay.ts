// BEH-16..18, ADM-38: customers finish a thought before the bot answers.
import { N13_REPLY_DELAY_MS } from './numbers.ts';
import type { CyborgEvent, Proposal } from './types.ts';

export interface ReplySchedulerDeps {
  /** Runs a ready event (the joined burst) through the handlers. */
  run(event: CyborgEvent): Promise<Proposal[]>;
  /** Moves an earlier proposal to `superseded` (BEH-18). */
  supersede(proposalId: string): void;
  /** Reads a proposal's current status, so only an open one is superseded. */
  isOpen(proposalId: string): boolean;
  delayMs?: number;
  /** OPEN in the spec; unset means no maximum. */
  maxWaitMs?: number;
}

interface Pending {
  chat: string;
  messages: CyborgEvent[];
  firstAt: number;
  lastAt: number;
}

/** Time is passed in (`now`), so callers and tests control the clock. */
export class ReplyScheduler {
  private readonly pending = new Map<string, Pending>();
  private readonly open = new Map<string, string[]>();

  constructor(private readonly deps: ReplySchedulerDeps) {}

  private delay(): number {
    return this.deps.delayMs ?? N13_REPLY_DELAY_MS;
  }

  /**
   * A customer message. Held for N-13 after the last message of the burst (each new one restarts the wait).
   * A new message while an earlier proposal for the chat is still open supersedes that proposal (BEH-18).
   */
  submit(event: CyborgEvent, now: number): void {
    const chat = String(event.payload['chat'] ?? '');
    for (const id of this.open.get(chat) ?? []) if (this.deps.isOpen(id)) this.deps.supersede(id);
    this.open.delete(chat);
    const current = this.pending.get(chat);
    if (current) {
      current.messages.push(event);
      current.lastAt = now;
    } else {
      this.pending.set(chat, { chat, messages: [event], firstAt: now, lastAt: now });
    }
  }

  /** BEH-17: commands, kill switches, ops-chat and manual events are never delayed. */
  async immediate(event: CyborgEvent): Promise<Proposal[]> {
    return this.deps.run(event);
  }

  /** Runs every burst that is due: N-13 after its last message, or past the maximum wait if one is set. */
  async tick(now: number): Promise<{ chat: string; messages: number; proposals: Proposal[] }[]> {
    const done: { chat: string; messages: number; proposals: Proposal[] }[] = [];
    for (const [chat, burst] of [...this.pending]) {
      const quiet = now - burst.lastAt >= this.delay();
      const tooLong = this.deps.maxWaitMs !== undefined && now - burst.firstAt >= this.deps.maxWaitMs;
      if (!quiet && !tooLong) continue;
      this.pending.delete(chat);
      const last = burst.messages.at(-1)!;
      const joined: CyborgEvent = {
        ...last,
        payload: { ...last.payload, text: burst.messages.map((m) => String(m.payload['text'] ?? '')).join('\n') },
      };
      const proposals = await this.deps.run(joined);
      this.open.set(chat, proposals.map((p) => p.id));
      done.push({ chat, messages: burst.messages.length, proposals });
    }
    return done;
  }

  pendingChats(): string[] {
    return [...this.pending.keys()];
  }
}
