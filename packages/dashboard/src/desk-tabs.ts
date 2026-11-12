import { addPartner, answerQuestion, forgetLearned, listLearned, assetRecords, decideBooking, dismissMaintenance, doneMaintenance, fixTicket, listBookings, listMaintenance, listPartners, partnerAccount, removePartner, scheduleMaintenance, listNotes, listTickets, openQuestions, recentAnswers, saveNote, type Company, type NoteKind } from '@cyborg/company';
import { businessTab, type SheetStore } from './business-tab.ts';
import type { DashboardTab, TabRequest } from './tabs.ts';

// feat-wazaa-port W5, WZP-41..46: the chat desk's tabs (wazaa's Lições, Perguntas, Conversas and Guardados). They sit on what the company already
// has: the lesson store, the handoff cards, the audit log. The shell knows none of them; a company that has the sales module gets them (DSH-2).

const LESSON_MAX = 300;
const str = (body: unknown, key: string): string => (typeof (body as Record<string, unknown>)?.[key] === 'string' ? ((body as Record<string, string>)[key] as string).trim() : '');

// ---- Lições (wazaa docs/17, PRF-22, PRF-67) ------------------------------------------------------------------------------------------------

const lessonText = {
  pt: {
    lsTitle: 'Lições', lsIntro: 'Uma lição é uma regra curta que o bot passa a seguir nas próximas respostas, como «quando disser o preço, diga que o transporte está incluído». Só uma pessoa as acrescenta e pode retirá-las quando quiser.',
    lsNone: 'Ainda sem lições.', lsAdd: 'Acrescentar', lsPlaceholder: 'Escreva a regra numa frase curta…', lsAll: 'Em todas as respostas', lsRetire: 'Retirar', lsEdit: 'Editar',
    lsEditing: 'A editar uma lição: ao acrescentar, a antiga é retirada.', lsCancel: 'Cancelar', lsSince: 'desde', lsWhere: 'Aplica-se a', lsMax: 'Máximo de caracteres: ' + LESSON_MAX,
  },
  en: {
    lsTitle: 'Lessons', lsIntro: 'A lesson is a short rule the bot follows in its next replies, like “when you give a price, say pick-up is included”. Only a person adds them and can retire them whenever they like.',
    lsNone: 'No lessons yet.', lsAdd: 'Add', lsPlaceholder: 'Write the rule in one short sentence…', lsAll: 'In every reply', lsRetire: 'Retire', lsEdit: 'Edit',
    lsEditing: 'Editing a lesson: when you add, the old one is retired.', lsCancel: 'Cancel', lsSince: 'since', lsWhere: 'Applies to', lsMax: 'Most characters: ' + LESSON_MAX,
  },
};

const lessonScript = String.raw`
var el = ctx.el, t = ctx.t, api = ctx.api, act = ctx.act;
var data = null, editing = null;
return { draw: function (box) {
  box.textContent = '';
  var panel = el('div', 'panel'); box.appendChild(panel);
  panel.appendChild(el('h2', '', t('lsTitle')));
  panel.appendChild(el('p', 'tc-note', t('lsIntro')));
  var list = el('div', '');
  var row = el('div', 'tc-row'), input = el('input', ''), add = el('button', 'primary', t('lsAdd'));
  input.placeholder = t('lsPlaceholder'); input.maxLength = ` + LESSON_MAX + String.raw`; input.setAttribute('aria-label', t('lsPlaceholder'));
  var where = el('select', ''); where.setAttribute('aria-label', t('lsWhere'));
  var note = el('div', 'tc-note'), cancel = el('button', '', t('lsCancel')); cancel.style.display = 'none';
  row.appendChild(input); row.appendChild(where); row.appendChild(add);
  function fill() {
    where.textContent = '';
    var all = el('option', '', t('lsAll')); all.value = ''; where.appendChild(all);
    (data.handlers || []).forEach(function (h) { var o = el('option', '', ctx.handler(h)); o.value = h; where.appendChild(o); });
  }
  function drawList() {
    list.textContent = '';
    if (!data.lessons.length) list.appendChild(el('div', 'empty', t('lsNone')));
    data.lessons.forEach(function (l) {
      var r = el('div', 'row green'); r.style.cursor = 'default';
      r.appendChild(el('b', '', l.text));
      r.appendChild(el('small', '', t('lsWhere') + ': ' + (l.handlerId ? ctx.handler(l.handlerId) : t('lsAll')) + ' · ' + t('lsSince') + ' ' + new Date(l.createdAt).toLocaleDateString(ctx.lang() === 'pt' ? 'pt-PT' : 'en-GB')));
      var acts = el('div', 'actions'), ed = el('button', '', t('lsEdit')), rt = el('button', '', t('lsRetire'));
      ed.addEventListener('click', function () { editing = l.id; input.value = l.text; where.value = l.handlerId || ''; note.textContent = t('lsEditing'); cancel.style.display = ''; input.focus(); });
      rt.addEventListener('click', function () { act(rt, function () { return api('POST', 'retire', { id: l.id }).then(load); }); });
      acts.appendChild(ed); acts.appendChild(rt); r.appendChild(acts); list.appendChild(r);
    });
  }
  function load() { return api('GET', 'list').then(function (d) { data = d; fill(); drawList(); }); }
  function reset() { editing = null; input.value = ''; note.textContent = ''; cancel.style.display = 'none'; }
  function send() {
    var text = input.value.trim(); if (!text) return;
    act(add, function () { return api('POST', 'add', { text: text, handler: where.value, replaces: editing || '' }).then(function () { reset(); return load(); }); });
  }
  add.addEventListener('click', send); input.addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); });
  cancel.addEventListener('click', reset);
  panel.appendChild(row); panel.appendChild(note); panel.appendChild(cancel); panel.appendChild(el('h3', '', t('lsTitle'))); panel.appendChild(list);
  load().catch(ctx.fail);
} };
`;

