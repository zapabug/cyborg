import { readFileSync } from 'node:fs';
import { createContext, Script } from 'node:vm';

// feat-wazaa-port W3, WZP-20..29: the intake in. The client fills in the intake questionnaire (a list of tasks with who does it, how long and
// whether to automate it, then a few questions) and it arrives as one text message. This reads that message with no model call, so a line it
// cannot read is listed and never guessed, and turns it into a draft company model, a draft task list and a report. Every value is a client
// statement that stays unconfirmed until the client confirms it (WZP-29).

export interface IntakeForm {
  /** The title line of the message, e.g. "Intake: answers". */
  messageTitle: string;
  /** The label before the name, e.g. "Filled in by". */
  filledBy: string;
  /** The tasks in the order the form lists them: a task's number in the message is its place here. */
  tasks: string[];
  questions: { key: string; short: string }[];
  /** The three automate choices in the form's order: yes, no, maybe (the words are the form's language). */
  choices: [string, string, string];
}

/** WZP-21: the task list and the questions come from the intake site's own data file, never from a copy typed here. The file is run with nothing but an empty `window`. */
export function loadIntakeForm(file: string): IntakeForm {
  const window: { FORM?: Record<string, any> } = {};
  try {
    new Script(readFileSync(file, 'utf8'), { filename: file }).runInContext(createContext({ window }), { timeout: 1000 });
  } catch (error) {
    throw new Error(`${file}: cannot read the intake form data (${(error as Error).message})`);
  }
  const form = window.FORM;
  if (!form || !Array.isArray(form['tasks']) || !Array.isArray(form['questions']) || typeof form['messageTitle'] !== 'string' || !Array.isArray(form['ui']?.choices) || form['ui'].choices.length !== 3) {
    throw new Error(`${file}: this is not an intake form data file (it needs tasks, questions, messageTitle and ui.choices)`);
  }
  return {
    messageTitle: form['messageTitle'],
    filledBy: String(form['ui']?.filledBy ?? 'Filled in by'),
    // Array.from: the form was evaluated in its own context, and a list made there is not an Array of this one.
    tasks: Array.from(form['tasks'] as unknown[][], (t) => String(t[0])),
    questions: Array.from(form['questions'] as { key: string; short: string }[], (q) => ({ key: String(q.key), short: String(q.short) })),
    choices: Array.from(form['ui'].choices as unknown[], String) as [string, string, string],
  };
}

export type Automate = 'yes' | 'no' | 'maybe';

export interface IntakeTask {
  /** The task's number in the message and its place in the form's list. */
  n: number;
  title: string;
  who: string | null;
  time: string | null;
  automate: Automate | null;
  notes: string | null;
}

export interface ParsedIntake {
  filledBy: string | null;
  tasks: IntakeTask[];
  /** The answers by the question's short label. */
  answers: Record<string, string>;
  /** WZP-20: every line that could not be read as what it looked like, with the reason, so nothing is guessed. */
  unread: string[];
}

const TIME = /\b\d+(?:[.,]\d+)?\s*(?:m|min|mins|minute|minutes|minutos|h|hr|hrs|hour|hours|hora|horas|d|day|days|dia|dias|w|week|weeks|semana|semanas)\b|\/\s*(?:day|week|month|dia|semana|m[eê]s)\b/i;

/** WZP-20: the intake message as the form builds it: a title, the person, numbered task lines with only what was filled in, then the answered questions. */
export function parseIntakeMessage(text: string, form: IntakeForm): ParsedIntake {
  const out: ParsedIntake = { filledBy: null, tasks: [], answers: {}, unread: [] };
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const byShort = new Map(form.questions.map((q) => [q.short, q.key]));
  let sawTitle = false;
  let openAnswer: string | null = null;
  const yesNoMaybe = (word: string): Automate | null => {
    const i = form.choices.findIndex((c) => c.toLowerCase() === word.trim().toLowerCase());
    return i === 0 ? 'yes' : i === 1 ? 'no' : i === 2 ? 'maybe' : null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === '') { openAnswer = null; continue; }
    if (!sawTitle && line.trim() === `*${form.messageTitle}*`) { sawTitle = true; continue; }
    if (line.startsWith(`${form.filledBy}: `)) { out.filledBy = line.slice(form.filledBy.length + 2).trim() || null; continue; }

    const task = /^(\d+)\. (.*)$/.exec(line);
    if (task) {
      openAnswer = null;
      const n = Number(task[1]);
      const title = form.tasks[n - 1];
      if (title === undefined || !task[2]!.startsWith(`${title}:`)) { out.unread.push(`${line}: not one of the form's tasks (task ${n} is ${title === undefined ? 'not in the form' : `"${title}"`})`); continue; }
      let rest = task[2]!.slice(title.length + 1).trim();
      let notes: string | null = null;
      const quoted = /(?:^|\s·\s)"(.*)"$/.exec(rest);
      if (quoted) { notes = quoted[1] ?? null; rest = rest.slice(0, quoted.index).trim(); }
      const parts = rest === '' ? [] : rest.split(' · ').map((p) => p.trim()).filter(Boolean);
      let automate: Automate | null = null;
      if (parts.length > 0) {
        const last = yesNoMaybe(parts[parts.length - 1]!);
        if (last) { automate = last; parts.pop(); }
      }
      const times = parts.filter((p) => TIME.test(p));
      const others = parts.filter((p) => !TIME.test(p));
      if (times.length > 1 || others.length > 1) out.unread.push(`${line}: could not tell which part is who and which is the time (${parts.join(' | ')})`);
      out.tasks.push({ n, title, who: others[0] ?? null, time: times[0] ?? null, automate, notes });
      continue;
    }

    const answer = /^\*(.+?):\*\s?(.*)$/.exec(line);
    if (answer && byShort.has(answer[1]!)) { out.answers[answer[1]!] = (answer[2] ?? '').trim(); openAnswer = answer[1]!; continue; }
    if (openAnswer !== null) { out.answers[openAnswer] += `\n${line.trim()}`; continue; }
    out.unread.push(`${line}: not a line of the intake message`);
  }
  if (!sawTitle) out.unread.unshift(`the message does not start with "*${form.messageTitle}*"`);
  return out;
}

