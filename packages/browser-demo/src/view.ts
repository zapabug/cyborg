import type { TurnView } from './engine.ts';

// What the recorded showcase needs and nothing else: this file imports no framework code (only a type, erased in the build), so a page that ships only this
// carries none. Text from the data goes on the page with textContent, never as markup.

export interface RecordedSession {
  id: string;
  title: string;
  blurb: string;
  /** How the framework treats the answer: `shadow` (a draft beside the team, nothing sent), `drafts` (a person approves before it is sent) or `auto` (sent by itself). */
  mode?: Mode;
  turns: { text: string; view?: TurnView; office?: string; card?: string }[];
}

export type Mode = 'shadow' | 'drafts' | 'auto';

export interface Recorded {
  recordedAt: string;
  model: string;
  sessions: RecordedSession[];
}

type Child = Node | string | null | undefined | false;
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { class: cls, ...rest } = props as { class?: string };
  if (cls) el.className = cls;
  Object.assign(el, rest);
  for (const c of children) if (c) el.append(c);
  return el;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const FACT_LABEL: Record<string, string> = { 'business.name': 'Name', 'tone.style': 'Tone', 'offer.items': 'Services and prices', 'offer.availability': 'Days it runs', 'rules.commitments': 'Rules it must keep', 'faq.entries': "The business's answers" };

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A fact's content in the business's words, for the panel that says what the writer was given. A shape it does not know is shown as it is. */
export function factText(key: string, value: unknown): string {
  if (typeof value === 'string') return value;
  if (key === 'offer.items') {
    return list(value).filter(isObj).map((i) => `${String(i['name'])}: ${i['priceFrom'] ? 'from ' : ''}${String(i['price'])} ${String(i['currency'] ?? '')}`.trim() + (i['note'] ? ` (${String(i['note'])})` : '')).join('\n');
  }
  if (key === 'offer.availability' && isObj(value)) {
    const days = list(value['days']).map(Number).filter((d) => d >= 0 && d <= 6);
    const run = days.length > 2 && days.every((d, i) => i === 0 || d === days[i - 1]! + 1);
    const names = run ? `${DAYS[days[0]!]} to ${DAYS[days.at(-1)!]}` : days.map((d) => DAYS[d]).join(', ');
    const closed = list(value['closedDates']).map(String);
    return names + (closed.length ? `. Closed on ${closed.join(', ')}` : '');
  }
  if (key === 'rules.commitments') return list(value).map(String).join('\n');
  if (key === 'faq.entries') return list(value).filter(isObj).map((e) => `${String(e['q'])} ${String(e['a'])}`).join('\n');
  return JSON.stringify(value);
}

/** A fact key in the business's words; a key it does not know is shown as it is. */
export const factLabel = (key: string): string => FACT_LABEL[key] ?? key;

/** What a check or a refusal said, without the handler's name or the profile key behind it, in a sentence a business reads. */
export function plainProblem(text: string): string {
  const s = text.replace(/^[a-z_]+:\s*/i, '').replace(/^(?:reply blocked|the drafted reply was blocked):\s*/i, '').trim();
  const day = /^weekday (\d) is not /.exec(s);
  if (day) return `${DAYS[Number(day[1])] ?? 'That day'} is not one of the opening days.`;
  return s === '' ? text : s.charAt(0).toUpperCase() + s.slice(1);
}

/** The office card without the chat's internal reference on its first line. */
export const cardText = (card: string): string => card.replace(/^Handoff: \S+/, 'Handoff to the office');

/** `*bold*` and `**bold**` (a draft is written for WhatsApp, where a star pair is bold) as bold text; everything else stays text, never markup. */
export function richText(text: string): (Node | string)[] {
  return text.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*)/).filter((p) => p !== '').map((p) => {
    const m = /^\*\*?([^*\n]+)\*\*?$/.exec(p);
    return m ? h('strong', {}, m[1]) : p;
  });
}

const BAND: Record<string, string> = { high: 'high confidence', medium: 'medium confidence', low: 'low confidence: a person reads it first' };

const MODE: Record<Mode, { tag: string; meta: string; buttons: [string, string][]; auto?: string }> = {
  shadow: {
    tag: 'Shadow mode · built',
    meta: 'Shadow mode: the bot drafts beside your team. Nothing is sent.',
    buttons: [['Mark right', 'Recorded for the audit. Nothing was sent, and a run of right answers is what supports switching this task on.'], ['Mark wrong', 'Recorded with the reason. The fact or rule behind it is fixed, and the next version is checked against it.']],
  },
  drafts: {
    tag: 'Drafts mode · approve and decline are built; sending on approve is live mode, not built in cyborg yet',
    meta: 'Draft waiting for a person to approve.',
    buttons: [['Approve and send', 'Sent to the customer. The approval is recorded with who gave it.'], ['Edit first', 'The person changes the words, then sends. The change is kept so the bot can learn from it.'], ['Decline', 'Not sent. The reason is kept.']],
  },
  auto: {
    tag: 'Auto mode · built in wazaa for Demo Tours; live mode in cyborg: not yet',
    meta: 'Sent to the customer by itself.',
    buttons: [],
    auto: 'This kind of answer is switched on, the band is high and every statement traces to a confirmed fact. It is in the log, and a person can take over the chat at any time.',
  },
};