export function lessonsTab(company: Company): DashboardTab {
  const modelHandlers = () => company.registry.all().filter((h) => h.kind === 'model').map((h) => h.id);
  return {
    id: 'lessons',
    label: { pt: 'Lições', en: 'Lessons' },
    level: 'simple',
    order: 60,
    text: lessonText,
    routes: {
      list: () => ({ lessons: company.store.listLessons().filter((l) => l.status === 'active').sort((a, b) => a.version - b.version), handlers: modelHandlers() }),
      add: ({ body, operator }: TabRequest) => {
        const text = str(body, 'text');
        const handler = str(body, 'handler');
        const replaces = str(body, 'replaces');
        if (text.length < 5) throw new Error('a lesson is a short sentence');
        if (text.length > LESSON_MAX) throw new Error(`a lesson is at most ${LESSON_MAX} characters`);
        if (handler !== '' && !modelHandlers().includes(handler)) throw new Error('that is not a step of the bot that a lesson can apply to');
        const at = new Date().toISOString();
        if (replaces !== '') company.store.retireLesson(replaces, at);
        const lesson = company.store.addLesson({ handlerId: handler === '' ? null : handler, text, originEntryId: null }, at);
        company.store.appendAudit({ at, proposalId: null, kind: 'lesson_by', fromStatus: null, toStatus: null, actor: operator, detail: { id: lesson.id, ...(replaces ? { replaces } : {}) } });
        return lesson;
      },
      retire: ({ body, operator }: TabRequest) => {
        const id = str(body, 'id');
        if (id === '') throw new Error('which lesson?');
        const at = new Date().toISOString();
        const lesson = company.store.retireLesson(id, at);
        company.store.appendAudit({ at, proposalId: null, kind: 'lesson_by', fromStatus: null, toStatus: null, actor: operator, detail: { id, retired: true } });
        return lesson;
      },
    },
    script: lessonScript,
  };
}


// ---- Perguntas (wazaa docs/10: the office answers, and the answer can be kept for the next customer) ----------------------------------------------

const questionText = {
  pt: {
    qsTitle: 'Perguntas ao escritório', qsIntro: 'Aqui estão os clientes a quem o bot não pôde responder sozinho. Escreva a resposta: fica registada como a resposta do escritório, ao lado do rascunho do bot. Em modo sombra nada é enviado ao cliente.',
    qsNone: 'Nenhuma pergunta à espera.', qsAnswer: 'A resposta do escritório…', qsSend: 'Responder', qsRemember: 'Lembrar para os próximos clientes', qsQuestion: 'A pergunta, como fica nas respostas frequentes',
    qsLearned: 'Respostas guardadas para os próximos clientes', qsForget: 'Esquecer', qsNoLearned: 'Nenhuma ainda.',
    qsDone: 'Respondidas há pouco', qsKept: 'guardada nas respostas frequentes (por confirmar)', qsNoDone: 'Ainda nenhuma.', qsSince: 'desde', qsBy: 'por', qsNoName: 'cliente sem nome',
  },
  en: {
    qsTitle: 'Questions for the office', qsIntro: 'These are the customers the bot could not answer alone. Write the answer: it is recorded as the office\'s reply beside the bot\'s draft. In shadow mode nothing is sent to the customer.',
    qsNone: 'No question is waiting.', qsAnswer: 'The office\'s answer…', qsSend: 'Answer', qsRemember: 'Remember for the next customers', qsQuestion: 'The question, as it goes into the FAQ',
    qsLearned: 'Answers kept for the next customers', qsForget: 'Forget', qsNoLearned: 'None yet.',
    qsDone: 'Answered recently', qsKept: 'kept in the FAQ (to be confirmed)', qsNoDone: 'None yet.', qsSince: 'since', qsBy: 'by', qsNoName: 'customer with no name',
  },
};

