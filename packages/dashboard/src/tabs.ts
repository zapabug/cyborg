import { Script } from 'node:vm';
import type { TestChat } from '@cyborg/company';
import type { StaffLanguage } from '@cyborg/core';

// feat-wazaa-port WZP-40, docs/14 DSH-1: the shell knows no module, no channel and no business. A module or an integration contributes a
// tab; a tab it does not have is not shown (DSH-4). A tab is an id, its label in each staff language, a level, an order, its own routes
// under /api/tab/<id>/ (served behind the shell's host, origin and token checks) and the script that draws it.

/** What the shell owns itself. A tab may not take these ids. */
export const SHELL_TABS = ['home', 'sheet', 'audit', 'log', 'item', 'chat', 't'] as const;

export interface TabRequest {
  method: 'GET' | 'POST';
  /** The parsed JSON body of a POST, `{}` when there is none. */
  body: unknown;
  /** The operator's name as the shell records it (DSH-3). */
  operator: string;
}
export type TabRoute = (request: TabRequest) => Promise<unknown> | unknown;

export interface DashboardTab {
  /** Lower-case letters, digits and hyphens; it is the address `#/t/<id>` and the route prefix. */
  id: string;
  label: Record<StaffLanguage, string>;
  /** `simple` tabs are always shown, `advanced` ones when the person chose Advanced. */
  level: 'simple' | 'advanced';
  /** Lower first. */
  order: number;
  /** A short text for the header, e.g. a demo's label. */
  chip?: string;
  /** The tab's own sentences, by language; `ctx.t(key)` looks here before the shell's. Staff never see an internal name (DSH-7). */
  text?: Record<StaffLanguage, Record<string, string | Record<string, string>>>;
  /** Served at `/api/tab/<id>/<name>` (GET and POST). A thrown error is a 400 with its message. */
  routes?: Record<string, TabRoute>;
  /**
   * The body of a function `(ctx) => { draw(box) }`: it must `return` an object with `draw(box)`, called when the tab is opened and when the
   * language changes, never on a live update (DSH-7). `ctx` is `{ el, t, lang, api, act, fail }`: `api(method, name, body)` calls this tab's own routes, `act(button, fn)` disables
   * the button while `fn` runs and shows a plain error when it fails. Text from the store or a customer goes on the page with `textContent` only.
   */
  script: string;
}

const ID = /^[a-z][a-z0-9-]*$/;

