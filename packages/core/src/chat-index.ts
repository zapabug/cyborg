// docs/10 ADM-81..86: which chat an event, a proposal and a customer's name belong to, so a board of chats can be drawn.

export interface ChatIndex {
  /** Records that this event came from this chat. The core keeps no chat history; this is only the link. */
  linkEvent(source: string, eventId: string, chat: string, at: string): void;
  chatOfEvent(source: string, eventId: string): string | null;
  /** Every chat that has had an event, most recent first, with the time of its last customer message. */
  listChats(): { chat: string; lastAt: string }[];
  /** The customer's display name as a vault code (identity class: it never goes to a model; it is read back only to show staff). */
  setContact(chat: string, nameCode: string, at: string): void;
  getContact(chat: string): string | null;
}