const questionScript = String.raw`
var el = ctx.el, t = ctx.t, api = ctx.api, act = ctx.act;
function when(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString(ctx.lang() === 'pt' ? 'pt-PT' : 'en-GB', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }); }
return { draw: function (box) {
  box.textContent = '';
  var panel = el('div', 'panel'); box.appendChild(panel);
  panel.appendChild(el('h2', '', t('qsTitle')));
  panel.appendChild(el('p', 'tc-note', t('qsIntro')));
  var list = el('div', ''), done = el('div', ''), kept = el('div', '');
  panel.appendChild(list); panel.appendChild(el('h3', '', t('qsLearned'))); panel.appendChild(kept); panel.appendChild(el('h3', '', t('qsDone'))); panel.appendChild(done);
  function load() {
    return api('GET', 'list').then(function (d) {
      list.textContent = ''; done.textContent = ''; kept.textContent = '';
      if (!d.learned.length) kept.appendChild(el('div', 'empty', t('qsNoLearned')));
      d.learned.forEach(function (l) {
        var row = el('div', 'row green'); row.style.cursor = 'default';
        row.appendChild(el('b', '', l.q)); row.appendChild(el('small', '', l.a));
        var fg = el('button', '', t('qsForget')); fg.addEventListener('click', function () { act(fg, function () { return api('POST', 'forget', { id: l.id }).then(load); }); });
        row.appendChild(el('div', 'actions', '')); row.lastChild.appendChild(fg); kept.appendChild(row);
      });
      if (!d.questions.length) list.appendChild(el('div', 'empty', t('qsNone')));
      d.questions.forEach(function (q) {
        var r = el('div', 'row yellow'); r.style.cursor = 'default';
        r.appendChild(el('b', '', q.name || t('qsNoName')));
        r.appendChild(el('small', '', t('qsSince') + ' ' + when(q.since)));
        r.appendChild(el('pre', '', q.card));
        var row = el('div', 'tc-row'), ans = el('input', ''), send = el('button', 'primary', t('qsSend'));
        ans.placeholder = t('qsAnswer'); ans.maxLength = 1000; ans.setAttribute('aria-label', t('qsAnswer')); row.appendChild(ans); row.appendChild(send); r.appendChild(row);
        var lab = el('label', 'line'), cb = document.createElement('input'); cb.type = 'checkbox'; cb.style.minHeight = '0'; cb.style.marginRight = '8px';
        lab.appendChild(cb); lab.appendChild(document.createTextNode(t('qsRemember'))); r.appendChild(lab);
        var qin = el('input', ''); qin.value = q.questions[0] || ''; qin.maxLength = 300; qin.style.display = 'none'; qin.style.width = '100%'; qin.setAttribute('aria-label', t('qsQuestion')); qin.placeholder = t('qsQuestion');
        cb.addEventListener('change', function () { qin.style.display = cb.checked ? '' : 'none'; }); r.appendChild(qin);
        function go() { var text = ans.value.trim(); if (!text) return; act(send, function () { return api('POST', 'answer', { chat: q.chat, answer: text, remember: cb.checked ? qin.value : '' }).then(load); }); }
        send.addEventListener('click', go); ans.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
        list.appendChild(r);
      });
      if (!d.answered.length) done.appendChild(el('div', 'empty', t('qsNoDone')));
      d.answered.forEach(function (a) {
        done.appendChild(el('div', 'line', when(a.at) + ' · ' + (a.name || t('qsNoName')) + ' · ' + t('qsBy') + ' ' + a.by.replace(/^dashboard:/, '') + (a.remembered ? ' · ' + t('qsKept') : '')));
      });
    });
  }
  load().catch(ctx.fail);
} };
`;

export function questionsTab(company: Company): DashboardTab {
  return {
    id: 'questions',
    label: { pt: 'Perguntas', en: 'Questions' },
    level: 'simple',
    order: 40,
    text: questionText,
    routes: {
      list: () => ({ questions: openQuestions(company), answered: recentAnswers(company), learned: listLearned(company) }),
      forget: ({ body, operator }: TabRequest) => { forgetLearned(company, str(body, 'id'), operator); return { ok: true }; },
      answer: ({ body, operator }: TabRequest) => answerQuestion(company, str(body, 'chat'), str(body, 'answer'), operator, { remember: str(body, 'remember') }),
    },
    script: questionScript,
  };
}

// ---- Guardados (wazaa's save, bug and idea, and the tickets staff opened) ---------------------------------------------------------------------------

const savedText = {
  pt: {
    svTitle: 'Guardados', svIntro: 'Notas para ver mais tarde: algo a rever, um erro a corrigir ou uma ideia para quem desenvolve. Não se copia a conversa do cliente.',
    svKinds: { save: 'Guardar', bug: 'Erro', idea: 'Ideia' }, svPlaceholder: 'Escreva a nota…', svAdd: 'Guardar nota', svNone: 'Ainda sem notas.', svTickets: 'Pedidos abertos ao sinalizar uma resposta',
    svNoTickets: 'Nenhum.', svFixed: 'Marcar como corrigido', svClosed: 'corrigido', svOpen: 'aberto', svBy: 'por',
  },
  en: {
    svTitle: 'Saved', svIntro: 'Notes to look at later: something to review, a failure to fix or an idea for the developer. The customer\'s conversation is not copied.',
    svKinds: { save: 'Save', bug: 'Bug', idea: 'Idea' }, svPlaceholder: 'Write the note…', svAdd: 'Save note', svNone: 'No notes yet.', svTickets: 'Tickets opened by flagging a reply',
    svNoTickets: 'None.', svFixed: 'Mark as fixed', svClosed: 'fixed', svOpen: 'open', svBy: 'by',
  },
};

