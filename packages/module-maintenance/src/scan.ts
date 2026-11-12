import { scrub } from '@cyborg/core';

// feat WZP-60: finding an asset and a problem in a team chat message with no model: plain, deterministic, the same answer every time. What it reads is the
// business's list of assets (plates, tags, nicknames, consumables) and its own words for a problem. Only a hit is kept, and only as a scrubbed snippet.

export interface Asset {
  id: string;
  label?: string;
  /** Plates and tags. Matched ignoring case, accents, spaces and dashes: "AA 12 BB", "aa-12-bb" and "AA12BB" are one. */
  identifiers: string[];
  /** The nicknames the team uses, as whole words. */
  aliases: string[];
  /** Consumables flagged for attention on this asset: naming one beside the asset counts as a low-priority signal. */
  consumables?: string[];
}

export type Priority = 'high' | 'medium' | 'low';
export interface IssueWords {
  high: readonly string[];
  medium: readonly string[];
  low: readonly string[];
}

const RANK: Record<Priority, number> = { high: 3, medium: 2, low: 1 };

/** Lower case with accents taken off, so "não" and "nao" are the same word to the matcher. */
export const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BOUND_L = '(?<![\\p{L}\\p{N}])';
const BOUND_R = '(?![\\p{L}\\p{N}])';

const wordPattern = (term: string): RegExp => new RegExp(`${BOUND_L}${escape(fold(term).trim()).replace(/\s+/g, '\\s+')}${BOUND_R}`, 'u');
const identifierPattern = (id: string): RegExp => {
  const chars = [...fold(id).replace(/[\s-]+/g, '')].map(escape);
  return new RegExp(`${BOUND_L}${chars.join('[\\s-]*')}${BOUND_R}`, 'u');
};

export function assetsIn(text: string, assets: readonly Asset[]): Asset[] {
  const t = fold(text);
  return assets.filter((a) => a.identifiers.some((i) => i.trim() !== '' && identifierPattern(i).test(t)) || a.aliases.some((x) => x.trim() !== '' && wordPattern(x).test(t)));
}

export interface IssueHit {
  priority: Priority;
  terms: string[];
}

/** The problem words in a message, the most urgent level they reach. Null when there are none. */
export function issuesIn(text: string, words: IssueWords, extra: readonly string[] = []): IssueHit | null {
  const t = fold(text);
  const terms: string[] = [];
  let priority: Priority | null = null;
  for (const level of ['high', 'medium', 'low'] as const) {
    for (const w of words[level]) {
      if (w.trim() !== '' && wordPattern(w).test(t)) {
        terms.push(w);
        if (priority === null || RANK[level] > RANK[priority]) priority = level;
      }
    }
  }
  for (const w of extra) {
    if (w.trim() !== '' && wordPattern(w).test(t)) {
      terms.push(w);
      priority ??= 'low';
    }
  }
  return priority === null ? null : { priority, terms: [...new Set(terms)] };
}

/** The message with what the scrubber finds (phones, emails, ids) taken out, so a snippet can be kept without a person's data in it. */
export function redact(text: string): string {
  let out = '';
  let at = 0;
  for (const hit of scrub(text)) {
    if (hit.start < at) continue;
    out += `${text.slice(at, hit.start)}[removed]`;
    at = hit.end;
  }
  return out + text.slice(at);
}

/** What one message said, kept only as ids and words: enough to join it with the next messages. */
export interface Seen {
  at: number;
  assets: string[];
  issue: IssueHit | null;
}

export interface Hit {
  asset: string;
  priority: Priority;
  terms: string[];
}

export interface Window {
  messages: number;
  ms: number;
}

/**
 * An asset and a problem together, in this message or within the window of the messages before it. An asset with no problem near it, or a problem with no
 * asset near it, is no hit: that is the noise guard. `before` is the earlier messages of the same chat, oldest first.
 */
export function hitsFor(current: Seen, before: readonly Seen[], window: Window): Hit[] {
  const near = before.slice(Math.max(0, before.length - window.messages)).filter((s) => current.at - s.at <= window.ms).reverse();
  const hits = new Map<string, Hit>();
  const add = (asset: string, issue: IssueHit) => {
    const known = hits.get(asset);
    if (!known || RANK[issue.priority] > RANK[known.priority]) hits.set(asset, { asset, priority: issue.priority, terms: issue.terms });
  };
  if (current.issue) {
    for (const asset of current.assets) add(asset, current.issue);
    if (current.assets.length === 0) for (const s of near) for (const asset of s.assets) add(asset, current.issue);
  } else if (current.assets.length > 0) {
    const issue = near.map((s) => s.issue).filter((i): i is IssueHit => i !== null).sort((a, b) => RANK[b.priority] - RANK[a.priority])[0];
    if (issue) for (const asset of current.assets) add(asset, issue);
  }
  return [...hits.values()];
}
