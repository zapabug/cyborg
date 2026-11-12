import { CHAT_ROLES, type ChatRole } from '@cyborg/core';
import type { DashboardTab } from './tabs.ts';

// feat-wazaa-port WZP-30..39, wazaa's Configurar: the chats of the linked account by name, and the person's choice of what the bot reads and
// for what. The shell knows no channel: a channel adapter gives the tab a ChatDirectory and the tab does the rest. Numbers and addresses never
// reach this tab (WZP-31): a chat is a reference, a name and a kind.

export interface DirectoryChat {
  /** The opaque reference the core uses for the chat (ADM-104); the page never sees a number or an address. */
  ref: string;
  /** The name the account shows for the chat, or null when it is only a number: the page then says "no name". */
  name: string | null;
  kind: 'person' | 'group';
  /** For a group: how many members. */
  members?: number;
  lastAt?: string;
  /** What the bot does there now; `ignored` is the default, and nothing is read until a person chooses (WZP-32). */
  role: ChatRole;
  /** The client's tasks (their intake titles) chosen for this chat; absent until a person has chosen. */
  tasks?: string[];
}

/** WZP-5: the fine print the client agrees to before the channel reads any chat. */
export interface DirectoryAgreement {
  /** The channel's own fine print, in each staff language, as paragraphs. */
  text: { pt: string[]; en: string[] };
  /** The business's own terms, shown after the fine print; null when it has none. */
  terms: string | null;
  /** Identifies the text shown; a record is for one version and a changed text asks again. */
  version: string;
  /** Who agreed and when; null while nobody has. While null the channel lists no chats and watches nothing. */
  recorded: { at: string } | null;
}

export interface DirectoryListing {
  /** False until the channel is linked and ready: there are no chats to show yet. */
  ready: boolean;
  chats: DirectoryChat[];
  /** Present when the channel needs the client's agreement (WZP-5). Not recorded: `chats` is empty and the tab shows the fine print first. */
  agreement?: DirectoryAgreement;
}

export interface DirectoryChoice {
  ref: string;
  role: ChatRole;
  /** WZP-34: the intake tasks done in this chat. Kept and shown; what each task makes the bot do is the handlers' job, not the picker's. */
  tasks?: string[];
}

/** A task of the client's intake that the picker offers to the chats of these kinds. */
export interface DirectoryTask {
  title: string;
  roles: ChatRole[];
}

export interface ChatDirectory {
  chats(): Promise<DirectoryListing>;
  /**
   * Applies the choices to the running channel and keeps them for the next start. A chat not in the list keeps what it has. It throws a plain
   * message when it cannot (not linked, an unknown chat), which the tab shows.
   */
  save(choices: DirectoryChoice[], by: string): Promise<{ watching: number }>;
  /** WZP-5: records that the client agreed to the text of `version` (`by` is the dashboard's operator label). Throws a plain message when it cannot (a changed text). Absent when the channel needs no agreement. */
  agree?(version: string, by: string): Promise<void>;
  /** WZP-85: which account is linked (null while none is), shown on the tab with the Unlink button. */
  account?(): string | null;
  /** WZP-85: logs the account out of this computer, deletes the stored session and starts a new link. `by` is the dashboard's operator label. Absent when the channel cannot. */
  unlink?(by: string): Promise<{ loggedOut: boolean }>;
}

/** N-21 (docs/02). */
const MAX_CHOICES = 500;