/** One turn: the customer's line, the draft, and how it got there. */
export function turnView(view: TurnView, extra?: { card?: string; mode?: Mode }): HTMLElement {
  const box = h('div', { class: 'cy-turn' }, h('div', { class: 'cy-in' }, h('span', {}, view.text)));
  const bot = h('div', { class: 'cy-bot' + (view.draft ? '' : ' cy-none') });
  bot.append(view.draft ? h('div', { class: 'cy-draft' }, ...richText(view.draft)) : h('div', { class: 'cy-draft' }, view.needsOffice ? 'No draft: a person has to answer this one.' : 'No draft.'));
  const mode = extra?.mode ? MODE[extra.mode] : null;
  if (mode) bot.prepend(h('div', { class: 'cy-mode' }, mode.tag));
  bot.append(h('div', { class: 'cy-meta' }, view.draft ? `${mode ? mode.meta : 'Draft for a person to approve, never sent.'} ${view.band ? BAND[view.band] : ''}` : 'Held back by the code.'));
  if (mode && view.draft) {
    if (mode.buttons.length > 0) {
      const outcome = h('div', { class: 'cy-outcome' });
      const row = h('div', { class: 'cy-controls' }, ...mode.buttons.map(([label, result]) => {
        const b = h('button', { class: 'cy-chipbtn', type: 'button' }, label);
        b.addEventListener('click', () => { outcome.textContent = result; });
        return b;
      }));
      bot.append(row, outcome);
    }
    if (mode.auto) bot.append(h('div', { class: 'cy-outcome' }, mode.auto));
  }
  const problems = [...new Set(view.problems.map(plainProblem))];
  for (const p of problems) bot.append(h('div', { class: 'cy-prob' }, p));
  if (view.request) bot.append(h('div', { class: 'cy-req' }, `Booking request ${view.request} made: waiting for the office.`));
  const how = h('details', { class: 'cy-how' }, h('summary', {}, 'How it got there'));
  if (view.computed) how.append(h('h4', {}, 'What the code computed and put in front of the writer'), h('pre', {}, view.computed));
  const given = view.facts.filter((f) => f.key !== 'business.name');
  if (given.length) {
    const open = given.filter((f) => f.unconfirmed);
    how.append(
      h('h4', {}, 'What the writer was given'),
      h('div', { class: 'cy-given' }, ...given.map((f) => h('div', { class: 'cy-given-row' }, h('strong', {}, factLabel(f.key)), h('span', { class: 'cy-given-text' }, f.value === undefined ? '' : factText(f.key, f.value))))),
      h('p', { class: 'cy-given-note' }, open.length ? `Not yet approved by the business: ${open.map((f) => factLabel(f.key)).join(', ')}.` : 'Every item was approved by the business before use.'),
    );
  }
  // A check that only says what the red line above already says is not shown twice.
  const checks = [...new Set(view.checks.map(plainProblem))].filter((c) => !problems.includes(c));
  if (checks.length) how.append(h('h4', {}, 'Checks'), ...checks.map((c) => h('div', {}, c)));
  if (view.prompt) how.append(h('details', { class: 'cy-prompt' }, h('summary', {}, 'The exact prompt the model got'), h('pre', {}, view.prompt)));
  bot.append(how);
  if (extra?.card) bot.append(h('h4', {}, 'The card the office would get'), h('pre', {}, cardText(extra.card)));
  box.append(bot);
  return box;
}

export function replay(root: HTMLElement, recorded: Recorded): void {
  const pick = h('div', { class: 'cy-picks' });
  const thread = h('div', { class: 'cy-thread' });
  const next = h('button', { class: 'btn btn-primary' }, 'Next line');
  const again = h('button', { class: 'btn' }, 'Play again');
  const blurb = h('p', { class: 'cy-blurb' });
  let session = recorded.sessions[0]!;
  let at = 0;
  // Only a click on "Next line" scrolls to the new turn. The first turn is shown when the page loads, and scrolling to it then drags the visitor away from the top.
  const showTurn = (scroll = false) => {
    const t = session.turns[at]!;
    if (t.view) thread.append(turnView(t.view, { ...(t.card ? { card: t.card } : {}), ...(session.mode ? { mode: session.mode } : {}) }));
    else thread.append(h('div', { class: 'cy-turn' }, h('div', { class: 'cy-in' }, h('span', {}, t.text)), t.office ? h('pre', { class: 'cy-office' }, t.office) : null, t.card ? h('pre', { class: 'cy-office' }, cardText(t.card)) : null));
    if (scroll) thread.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    at += 1;
    next.disabled = at >= session.turns.length;
  };
  const load = (s: RecordedSession) => { session = s; at = 0; thread.textContent = ''; blurb.textContent = s.blurb; next.disabled = false; for (const b of pick.children) b.setAttribute('aria-pressed', String((b as HTMLElement).dataset['id'] === s.id)); showTurn(); };
  for (const s of recorded.sessions) { const b = h('button', { class: 'cy-chipbtn', type: 'button' }, s.title); b.dataset['id'] = s.id; b.onclick = () => load(s); pick.append(b); }
  next.onclick = () => showTurn(true);
  again.onclick = () => load(session);
  root.append(
    h('p', { class: 'cy-note' }, `Recorded ${recorded.recordedAt.slice(0, 10)} from a real run of the framework on ${recorded.model}. The customer's lines were written for the demo; the drafts, the figures and the checks are what the system produced.`),
    pick, blurb, thread, h('div', { class: 'cy-actions' }, next, again),
  );
  load(session);
}

/** The recorded showcase on its own: nothing to configure and nothing sent anywhere. */
export function mountRecorded(root: HTMLElement, recorded: Recorded): void {
  replay(root, recorded);
}