const savedScript = String.raw`
var el = ctx.el, t = ctx.t, api = ctx.api, act = ctx.act;
function when(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString(ctx.lang() === 'pt' ? 'pt-PT' : 'en-GB', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }); }
return { draw: function (box) {
  box.textContent = '';
  var panel = el('div', 'panel'); box.appendChild(panel);
  panel.appendChild(el('h2', '', t('svTitle')));
  panel.appendChild(el('p', 'tc-note', t('svIntro')));
  var row = el('div', 'tc-row'), kind = el('select', ''), input = el('input', ''), add = el('button', 'primary', t('svAdd'));
  ['save', 'bug', 'idea'].forEach(function (k) { var o = el('option', '', t('svKinds')[k]); o.value = k; kind.appendChild(o); });
  input.placeholder = t('svPlaceholder'); input.maxLength = 500; input.setAttribute('aria-label', t('svPlaceholder'));
  row.appendChild(kind); row.appendChild(input); row.appendChild(add); panel.appendChild(row);
  var notes = el('div', ''), tickets = el('div', '');
  panel.appendChild(notes); panel.appendChild(el('h3', '', t('svTickets'))); panel.appendChild(tickets);
  function load() {
    return api('GET', 'list').then(function (d) {
      notes.textContent = ''; tickets.textContent = '';
      if (!d.notes.length) notes.appendChild(el('div', 'empty', t('svNone')));
      d.notes.forEach(function (n) {
        var r = el('div', 'row ' + (n.kind === 'bug' ? 'red' : n.kind === 'idea' ? 'green' : 'none')); r.style.cursor = 'default';
        var b = el('b', '', t('svKinds')[n.kind] + ': ' + n.note); r.appendChild(b);
        r.appendChild(el('small', '', when(n.at) + ' · ' + t('svBy') + ' ' + n.by.replace(/^dashboard:/, '') + (n.name ? ' · ' + n.name : '')));
        notes.appendChild(r);
      });
      if (!d.tickets.length) tickets.appendChild(el('div', 'empty', t('svNoTickets')));
      d.tickets.forEach(function (k) {
        var r = el('div', 'row ' + (k.ticket.status === 'open' ? 'yellow' : 'none')); r.style.cursor = 'default';
        r.appendChild(el('b', '', ctx.handler(k.flag.handlerId) + (k.flag.note ? ': ' + k.flag.note : '')));
        r.appendChild(el('small', '', (k.ticket.status === 'open' ? t('svOpen') : t('svClosed')) + ' · ' + when(k.flag.flaggedAt) + ' · ' + t('svBy') + ' ' + k.flag.flaggedBy.replace(/^dashboard:/, '')));
        if (k.ticket.status === 'open') {
          var acts = el('div', 'actions'), fx = el('button', '', t('svFixed'));
          fx.addEventListener('click', function () { act(fx, function () { return api('POST', 'fix', { id: k.id }).then(load); }); });
          acts.appendChild(fx); r.appendChild(acts);
        }
        tickets.appendChild(r);
      });
    });
  }
  function send() { var text = input.value.trim(); if (!text) return; act(add, function () { return api('POST', 'note', { kind: kind.value, note: text }).then(function () { input.value = ''; return load(); }); }); }
  add.addEventListener('click', send); input.addEventListener('keydown', function (e) { if (e.key === 'Enter') send(); });
  load().catch(ctx.fail);
} };
`;

export function savedTab(company: Company): DashboardTab {
  return {
    id: 'saved',
    label: { pt: 'Guardados', en: 'Saved' },
    level: 'simple',
    order: 50,
    text: savedText,
    routes: {
      list: () => ({ notes: listNotes(company), tickets: listTickets(company) }),
      note: ({ body, operator }: TabRequest) => saveNote(company, str(body, 'kind') as NoteKind, str(body, 'note'), operator),
      fix: ({ body, operator }: TabRequest) => { fixTicket(company, str(body, 'id'), operator); return { ok: true }; },
    },
    script: savedScript,
  };
}

// ---- Conversas (wazaa's chat list: every chat, who has it, take over and hand back) -------------------------------------------------------------------

const chatsText = {
  pt: {
    cvTitle: 'Conversas', cvNone: 'Ainda sem conversas.', cvPick: 'Escolha uma conversa.', cvNoName: 'sem nome', cvState: 'Quem tem a conversa', cvTake: 'Assumir', cvBack: 'Devolver ao bot', cvDone: 'Feito',
    cvCard: 'Resumo para o escritório', cvPending: 'Respostas à espera', cvHistory: 'Conversa', cvNoHistory: 'Sem histórico neste momento.', cvReplyOff: 'A caixa de resposta está desligada: em modo sombra nada é enviado ao cliente. Responda no WhatsApp como sempre.',
    cvCustomer: 'cliente', cvBot: 'bot', cvStaff: 'equipa', cvAll: 'Todas', cvOpen: 'Precisam de uma pessoa', cvBand: 'confiança',
  },
  en: {
    cvTitle: 'Chats', cvNone: 'No chats yet.', cvPick: 'Choose a chat.', cvNoName: 'no name', cvState: 'Who has the chat', cvTake: 'Take over', cvBack: 'Hand back to the bot', cvDone: 'Done',
    cvCard: 'Summary for the office', cvPending: 'Replies waiting', cvHistory: 'Conversation', cvNoHistory: 'No history available right now.', cvReplyOff: 'The reply box is off: in shadow mode nothing is sent to the customer. Answer in WhatsApp as usual.',
    cvCustomer: 'customer', cvBot: 'bot', cvStaff: 'staff', cvAll: 'All', cvOpen: 'Need a person', cvBand: 'confidence',
  },
};