/** WZP-36, WZP-38: the rules every channel gets, checked before the adapter sees a choice. */
export function checkChoices(raw: unknown): DirectoryChoice[] {
  const list = (raw as { choices?: unknown } | null)?.choices;
  if (!Array.isArray(list) || list.length === 0) throw new Error('there is nothing to save');
  if (list.length > MAX_CHOICES) throw new Error(`more than ${MAX_CHOICES} chats at once`);
  const seen = new Set<string>();
  const out: DirectoryChoice[] = [];
  for (const item of list) {
    const ref = (item as { ref?: unknown })?.ref;
    const role = (item as { role?: unknown })?.role;
    if (typeof ref !== 'string' || ref === '') throw new Error('a choice has no chat');
    if (typeof role !== 'string' || !(CHAT_ROLES as readonly string[]).includes(role)) throw new Error(`"${String(role)}" is not something the bot can do in a chat`);
    if (seen.has(ref)) throw new Error('the same chat is chosen twice');
    seen.add(ref);
    const tasks = (item as { tasks?: unknown }).tasks;
    if (tasks !== undefined) {
      if (!Array.isArray(tasks) || tasks.length > 40 || tasks.some((t) => typeof t !== 'string' || t === '' || t.length > 200)) throw new Error('the tasks of a chat are a short list of names');
      if (role === 'ignored' && tasks.length > 0) throw new Error('a chat the bot ignores has no tasks');
    }
    out.push({ ref, role: role as ChatRole, ...(tasks === undefined ? {} : { tasks: tasks as string[] }) });
  }
  if (out.filter((c) => c.role === 'ops').length > 1) throw new Error('only one chat can be the office chat');
  return out;
}

const text = {
  pt: {
    cfgTitle: 'Que conversas o bot lê', cfgIntro: 'Escolha o que o bot faz em cada conversa. Enquanto não escolher, não lê nada. Os rascunhos vão para a sua própria conversa («Mensagens para si»); nada é enviado a clientes.',
    cfgNotReady: 'A ligação ainda não está pronta. Quando o WhatsApp estiver ligado, as conversas aparecem aqui.', cfgRetry: 'Ver outra vez',
    cfgSearch: 'Procurar pelo nome…', cfgAll: 'Todas', cfgGroups: 'Grupos', cfgPeople: 'Pessoas', cfgWatched: 'A ler',
    cfgGroup: 'grupo', cfgPerson: 'pessoa', cfgMembers: 'membros', cfgNoName: 'sem nome', cfgNone: 'Nenhuma conversa com esse filtro.',
    cfgSave: 'Guardar', cfgSaved: 'Guardado. O bot lê agora {n} conversas, em modo sombra: nada é enviado a clientes.', cfgChanged: 'alterações por guardar',
    cfgReading: 'A ler {n} conversas', cfgOneOps: 'Só uma conversa pode ser o escritório.', cfgTasks: 'Tarefas do cliente nesta conversa',
    roles: { ignored: 'Ignorar', reply: 'Clientes: o bot redige respostas', monitor: 'Equipa: só leitura', ops: 'Escritório: comandos e avisos' },
    agTitle: 'Antes de começar: letra pequena', agIntro: 'O bot só pode ler conversas depois de uma pessoa do cliente ler isto e concordar. Enquanto não concordar, não se mostra nenhuma conversa.',
    agTerms: 'Os termos do negócio', lkTitle: 'WhatsApp ligado', lkAs: 'Conta ligada', lkNone: 'Nenhuma conta ligada.', lkButton: 'Desligar o WhatsApp', lkAsk: 'Isto termina a sessão da conta neste computador. As conversas ficam no telemóvel. Para usar o bot outra vez, lê um código novo.', lkYes: 'Sim, desligar', lkNo: 'Cancelar', lkDone: 'Desligado. Lê o código novo que aparece no topo da página para ligar outra vez.', lkPhone: 'Não foi possível terminar a sessão no telemóvel: remova este aparelho em WhatsApp, Aparelhos ligados.', agButton: 'Concordo', agDone: 'Concordou em {at}.', agFailed: 'Não foi possível guardar.',
    roleHelp: 'Clientes: o bot redige respostas que uma pessoa aprova. Equipa: o bot só lê (manutenção, tarefas). Escritório: onde chegam os avisos e onde se dão comandos.',
  },
  en: {
    cfgTitle: 'Which chats the bot reads', cfgIntro: 'Choose what the bot does in each chat. Until you choose, it reads nothing. Drafts go to your own chat (“Message yourself”); nothing is sent to customers.',
    cfgNotReady: 'The link is not ready yet. When WhatsApp is linked, the chats appear here.', cfgRetry: 'Look again',
    cfgSearch: 'Search by name…', cfgAll: 'All', cfgGroups: 'Groups', cfgPeople: 'People', cfgWatched: 'Reading',
    cfgGroup: 'group', cfgPerson: 'person', cfgMembers: 'members', cfgNoName: 'no name', cfgNone: 'No chat matches that filter.',
    cfgSave: 'Save', cfgSaved: 'Saved. The bot now reads {n} chats, in shadow mode: nothing is sent to customers.', cfgChanged: 'changes not saved',
    cfgReading: 'Reading {n} chats', cfgOneOps: 'Only one chat can be the office.', cfgTasks: 'The client\'s tasks in this chat',
    roles: { ignored: 'Ignore', reply: 'Customers: the bot drafts replies', monitor: 'Team: read only', ops: 'Office: commands and alerts' },
    agTitle: 'Before we start: the fine print', agIntro: 'The bot can read chats only after a person of the client has read this and agreed. Until then no chat is shown.',
    agTerms: 'The business\'s own terms', lkTitle: 'WhatsApp link', lkAs: 'Linked account', lkNone: 'No account is linked.', lkButton: 'Unlink WhatsApp', lkAsk: 'This logs the account out of this computer. Chats stay on the phone. To use the bot again you scan a new code.', lkYes: 'Yes, unlink', lkNo: 'Cancel', lkDone: 'Unlinked. Scan the new code that appears at the top of the page to link again.', lkPhone: 'The phone could not be told to end the session: remove this device in WhatsApp, Linked devices.', agButton: 'I agree', agDone: 'Agreed on {at}.', agFailed: 'Could not save.',
    roleHelp: 'Customers: the bot drafts replies a person approves. Team: the bot only reads (maintenance, tasks). Office: where alerts arrive and where commands are given.',
  },
};

