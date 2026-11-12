import { ENGLISH, staffMessages, type LanguageSource } from './messages.ts';
import { localLabel, nextOfficeChange, officeOpenAt, type OfficeSchedule } from './office.ts';
import type { RuntimeFactSource } from './profile-types.ts';

// docs/10 ADM-50..53: whether a person is watching the chat. A toggle a chat admin flips; the bot learns it as a fact.

export interface Presence {
  state: 'in_office' | 'out_of_office';
  /** Free label the admin typed, such as "back 09:00 Monday". Shown as given, never parsed (ADM-51). */
  label: string;
  since: string;
  by: string;
  /**
   * ADM-61: with an office schedule, a toggle holds until the schedule next changes (an `.ooo` at 11:00 ends when the office would
   * close, a `.back` on a closed day ends at the next opening), so a forgotten toggle cannot outlive the day. Absent without a schedule.
   */
  until?: string | null;
}

/** The label goes into a prompt as a fact, so it is short and plain (ADM-51). */
export const PRESENCE_LABEL_PATTERN = /^[\p{L}\p{N} :.,/+()-]{0,40}$/u;

export const PRESENCE_FACT_KEY = 'presence.status';

/**
 * ADM-52, ADM-71: the sentences the bot is given about who is at the office. The company may rewrite them (`wording` in its config);
 * `{note}` stands for the staff note or the time the office is back. They go into a prompt, so they are plain, short text.
 */
export interface PresenceWording {
  onDuty?: string | undefined;
  outOfOffice?: string | undefined;
  outOfOfficeWithNote?: string | undefined;
}

export type FullPresenceWording = { onDuty: string; outOfOffice: string; outOfOfficeWithNote: string };

/** The built-in English lines; the Portuguese ones are in the staff messages. */
export const DEFAULT_PRESENCE_WORDING: FullPresenceWording = staffMessages(ENGLISH).presence;

/** The company's lines where it set them, the built-in ones where it did not. */
export function presenceWording(wording: PresenceWording = {}, language: LanguageSource = ENGLISH): FullPresenceWording {
  const built = staffMessages(language).presence;
  return {
    onDuty: wording.onDuty ?? built.onDuty,
    outOfOffice: wording.outOfOffice ?? built.outOfOffice,
    outOfOfficeWithNote: wording.outOfOfficeWithNote ?? built.outOfOfficeWithNote,
  };
}

/** ADM-52: the sentence the bot is given. Built in code from the toggle; the model only words the reply around it. */
export function presenceSentence(presence: Presence | null, wording: PresenceWording = {}, language: LanguageSource = ENGLISH): string {
  const w = presenceWording(wording, language);
  if (!presence || presence.state === 'in_office') return w.onDuty;
  return presence.label ? w.outOfOfficeWithNote.replaceAll('{note}', presence.label) : w.outOfOffice;
}

export interface OfficeStatus {
  /** Whether the bot should assume a person is watching the chat. */
  onDuty: boolean;
  sentence: string;
  /** `manual`: a toggle a person flipped; `schedule`: the office hours and calendar; `default`: nothing is set, a person is assumed. */
  source: 'manual' | 'schedule' | 'default';
}

/**
 * ADM-60..62: who is assumed at the office now. A toggle that has not expired wins; otherwise the schedule decides; with neither,
 * a person is assumed (as before the schedule existed). A person answering outside the hours changes nothing here: the bot does its
 * job whether or not anyone answers (ADM-63).
 */
export function officeStatus(manual: Presence | null, schedule: OfficeSchedule | null | undefined, now: Date, wording: PresenceWording = {}, language: LanguageSource = ENGLISH): OfficeStatus {
  const active = manual && (manual.until == null || now.getTime() < new Date(manual.until).getTime()) ? manual : null;
  if (active) return { onDuty: active.state === 'in_office', sentence: presenceSentence(active, wording, language), source: 'manual' };
  if (!schedule) return { onDuty: true, sentence: presenceSentence(null, wording, language), source: 'default' };
  if (officeOpenAt(schedule, now).open) return { onDuty: true, sentence: presenceSentence(null, wording, language), source: 'schedule' };
  const next = nextOfficeChange(schedule, now);
  return { onDuty: false, sentence: presenceSentence({ state: 'out_of_office', label: next ? `${staffMessages(language).presence.back} ${localLabel(next, schedule.timezone, staffMessages(language).weekdayLocale)}` : '', since: now.toISOString(), by: 'schedule' }, wording, language), source: 'schedule' };
}

/** ADM-52, CMP-27: the on-duty sentence as a runtime fact. It is computed from local state and the clock, so it never goes stale. */
export function presenceFactSource(control: { getPresence(): Presence | null }, schedule?: OfficeSchedule | null, wording: PresenceWording = {}, language: LanguageSource = ENGLISH): RuntimeFactSource {
  return {
    class: 'public',
    maxAgeMs: null,
    read: (now) => ({ sentence: officeStatus(control.getPresence(), schedule, now, wording, language).sentence, asOf: now.toISOString() }),
  };
}