const chatsScript = String.raw`
var el = ctx.el, t = ctx.t, api = ctx.api, act = ctx.act;
var sel = null, onlyOpen = false;
return { draw: function (box) {
  box.className = 'two'; box.textContent = '';
  var list = el('div', ''), panel = el('div', 'panel'); box.appendChild(list); box.appendChild(panel);
  var states = t('states'), bands = t('bands');
  function drawList(rows) {
    list.textContent = '';
    var f = el('div', 'actions');
    [[false, 'cvAll'], [true, 'cvOpen']].forEach(function (x) { var b = el('button', onlyOpen === x[0] ? 'primary' : '', t(x[1])); b.addEventListener('click', function () { onlyOpen = x[0]; loadList(); }); f.appendChild(b); });
    list.appendChild(f);
    var shown = rows.filter(function (r) { return !onlyOpen || r.colour !== 'none'; });
    if (!shown.length) list.appendChild(el('div', 'empty', t('cvNone')));
    shown.forEach(function (r) {
      var d = el('div', 'row ' + r.colour + (sel === r.chat ? ' sel' : ''));
      d.appendChild(el('b', '', r.name || t('cvNoName')));
      d.appendChild(el('small', '', (states[r.state] || r.state) + (r.summary ? ' · ' + r.summary : '')));
      d.addEventListener('click', function () { sel = r.chat; drawList(rows); drawChat(); });
      list.appendChild(d);
    });
  }
  function drawChat() {
    panel.textContent = '';
    if (!sel) { panel.appendChild(el('div', 'empty', t('cvPick'))); return; }
    api('POST', 'view', { chat: sel }).then(function (v) {
      panel.textContent = '';
      panel.appendChild(el('h2', '', v.name || t('cvNoName')));
      panel.appendChild(el('div', 'tc-note', t('cvState') + ': ' + (states[v.state] || v.state)));
      var acts = el('div', 'actions'), take = el('button', 'primary', t('cvTake')), back = el('button', '', t('cvBack')), dn = el('button', '', t('cvDone'));
      take.disabled = v.state !== 'bot'; back.disabled = v.state === 'bot';
      function doIt(b, name) { b.addEventListener('click', function () { act(b, function () { return api('POST', name, { chat: sel }).then(loadList).then(drawChat); }); }); }
      doIt(take, 'take'); doIt(back, 'hand'); doIt(dn, 'done');
      acts.appendChild(take); acts.appendChild(back); acts.appendChild(dn); panel.appendChild(acts);
      panel.appendChild(el('div', 'tc-note', t('cvReplyOff')));
      if (v.card) { panel.appendChild(el('h3', '', t('cvCard'))); panel.appendChild(el('pre', '', v.card)); }
      if (v.pending.length) {
        panel.appendChild(el('h3', '', t('cvPending')));
        v.pending.forEach(function (p) { panel.appendChild(el('pre', '', (p.draft || ctx.handler(p.handler)) + (p.band ? '\n[' + t('cvBand') + ': ' + (bands[p.band] || p.band) + ']' : ''))); });
      }
      panel.appendChild(el('h3', '', t('cvHistory')));
      if (!v.history.length) panel.appendChild(el('div', 'empty', t('cvNoHistory')));
      v.history.forEach(function (l) { var d = el('div', 'line'); d.appendChild(el('b', '', t(l.from === 'customer' ? 'cvCustomer' : l.from === 'bot' ? 'cvBot' : 'cvStaff'))); d.appendChild(document.createTextNode(l.text)); panel.appendChild(d); });
    }).catch(ctx.fail);
  }
  function loadList() { return api('GET', 'list').then(function (d) { drawList(d.rows); }); }
  panel.appendChild(el('div', 'empty', t('cvPick')));
  loadList().catch(ctx.fail);
} };
`;

export function conversationsTab(company: Company): DashboardTab {
  const known = (chat: string): string => {
    if (!company.store.listChats().some((c) => c.chat === chat)) throw new Error('that chat is not known');
    return chat;
  };
  return {
    id: 'chats',
    label: { pt: 'Conversas', en: 'Chats' },
    level: 'simple',
    order: 20,
    text: chatsText,
    routes: {
      list: () => ({ rows: company.board({ includeComplete: true }).map((r) => ({ chat: r.chat, name: r.name, colour: r.colour, state: r.state, summary: r.summary, since: r.since })) }),
      view: ({ body }: TabRequest) => company.chatView(known(str(body, 'chat'))),
      take: ({ body, operator }: TabRequest) => { company.takeOver(known(str(body, 'chat')), operator); return { ok: true }; },
      hand: ({ body, operator }: TabRequest) => { company.handBack(known(str(body, 'chat')), operator); return { ok: true }; },
      done: ({ body, operator }: TabRequest) => { company.gate.personReplied(known(str(body, 'chat')), operator); return { ok: true }; },
    },
    script: chatsScript,
  };
}

// ---- Reservas (wazaa's bookings: a request the bot made, for the office to confirm or decline) -------------------------------------------------

const bookingText = {
  pt: {
    bkTitle: 'Reservas', bkIntro: 'Pedidos de reserva feitos pelo bot depois de o cliente dizer que sim ao preço. Nada está reservado até uma pessoa confirmar. Em modo sombra nada é enviado ao cliente: avise-o como sempre.',
    bkNone: 'Ainda sem pedidos.', bkConfirm: 'Confirmar', bkDecline: 'Recusar', bkNote: 'Nota (opcional)', bkPeople: 'pessoas', bkTotal: 'total', bkNoName: 'cliente sem nome',
    bkDone: { proposed: 'à espera de confirmação', approved: 'confirmada', declined: 'recusada' },
  },
  en: {
    bkTitle: 'Bookings', bkIntro: 'Booking requests the bot made after the customer said yes to the price. Nothing is booked until a person confirms it. In shadow mode nothing is sent to the customer: tell them as usual.',
    bkNone: 'No requests yet.', bkConfirm: 'Confirm', bkDecline: 'Decline', bkNote: 'Note (optional)', bkPeople: 'people', bkTotal: 'total', bkNoName: 'customer with no name',
    bkDone: { proposed: 'waiting for confirmation', approved: 'confirmed', declined: 'declined' },
  },
};

