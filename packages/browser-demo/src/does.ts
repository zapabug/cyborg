// Imported from the two files, not the package index, so the page carries these and not the whole core.
import { toastForItem, type AttentionItem, type AttentionToast } from '../../core/src/attention.ts';
import { redact, scrub, type ScrubHit } from '../../core/src/scrubber.ts';

// The entry of the "what it does" page: the framework's own scrubber and its own toast builder, run in the visitor's browser on what they type.
// No model call, no network, no key. The sample text and the sample item below are written for the page and labelled as such there.

const SAMPLE_TEXT = "Hi, it's Ana. Can I move Thursday to Friday? Call me on +351 912 345 678 or write to ana.demo@example.com. My NIF is 123 456 789.";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Overlapping hits (a phone number also looks like a long number) are drawn once. */
function mergeRanges(hits: ScrubHit[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const h of [...hits].sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && h.start <= last[1]) last[1] = Math.max(last[1], h.end);
    else out.push([h.start, h.end]);
  }
  return out;
}

function renderScrub(text: string, shown: HTMLElement, verdict: HTMLElement, list: HTMLElement): void {
  const hits = scrub(text);
  shown.replaceChildren();
  let at = 0;
  for (const [start, end] of mergeRanges(hits)) {
    if (start > at) shown.append(document.createTextNode(text.slice(at, start)));
    shown.append(el('mark', 'hit', text.slice(start, end)));
    at = end;
  }
  if (at < text.length) shown.append(document.createTextNode(text.slice(at)));

  list.replaceChildren();
  for (const h of hits) list.append(el('li', undefined, `${h.rule} · characters ${h.start}–${h.end}`));
  verdict.className = hits.length ? 'verdict replaced' : 'verdict pass';
  if (hits.length === 0) {
    verdict.textContent = 'No pattern matched, so this text goes to the model as it is. Names written in free text cannot be found by a pattern; see the note below.';
    return;
  }
  verdict.textContent = 'Not stopped. The model still does the task, and gets this text instead. The original stays in the chat on your machine; the log keeps the rule and the positions above, never the matched text.';
  verdict.append(el('pre', 'sent-text', redact(text).text));
}

function toastCard(toast: AttentionToast, mode: string): HTMLElement {
  const card = el('div', 'toast');
  const head = el('div', 'toast-head');
  head.append(el('span', `dot ${toast.colour}`), el('b', undefined, toast.title), el('span', 'toast-mode', mode));
  card.append(head, el('p', 'toast-body', toast.body));
  const row = el('div', 'toast-actions');
  for (const a of toast.actions) row.append(el('span', 'toast-btn', a.label));
  card.append(row);
  return card;
}

const scrubIn = document.getElementById('scrub-in') as HTMLTextAreaElement | null;
const scrubShown = document.getElementById('scrub-shown');
const scrubVerdict = document.getElementById('scrub-verdict');
const scrubList = document.getElementById('scrub-hits');
if (scrubIn && scrubShown && scrubVerdict && scrubList) {
  scrubIn.value = SAMPLE_TEXT;
  const run = (): void => renderScrub(scrubIn.value, scrubShown, scrubVerdict, scrubList);
  scrubIn.addEventListener('input', run);
  document.getElementById('scrub-reset')?.addEventListener('click', () => { scrubIn.value = SAMPLE_TEXT; run(); });
  document.getElementById('scrub-clear')?.addEventListener('click', () => { scrubIn.value = 'Can I move Thursday to Friday afternoon?'; run(); });
  run();
}

const teaser = document.getElementById('teaser-scrub');
if (teaser) {
  const hits = scrub(SAMPLE_TEXT);
  const kinds = [...new Set(hits.map((h) => h.rule))];
  teaser.replaceChildren(el('pre', undefined, SAMPLE_TEXT), el('span', 'arrow-down', 'cyborg swaps the details ↓'));
  const chips = el('div', 'chips');
  for (const k of kinds) chips.append(el('span', undefined, k));
  teaser.append(chips, el('pre', undefined, redact(SAMPLE_TEXT).text), el('small', undefined, 'The model gets this, and still does the task'));
}

// The strip "when a person is needed": five steps through shadow, live and the morning. Written for the page (no model, no recording of a real bot); the toast cards are
// built by the framework's own toast builder. `built` says whether the step is something the framework does today or a plan.
interface Step {
  stage: string;
  /** `built`: the framework does it today. `wazaa`: built in wazaa for Demo Tours, not yet in the framework's live mode. `partly`: built, apart from the toast. */
  tag: 'built' | 'wazaa' | 'partly';
  customer: string;
  at: string;
  bot: string;
  pc: { toast: AttentionItem | null; none?: string; sheet?: string };
  admin: string | null;
  note?: string;
}

const item = (over: Partial<AttentionItem>): AttentionItem => ({
  key: 'sales:flow', source: 'sales', kind: 'chat', colour: 'red', title: 'Ana Costa', summary: '', reference: 'chat 7', reasonText: 'A customer needs a person now.',
  since: '2026-11-09T09:00:00.000Z', reasons: [], actions: [{ id: 'take_over', label: 'Take over' }, { id: 'leave', label: 'Leave it to the bot' }], ...over,
});