// No backticks and no dollar-brace: a plain string the page runs. Names and everything from the account go on the page with textContent.
const script = String.raw`
var el = ctx.el, t = ctx.t, api = ctx.api, act = ctx.act;
var data = null, pending = {}, filter = 'all', query = '', note = '';
function defaults(role) { return (data.tasks || []).filter(function (x) { return x.roles.indexOf(role) >= 0; }).map(function (x) { return x.title; }); }
function load(box) {
  return api('GET', 'chats').then(function (d) { data = d; pending = {}; if (box) render(box); });
}
function changes() { return Object.keys(pending).length; }
function roleOf(c) { return pending[c.ref] !== undefined ? pending[c.ref].role : c.role; }
function tasksOf(c) { if (pending[c.ref] && pending[c.ref].tasks) return pending[c.ref].tasks; return c.tasks || defaults(roleOf(c)); }
function renderAgreement(box, panel) {
  var ag = data.agreement, lang = ctx.lang();
  panel.appendChild(el('h3', '', t('agTitle')));
  panel.appendChild(el('p', 'tc-note', t('agIntro')));
  var print = el('div', 'row none');
  (ag.text[lang] || ag.text.en).forEach(function (para) { print.appendChild(el('p', '', para)); });
  panel.appendChild(print);
  if (ag.terms) {
    panel.appendChild(el('h3', '', t('agTerms')));
    var terms = el('div', 'row none'); terms.style.whiteSpace = 'pre-wrap'; terms.textContent = ag.terms; panel.appendChild(terms);
  }
  var go = el('button', 'primary', t('agButton'));
  go.addEventListener('click', function () {
    act(go, function () { return api('POST', 'agree', { version: ag.version }).then(function () { return load(box); }); });
  });
  var acts = el('div', 'actions'); acts.appendChild(go); panel.appendChild(acts);
}
function render(box) {
  box.textContent = '';
  var panel = el('div', 'panel'); box.appendChild(panel);
  panel.appendChild(el('h2', '', t('cfgTitle')));
  panel.appendChild(el('p', 'tc-note', t('cfgIntro')));
  if (!data || !data.ready) {
    if (note) panel.appendChild(el('p', 'tc-note', note));
    panel.appendChild(el('div', 'empty', t('cfgNotReady')));
    var again = el('button', '', t('cfgRetry')); again.addEventListener('click', function () { act(again, function () { return load(box); }); }); panel.appendChild(again);
    return;
  }
  if (data.agreement && !data.agreement.recorded) { renderAgreement(box, panel); return; }
  if (data.agreement && data.agreement.recorded) {
    var ag = data.agreement.recorded;
    panel.appendChild(el('p', 'tc-note', t('agDone').replace('{at}', ag.at.slice(0, 16).replace('T', ' '))));
  }
  if (data.link) {
    // WZP-85: which account is linked, and Unlink behind a second press.
    var lk = el('div', 'row none'), ask = el('div', ''), ub = el('button', '', t('lkButton'));
    lk.appendChild(el('b', '', t('lkTitle'))); lk.appendChild(el('span', 'tc-note', ' · ' + t('lkAs') + ': ' + (data.link.account || '—')));
    ub.addEventListener('click', function () {
      ub.style.display = 'none'; ask.textContent = ''; ask.appendChild(el('p', 'tc-note', t('lkAsk')));
      var yes = el('button', 'primary', t('lkYes')), no = el('button', '', t('lkNo'));
      yes.addEventListener('click', function () {
        act(yes, function () { return api('POST', 'unlink', {}).then(function (r) { note = t('lkDone') + (r && r.loggedOut === false ? ' ' + t('lkPhone') : ''); return load(box); }); });
      });
      no.addEventListener('click', function () { ask.textContent = ''; ub.style.display = ''; });
      ask.appendChild(yes); ask.appendChild(no);
    });
    lk.appendChild(document.createElement('br')); lk.appendChild(ub); lk.appendChild(ask); panel.appendChild(lk);
  }
  panel.appendChild(el('p', 'tc-note', t('roleHelp')));
  var watching = data.chats.filter(function (c) { return roleOf(c) !== 'ignored'; }).length;
  var bar = el('div', 'tc-row');
  var search = el('input', ''); search.placeholder = t('cfgSearch'); search.value = query; search.setAttribute('aria-label', t('cfgSearch'));
  bar.appendChild(search); panel.appendChild(bar);
  var chips = el('div', 'actions');
  [['all', 'cfgAll'], ['group', 'cfgGroups'], ['person', 'cfgPeople'], ['watched', 'cfgWatched']].forEach(function (f) {
    var b = el('button', filter === f[0] ? 'primary' : '', t(f[1])); b.addEventListener('click', function () { filter = f[0]; render(box); }); chips.appendChild(b);
  });
  panel.appendChild(chips);
  var status = el('div', 'tc-note', t('cfgReading').replace('{n}', watching) + (changes() ? ' · ' + changes() + ' ' + t('cfgChanged') : '')); panel.appendChild(status);
  var list = el('div', ''); panel.appendChild(list);
  function drawList() {
    list.textContent = '';
    var q = query.trim().toLowerCase(), shown = 0;
    data.chats.forEach(function (c) {
      var role = roleOf(c);
      if (filter === 'group' && c.kind !== 'group') return;
      if (filter === 'person' && c.kind !== 'person') return;
      if (filter === 'watched' && role === 'ignored') return;
      if (q && (c.name || '').toLowerCase().indexOf(q) < 0) return;
      shown++;
      var row = el('div', 'row ' + (role === 'ignored' ? 'none' : 'green'));
      var top = el('div', ''); top.style.display = 'flex'; top.style.gap = '8px'; top.style.flexWrap = 'wrap'; top.style.alignItems = 'center';
      var name = el('b', '', c.name || t('cfgNoName')); name.style.flex = '1 1 200px'; top.appendChild(name);
      top.appendChild(el('span', 'pill', c.kind === 'group' ? t('cfgGroup') + (c.members ? ' · ' + c.members + ' ' + t('cfgMembers') : '') : t('cfgPerson')));
      var sel = el('select', ''); sel.setAttribute('aria-label', (c.name || t('cfgNoName')));
      ['ignored', 'reply', 'monitor', 'ops'].forEach(function (r) { var o = el('option', '', t('roles')[r]); o.value = r; if (r === role) o.selected = true; sel.appendChild(o); });
      sel.addEventListener('change', function () {
        if (sel.value === c.role) delete pending[c.ref]; else pending[c.ref] = { role: sel.value, tasks: sel.value === 'ignored' ? [] : defaults(sel.value) };
        render(box);
      });
      top.appendChild(sel); row.appendChild(top);
      var avail = role === 'ignored' ? [] : (data.tasks || []).filter(function (x) { return x.roles.indexOf(role) >= 0; });
      if (avail.length) {
        var det = document.createElement('details'); var chosen = tasksOf(c);
        det.appendChild(el('summary', '', t('cfgTasks') + ' (' + chosen.length + '/' + avail.length + ')'));
        avail.forEach(function (x) {
          var lab = el('label', 'line'); lab.style.display = 'block';
          var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = chosen.indexOf(x.title) >= 0; cb.style.minHeight = '0'; cb.style.marginRight = '8px';
          cb.addEventListener('change', function () {
            var now = tasksOf(c).filter(function (y) { return y !== x.title; });
            if (cb.checked) now.push(x.title);
            pending[c.ref] = { role: role, tasks: now };
            render(box);
          });
          lab.appendChild(cb); lab.appendChild(document.createTextNode(x.title)); det.appendChild(lab);
        });
        row.appendChild(det);
      }
      row.style.cursor = 'default'; list.appendChild(row);
    });
    if (!shown) list.appendChild(el('div', 'empty', t('cfgNone')));
  }
  search.addEventListener('input', function () { query = search.value; drawList(); });
  drawList();
  var opsCount = data.chats.filter(function (c) { return roleOf(c) === 'ops'; }).length;
  if (opsCount > 1) panel.appendChild(el('div', 'tc-prob', t('cfgOneOps')));
  var acts = el('div', 'actions'), save = el('button', 'primary', t('cfgSave'));
  save.disabled = !changes() || opsCount > 1;
  save.addEventListener('click', function () {
    var choices = Object.keys(pending).map(function (ref) { var p = pending[ref]; return p.tasks ? { ref: ref, role: p.role, tasks: p.tasks } : { ref: ref, role: p.role }; });
    act(save, function () { return api('POST', 'save', { choices: choices }).then(function (r) { return load(null).then(function () { note = t('cfgSaved').replace('{n}', r.watching); render(box); }); }); });
  });
  acts.appendChild(save); panel.appendChild(acts);
  if (note) { panel.appendChild(el('div', 'tc-note', note)); }
}
return { draw: function (box) { note = ''; render(box); load(box).catch(ctx.fail); } };
`;

/** The Configurar tab for a channel's chat directory. Routes: `chats` and `save`. */
export function configureTab(directory: ChatDirectory, options: { tasks?: DirectoryTask[] } = {}): DashboardTab {
  return {
    id: 'configure',
    label: { pt: 'Configurar', en: 'Configure' },
    level: 'simple',
    order: 35,
    text,
    routes: {
      chats: async () => ({ ...(await directory.chats()), tasks: options.tasks ?? [], ...(directory.unlink ? { link: { account: directory.account?.() ?? null } } : {}) }),
      unlink: async ({ operator }) => {
        if (!directory.unlink) throw new Error('this channel cannot be unlinked here');
        return directory.unlink(operator);
      },
      save: ({ body, operator }) => directory.save(checkChoices(body), operator),
      agree: async ({ body, operator }) => {
        if (!directory.agree) throw new Error('this channel needs no agreement');
        const version = (body as { version?: unknown } | null)?.version;
        if (typeof version !== 'string') throw new Error('the fine print has changed: read it again');
        await directory.agree(version, operator);
        return { ok: true };
      },
    },
    script,
  };
}