export type Availability = 'exists' | 'planned' | 'never_automatic' | 'not_covered';
export interface TaskMapEntry { match: string; handlers: string[]; availability: Availability; milestone?: string; note?: string; /** The kind of chat the task is done in (WZP-34). */ for?: ('reply' | 'monitor' | 'ops')[] }
export interface TaskMap { tasks: TaskMapEntry[]; channels: { pattern: string; label: string }[] }

export function loadTaskMap(file: string): TaskMap {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as TaskMap;
  if (!Array.isArray(raw.tasks) || !Array.isArray(raw.channels)) throw new Error(`${file}: a task map has tasks and channels`);
  return raw;
}

/** WZP-25: what the client's automate choice means here. Nothing is automatic in this feat (WZP-4); this is where the live gate will look first. */
export type Gate = 'candidate_now' | 'candidate_later' | 'draft_only' | 'undecided';

export interface DraftTask extends IntakeTask {
  availability: Availability | 'unmapped';
  handlers: string[];
  milestone: string | null;
  note: string | null;
  gate: Gate;
  /** The kinds of chat the task is done in, from the task map. */
  roles: ('reply' | 'monitor' | 'ops')[];
}

export interface IntakeDraft {
  filledBy: string | null;
  tasks: DraftTask[];
  /** Client statements to load as unconfirmed profile facts (WZP-29), by profile key. */
  statements: Record<string, unknown>;
  /** WZP-26: the client's own words for what must never be automatic and never promised, to be shown to the client before shadow. */
  commitments: string[];
  /** WZP-28: channels other than WhatsApp the client named, which are out of scope for now and listed, never dropped. */
  outOfScope: string[];
  /** Things a person sets from the answers; the importer never guesses a number (WZP-9). */
  toDecide: string[];
  unread: string[];
}

const SHORT = { missing: 'Missing tasks', channels: 'Where customers reach you', volume: 'Messages a day', languages: 'Languages', never: 'Never automatic', promise: 'Never promise', biggest: 'Biggest time sink', success: 'What success looks like' };

