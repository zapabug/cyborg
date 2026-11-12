// docs/10 ADM-60..64: when the office is staffed, as a setting. It feeds the bot's assumption about who is there; it is not a gate.

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface OfficeSchedule {
  /** An IANA name such as "Europe/Lisbon". Daylight saving follows it. */
  timezone: string;
  /** Per weekday, intervals "HH:MM-HH:MM" (start included, end excluded). A weekday with none is closed. */
  hours: Partial<Record<Weekday, readonly string[]>>;
  /** "YYYY-MM-DD" for one day, "MM-DD" for every year (holidays, closures). A closed date is closed all day. */
  closedDates: readonly string[];
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function parts(at: Date, timezone: string): { weekday: Weekday; date: string; monthDay: string; minutes: number } {
  let f = formatters.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    formatters.set(timezone, f);
  }
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  const weekday = String(p['weekday']).toLowerCase().slice(0, 3) as Weekday;
  return { weekday, date: `${p['year']}-${p['month']}-${p['day']}`, monthDay: `${p['month']}-${p['day']}`, minutes: Number(p['hour']) * 60 + Number(p['minute']) };
}

const toMinutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Whether the office is staffed at `at`, and why not if it is not. */
export function officeOpenAt(schedule: OfficeSchedule, at: Date): { open: boolean; why: 'open' | 'closed_date' | 'outside_hours' } {
  const p = parts(at, schedule.timezone);
  if (schedule.closedDates.includes(p.date) || schedule.closedDates.includes(p.monthDay)) return { open: false, why: 'closed_date' };
  const open = (schedule.hours[p.weekday] ?? []).some((interval) => p.minutes >= toMinutes(interval.slice(0, 5)) && p.minutes < toMinutes(interval.slice(6, 11)));
  return { open, why: open ? 'open' : 'outside_hours' };
}

/** The next moment the answer to `officeOpenAt` changes, looking at most 14 days ahead (a long closure still ends). Null if it never does. */
export function nextOfficeChange(schedule: OfficeSchedule, from: Date): Date | null {
  const start = officeOpenAt(schedule, from).open;
  const minute = new Date(Math.floor(from.getTime() / 60_000) * 60_000);
  for (let i = 1; i <= 14 * 24 * 60; i++) {
    const t = new Date(minute.getTime() + i * 60_000);
    if (officeOpenAt(schedule, t).open !== start) return t;
  }
  return null;
}

/** "Monday 09:00" in the office's own time. */
export function localLabel(at: Date, timezone: string, locale = 'en-GB'): string {
  const day = new Intl.DateTimeFormat(locale, { timeZone: timezone, weekday: 'long' }).format(at);
  const time = new Intl.DateTimeFormat(locale, { timeZone: timezone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(at);
  return `${day} ${time}`;
}

/** Checks the shape of a schedule; returns the problems, empty if it is usable. */
export function scheduleProblems(schedule: OfficeSchedule): string[] {
  const problems: string[] = [];
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: schedule.timezone });
  } catch {
    problems.push(`timezone "${schedule.timezone}" is not an IANA time zone name`);
  }
  for (const [day, intervals] of Object.entries(schedule.hours)) {
    if (!WEEKDAYS.includes(day as Weekday)) problems.push(`hours.${day}: not a weekday (mon, tue, wed, thu, fri, sat, sun)`);
    for (const i of intervals ?? []) {
      const m = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/.exec(i);
      if (!m) problems.push(`hours.${day}: "${i}" is not HH:MM-HH:MM`);
      else if (toMinutes(i.slice(0, 5)) >= toMinutes(i.slice(6, 11))) problems.push(`hours.${day}: "${i}" ends before it starts`);
    }
  }
  for (const d of schedule.closedDates) if (!/^(\d{4}-)?(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(d)) problems.push(`closedDates: "${d}" is not YYYY-MM-DD or MM-DD`);
  return problems;
}
