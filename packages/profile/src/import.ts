import type { FactClass, FactSourceKind, NewFact, ProfileStore } from '@cyborg/core';

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

export const ORDER = '$order';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const isPlainObject = (v: unknown): v is { [key: string]: Json } => typeof v === 'object' && v !== null && !Array.isArray(v);
const isScalar = (v: unknown): boolean => v === null || ['string', 'number', 'boolean'].includes(typeof v);

function segmentOk(segment: string): boolean {
  return segment.length > 0 && !segment.includes('.') && segment !== ORDER;
}

/** PRF-61: parsed tree -> dotted-key facts. Throws `ImportError` for anything that cannot be represented exactly. */
export function flattenTree(tree: unknown): { key: string; value: Json }[] {
  if (!isPlainObject(tree)) throw new ImportError('the root of an import must be an object');
  const out: { key: string; value: Json }[] = [];

  const visit = (path: string, value: Json): void => {
    if (isScalar(value)) return void out.push({ key: path, value });
    if (Array.isArray(value)) {
      const objects = value.length > 0 && value.every(isPlainObject);
      if (!objects) return void out.push({ key: path, value }); // scalars, empty or mixed: one fact
      const ids = value.map((v) => (v as { id?: unknown }).id);
      const idKeyed = ids.every((id) => typeof id === 'string' && segmentOk(id)) && new Set(ids).size === ids.length;
      const segments = idKeyed ? (ids as string[]) : value.map((_, i) => String(i));
      out.push({ key: `${path}.${ORDER}`, value: segments });
      value.forEach((item, i) => visit(`${path}.${segments[i]!}`, item));
      return;
    }
    const entries = Object.entries(value as { [key: string]: Json });
    if (entries.length === 0) return void out.push({ key: path, value });
    for (const [name, child] of entries) {
      if (!segmentOk(name)) throw new ImportError(`key "${name}" under "${path}" cannot be a fact key segment (empty, contains ".", or is "${ORDER}")`);
      visit(`${path}.${name}`, child);
    }
  };

  for (const [name, child] of Object.entries(tree)) {
    if (!segmentOk(name)) throw new ImportError(`top-level key "${name}" cannot be a fact key segment`);
    visit(name, child);
  }
  return out;
}

interface Node {
  hasValue: boolean;
  value?: Json;
  children: Map<string, Node>;
}

/** The inverse of `flattenTree` (key order of objects aside). */
export function buildTree(facts: readonly { key: string; value: unknown }[]): Json {
  const root: Node = { hasValue: false, children: new Map() };
  for (const { key, value } of facts) {
    let node = root;
    for (const segment of key.split('.')) {
      let child = node.children.get(segment);
      if (!child) node.children.set(segment, (child = { hasValue: false, children: new Map() }));
      node = child;
    }
    if (node.hasValue || node.children.size > 0) throw new ImportError(`fact "${key}" collides with another fact`);
    node.hasValue = true;
    node.value = value as Json;
  }
  const materialize = (node: Node, path: string): Json => {
    if (node.hasValue) {
      if (node.children.size > 0) throw new ImportError(`fact "${path}" has both a value and children`);
      return node.value as Json;
    }
    const order = node.children.get(ORDER);
    if (order) {
      const segments = order.value as string[];
      return segments.map((segment) => {
        const child = node.children.get(segment);
        if (!child) throw new ImportError(`"${path}" lists "${segment}" in ${ORDER} but has no such fact`);
        return materialize(child, `${path}.${segment}`);
      });
    }
    const object: { [key: string]: Json } = {};
    for (const [name, child] of node.children) object[name] = materialize(child, path ? `${path}.${name}` : name);
    return object;
  };
  return materialize(root, '');
}

export interface ImportOptions {
  source: FactSourceKind;
  /** Where the tree came from (a file path or URL). Each fact's own reference is `<sourceRef>#<key>`. */
  sourceRef: string;
  class: FactClass;
  /** Prepended to every key, for example `catalog`. */
  prefix?: string;
  actor: string;
  at: string;
  reviewBy?: string | null;
}

export interface ImportResult {
  added: number;
  replaced: number;
  unchanged: number;
}

/**
 * PRF-61, PRF-10: every fact enters `unconfirmed` with its source. A fact whose value and source are
 * unchanged is left alone, so re-importing never undoes a confirmation.
 */
export function importTree(store: ProfileStore, tree: unknown, options: ImportOptions): ImportResult {
  const result: ImportResult = { added: 0, replaced: 0, unchanged: 0 };
  for (const { key, value } of flattenTree(tree)) {
    const fullKey = options.prefix ? `${options.prefix}.${key}` : key;
    const existing = store.getFact(fullKey);
    const sourceRef = `${options.sourceRef}#${key}`;
    if (existing && existing.source === options.source && existing.sourceRef === sourceRef && JSON.stringify(existing.value) === JSON.stringify(value)) {
      result.unchanged++;
      continue;
    }
    const fact: NewFact = { key: fullKey, value, class: options.class, source: options.source, sourceRef, reviewBy: options.reviewBy ?? null };
    store.putFact(fact, options.actor, options.at);
    existing ? result.replaced++ : result.added++;
  }
  return result;
}

/** Rebuilds the tree of everything under `prefix`. */
export function exportTree(store: ProfileStore, prefix?: string): Json {
  const facts = store.listFacts(prefix).map((f) => ({
    key: prefix ? f.key.slice(prefix.length + 1) : f.key,
    value: f.value,
  }));
  return buildTree(facts);
}
