// docs/06: business profile, knowledge packs and the port the runner uses to read them.

export type FactClass = 'public' | 'deal';
export type FactSourceKind = 'client_statement' | 'store_sync' | 'document' | 'observation' | 'shadow_run';
export type FactStatus = 'unconfirmed' | 'confirmed' | 'contradicted' | 'stale';

export interface Fact {
  key: string;
  /** JSON-compatible value, typed by the profile schemas the modules declare. */
  value: unknown;
  class: FactClass;
  source: FactSourceKind;
  sourceRef: string;
  status: FactStatus;
  /** Adapter reference for the person who confirmed (a vault code, never a name). */
  confirmedBy: string | null;
  confirmedAt: string | null;
  reviewBy: string | null;
  updatedAt: string;
}

export interface NewFact {
  key: string;
  value: unknown;
  class: FactClass;
  source: FactSourceKind;
  sourceRef: string;
  reviewBy?: string | null;
}

const FACT_MOVES: Readonly<Record<FactStatus, readonly FactStatus[]>> = {
  unconfirmed: ['confirmed', 'contradicted'],
  confirmed: ['contradicted', 'stale'],
  contradicted: ['confirmed'],
  stale: ['confirmed'],
};

/** PRF-2 */
export function canMoveFact(from: FactStatus, to: FactStatus): boolean {
  return FACT_MOVES[from].includes(to);
}

export class IllegalFactMoveError extends Error {
  constructor(key: string, from: FactStatus, to: FactStatus) {
    super(`fact "${key}": ${from} -> ${to} is not allowed (PRF-2)`);
    this.name = 'IllegalFactMoveError';
  }
}

/** PRF-54: a confirmed fact past its `reviewBy` date reads as stale. */
export function effectiveStatus(fact: Fact, now: Date): FactStatus {
  if (fact.status === 'confirmed' && fact.reviewBy !== null && new Date(fact.reviewBy).getTime() < now.getTime()) return 'stale';
  return fact.status;
}

export interface FactSourceInfo {
  kind: FactSourceKind | string;
  /** The origin: a URL, a file, a field, a page script. */
  ref: string;
}

export interface DiscrepancyEvidence {
  source: FactSourceInfo;
  observed: unknown;
  note?: string;
}

export interface Discrepancy {
  id: string;
  factKey: string;
  createdAt: string;
  status: 'open' | 'resolved';
  factValue: unknown;
  factSource: FactSourceInfo;
  evidence: DiscrepancyEvidence[];
  /** True when only one source supports the claim (PRF-9). */
  singleSource: boolean;
}

export interface CheckRecord {
  id: number;
  factKey: string;
  checkedAt: string;
  independent: FactSourceInfo;
  observed: unknown;
  outcome: 'pass' | 'fail';
  note: string | null;
}

export interface ProfileStore {
  /** A new key, or a replaced value (PRF-55: back to `unconfirmed`, old value kept in the audit event). */
  putFact(fact: NewFact, actor: string, at: string): Fact;
  getFact(key: string): Fact | null;
  listFacts(prefix?: string): Fact[];
  /** Enforces PRF-2 and writes the audit event in the same transaction. */
  moveFact(key: string, to: FactStatus, change: { actor: string; at: string; reason?: string }): Fact;
  recordCheck(record: Omit<CheckRecord, 'id'>): void;
  listChecks(factKey?: string): CheckRecord[];
  addDiscrepancy(discrepancy: Omit<Discrepancy, 'id'>): Discrepancy;
  listDiscrepancies(status?: 'open' | 'resolved'): Discrepancy[];
}

// ---- knowledge packs (PRF-11..13): data only ----------------------------------

export type PackGradeValue = 'checked' | 'secondary' | 'unverified';

export const GRADE_ORDER: Record<PackGradeValue, number> = { unverified: 0, secondary: 1, checked: 2 };

export interface PackFact {
  key: string;
  value: unknown;
  grade: PackGradeValue;
  sourceUrl: string;
  sourceDate: string;
  asOf: string;
  reviewBy?: string;
}

export interface Pack {
  id: string;
  version: string;
  asOf: string;
  facts: PackFact[];
  openQuestions: string[];
}

import type { CapabilityResult } from './types.ts';
export type { CapabilityResult };

// ---- what the runner needs ---------------------------------------------------------

export type RunMode = 'shadow' | 'live';

export interface ResolvedFacts {
  /** `runtime` marks a fact computed at run time by a connector or from local state (CMP-27): never stored in the profile. */
  profile: { key: string; value: unknown; class: FactClass; status: FactStatus; runtime?: true; asOf?: string }[];
  pack: { key: string; value: unknown; grade: PackGradeValue; sourceUrl: string }[];
}

export interface BlockedFact {
  kind: 'profile' | 'pack';
  key: string;
  reason: string;
}

/**
 * CMP-27: a fact that an add-on (a GPS feed, a job sheet, the on-duty toggle) supplies at run time. It is a sentence built in
 * code from the add-on's data, so raw coordinates, names and numbers from the add-on never reach a prompt. It is `public` or
 * `deal`; identity and secret values are refused at registration (PRV-2).
 */
export interface RuntimeFactSource {
  class: Extract<FactClass, 'public' | 'deal'>;
  /** Older than this and the fact is withheld and the handler that needs it does not run. Null means it is current by construction (local state). */
  maxAgeMs: number | null;
  /** Null means the add-on has nothing right now. `asOf` is when the data was true. */
  read(now: Date): { sentence: string; asOf: string } | null;
}

export interface FactProvider {
  resolve(request: {
    profileKeys: readonly string[];
    packFacts: readonly { key: string; minGrade: PackGradeValue }[];
    mode: RunMode;
    now: Date;
  }): { ok: true; facts: ResolvedFacts } | { ok: false; blocked: BlockedFact[] };
}