const bookingScript = String.raw`
var el = ctx.el, t = ctx.t, api = ctx.api, act = ctx.act;
return { draw: function (box) {
  box.textContent = '';
  var panel = el('div', 'panel'); box.appendChild(panel);
  panel.appendChild(el('h2', '', t('bkTitle')));
  panel.appendChild(el('p', 'tc-note', t('bkIntro')));
  var list = el('div', ''); panel.appendChild(list);
  function load() {
    return api('GET', 'list').then(function (d) {
      list.textContent = '';
      if (!d.bookings.length) list.appendChild(el('div', 'empty', t('bkNone')));
      d.bookings.forEach(function (b) {
        var open = b.status === 'proposed';
        var r = el('div', 'row ' + (open ? 'yellow' : b.status === 'approved' ? 'green' : 'none')); r.style.cursor = 'default';
        r.appendChild(el('b', '', b.ref + ' · ' + b.service + ' · ' + b.partySize + ' ' + t('bkPeople') + ' · ' + b.date));
        r.appendChild(el('small', '', (b.name || t('bkNoName')) + ' · ' + t('bkTotal') + ' ' + b.total + ' · ' + (t('bkDone')[b.status] || b.status)));
        if (open) {
          var note = el('input', ''); note.placeholder = t('bkNote'); note.maxLength = 200; note.setAttribute('aria-label', t('bkNote')); note.style.display = 'block'; note.style.margin = '8px 0';
          var acts = el('div', 'actions'), yes = el('button', 'primary', t('bkConfirm')), no = el('button', '', t('bkDecline'));
          function decide(btn, decision) { act(btn, function () { return api('POST', 'decide', { id: b.id, decision: decision, note: note.value }).then(load); }); }
          yes.addEventListener('click', function () { decide(yes, 'approve'); }); no.addEventListener('click', function () { decide(no, 'decline'); });
          acts.appendChild(yes); acts.appendChild(no); r.appendChild(note); r.appendChild(acts);
        }
        list.appendChild(r);
      });
    });
  }
  load().catch(ctx.fail);
} };
`;

export function bookingsTab(company: Company): DashboardTab {
  return {
    id: 'bookings',
    label: { pt: 'Reservas', en: 'Bookings' },
    level: 'simple',
    order: 15,
    text: bookingText,
    routes: {
      list: () => ({ bookings: listBookings(company) }),
      decide: ({ body, operator }: TabRequest) => {
        const decision = str(body, 'decision');
        if (decision !== 'approve' && decision !== 'decline') throw new Error('confirm or decline');
        return decideBooking(company, str(body, 'id'), decision, operator, str(body, 'note') || undefined);
      },
    },
    script: bookingScript,
  };
}
// ---- Manutenção (wazaa's maintenance records from the team chats, and each vehicle's track record) -------------------------------------------------

const maintenanceText = {
  pt: {
    mnTitle: 'Manutenção', mnIntro: 'Pedidos criados quando uma viatura e um problema aparecem juntos numa conversa da equipa. O bot só lê essas conversas e nunca responde nelas: guarda um excerto sem números nem emails.',
    mnNone: 'Nenhum pedido aberto.', mnSchedule: 'Agendar', mnDone: 'Feito', mnDismiss: 'Dispensar', mnDate: 'Data (AAAA-MM-DD)', mnMentions: 'menções', mnAssets: 'Viaturas', mnNoAssets: 'Ainda sem viaturas na lista da empresa.',
    mnOpen: 'abertos', mnTotal: 'no total', mnClosed: 'Fechados há pouco', mnScheduled: 'agendado para',
    mnPriority: { high: 'urgente', medium: 'a seguir', low: 'quando der' }, mnStatus: { open: 'aberto', scheduled: 'agendado', done: 'feito', dismissed: 'dispensado' },
  },
  en: {
    mnTitle: 'Maintenance', mnIntro: 'Records made when a vehicle and a problem appear together in a team chat. The bot only reads those chats and never answers in them: it keeps a snippet without numbers or emails.',
    mnNone: 'No record is open.', mnSchedule: 'Schedule', mnDone: 'Done', mnDismiss: 'Dismiss', mnDate: 'Date (YYYY-MM-DD)', mnMentions: 'mentions', mnAssets: 'Vehicles', mnNoAssets: 'No vehicles in the company\'s list yet.',
    mnOpen: 'open', mnTotal: 'in all', mnClosed: 'Recently closed', mnScheduled: 'scheduled for',
    mnPriority: { high: 'urgent', medium: 'soon', low: 'when possible' }, mnStatus: { open: 'open', scheduled: 'scheduled', done: 'done', dismissed: 'dismissed' },
  },
};

