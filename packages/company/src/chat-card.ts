// feat-desk DK2b / DSK-79, 80, 82: the chat card, one record per chat. What the customer has told us in THIS chat, built by code from each message's
// validated extraction (every value has a source phrase that occurs in the message, HDL-6), merged into the chat's record, and shown to the reply
// writer so it does not ask again for what it was told and asks for the next missing detail. A different chat starts empty. Never a free summary.
import type { ModuleStateStore } from '@cyborg/core';

export const CHAT_CARD_MODULE = 'chat-card';
// N-20 (docs/02): the numbers below live there.
const VALUE_MAX = 120;
const HISTORY_MAX = 5;

export interface ChatCardField {
  value: string;
  sourcePhrase: string;
  at: string;
  /** What this field held before, newest first. */
  was: { value: string; at: string }[];
}

export interface ChatCard {
  fields: Record<string, ChatCardField>;
  updatedAt: string;
}

export interface EnquiryField {
  name: string;
  description: string;
}

/** A value comes from the customer's words: one line, bounded, so it reads as data and never as a paragraph of instructions. */
const clean = (value: string): string => value.replace(/\s+/g, ' ').trim().slice(0, VALUE_MAX);

/** The chat's card, or an empty one: a chat that has been silent for `idleHours` (when the business sets it) starts a new card (DSK-82). */
export function readChatCard(store: ModuleStateStore, chat: string, now: Date, idleHours?: number): ChatCard {
  const stored = store.getModuleState<ChatCard>(CHAT_CARD_MODULE, chat)?.value;
  if (!stored || typeof stored !== 'object' || typeof stored.fields !== 'object') return { fields: {}, updatedAt: now.toISOString() };
  if (idleHours !== undefined && now.getTime() - Date.parse(stored.updatedAt) > idleHours * 3_600_000) return { fields: {}, updatedAt: now.toISOString() };
  return stored;
}

/** Merges one message's extraction into the chat's card. A later value replaces the earlier one and keeps it in `was`. Returns whether anything changed. */
export function mergeIntoChatCard(
  store: ModuleStateStore,
  chat: string,
  changes: readonly { field: string; newValue: unknown; sourcePhrase?: unknown }[],
  fieldNames: readonly string[],
  now: Date,
  idleHours?: number,
): boolean {
  const card = readChatCard(store, chat, now, idleHours);
  const at = now.toISOString();
  let changed = false;
  for (const c of changes) {
    if (!fieldNames.includes(c.field) || typeof c.newValue !== 'string') continue;
    const value = clean(c.newValue);
    if (value === '') continue;
    const before = card.fields[c.field];
    if (before?.value === value) continue;
    card.fields[c.field] = { value, sourcePhrase: clean(String(c.sourcePhrase ?? '')), at, was: before ? [{ value: before.value, at: before.at }, ...before.was].slice(0, HISTORY_MAX) : [] };
    changed = true;
  }
  if (!changed) return false;
  card.updatedAt = at;
  store.setModuleState(CHAT_CARD_MODULE, chat, card, 'chat-card', at);
  return true;
}

/** The card as the writer reads it: what the customer told us, and the fields still missing, in the business's own field descriptions. */
export function renderChatCard(card: ChatCard, fields: readonly EnquiryField[]): string {
  const told = fields.filter((f) => card.fields[f.name]).map((f) => `- ${f.name} (${f.description}): ${card.fields[f.name]!.value}`);
  const missing = fields.filter((f) => !card.fields[f.name]).map((f) => `- ${f.name}: ${f.description}`);
  return [
    `Told by the customer in this chat so far:${told.length ? `\n${told.join('\n')}` : ' nothing yet.'}`,
    `Still missing:${missing.length ? `\n${missing.join('\n')}` : ' nothing; every field has been given.'}`,
  ].join('\n');
}
