// docs/10 ADM-92..95: the one place a person looks. A module that leaves work for a person contributes items; the board, the toast and
// the dashboard are the same for all of them. The dashboard knows no module.

export type AttentionColour = 'red' | 'yellow' | 'green';
export const ATTENTION_ORDER: Record<AttentionColour, number> = { red: 0, yellow: 1, green: 2 };

export interface AttentionAction {
  id: string;
  label: string;
}

export interface AttentionItem {
  /** Unique across sources: `<source>:<id>`. */
  key: string;
  /** The module or plug-in that made it. */
  source: string;
  /** What kind of thing: `chat`, `complaint`, `inspection`. The source decides. */
  kind: string;
  colour: AttentionColour;
  /** What a person recognises it by: a customer's first name, a vehicle, a site. */
  title: string;
  /** One line of what is needed. May name people or contain text, so it is shown on a toast only if the company allows it. */
  summary: string | null;
  /** A neutral label that leaves out anything personal: a chat reference, a plate, a review reference. Used by `reference_only` toasts. */
  reference: string;
  /** A fixed sentence for why it is here, with nothing personal in it. Used by `reference_only` toasts. */
  reasonText: string;
  /** When the oldest need began (ISO). */
  since: string;
  /** Module-defined reason codes, for the module's own detail view. */
  reasons: string[];
  /**
   * ADM-97: for a green item, how often this kind of reply has been right, as counts. Present only when a source has a record to show;
   * `candidate` flags a kind a person might consider automating. It is evidence for that person, not a switch.
   */
  record?: { right: number; considered: number; of: number; candidate: boolean };
  /** The buttons a person can press: on the item, and on its toast where the browser shows them. */
  actions: AttentionAction[];
  /** Where a click goes in the dashboard. Defaults to the generic item view. */
  open?: string;
}

export interface AttentionSource {
  id: string;
  /** Everything of this source's that needs a person now, as items. Read each time; nothing is cached. */
  items(): AttentionItem[];
  /** A person pressed one of the item's actions. Throws if the action is not one it offered. */
  act?(itemKey: string, actionId: string, by: string): void;
  /** The generic item view, for an item with no view of its own (a complaint's words, an inspection's dates). */
  detail?(itemKey: string): Promise<{ title: string; text: string } | null>;
}

export function collectAttention(sources: readonly AttentionSource[]): AttentionItem[] {
  return sources.flatMap((s) => s.items()).sort((a, b) => ATTENTION_ORDER[a.colour] - ATTENTION_ORDER[b.colour] || a.since.localeCompare(b.since));
}

export interface AttentionToast {
  title: string;
  body: string;
  colour: AttentionColour;
  open: string;
  actions: AttentionAction[];
  key: string;
}

const MAX_BODY = 120;

/**
 * The toast for any item. With `name_and_summary` it carries the title and the one-line summary; with `reference_only` only the
 * neutral reference and the fixed reason, for a screen that others can see. The body is cut at 120 characters.
 */
export function toastForItem(item: AttentionItem, detail: 'name_and_summary' | 'reference_only' = 'name_and_summary'): AttentionToast {
  const body = detail === 'name_and_summary' ? (item.summary ?? item.reasonText) : item.reasonText;
  return {
    key: item.key,
    title: detail === 'name_and_summary' ? item.title : item.reference,
    body: body.length > MAX_BODY ? `${body.slice(0, MAX_BODY - 1)}…` : body,
    colour: item.colour,
    open: item.open ?? `#/item/${encodeURIComponent(item.key)}`,
    actions: item.actions,
  };
}
