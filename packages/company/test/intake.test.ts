import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { draftFromIntake, loadIntakeForm, loadTaskMap, mergeIntakeModel, parseIntakeMessage, renderIntakeReport, type IntakeForm } from '../src/index.ts';

// feat-wazaa-port W3, WZP-20..29. The form data file is the intake site's own (a copy as a test fixture); the task titles and labels are
// real. The message is built the way the form builds it (form.js `message()`); what the "client" wrote in it is structural test input, since a
// real intake message from a client is zapa's to supply (M-EC, user check).

const FORM = join(import.meta.dirname, 'fixtures', 'intake-form-data.js');
const MAP = join(import.meta.dirname, '..', '..', '..', 'docs', 'intake', 'task-map.json');
const form = loadIntakeForm(FORM);

/** form.js `message()`, line for line. */
function build(f: IntakeForm, who: string, tasks: Record<number, { who?: string; time?: string; auto?: string; notes?: string }>, answers: Record<string, string>): string {
  const lines = [`*${f.messageTitle}*`];
  if (who) lines.push(`${f.filledBy}: ${who}`);
  lines.push('');
  f.tasks.forEach((title, i) => {
    const n = i + 1;
    const d = tasks[n];
    if (!d) return;
    const parts = [d.who, d.time, d.auto].filter(Boolean) as string[];
    const notes = d.notes;
    if (!parts.length && !notes) return;
    lines.push(`${n}. ${title}: ${parts.join(' · ')}${notes ? `${parts.length ? ' · ' : ''}"${notes}"` : ''}`);
  });
  const answered = f.questions.filter((q) => answers[q.short]);
  if (answered.length) {
    lines.push('');
    answered.forEach((q) => lines.push(`*${q.short}:* ${answers[q.short]}`));
  }
  return lines.join('\n');
}

test('WZP-21: the task list and the questions come from the intake site\'s own data file', () => {
  assert.equal(form.messageTitle, 'Intake: answers');
  assert.equal(form.tasks.length, 16);
  assert.equal(form.tasks[0], 'Answering customer questions');
  assert.equal(form.questions.length, 28, 'the live form: the questions of every section, flattened');
  assert.deepEqual(form.choices, ['Yes', 'No', 'Maybe']);
  assert.throws(() => loadIntakeForm(join(import.meta.dirname, 'intake.test.ts')), /cannot read the intake form data|not an intake form data file/);
});

test('WZP-20: every part of a task line is read: who, time, the automate choice and the notes, whichever are filled in', () => {
  const text = build(form, 'Test person, Test business', {
    1: { who: 'the office', time: '30 min/day', auto: 'Yes' },
    2: { auto: 'Maybe' },
    3: { who: 'the manager' },
    4: { time: '2 hours/week', auto: 'No', notes: 'only for regulars' },
    6: { notes: 'we forget this one' },
    9: { who: 'accounts', auto: 'Yes' },
  }, {});
  const p = parseIntakeMessage(text, form);
  assert.deepEqual(p.unread, []);
  assert.equal(p.filledBy, 'Test person, Test business');
  assert.deepEqual(p.tasks.map((t) => [t.n, t.who, t.time, t.automate, t.notes]), [
    [1, 'the office', '30 min/day', 'yes', null],
    [2, null, null, 'maybe', null],
    [3, 'the manager', null, null, null],
    [4, null, '2 hours/week', 'no', 'only for regulars'],
    [6, null, null, null, 'we forget this one'],
    [9, 'accounts', null, 'yes', null],
  ]);
});