const maintenanceScript = String.raw`
var el = ctx.el, t = ctx.t, api = ctx.api, act = ctx.act;
function when(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString(ctx.lang() === 'pt' ? 'pt-PT' : 'en-GB', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }); }
return { draw: function (box) {
  box.textContent = '';
  var panel = el('div', 'panel'); box.appendChild(panel);
  panel.appendChild(el('h2', '', t('mnTitle')));
  panel.appendChild(el('p', 'tc-note', t('mnIntro')));
  var list = el('div', ''), assets = el('div', ''), closed = el('div', '');
  panel.appendChild(list); panel.appendChild(el('h3', '', t('mnAssets'))); panel.appendChild(assets); panel.appendChild(el('h3', '', t('mnClosed'))); panel.appendChild(closed);
  function load() {
    return api('GET', 'list').then(function (d) {
      list.textContent = ''; assets.textContent = ''; closed.textContent = '';
      var open = d.records.filter(function (r) { return r.status === 'open' || r.status === 'scheduled'; });
      if (!open.length) list.appendChild(el('div', 'empty', t('mnNone')));
      open.forEach(function (r) {
        var colour = r.priority === 'high' ? 'red' : r.priority === 'medium' ? 'yellow' : 'green';
        var row = el('div', 'row ' + colour); row.style.cursor = 'default';
        row.appendChild(el('b', '', r.ref + ' · ' + (r.label || r.asset) + ' · ' + r.issue));
        row.appendChild(el('small', '', t('mnPriority')[r.priority] + ' · ' + t('mnStatus')[r.status] + (r.scheduledFor ? ' ' + t('mnScheduled') + ' ' + r.scheduledFor : '') + ' · ' + r.mentions + ' ' + t('mnMentions') + ' · ' + when(r.lastAt)));
        if (r.note) row.appendChild(el('pre', '', r.note));
        var acts = el('div', 'actions'), date = el('input', ''), sch = el('button', '', t('mnSchedule')), dn = el('button', 'primary', t('mnDone')), ds = el('button', '', t('mnDismiss'));
        date.placeholder = t('mnDate'); date.maxLength = 10; date.setAttribute('aria-label', t('mnDate')); date.style.width = '170px';
        sch.addEventListener('click', function () { act(sch, function () { return api('POST', 'schedule', { id: r.id, date: date.value.trim() }).then(load); }); });
        dn.addEventListener('click', function () { act(dn, function () { return api('POST', 'done', { id: r.id }).then(load); }); });
        ds.addEventListener('click', function () { act(ds, function () { return api('POST', 'dismiss', { id: r.id }).then(load); }); });
        if (r.status === 'open') { acts.appendChild(date); acts.appendChild(sch); }
        acts.appendChild(dn); if (r.status === 'open') acts.appendChild(ds);
        row.appendChild(acts); list.appendChild(row);
      });
      if (!d.assets.length) assets.appendChild(el('div', 'empty', t('mnNoAssets')));
      d.assets.forEach(function (a) {
        var worst = a.worst === 'high' ? 'red' : a.worst === 'medium' ? 'yellow' : a.worst === 'low' ? 'green' : 'none';
        var r = el('div', 'row ' + worst); r.style.cursor = 'default';
        r.appendChild(el('b', '', a.label || a.id));
        r.appendChild(el('small', '', a.open + ' ' + t('mnOpen') + ' · ' + a.total + ' ' + t('mnTotal') + (a.lastAt ? ' · ' + when(a.lastAt) : '')));
        assets.appendChild(r);
      });
      d.records.filter(function (r) { return r.status === 'done' || r.status === 'dismissed'; }).slice(0, 15).forEach(function (r) {
        closed.appendChild(el('div', 'line', r.ref + ' · ' + (r.label || r.asset) + ' · ' + r.issue + ' · ' + t('mnStatus')[r.status]));
      });
    });
  }
  load().catch(ctx.fail);
} };
`;

export function maintenanceTab(company: Company): DashboardTab {
  return {
    id: 'maintenance',
    label: { pt: 'Manutenção', en: 'Maintenance' },
    level: 'simple',
    order: 45,
    text: maintenanceText,
    routes: {
      list: () => ({ records: listMaintenance(company), assets: assetRecords(company) }),
      schedule: ({ body, operator }: TabRequest) => { scheduleMaintenance(company, str(body, 'id'), str(body, 'date'), operator); return { ok: true }; },
      done: ({ body, operator }: TabRequest) => { doneMaintenance(company, str(body, 'id'), operator); return { ok: true }; },
      dismiss: ({ body, operator }: TabRequest) => { dismissMaintenance(company, str(body, 'id'), operator, str(body, 'note') || undefined); return { ok: true }; },
    },
    script: maintenanceScript,
  };
}

// ---- Parceiros (partner chats: hotel desks and agencies that write for guests of their own) -----------------------------------------------------------

const partnerText = {
  pt: {
    paTitle: 'Parceiros', paIntro: 'Uma conversa de parceiro escreve vezes sem conta, sempre para um hóspede diferente. Nela o bot nunca diz preços: só conta as pessoas e passa o pedido; o escritório confirma tudo.',
    paNone: 'Ainda sem parceiros.', paAdd: 'Marcar como parceiro', paChat: 'Conversa', paName: 'Nome (ex.: nome do parceiro - receção)', paPickup: 'Recolha habitual (opcional)', paRemove: 'Retirar',
    paAccount: 'Conta do mês', paMonth: 'Mês (AAAA-MM)', paShow: 'Ver', paPeople: 'pessoas', paBookings: 'reservas', paNoRows: 'Nada confirmado nesse mês.', paNoChats: 'Ainda não há conversas para escolher.',
  },
  en: {
    paTitle: 'Partners', paIntro: 'A partner chat writes again and again, each time for a different guest. In it the bot never states a price: it counts the people and passes the request on; the office confirms everything.',
    paNone: 'No partners yet.', paAdd: 'Mark as partner', paChat: 'Chat', paName: 'Name (e.g. the partner name - reception)', paPickup: 'Usual pick-up (optional)', paRemove: 'Remove',
    paAccount: 'Month\'s account', paMonth: 'Month (YYYY-MM)', paShow: 'Show', paPeople: 'people', paBookings: 'bookings', paNoRows: 'Nothing confirmed that month.', paNoChats: 'No chats to choose from yet.',
  },
};

