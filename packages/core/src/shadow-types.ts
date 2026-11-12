// docs/06 PRF-15..26, 63..70: shadow mode, the evaluation loop, lessons and the live gate.
import type { FactUsed } from './types.ts';

export const MARKINGS = ['match', 'better', 'worse', 'different_but_fine', 'wrong_fact'] as const;
export type Marking = (typeof MARKINGS)[number];

export interface ShadowEntry {
  id: string;
  createdAt: string;
  eventSource: string;
  eventId: string;
  handlerId: string;
  /** Effective version, including the lesson tag (PRF-67). */
  handlerVersion: string;
  proposalId: string | null;
  draft: string | null;
  /** The whole proposal body as JSON, for handlers whose output is not a draft. */
  output: unknown;
  /** The handler input after sealing: identity values are vault codes (PRF-64). */
  input: Record<string, unknown>;
  factsUsed: FactUsed[];
  humanReply: string | null;
  humanAction: string | null;
  humanAt: string | null;
  marking: Marking | null;
  markedBy: string | null;
  markedAt: string | null;
  /** PRF-31: did staff find the confidence band about right, too high or too low? */
  bandVerdict: 'about_right' | 'too_high' | 'too_low' | null;
}

export type NewShadowEntry = Pick<
  ShadowEntry,
  'eventSource' | 'eventId' | 'handlerId' | 'handlerVersion' | 'proposalId' | 'draft' | 'output' | 'input' | 'factsUsed'
>;

export interface HumanAction {
  reply?: string;
  action?: string;
}

export interface MarkingCounts {
  handlerId: string;
  handlerVersion: string;
  counts: Record<Marking | 'unmarked', number>;
}

export interface ShadowLog {
  addEntry(entry: NewShadowEntry, at: string): ShadowEntry;
  /** Attaches what the business's human did to every entry of the event; returns the entries touched. */
  recordHuman(source: string, eventId: string, human: HumanAction, at: string): ShadowEntry[];
  mark(entryId: string, marking: Marking, actor: string, at: string): ShadowEntry;
  setBandVerdict(entryId: string, verdict: 'about_right' | 'too_high' | 'too_low', actor: string, at: string): ShadowEntry;
  getEntry(id: string): ShadowEntry | null;
  listEntries(filter?: { handlerId?: string; handlerVersion?: string }): ShadowEntry[];
  /** PRF-26, PRF-69: counts per handler version, no single score. */
  markingCounts(): MarkingCounts[];
}

export interface Lesson {
  id: string;
  /** Null: applies to the whole business. */
  handlerId: string | null;
  text: string;
  originEntryId: string | null;
  version: number;
  status: 'active' | 'retired';
  createdAt: string;
}

export interface LessonStore {
  addLesson(lesson: { handlerId: string | null; text: string; originEntryId: string | null }, at: string): Lesson;
  retireLesson(id: string, at: string): Lesson;
  /** Active lessons for a handler: its own and the business-wide ones, oldest first. */
  activeLessonsFor(handlerId: string): Lesson[];
  listLessons(): Lesson[];
}

export interface LiveRecord {
  handlerId: string;
  enabledAt: string;
  enabledBy: string;
  evidence: unknown;
}

export interface LiveStore {
  enable(record: LiveRecord): void;
  isEnabled(handlerId: string): boolean;
  listEnabled(): LiveRecord[];
}
