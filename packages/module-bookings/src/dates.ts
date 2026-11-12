// Dates are plain `YYYY-MM-DD` strings in the business's own calendar; the caller says what today is. No clock is read here (no hidden time).

const DAY_MS = 86_400_000;
const utc = (iso: string) => new Date(`${iso}T12:00:00Z`);
export const isIso = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(utc(s).getTime()) && utc(s).toISOString().slice(0, 10) === s;
export const weekdayOf = (iso: string): number => utc(iso).getUTCDay();
export const addDays = (iso: string, n: number): string => new Date(utc(iso).getTime() + n * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string): number => Math.round((utc(to).getTime() - utc(from).getTime()) / DAY_MS);
export const monthDay = (iso: string): string => iso.slice(5);

const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  domingo: 0, 'segunda-feira': 1, segunda: 1, 'terça-feira': 2, 'terça': 2, terca: 2, 'quarta-feira': 3, quarta: 3, 'quinta-feira': 4, quinta: 4, 'sexta-feira': 5, sexta: 5, 'sábado': 6, sabado: 6,
  lunes: 1, martes: 2, 'miércoles': 3, miercoles: 3, jueves: 4, viernes: 5,
  montag: 1, dienstag: 2, mittwoch: 3, donnerstag: 4, freitag: 5, samstag: 6, sonntag: 0,
  lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6, dimanche: 0,
};
const TODAY = ['today', 'hoje', 'hoy', 'heute', "aujourd'hui"];
const TOMORROW = ['tomorrow', 'amanhã', 'amanha', 'mañana', 'manana', 'morgen', 'demain'];

/**
 * The brain spec's date parsing (the code's reading of the raw message wins over the model's, because it does relative-day maths correctly):
 * an ISO date, day/month with or without the year, today and tomorrow in six languages, and a weekday name, which is the next such day after today.
 * A date before today is never returned. Null when the message names none.
 */
export function parseDate(text: string, today: string): string | null {
  const lower = text.toLowerCase();
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(lower);
  if (iso) return isIso(iso[0]) && iso[0] >= today ? iso[0] : null;
  const dm = /\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/.exec(lower);
  if (dm) {
    const day = Number(dm[1]);
    const month = Number(dm[2]);
    const yearGiven = dm[3] !== undefined ? (dm[3].length === 2 ? 2000 + Number(dm[3]) : Number(dm[3])) : null;
    const make = (year: number) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const thisYear = Number(today.slice(0, 4));
    const candidates = yearGiven !== null ? [make(yearGiven)] : [make(thisYear), make(thisYear + 1)];
    const found = candidates.find((c) => isIso(c) && c >= today);
    if (found) return found;
  }
  const words = lower.match(/[\p{L}'-]+/gu) ?? [];
  if (words.some((w) => TODAY.includes(w))) return today;
  if (words.some((w) => TOMORROW.includes(w))) return addDays(today, 1);
  for (const w of words) {
    const weekday = WEEKDAYS[w];
    if (weekday === undefined) continue;
    for (let i = 1; i <= 7; i++) if (weekdayOf(addDays(today, i)) === weekday) return addDays(today, i);
  }
  return null;
}