const partnerScript = String.raw`
var el = ctx.el, t = ctx.t, api = ctx.api, act = ctx.act;
return { draw: function (box) {
  box.textContent = '';
  var panel = el('div', 'panel'); box.appendChild(panel);
  panel.appendChild(el('h2', '', t('paTitle')));
  panel.appendChild(el('p', 'tc-note', t('paIntro')));
  var form = el('div', 'tc-row'), chatSel = el('select', ''), name = el('input', ''), pickup = el('input', ''), add = el('button', 'primary', t('paAdd'));
  chatSel.setAttribute('aria-label', t('paChat')); name.placeholder = t('paName'); name.maxLength = 80; name.setAttribute('aria-label', t('paName')); pickup.placeholder = t('paPickup'); pickup.maxLength = 120; pickup.setAttribute('aria-label', t('paPickup'));
  form.appendChild(chatSel); form.appendChild(name); form.appendChild(pickup); form.appendChild(add); panel.appendChild(form);
  var list = el('div', ''); panel.appendChild(list);
  function load() {
    return api('GET', 'list').then(function (d) {
      chatSel.textContent = '';
      if (!d.chats.length) chatSel.appendChild(el('option', '', t('paNoChats')));
      d.chats.forEach(function (c) { var o = el('option', '', c.name || c.chat); o.value = c.chat; chatSel.appendChild(o); });
      list.textContent = '';
      if (!d.partners.length) list.appendChild(el('div', 'empty', t('paNone')));
      d.partners.forEach(function (p) {
        var r = el('div', 'row green'); r.style.cursor = 'default';
        r.appendChild(el('b', '', p.name)); if (p.pickup) r.appendChild(el('small', '', p.pickup));
        var acts = el('div', 'actions'), month = el('input', ''), show = el('button', '', t('paShow')), rm = el('button', '', t('paRemove')), out = el('div', '');
        month.placeholder = t('paMonth'); month.value = new Date().toISOString().slice(0, 7); month.maxLength = 7; month.style.width = '130px'; month.setAttribute('aria-label', t('paMonth'));
        show.addEventListener('click', function () {
          act(show, function () {
            return api('POST', 'account', { chat: p.chat, month: month.value.trim() }).then(function (a) {
              out.textContent = '';
              out.appendChild(el('h3', '', t('paAccount') + ' ' + a.month + ': ' + a.bookings + ' ' + t('paBookings') + ' · ' + a.people + ' ' + t('paPeople')));
              if (!a.rows.length) out.appendChild(el('div', 'empty', t('paNoRows')));
              a.rows.forEach(function (x) { out.appendChild(el('div', 'line', x.ref + ' · ' + x.service + ' · ' + x.date + ' · ' + x.people + ' ' + t('paPeople'))); });
            });
          });
        });
        rm.addEventListener('click', function () { act(rm, function () { return api('POST', 'remove', { chat: p.chat }).then(load); }); });
        acts.appendChild(month); acts.appendChild(show); acts.appendChild(rm); r.appendChild(acts); r.appendChild(out); list.appendChild(r);
      });
    });
  }
  add.addEventListener('click', function () { act(add, function () { return api('POST', 'add', { chat: chatSel.value, name: name.value, pickup: pickup.value }).then(function () { name.value = ''; pickup.value = ''; return load(); }); }); });
  load().catch(ctx.fail);
} };
`;

export function partnersTab(company: Company): DashboardTab {
  return {
    id: 'partners',
    label: { pt: 'Parceiros', en: 'Partners' },
    level: 'simple',
    order: 47,
    text: partnerText,
    routes: {
      list: () => ({
        partners: listPartners(company),
        chats: company.store.listChats().map((c) => {
          const code = company.store.getContact(c.chat);
          const full = code ? company.vault.get(code)?.value ?? null : null;
          return { chat: c.chat, name: full ? (full.trim().split(/\s+/)[0] ?? null) : null };
        }),
      }),
      add: ({ body, operator }: TabRequest) => addPartner(company, str(body, 'chat'), str(body, 'name'), str(body, 'pickup') || null, operator),
      remove: ({ body, operator }: TabRequest) => { removePartner(company, str(body, 'chat'), operator); return { ok: true }; },
      account: ({ body }: TabRequest) => partnerAccount(company, str(body, 'chat'), str(body, 'month')),
    },
    script: partnerScript,
  };
}

/** WZP-40, DSH-2: the tabs the chat desk gives a company that has the sales module on. */
export function deskTabs(company: Company, sheet?: SheetStore): DashboardTab[] {
  const sales = company.registry.all().some((h) => h.id.startsWith('sales.'));
  const bookings = company.registry.all().some((h) => h.id.startsWith('bookings.'));
  const maintenance = company.registry.all().some((h) => h.id.startsWith('maintenance.'));
  return [...(sales ? [businessTab(company, sheet)] : []), ...(sales ? [...(bookings ? [bookingsTab(company), partnersTab(company)] : []), conversationsTab(company), questionsTab(company), savedTab(company), lessonsTab(company)] : []), ...(maintenance ? [maintenanceTab(company)] : [])];
}