/** Refuses a tab the page could not run safely: the shell would show a broken page for every tab. Returns the tabs sorted for the shell. */
export function validateTabs(tabs: readonly DashboardTab[]): DashboardTab[] {
  const seen = new Set<string>();
  for (const tab of tabs) {
    if (!ID.test(tab.id)) throw new Error(`tab "${tab.id}": an id is lower-case letters, digits and hyphens`);
    if ((SHELL_TABS as readonly string[]).includes(tab.id)) throw new Error(`tab "${tab.id}": that id belongs to the shell`);
    if (seen.has(tab.id)) throw new Error(`tab "${tab.id}": two tabs have this id`);
    seen.add(tab.id);
    for (const lang of ['pt', 'en'] as const) if (typeof tab.label[lang] !== 'string' || tab.label[lang].trim() === '') throw new Error(`tab "${tab.id}": a label in ${lang} is needed`);
    for (const name of Object.keys(tab.routes ?? {})) if (!ID.test(name)) throw new Error(`tab "${tab.id}": route "${name}" is not a plain name`);
    if (/<\/script/i.test(tab.script)) throw new Error(`tab "${tab.id}": the script must not contain a closing script tag`);
    try {
      new Script(`(function (ctx) {${tab.script}\n})`, { filename: `tab-${tab.id}.js` });
    } catch (error) {
      throw new Error(`tab "${tab.id}": the script does not parse: ${(error as Error).message}`);
    }
  }
  return [...tabs].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** What the page is given for the tabs: the definitions as data and the scripts as function literals. `<` is escaped so no text can close the script block. */
export function tabsForPage(tabs: readonly DashboardTab[]): string {
  const defs = tabs.map((tab) => {
    const meta = JSON.stringify({ id: tab.id, label: tab.label, level: tab.level, order: tab.order, chip: tab.chip ?? null, text: tab.text ?? { pt: {}, en: {} } }).replaceAll('<', '\\u003c');
    return `Object.assign(${meta}, { build: function (ctx) {${tab.script}\n} })`;
  });
  return `[${defs.join(',\n')}]`;
}

// ---- the test chat as a tab (WZP-10..14, 19) -------------------------------------------------------------------------------------

const testText = {
  pt: {
    testNew: 'Nova conversa de teste', testChatN: 'Conversa de teste', testId: 'Nos comandos do escritório, esta conversa chama-se', testSend: 'Enviar', testType: 'Escreva como cliente…',
    testOffice: 'Escritório (comandos)', testOfficeHint: 'ex.: ooo back 09:00 Monday', testDraft: 'Resposta do bot (não é enviada)', testNoDraft: 'O bot não tem resposta: uma pessoa tem de responder.',
    testRight: 'Certa', testWrong: 'Errada', testAnswerHint: 'A resposta certa', testSaveAnswer: 'Guardar a resposta', testChange: 'Mudar a marca', testMarkedRight: 'Marcada como certa', testMarkedWrong: 'Marcada como errada. Resposta guardada:',
    testWhy: 'Como chegou aqui', testFacts: 'Factos usados', testUnconf: 'não confirmado', testChecks: 'Verificações', testQuestions: 'Perguntas para o escritório',
    testPass: 'Passar ao escritório', testScript: 'Guardar como guião de simulação', testCopy: 'Copiar', testCard: 'Cartão para o escritório (não é enviado)',
    testGets: 'O escritório receberia', testSafe: 'Nada é enviado a ninguém: só as chamadas ao modelo saem desta máquina.', testWorking: 'a pensar…', testCmds: 'Comandos: .help',
  },
  en: {
    testNew: 'New test chat', testChatN: 'Test chat', testId: 'In office commands this chat is called', testSend: 'Send', testType: 'Type as the customer…',
    testOffice: 'Office (commands)', testOfficeHint: 'e.g. ooo back 09:00 Monday', testDraft: 'The bot\'s reply (not sent)', testNoDraft: 'The bot has no reply: a person has to answer.',
    testRight: 'Right', testWrong: 'Wrong', testAnswerHint: 'The correct answer', testSaveAnswer: 'Save the answer', testChange: 'Change the mark', testMarkedRight: 'Marked right', testMarkedWrong: 'Marked wrong. Answer saved:',
    testWhy: 'How it got there', testFacts: 'Facts used', testUnconf: 'unconfirmed', testChecks: 'Checks', testQuestions: 'Questions for the office',
    testPass: 'Pass to the office', testScript: 'Save as a simulation script', testCopy: 'Copy', testCard: 'Card for the office (not sent)',
    testGets: 'The office would receive', testSafe: 'Nothing is sent to anyone: only the model calls leave this machine.', testWorking: 'working…', testCmds: 'Commands: .help',
  },
};

// No backticks and no dollar-brace in the script: it is a plain string the page runs, and the text it draws goes on the page with textContent.
const testScript = String.raw`
var el = ctx.el, t = ctx.t, api = ctx.api, act = ctx.act;
var chats = [], sel = null;
try { chats = JSON.parse(localStorage.getItem('cyborg.testchats') || '[]'); } catch (e) { chats = []; }
function save() { try { localStorage.setItem('cyborg.testchats', JSON.stringify(chats.slice(0, 20))); } catch (e) { /* private window */ } }
function fresh() {
  var n = 1; chats.forEach(function (c) { n = Math.max(n, c.n + 1); });
  var c = { id: 't' + n + '-' + Math.random().toString(36).slice(2, 6), n: n, messages: [] };
  chats.unshift(c); sel = c.id; save(); return c;
}
function turnView(box, turn) {
  if (turn.note) box.appendChild(el('div', 'tc-note', turn.note));
  var shown = null;
  turn.replies.forEach(function (r) { if (r.draft) shown = r; });
  if (turn.kind === 'reply') {
    var bubble = el('div', 'tc-bubble');
    bubble.appendChild(el('div', '', shown ? shown.draft : t('testNoDraft')));
    if (shown) bubble.appendChild(el('small', 'tc-note', t('testDraft') + (shown.band ? ' · ' + t('band') + ': ' + t('bands')[shown.band] : '')));
    box.appendChild(bubble);
  }
  if (turn.replaced) box.appendChild(el('div', 'tc-note', turn.replaced));
  turn.problems.forEach(function (p) { box.appendChild(el('div', 'tc-prob', p)); });
  if (turn.replies.length) {
    var d = document.createElement('details'); d.appendChild(el('summary', '', t('testWhy')));
    turn.replies.forEach(function (r) {
      d.appendChild(el('h3', '', ctx.handler(r.handler) + ' · ' + t('statuses')[r.status] + (r.band ? ' · ' + t('bands')[r.band] : '')));
      if (r.facts.length) { d.appendChild(el('div', 'tc-note', t('testFacts') + ':')); r.facts.forEach(function (f) { d.appendChild(el('div', 'line', f.key + (f.unconfirmed ? ' · ' + t('testUnconf') : ''))); }); }
      if (r.checks.length) { d.appendChild(el('div', 'tc-note', t('testChecks') + ':')); r.checks.forEach(function (c) { d.appendChild(el('div', 'line', c)); }); }
      if (r.questions.length) { d.appendChild(el('div', 'tc-note', t('testQuestions') + ':')); r.questions.forEach(function (q) { d.appendChild(el('div', 'line', q)); }); }
    });
    box.appendChild(d);
  }
  if (turn.card) { box.appendChild(el('h3', '', t('testCard'))); box.appendChild(el('pre', '', turn.card)); }
  if (turn.office.length) { box.appendChild(el('h3', '', t('testGets'))); turn.office.forEach(function (o) { box.appendChild(el('pre', '', o)); }); }
}
return { draw: function (main) {
  if (!chats.length) fresh();
  if (!sel || !chats.some(function (c) { return c.id === sel; })) sel = chats[0].id;
  main.className = 'two';
  var list = el('div', ''), panel = el('div', 'panel'); main.appendChild(list); main.appendChild(panel);
  var cur = function () { return chats.filter(function (c) { return c.id === sel; })[0]; };
  var thread = el('div', ''), busy = false;
  var head = el('h2', ''), idLine = el('div', 'tc-note'), safe = el('div', 'tc-note', t('testSafe'));
  var row = el('div', 'tc-row'), input = el('input', ''), send = el('button', 'primary', t('testSend'));
  input.placeholder = t('testType'); input.maxLength = 1000; input.setAttribute('aria-label', t('testType')); row.appendChild(input); row.appendChild(send);
  var cmds = el('div', 'tc-note', t('testCmds'));
  var pass = el('button', '', t('testPass'));
  var officeRow = el('div', 'tc-row'), officeIn = el('input', ''), officeBtn = el('button', '', t('testSend'));
  officeIn.placeholder = t('testOfficeHint'); officeIn.maxLength = 300; officeIn.setAttribute('aria-label', t('testOffice')); officeRow.appendChild(officeIn); officeRow.appendChild(officeBtn);
  var officeLog = el('div', '');
  function renderList() {
    list.textContent = '';
    var nb = el('button', 'primary', t('testNew')); nb.style.marginBottom = '8px';
    nb.addEventListener('click', function () { fresh(); renderList(); renderThread(); input.focus(); });
    list.appendChild(nb);
    chats.forEach(function (c) {
      var d = el('div', 'row none' + (c.id === sel ? ' sel' : ''));
      d.appendChild(el('b', '', t('testChatN') + ' ' + c.n));
      var last = c.messages.filter(function (m) { return m.dir === 'in'; }).slice(-1)[0];
      d.appendChild(el('small', '', last ? last.text.slice(0, 60) : '—'));
      d.addEventListener('click', function () { sel = c.id; renderList(); renderThread(); });
      list.appendChild(d);
    });
  }
  function renderThread() {
    var c = cur(); thread.textContent = '';
    head.textContent = t('testChatN') + ' ' + c.n; idLine.textContent = t('testId') + ': ' + c.id;
    c.messages.forEach(function (m) {
      var box = el('div', 'tc-msg' + (m.dir === 'in' ? ' tc-in' : ''));
      if (m.dir === 'in') box.appendChild(el('span', '', m.text));
      else if (m.dir === 'out') { turnView(box, m.turn); verdictView(box, m, c); }
      else if (m.dir === 'card') { box.appendChild(el('h3', '', t('testCard'))); box.appendChild(el('pre', '', m.card || m.text)); }
      thread.appendChild(box);
    });
    if (busy) thread.appendChild(el('div', 'tc-note', t('testWorking')));
  }
  // feat-desk DSK-75: right or wrong, under the bot's reply, in the same place. Wrong opens the box for the correct answer.
  function verdictView(box, m, c) {
    var replied = function (x) { return x.dir === 'out' && x.turn.kind === 'reply' && x.turn.replies.some(function (r) { return r.draft; }); };
    // The verdict acts on the chat's latest bot reply, so the controls are under that one only; an older reply keeps what it was marked.
    var latest = c.messages.filter(replied).slice(-1)[0];
    if (!replied(m)) return;
    if (m !== latest) { if (m.verdict) box.appendChild(el('div', 'tc-note', m.verdict === 'right' ? t('testMarkedRight') : t('testMarkedWrong') + ' ' + (m.answer || ''))); return; }
    var line = el('div', 'tc-row');
    if (m.verdict) {
      line.appendChild(el('span', 'tc-note', m.verdict === 'right' ? t('testMarkedRight') : t('testMarkedWrong') + ' ' + (m.answer || '')));
      var changeBtn = el('button', '', t('testChange'));
      changeBtn.addEventListener('click', function () {
        go(changeBtn, function () { return api('POST', 'verdict', { chat: c.id, verdict: 'undo' }).then(function () { delete m.verdict; delete m.answer; }); });
      });
      line.appendChild(changeBtn); box.appendChild(line); return;
    }
    var okBtn = el('button', '', t('testRight')), badBtn = el('button', '', t('testWrong'));
    okBtn.addEventListener('click', function () {
      go(okBtn, function () { return api('POST', 'verdict', { chat: c.id, verdict: 'right' }).then(function () { m.verdict = 'right'; }); });
    });
    badBtn.addEventListener('click', function () {
      line.textContent = '';
      var ans = el('input', ''), saveBtn = el('button', 'primary', t('testSaveAnswer'));
      ans.placeholder = t('testAnswerHint'); ans.maxLength = 1000; ans.setAttribute('aria-label', t('testAnswerHint'));
      line.appendChild(ans); line.appendChild(saveBtn); ans.focus();
      var submit = function () {
        var text = ans.value.trim(); if (!text || busy) return;
        go(saveBtn, function () { return api('POST', 'verdict', { chat: c.id, verdict: 'wrong', answer: text }).then(function () { m.verdict = 'wrong'; m.answer = text; }); });
      };
      saveBtn.addEventListener('click', submit);
      ans.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    });
    line.appendChild(okBtn); line.appendChild(badBtn); box.appendChild(line);
  }
  function go(button, fn) { busy = true; renderThread(); return act(button, fn).then(function () { busy = false; save(); renderList(); renderThread(); }); }
  function sendLine() {
    var text = input.value.trim(); if (!text || busy) return;
    var c = cur(); c.messages.push({ dir: 'in', text: text }); input.value = '';
    go(send, function () { return api('POST', 'turn', { chat: c.id, text: text }).then(function (turn) { c.messages.push({ dir: 'out', turn: turn }); }); });
  }
  send.addEventListener('click', sendLine);
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') sendLine(); });
  pass.addEventListener('click', function () {
    var c = cur(); go(pass, function () { return api('POST', 'handoff', { chat: c.id }).then(function (r) { c.messages.push({ dir: 'card', card: r.card, text: r.note || '' }); }); });
  });
  function sendOffice() {
    var text = officeIn.value.trim(); if (!text || busy) return; officeIn.value = '';
    var box = el('div', 'tc-msg tc-in'); box.appendChild(el('span', '', text)); officeLog.appendChild(box);
    var out = el('div', 'tc-msg'); officeLog.appendChild(out);
    go(officeBtn, function () { return api('POST', 'office', { text: text }).then(function (turn) { turnView(out, turn); }); });
  }
  officeBtn.addEventListener('click', sendOffice);
  officeIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') sendOffice(); });
  var scriptBtn = el('button', '', t('testScript')), scriptOut = el('pre', ''), copyBtn = el('button', '', t('testCopy'));
  scriptOut.style.display = 'none'; copyBtn.style.display = 'none';
  scriptBtn.addEventListener('click', function () {
    act(scriptBtn, function () { return api('POST', 'script', {}).then(function (sc) { scriptOut.textContent = JSON.stringify(sc, null, 2); scriptOut.style.display = ''; copyBtn.style.display = ''; }); });
  });
  copyBtn.addEventListener('click', function () { try { navigator.clipboard.writeText(scriptOut.textContent); } catch (e) { /* no clipboard */ } });
  var acts = el('div', 'actions'); acts.appendChild(pass); acts.appendChild(scriptBtn); acts.appendChild(copyBtn);
  panel.appendChild(head); panel.appendChild(idLine); panel.appendChild(safe); panel.appendChild(thread); panel.appendChild(row); panel.appendChild(cmds);
  panel.appendChild(acts); panel.appendChild(scriptOut);
  panel.appendChild(el('h3', '', t('testOffice'))); panel.appendChild(officeRow); panel.appendChild(officeLog);
  renderList(); renderThread(); input.focus();
} };
`;

/** WZP-10: the test chat, contributed to the shell like any other tab. Its routes are `turn`, `office`, `handoff`, `verdict` and `script`. */
export function testChatTab(chat: TestChat): DashboardTab {
  const text = (body: unknown, key: string): string => (typeof (body as Record<string, unknown>)?.[key] === 'string' ? ((body as Record<string, string>)[key] as string) : '');
  return {
    id: 'test',
    label: { pt: 'Testar', en: 'Test' },
    level: 'simple',
    order: 30,
    ...(chat.demo ? { chip: `DEMO · ${chat.demo}` } : {}),
    text: testText,
    routes: {
      turn: ({ body }) => chat.customer(text(body, 'chat'), text(body, 'text')),
      office: ({ body }) => chat.office(text(body, 'text')),
      handoff: ({ body }) => chat.handoff(text(body, 'chat')),
      verdict: ({ body }) => chat.verdict(text(body, 'chat'), text(body, 'verdict') === 'wrong' ? 'wrong' : text(body, 'verdict') === 'undo' ? 'undo' : 'right', text(body, 'answer')),
      script: () => chat.script(),
    },
    script: testScript,
  };
}