const STEPS: Step[] = [
  {
    stage: '1 · Shadow', tag: 'built', customer: 'Are you open on Sunday?', at: '10:41',
    bot: 'Writes a draft, "We\'re closed on Sundays. Open Mon–Sat, 09:00–19:00.", and sends nothing. Shadow mode is drafts only.',
    pc: { toast: null, none: 'No toast. The draft waits in the Test tab for the team to mark it right or wrong.' }, admin: null,
  },
  {
    stage: '2 · Shadow', tag: 'built', customer: 'Can I get a group discount?', at: '10:44',
    bot: 'Has no fact about discounts, so it drafts nothing and prepares a card for the office.',
    pc: { toast: item({ summary: 'Asks for a group discount. The bot has no answer.' }) },
    admin: 'Handoff: Ana Costa (waiting since 10:44)\n────────────────────────────────────────\nSpec: wants\nState: a group discount\n────────────────────────────────────────\nSpec: office to check\nState: Is there a group discount?\n\nFrom a phone: .answer 3 <your answer>',
  },
  {
    stage: '3 · Live, an answer', tag: 'wazaa', customer: 'Are you open on Sunday?', at: '22:04',
    bot: 'Sends "We\'re closed on Sundays. Open Mon–Sat, 09:00–19:00." by itself, after the code has checked it against the business\'s facts. No person is needed, and it is the same at any hour.',
    pc: { toast: null, none: 'No toast. The row is green on the board and the answer is in the log and the morning sheet.' }, admin: null,
  },
  {
    stage: '4 · Live, an action', tag: 'partly', customer: 'Can I book the East Tour for 4 on Thursday?', at: '11:02',
    bot: 'Reads the details, the code works out the total, and the request is filed as B-000007. The bot never says "booked": a booking is a person\'s decision, every time.',
    pc: { toast: item({ colour: 'red', summary: 'Asks to book the East Tour for 4 on Thursday. B-000007 waits for a person.', actions: [{ id: 'open', label: 'Open the request' }, { id: 'later', label: 'Later' }] }) },
    admin: 'Request B-000007: Ana Costa\nEast Tour, Thursday, 4 people, 180 EUR in total\n\nFrom a phone: .confirm B-000007 <note>   or   .decline B-000007 <reason>',
    note: 'After hours the toast waits: the request appears on the morning sheet instead, and the customer is told the office will confirm.',
  },
  {
    stage: '5 · Morning', tag: 'built', customer: '', at: '09:00',
    bot: 'Builds the morning sheet when the office opens: what is waiting, what the bot answered, what is due.',
    pc: { toast: null, sheet: 'Morning sheet · Monday\nWaiting on the office: 1\n  Ana Costa: East Tour, Thursday, 4 people (B-000007)\nAnswered by the bot overnight: 3\nDue today: nothing' },
    admin: 'Ask any time from the admin group: .status',
  },
];

const TAGS = { built: 'Built', wazaa: 'Built in wazaa for Demo Tours · live mode in cyborg: not yet', partly: 'Built · the toast for a request: planned' };
const flow = document.getElementById('flow-demo');
if (flow) {
  let at = 0;
  let shared = false;
  const draw = (): void => {
    const st = STEPS[at]!;
    flow.replaceChildren();
    const nav = el('div', 'flow-nav');
    STEPS.forEach((x, n) => {
      const b = el('button', n === at ? 'flow-dot on' : 'flow-dot', String(n + 1));
      b.type = 'button';
      b.setAttribute('aria-label', `Step ${n + 1}: ${x.stage}`);
      b.setAttribute('aria-current', String(n === at));
      b.addEventListener('click', () => { at = n; draw(); });
      nav.append(b);
    });
    const head = el('div', 'flow-head');
    head.append(el('b', undefined, st.stage), el('span', `flow-tag ${st.tag}`, TAGS[st.tag]));
    flow.append(nav, head);

    if (st.customer) {
      const wa = el('div', 'flow-wa');
      wa.append(el('small', undefined, `Customer, in WhatsApp · ${st.at}`), el('p', 'flow-bubble', st.customer));
      flow.append(wa);
    }
    flow.append(el('p', 'flow-bot', st.bot));

    const grid = el('div', 'flow-grid');
    const pc = el('div', 'flow-pane');
    pc.append(el('h4', undefined, 'On the office PC'));
    if (st.pc.toast) pc.append(toastCard(toastForItem(st.pc.toast, shared ? 'reference_only' : 'name_and_summary'), shared ? 'Shared screen setting' : 'Name and summary'));
    else if (st.pc.sheet) pc.append(el('pre', 'flow-card', st.pc.sheet));
    else pc.append(el('p', 'flow-none', st.pc.none ?? 'No toast.'));
    const ad = el('div', 'flow-pane');
    ad.append(el('h4', undefined, 'In the admin group'));
    if (st.admin) ad.append(el('pre', 'flow-card', st.admin));
    else ad.append(el('p', 'flow-none', 'Nothing.'));
    grid.append(pc, ad);
    flow.append(grid);
    if (st.note) flow.append(el('p', 'flow-note', st.note));

    const ctl = el('div', 'flow-ctl');
    const back = el('button', 'cy-chipbtn', 'Back'); back.type = 'button'; back.disabled = at === 0; back.addEventListener('click', () => { at -= 1; draw(); });
    const next = el('button', 'cy-chipbtn', 'Next'); next.type = 'button'; next.disabled = at === STEPS.length - 1; next.addEventListener('click', () => { at += 1; draw(); });
    const swap = el('button', 'cy-chipbtn', shared ? 'Showing the shared-screen setting' : 'Show the shared-screen setting'); swap.type = 'button'; swap.setAttribute('aria-pressed', String(shared));
    swap.addEventListener('click', () => { shared = !shared; draw(); });
    ctl.append(back, next, swap);
    flow.append(ctl);
  };
  draw();
}