/** WZP-23..29: the draft from a parsed message. The wording of the short labels is the form's; a form with other labels gives fewer statements, not wrong ones. */
export function draftFromIntake(parsed: ParsedIntake, map: TaskMap): IntakeDraft {
  const tasks: DraftTask[] = parsed.tasks.map((t) => {
    const entry = map.tasks.find((m) => t.title.toLowerCase().includes(m.match.toLowerCase()));
    const availability = entry?.availability ?? 'unmapped';
    // Payment is never automatic whatever the client said (ADM-13); a task nobody built is a draft until it is.
    const gate: Gate = availability === 'never_automatic' ? 'draft_only' : t.automate === 'yes' ? 'candidate_now' : t.automate === 'maybe' ? 'candidate_later' : t.automate === 'no' ? 'draft_only' : 'undecided';
    return { ...t, availability, handlers: entry?.handlers ?? [], milestone: entry?.milestone ?? null, note: entry?.note ?? null, gate, roles: entry?.for ?? [] };
  });
  const a = parsed.answers;
  const statements: Record<string, unknown> = {};
  if (tasks.length) statements['intake.tasks'] = tasks.map((t) => ({ task: t.title, who: t.who, time: t.time, automate: t.automate, notes: t.notes }));
  if (a[SHORT.never]) statements['intake.never_automatic'] = a[SHORT.never];
  if (a[SHORT.promise]) statements['intake.never_promise'] = a[SHORT.promise];
  if (a[SHORT.languages]) statements['intake.languages'] = a[SHORT.languages];
  if (a[SHORT.volume]) statements['intake.messages_per_day'] = a[SHORT.volume];
  if (a[SHORT.channels]) statements['intake.channels'] = a[SHORT.channels];
  if (a[SHORT.missing]) statements['intake.missing_tasks'] = a[SHORT.missing];
  if (a[SHORT.biggest]) statements['intake.biggest_time_sink'] = a[SHORT.biggest];
  if (a[SHORT.success]) statements['intake.success'] = a[SHORT.success];

  const commitments = [
    ...(a[SHORT.never] ? [`Never automatic, in the client's words: “${a[SHORT.never]}”`] : []),
    ...(a[SHORT.promise] ? [`Never say or promise, in the client's words: “${a[SHORT.promise]}”`] : []),
  ];
  const channelText = a[SHORT.channels] ?? '';
  const outOfScope = map.channels.filter((c) => new RegExp(c.pattern, 'i').test(channelText)).map((c) => c.label);
  const toDecide = [
    ...(a[SHORT.volume] ? [`the daily call cap, from "${a[SHORT.volume]}" (limits.maxModelCallsPer24h)`] : []),
    ...(a[SHORT.languages] ? [`the staff and reply languages, from "${a[SHORT.languages]}" (language and the persona)`] : []),
    ...(a[SHORT.missing] ? [`tasks the client added: "${a[SHORT.missing]}"`] : []),
  ];
  return { filledBy: parsed.filledBy, tasks, statements, commitments, outOfScope, toDecide, unread: parsed.unread };
}

/** WZP-26, WZP-29: a draft company model: the base model's facts with the intake's statements added and the client's own words appended to `rules.commitments`, each to be confirmed. */
export function mergeIntakeModel(base: { profile: Record<string, unknown>; [k: string]: unknown } | null, draft: IntakeDraft): { profile: Record<string, unknown>; [k: string]: unknown } {
  const profile: Record<string, unknown> = { ...(base?.profile ?? {}), ...draft.statements };
  const existing = Array.isArray(profile['rules.commitments']) ? (profile['rules.commitments'] as unknown[]).map(String) : [];
  const added = draft.commitments.filter((c) => !existing.includes(c));
  if (added.length) profile['rules.commitments'] = [...existing, ...added];
  return { ...(base ?? {}), profile };
}

const WORDS: Record<Gate, string> = {
  candidate_now: 'a candidate for the live gate (the client said yes); nothing is automatic until a person switches it on',
  candidate_later: 'a candidate after the first audit (the client said maybe)',
  draft_only: 'drafts only, for good (the client said no, or it is never automatic)',
  undecided: 'the client did not say whether to automate it',
};

/** A plain report for the person who reads the draft with the client. */
export function renderIntakeReport(draft: IntakeDraft): string {
  const lines: string[] = [`Intake${draft.filledBy ? ` from ${draft.filledBy}` : ''}: ${draft.tasks.length} tasks ticked, ${Object.keys(draft.statements).length} statements, all unconfirmed.`, ''];
  lines.push('Tasks the client does, and what this system does with each:');
  for (const t of draft.tasks) {
    const who = [t.who && `who: ${t.who}`, t.time && `time: ${t.time}`, t.notes && `note: “${t.notes}”`].filter(Boolean).join(' · ');
    const what = t.availability === 'exists' ? `a handler does it today (${t.handlers.join(', ')})` : t.availability === 'planned' ? `planned (${t.milestone})` : t.availability === 'never_automatic' ? 'never automatic' : t.availability === 'not_covered' ? 'no handler and none planned' : 'not in the task map: decide';
    lines.push(`- ${t.n}. ${t.title}${who ? ` (${who})` : ''}`, `    ${what}${t.note ? `; ${t.note}` : ''}`, `    automate: ${WORDS[t.gate]}`);
  }
  lines.push('', 'The client\'s own limits, to be shown to the client and confirmed before shadow:');
  lines.push(...(draft.commitments.length ? draft.commitments.map((c) => `- ${c}`) : ['- none written']));
  lines.push('', 'Channels other than WhatsApp, out of scope for now:');
  lines.push(...(draft.outOfScope.length ? draft.outOfScope.map((c) => `- ${c}`) : ['- none named']));
  lines.push('', 'For a person to set (the importer does not guess a number):');
  lines.push(...(draft.toDecide.length ? draft.toDecide.map((c) => `- ${c}`) : ['- nothing']));
  if (draft.unread.length) lines.push('', 'Lines that could not be read (nothing was guessed):', ...draft.unread.map((u) => `- ${u}`));
  return `${lines.join('\n')}\n`;
}