test('WZP-20: the answers are read by their label, a multi-line answer is kept whole, and a line that is nothing is listed, not guessed', () => {
  const text = `${build(form, '', { 1: { auto: 'Yes' } }, { 'Languages': 'Portuguese and English', 'Never automatic': 'prices for groups' })}\nand second line of that\n\nsomething nobody asked\n7. Not a task: x\n99. Answering customer questions: x`;
  const p = parseIntakeMessage(text, form);
  assert.equal(p.answers['Languages'], 'Portuguese and English');
  assert.equal(p.answers['Never automatic'], 'prices for groups\nand second line of that');
  assert.equal(p.unread.length, 3);
  assert.match(p.unread.join('|'), /something nobody asked: not a line of the intake message/);
  assert.match(p.unread.join('|'), /7\. Not a task: x: not one of the form's tasks \(task 7 is "Reminders before the service or appointment"\)/);
  assert.match(p.unread.join('|'), /99\. .*not in the form/);
  assert.match(parseIntakeMessage('hello', form).unread[0]!, /does not start with "\*Intake: answers\*"/);
});

test('WZP-20: a part that could be who or time in two ways is listed as unreadable and the first of each is kept', () => {
  const p = parseIntakeMessage(build(form, '', { 1: { who: 'office · reception', time: '5 min/day' } }, {}).replace('office · reception', 'office · reception'), form);
  assert.match(p.unread.join('|'), /could not tell which part is who and which is the time/);
  assert.equal(p.tasks[0]!.who, 'office');
  assert.equal(p.tasks[0]!.time, '5 min/day');
});

test('WZP-23..25: each ticked task is mapped to what does it today, what is planned and what is never automatic; the client\'s choice sets the gate', () => {
  const map = loadTaskMap(MAP);
  const p = parseIntakeMessage(build(form, '', {
    1: { auto: 'Yes' }, 4: { auto: 'Yes' }, 6: { auto: 'Maybe' }, 9: { auto: 'Yes' }, 10: { auto: 'No' }, 16: { who: 'web person' }, 7: { who: 'office' },
  }, {}), form);
  const d = draftFromIntake(p, map);
  const by = (n: number) => d.tasks.find((t) => t.n === n)!;
  assert.deepEqual([by(1).availability, by(1).gate, by(1).handlers], ['exists', 'candidate_now', ['sales.enquiry.reply_draft']]);
  assert.deepEqual([by(4).availability, by(4).milestone, by(4).gate], ['planned', 'W6', 'candidate_now']);
  assert.deepEqual([by(6).availability, by(6).gate], ['planned', 'candidate_later']);
  assert.deepEqual([by(9).availability, by(9).gate], ['never_automatic', 'draft_only'], 'payment is draft-only whatever the client said (ADM-13)');
  assert.deepEqual([by(10).availability, by(10).gate], ['exists', 'draft_only']);
  assert.deepEqual([by(16).availability, by(16).gate], ['not_covered', 'undecided']);
  assert.equal(by(7).gate, 'undecided');
  assert.deepEqual([by(1).roles, by(16).roles], [['reply'], []], 'a task knows the kind of chat it is done in');
  assert.ok(map.tasks.every((m) => form.tasks.some((t) => t.toLowerCase().includes(m.match.toLowerCase()))), 'every row of the task map matches a task of the real form');
  assert.ok(form.tasks.every((t) => map.tasks.some((m) => t.toLowerCase().includes(m.match.toLowerCase()))), 'every task of the real form is in the task map');
});

test('WZP-26..29: the client\'s own words become commitments, quoted; channels other than WhatsApp are listed; numbers are left for a person; all unconfirmed', () => {
  const map = loadTaskMap(MAP);
  const answers = {
    'Never automatic': 'prices for groups', 'Never promise': 'a discount or a confirmed booking', 'Languages': 'Portuguese, English',
    'Messages a day': 'about 20 in a busy week', 'Where customers reach you': 'WhatsApp, phone, website and Instagram', 'Missing tasks': 'airport transfers',
  };
  const d = draftFromIntake(parseIntakeMessage(build(form, 'T', { 1: { auto: 'Yes' } }, answers), form), map);
  assert.deepEqual(d.commitments, ['Never automatic, in the client\'s words: “prices for groups”', 'Never say or promise, in the client\'s words: “a discount or a confirmed booking”']);
  assert.deepEqual(d.outOfScope.sort(), ['Instagram', 'phone calls', 'website']);
  assert.ok(d.toDecide.some((t) => /call cap, from "about 20 in a busy week"/.test(t)), 'the volume is shown, no number is made up from it');
  assert.ok(!JSON.stringify(d).match(/maxModelCallsPer24h"\s*:\s*\d/), 'no call cap number is invented');
  assert.equal(d.statements['intake.never_promise'], 'a discount or a confirmed booking');
  assert.equal(d.statements['intake.missing_tasks'], 'airport transfers');
  const merged = mergeIntakeModel({ profile: { 'business.name': 'Test', 'rules.commitments': ['never confirm a booking'] } }, d);
  assert.deepEqual(merged.profile['rules.commitments'], ['never confirm a booking', ...d.commitments], 'added after what is there, quoted');
  assert.equal(merged.profile['business.name'], 'Test');
  assert.deepEqual(mergeIntakeModel(merged, d).profile['rules.commitments'], merged.profile['rules.commitments'], 'merging twice adds nothing twice');
  const report = renderIntakeReport(d);
  assert.match(report, /Intake from T: 1 tasks ticked/);
  assert.match(report, /unconfirmed/);
  assert.match(report, /Instagram/);
});

test('WZP-20, WZP-23: the intake command writes the structure, the report and a company model, and refuses a file that is not an intake form', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cyborg-intake-'));
  try {
    const msg = join(dir, 'message.txt');
    writeFileSync(msg, build(form, 'T', { 1: { who: 'office', auto: 'Yes' }, 9: { auto: 'Yes' } }, { 'Never promise': 'a discount' }));
    const base = join(dir, 'company.json');
    writeFileSync(base, JSON.stringify({ profile: { 'business.name': 'Test' } }));
    const bin = join(import.meta.dirname, '..', 'bin', 'intake.ts');
    const run = (...args: string[]) => execFileSync('node', ['--import', 'tsx', bin, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    run('--form', FORM, '--message', msg, '--out', join(dir, 'out'), '--company-model', base);
    const draft = JSON.parse(readFileSync(join(dir, 'out', 'intake.json'), 'utf8')) as { draft: { tasks: { gate: string }[] } };
    assert.deepEqual(draft.draft.tasks.map((t) => t.gate), ['candidate_now', 'draft_only']);
    const model = JSON.parse(readFileSync(join(dir, 'out', 'company.intake.json'), 'utf8')) as { profile: Record<string, unknown> };
    assert.equal(model.profile['business.name'], 'Test');
    assert.ok('intake.tasks' in model.profile);
    assert.deepEqual(JSON.parse(readFileSync(base, 'utf8')), { profile: { 'business.name': 'Test' } }, 'the business\'s own company.json is never changed');
    assert.match(readFileSync(join(dir, 'out', 'intake-report.md'), 'utf8'), /payment|Taking payment/i);
    assert.throws(() => run('--form', msg, '--message', msg, '--out', join(dir, 'o2')), /cannot read the intake form data|not an intake form data file/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});
