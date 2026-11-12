/**
 * ADM-86: the dashboard page. One file, no external script, stylesheet or font (nothing leaves the machine). Every piece of text that
 * comes from a customer or the store is put on the page with textContent, never as markup. The two placeholders are filled in by the
 * server: the per-start token the page sends with every change, and the first language.
 */
export const PAGE = String.raw`<!doctype html>
<html lang="pt">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__NAME__</title>
<style>
  @font-face { font-family:"Figtree"; font-weight:300 900; font-display:swap; src:url(/assets/fonts/figtree-latin-wght-normal.woff2) format("woff2"); unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; }
  @font-face { font-family:"Figtree"; font-weight:300 900; font-display:swap; src:url(/assets/fonts/figtree-latin-ext-wght-normal.woff2) format("woff2"); unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF; }
  @font-face { font-family:"Unbounded"; font-weight:200 900; font-display:swap; src:url(/assets/fonts/unbounded-latin-wght-normal.woff2) format("woff2"); unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; }
  @font-face { font-family:"Unbounded"; font-weight:200 900; font-display:swap; src:url(/assets/fonts/unbounded-latin-ext-wght-normal.woff2) format("woff2"); unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF; }
  @font-face { font-family:"JetBrains Mono"; font-weight:400; font-display:swap; src:url(/assets/fonts/jetbrains-mono-latin-400-normal.woff2) format("woff2"); }
  /* DSH-6 Levada: basalt and laurel forest; the contour lines of the levada channels are the one pattern, a band under the header and nowhere else. */
  :root { --head:#1c211b; --on-head:#eef2e8; --head-muted:#a9b6a2; --chip:#2c342a; --tab-on:#a9c48a; --tab-on-text:#14190f;
    --bg:#e9ede3; --fg:#1b2219; --card:#f7f9f3; --bubble:#e3e9da; --muted:#5e6a58; --line:#b9c4b0; --accent:#3f6a3a; --accent-text:#f3f8ee;
    --red:#c4472f; --yellow:#d39b3a; --green:#4f8a49; --none:#8b9784;
    --display:"Unbounded","Figtree",system-ui,sans-serif; --body:"Figtree",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; --mono:"JetBrains Mono",ui-monospace,monospace; }
  @media (prefers-color-scheme: dark) { :root { --bg:#121611; --fg:#e6ebe0; --card:#1a2018; --bubble:#222b20; --muted:#9aa893; --line:#33402f; --accent:#a9c48a; --accent-text:#14190f;
    --red:#e0735c; --yellow:#d9a64a; --green:#7fb87a; --none:#77806f; } }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.5 var(--body); }
  :focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  header { background:var(--head); color:var(--on-head); display:flex; flex-wrap:wrap; gap:8px 14px; align-items:center; padding:10px 16px; position:sticky; top:0; z-index:3; }
  .brand { font:600 1.05rem/1 var(--display); letter-spacing:-.02em; color:var(--on-head); text-decoration:none; margin-right:6px; }
  .chip { display:inline-flex; gap:6px; align-items:center; padding:4px 12px; border-radius:99px; background:var(--chip); color:var(--on-head); font-size:13px; min-height:28px; }
  .chip.demo { background:var(--yellow); color:#1b2219; font-weight:700; }
  .dot { width:10px; height:10px; border-radius:50%; display:inline-block; background:var(--none); flex:none; }
  .red { --c:var(--red); } .yellow { --c:var(--yellow); } .green { --c:var(--green); } .none { --c:var(--none); }
  .dot.red { background:var(--red); } .dot.yellow { background:var(--yellow); } .dot.green { background:var(--green); }
  button { font:inherit; min-height:44px; padding:6px 18px; border:1px solid var(--line); border-radius:999px; background:var(--card); color:var(--fg); cursor:pointer; }
  button.primary { background:var(--accent); color:var(--accent-text); border-color:var(--accent); }
  button:disabled { opacity:.5; cursor:default; }
  header button { min-height:36px; padding:4px 14px; background:var(--chip); color:var(--on-head); border-color:transparent; }
  nav { display:flex; flex-wrap:wrap; gap:4px; margin-left:auto; }
  nav a { padding:9px 16px; border-radius:999px; color:var(--head-muted); text-decoration:none; font-size:.92rem; }
  nav a.on { background:var(--tab-on); color:var(--tab-on-text); font-weight:600; }
  .contour { display:block; width:100%; height:28px; background:var(--head); color:var(--tab-on); }
  .contour svg { display:block; width:100%; height:100%; }
  #err { display:none; background:var(--red); color:#fff; padding:10px 16px; font-weight:600; }
  #alerts .alert { background:var(--red); color:#fff; padding:10px 16px; display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
  #alerts .alert button { margin-left:auto; color:var(--fg); }
  #link .panel { max-width:1168px; margin:16px auto 0; display:flex; gap:20px; align-items:center; flex-wrap:wrap; }
  #link svg { width:280px; height:280px; background:#fff; border-radius:12px; flex:none; }
  #link h2 { margin:0 0 8px; } #link p { margin:4px 0; max-width:60ch; } #link .muted { color:var(--muted); }
  main { display:block; padding:16px; max-width:1200px; margin:0 auto; }
  main.two { display:grid; grid-template-columns:minmax(260px,380px) 1fr; gap:16px; }
  @media (max-width: 760px) { main.two { grid-template-columns:1fr; } }
  .row { background:var(--card); border:1px solid var(--line); border-left:6px solid var(--c, var(--none)); border-radius:14px; padding:10px 12px; margin-bottom:8px; cursor:pointer; }
  .row.sel { outline:2px solid var(--accent); }
  .row b { display:block; } .row small { color:var(--muted); }
  .pill { display:inline-block; padding:1px 10px; border-radius:99px; border:1px solid var(--c, var(--none)); color:var(--fg); font-size:12px; margin-right:6px; }
  .panel { background:var(--card); border:1px solid var(--line); border-radius:18px; padding:14px 18px; }
  .panel h2 { margin:0 0 4px; font:500 1.15rem/1.3 var(--display); letter-spacing:-.02em; }
  .actions { display:flex; gap:8px; flex-wrap:wrap; margin:10px 0; }
  pre { white-space:pre-wrap; word-wrap:break-word; background:var(--bubble); border:1px solid var(--line); border-radius:12px; padding:10px; margin:6px 0 12px; font:13px/1.45 var(--mono); }
  .line { padding:3px 0; } .line b { color:var(--muted); font-weight:600; margin-right:6px; }
  .empty { color:var(--muted); padding:24px 4px; }
  h3 { font:500 .74rem/1.2 var(--mono); text-transform:uppercase; letter-spacing:.14em; color:var(--muted); margin:16px 0 6px; }
  select, input { font:inherit; min-height:44px; padding:6px 12px; border:1px solid var(--line); border-radius:12px; background:var(--card); color:var(--fg); }
  .tc-msg { margin:8px 0; } .tc-in { text-align:right; } .tc-in span { display:inline-block; background:var(--bubble); border:1px solid var(--line); border-radius:16px; padding:6px 12px; max-width:80%; text-align:left; white-space:pre-wrap; }
  .tc-bubble { background:var(--card); border:1px solid var(--line); border-left:6px solid var(--green); border-radius:16px; padding:8px 12px; max-width:85%; white-space:pre-wrap; }
  .tc-note { color:var(--muted); font-size:13px; white-space:pre-wrap; } .tc-prob { color:var(--red); font-size:13px; white-space:pre-wrap; font-weight:600; }
  .tc-row { display:flex; gap:8px; margin:8px 0; } .tc-row input { flex:1; }
  .tc-msg details { margin:4px 0 0 8px; } .tc-msg summary { cursor:pointer; color:var(--muted); font-size:13px; }
</style>
</head>
<body>
<header>
  <a class="brand" href="#/">__NAME__</a>
  <span class="chip"><span class="dot red"></span><b id="n-red">0</b> <span id="w-red"></span></span>
  <span class="chip"><span class="dot yellow"></span><b id="n-yellow">0</b> <span id="w-yellow"></span></span>
  <span class="chip"><span class="dot green"></span><b id="n-green">0</b> <span id="w-green"></span></span>
  <span class="chip demo" id="demo" style="display:none"></span>
  <button id="notify"></button>
  <button id="lang"></button>
  <button id="level" aria-pressed="false"></button>
  <nav id="nav"></nav>
</header>
<div class="contour" aria-hidden="true"><svg viewBox="0 0 1200 28" preserveAspectRatio="none" focusable="false"><g opacity=".55"><path d="M-480 6 q60 -3 120 0 q60 3 120 0 q60 -3 120 0 q60 3 120 0 q60 -3 120 0 q60 3 120 0 q60 -3 120 0 q60 3 120 0 q60 -3 120 0 q60 3 120 0 q60 -3 120 0 q60 3 120 0 q60 -3 120 0 q60 3 120 0 q60 -3 120 0 q60 3 120 0 q60 -3 120 0 q60 3 120 0" fill="none" stroke="currentColor" stroke-width="1"/><path d="M-480 14 q60 -7 120 0 q60 7 120 0 q60 -7 120 0 q60 7 120 0 q60 -7 120 0 q60 7 120 0 q60 -7 120 0 q60 7 120 0 q60 -7 120 0 q60 7 120 0 q60 -7 120 0 q60 7 120 0 q60 -7 120 0 q60 7 120 0 q60 -7 120 0 q60 7 120 0 q60 -7 120 0 q60 7 120 0" fill="none" stroke="currentColor" stroke-width="1"/><path d="M-480 22 q60 -11 120 0 q60 11 120 0 q60 -11 120 0 q60 11 120 0 q60 -11 120 0 q60 11 120 0 q60 -11 120 0 q60 11 120 0 q60 -11 120 0 q60 11 120 0 q60 -11 120 0 q60 11 120 0 q60 -11 120 0 q60 11 120 0 q60 -11 120 0 q60 11 120 0 q60 -11 120 0 q60 11 120 0" fill="none" stroke="currentColor" stroke-width="1"/></g></svg></div>
<div id="err" role="alert"></div>
<div id="alerts"></div>
<div id="link"></div>
<main id="main"></main>
<script>
(function () {
  'use strict';
  var TOKEN = '__TOKEN__';
  var LANG = '__LANG__';
  var NAME = '__NAME__';
  /* WZP-40: the tabs the company's modules and integrations contribute; the server fills this in and the shell knows none of them. */
  var TAB_DEFS = /*__TABS__*/[];
  var T = {
    pt: { board: 'Conversas', sheet: 'Manhã', notifyOn: 'Ativar notificações', notifyOk: 'Notificações ativas', notifyDenied: 'Notificações bloqueadas no navegador',
      none: 'Nada precisa de uma pessoa agora.', pick: 'Escolha uma conversa.', takeOver: 'Assumir', leaveToBot: 'Deixar o bot', done: 'Feito',
      handBack: 'Devolver ao bot', card: 'Resumo para o escritório', pending: 'Respostas à espera', history: 'Conversa', noHistory: 'Sem histórico neste momento.',
      seen: 'Visto', since: 'desde', state: 'estado', band: 'confiança', red: 'precisa de atenção agora', yellow: 'precisa de seguimento',
      green: 'precisa de resposta ou em curso', none2: 'completo', customer: 'cliente', bot: 'bot', staff: 'equipa', whoAmI: 'O seu nome (fica no registo):', other: 'EN',
      audit: 'Auditoria', approve: 'Aprovar', decline: 'Recusar', reason: 'motivo', note: 'nota (opcional)', send: 'Guardar', whichFact: 'Que facto estava errado?',
      customerSaid: 'O cliente escreveu', botDrafted: 'O bot redigiu', humanDid: 'A pessoa respondeu', noHuman: 'ainda sem resposta da pessoa', unmarked: 'sem marcação',
      marks: { match: 'igual', better: 'melhor', worse: 'pior', different_but_fine: 'diferente mas bom', wrong_fact: 'facto errado' },
      reasons: { wrong_fact: 'facto errado', promised_something: 'prometeu algo', missed_question: 'não respondeu à pergunta', wrong_tone: 'tom errado', too_long: 'demasiado longo', unclear: 'pouco claro', other: 'outro' },
      home: 'Início', log: 'Registo', simple: 'Simples', advanced: 'Avançado', levelTitle: 'Mostra mais separadores (Avançado) ou só os essenciais (Simples)',
      chip_red: 'urgente', chip_yellow: 'seguimento', chip_green: 'em curso', errGeneric: 'Não foi possível concluir. Tente outra vez.',
      states: { bot: 'o bot responde', handoff: 'uma pessoa tem a conversa', paused: 'em pausa', stopped: 'parada' },
      bands: { high: 'alta', medium: 'média', low: 'baixa' },
      statuses: { proposed: 'à espera de uma pessoa', approved: 'aprovada', applied: 'aplicada', apply_failed: 'não foi aplicada', declined: 'recusada', superseded: 'substituída', expired: 'expirada', invalid_output: 'resposta inválida do modelo', reverted: 'revertida' },
      kinds: { transition: 'mudança de estado', command: 'comando', board_dismissed: 'retirado do painel', flag: 'sinalizada', shadow_marking: 'marcação', shadow_run: 'rascunho em sombra', lesson_added: 'lição adicionada', lesson_retired: 'lição retirada', checklist_signoff: 'lista assinada', role: 'papel da conversa', language: 'idioma', presence: 'presença do escritório', model_changed: 'serviço de IA alterado' },
      logNone: 'Ainda sem registos.',
      counts: 'Contagens por versão (sem nota única)', auditNone: 'Nada para auditar.',
      records: 'Histórico de acertos por tipo de resposta', right: 'certa', of: 'de', lastOf: 'das últimas', candidate: 'candidata a automático: só uma pessoa a pode ligar, depois de rever a calibração', collecting: 'a juntar histórico' },
    en: { board: 'Chats', sheet: 'Morning', notifyOn: 'Turn on notifications', notifyOk: 'Notifications on', notifyDenied: 'Notifications blocked in the browser',
      none: 'Nothing needs a person right now.', pick: 'Choose a chat.', takeOver: 'Take over', leaveToBot: 'Leave it to the bot', done: 'Done',
      handBack: 'Hand back to the bot', card: 'Summary for the office', pending: 'Replies waiting', history: 'Conversation', noHistory: 'No history available right now.',
      seen: 'Seen', since: 'since', state: 'state', band: 'confidence', red: 'needs attention now', yellow: 'needs follow-up',
      green: 'needs an answer or ongoing', none2: 'complete', customer: 'customer', bot: 'bot', staff: 'staff', whoAmI: 'Your name (kept in the log):', other: 'PT',
      audit: 'Audit', approve: 'Approve', decline: 'Decline', reason: 'reason', note: 'note (optional)', send: 'Save', whichFact: 'Which fact was wrong?',
      customerSaid: 'The customer wrote', botDrafted: 'The bot drafted', humanDid: 'The person answered', noHuman: 'no answer from a person yet', unmarked: 'not marked',
      marks: { match: 'match', better: 'better', worse: 'worse', different_but_fine: 'different but fine', wrong_fact: 'wrong fact' },
      reasons: { wrong_fact: 'wrong fact', promised_something: 'promised something', missed_question: 'missed the question', wrong_tone: 'wrong tone', too_long: 'too long', unclear: 'unclear', other: 'other' },
      home: 'Home', log: 'Log', simple: 'Simple', advanced: 'Advanced', levelTitle: 'Show more tabs (Advanced) or only the essentials (Simple)',
      chip_red: 'urgent', chip_yellow: 'follow-up', chip_green: 'ongoing', errGeneric: 'That did not work. Try again.',
      states: { bot: 'the bot answers', handoff: 'a person has the chat', paused: 'paused', stopped: 'stopped' },
      bands: { high: 'high', medium: 'medium', low: 'low' },
      statuses: { proposed: 'waiting for a person', approved: 'approved', applied: 'applied', apply_failed: 'could not be applied', declined: 'declined', superseded: 'replaced', expired: 'expired', invalid_output: 'invalid model answer', reverted: 'reverted' },
      kinds: { transition: 'status change', command: 'command', board_dismissed: 'dismissed from the board', flag: 'flagged', shadow_marking: 'marking', shadow_run: 'shadow draft', lesson_added: 'lesson added', lesson_retired: 'lesson retired', checklist_signoff: 'checklist signed', role: 'chat role', language: 'language', presence: 'office presence', model_changed: 'AI service changed' },
      logNone: 'No log yet.',
      counts: 'Counts per version (no single score)', auditNone: 'Nothing to audit.',
      records: 'Track record per kind of reply', right: 'right', of: 'of', lastOf: 'of the last', candidate: 'candidate for automation: only a person can switch it on, after reviewing the calibration', collecting: 'still collecting a record' }
  };
  /* ADM-111: linking a channel. {c} is the channel's name. */
  var L = {
    pt: { starting: 'A ligar {c}…', waiting: 'Ligar {c} a este computador', linking: 'Código lido. A ligar…', linked: '{c} ligado', error: '{c} não está ligado. Veja o terminal ou o registo do canal.', as: 'conta',
      scan: 'No telemóvel: abra {c} > Definições > Dispositivos ligados > Ligar um dispositivo, e aponte para este código. O código muda sozinho a cada poucos segundos.' },
    en: { starting: 'Starting {c}…', waiting: 'Link {c} to this computer', linking: 'Code scanned. Linking…', linked: '{c} linked', error: '{c} is not linked. See the terminal or the channel log.', as: 'account',
      scan: 'On the phone: open {c} > Settings > Linked devices > Link a device, and point it at this code. The code changes by itself every few seconds.' }
  };
  function lt(k, c) { return ((L[LANG] || L.pt)[k] || k).replace('{c}', c); }
  var state = null, selected = null, notified = {}, audioOk = false, ctx = null, reg = null;
  try { notified = JSON.parse(localStorage.getItem('cyborg.notified') || '{}'); } catch (e) { notified = {}; }

  function t(k) { return (T[LANG] || T.pt)[k] || k; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function operator() {
    var n = '';
    try { n = localStorage.getItem('cyborg.operator') || ''; } catch (e) { /* private window */ }
    if (!n) { n = (window.prompt(t('whoAmI')) || 'operator').slice(0, 40); try { localStorage.setItem('cyborg.operator', n); } catch (e) { /* ignore */ } }
    return n.replace(/[^\p{L}\p{N} .-]/gu, '').slice(0, 40) || 'operator';
  }
  function api(method, path, body) {
    var h = { 'x-cyborg-token': TOKEN, 'x-cyborg-operator': encodeURIComponent(method === 'GET' ? 'viewer' : operator()) };
    if (body) h['content-type'] = 'application/json';
    return fetch(path, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined }).then(function (r) { if (!r.ok) throw new Error(path + ' ' + r.status); return r.json(); });
  }
  /* DSH-7: a failed action says so plainly and its button is disabled while it runs; the technical reason is only in the tooltip. */
  var failTimer = null;
  function fail(e) {
    var box = document.getElementById('err'); box.textContent = t('errGeneric'); box.title = e && e.message ? String(e.message) : ''; box.style.display = 'block';
    clearTimeout(failTimer); failTimer = setTimeout(function () { box.style.display = 'none'; }, 8000);
  }
  function act(btn, fn) {
    if (btn) btn.disabled = true;
    return Promise.resolve().then(fn).catch(fail).then(function () { if (btn) btn.disabled = false; });
  }
  /* DSH-7: staff never see a handler id; a name in their words, the id only as a tooltip where it is shown at all. */
  var HANDLER_WORDS = { pt: { reply_draft: 'resposta', intake: 'leitura do pedido', card: 'resumo para o escritório' }, en: { reply_draft: 'reply', intake: 'reading the request', card: 'summary for the office' } };
  function handlerName(id) { var last = String(id).split('.').pop(); return (HANDLER_WORDS[LANG] || HANDLER_WORDS.pt)[last] || last.replace(/_/g, ' '); }
  function hhmm(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString(LANG === 'pt' ? 'pt-PT' : 'en-GB', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }); }

  /* ---- notifications over other apps (ADM-85) ---- */
  function beep() {
    if (!audioOk) return;
    try { var o = ctx.createOscillator(), g = ctx.createGain(); o.connect(g); g.connect(ctx.destination); g.gain.value = 0.08; o.frequency.value = 880; o.start(); o.stop(ctx.currentTime + 0.25); } catch (e) { /* no audio */ }
  }
  function unlockAudio() { if (audioOk) return; try { ctx = new (window.AudioContext || window.webkitAudioContext)(); audioOk = true; } catch (e) { /* none */ } }
  document.addEventListener('click', unlockAudio, { once: true });
  function notifyButton() {
    var b = document.getElementById('notify');
    if (!('Notification' in window)) { b.style.display = 'none'; return; }
    b.textContent = Notification.permission === 'granted' ? t('notifyOk') : Notification.permission === 'denied' ? t('notifyDenied') : t('notifyOn');
    b.disabled = Notification.permission !== 'default';
  }
  document.getElementById('notify').addEventListener('click', function () { Notification.requestPermission().then(notifyButton); });
  function show(toast, row) {
    var opts = { body: toast.body, tag: row.key, requireInteraction: true, data: { key: row.key, open: toast.open, token: TOKEN },
      actions: toast.actions.map(function (a) { return { action: a.id, title: a.label }; }) };
    if (reg && reg.showNotification) { reg.showNotification(toast.title, opts); return; }
    var n = new Notification(toast.title, { body: toast.body, tag: row.key, requireInteraction: true });
    n.onclick = function () { window.focus(); location.hash = toast.open; n.close(); };
  }
  function alertNew(rows) {
    var fresh = false;
    rows.forEach(function (r) {
      if (r.colour !== 'red') return;
      var key = r.key + '|' + r.since;
      if (notified[key]) return;
      notified[key] = 1; fresh = true;
      if ('Notification' in window && Notification.permission === 'granted') show(r.toast, r);
    });
    if (fresh) { beep(); try { localStorage.setItem('cyborg.notified', JSON.stringify(notified)); } catch (e) { /* ignore */ } }
  }

  /* ---- drawing ---- */
  function drawHeader() {
    var c = { red: 0, yellow: 0, green: 0 };
    state.items.forEach(function (r) { if (c[r.colour] !== undefined) c[r.colour]++; });
    ['red', 'yellow', 'green'].forEach(function (k) { document.getElementById('n-' + k).textContent = c[k]; document.getElementById('w-' + k).textContent = t('chip_' + k); });
    document.title = (c.red > 0 ? '(' + c.red + ') ' : '') + NAME;
    document.getElementById('lang').textContent = t('other');
    var chip = null; (state.tabs || []).forEach(function (x) { if (x.chip && !chip) chip = x.chip; });
    var dm = document.getElementById('demo'); dm.style.display = chip ? '' : 'none'; dm.textContent = chip || '';
    drawNav();
    notifyButton();
    var box = document.getElementById('alerts'); box.textContent = '';
    state.alerts.forEach(function (a) {
      var d = el('div', 'alert'); d.appendChild(el('span', '', a.detail));
      if (!a.seenAt) { var b = el('button', '', t('seen')); b.addEventListener('click', function () { act(b, function () { return api('POST', '/api/alerts/' + a.id + '/seen').then(refresh); }); }); d.appendChild(b); }
      box.appendChild(d);
    });
    drawLink();
  }
  function drawLink() {
    var box = document.getElementById('link'), k = state.link;
    var sig = k ? JSON.stringify(k) + LANG : '';
    if (box.getAttribute('data-sig') === sig) return;
    box.setAttribute('data-sig', sig); box.textContent = '';
    if (!k) return;
    var p = el('div', 'panel'), txt = el('div'), c = k.channel;
    if (k.state === 'waiting' && k.qr && k.qr.length) p.appendChild(qrSvg(k.qr));
    txt.appendChild(el('h2', '', lt(k.state, c) + (k.account ? ' · ' + lt('as', c) + ' ' + k.account : '')));
    if (k.state === 'waiting') txt.appendChild(el('p', '', lt('scan', c)));
    var h = k.hint && (k.hint[LANG] || k.hint.pt || k.hint.en);
    if (h) txt.appendChild(el('p', 'muted', h));
    p.appendChild(txt); box.appendChild(p);
  }
  function qrSvg(rows) {
    var NS = 'http://www.w3.org/2000/svg', n = rows.length, s = document.createElementNS(NS, 'svg'), d = '';
    s.setAttribute('viewBox', '-4 -4 ' + (n + 8) + ' ' + (n + 8)); s.setAttribute('shape-rendering', 'crispEdges'); s.setAttribute('role', 'img'); s.setAttribute('aria-label', 'QR');
    rows.forEach(function (r, y) { for (var x = 0; x < r.length; x++) if (r.charAt(x) === '1') d += 'M' + x + ' ' + y + 'h1v1h-1z'; });
    var path = document.createElementNS(NS, 'path'); path.setAttribute('d', d); path.setAttribute('fill', '#000'); s.appendChild(path);
    return s;
  }
  function drawBoard(list) {
    list.textContent = '';
    if (state.items.length === 0) { list.appendChild(el('div', 'empty', t('none'))); return; }
    state.items.forEach(function (r) {
      var d = el('div', 'row ' + r.colour + (selected === (r.open || r.key) ? ' sel' : ''));
      d.appendChild(el('b', '', r.title));
      d.appendChild(el('span', '', r.summary || ''));
      d.appendChild(el('small', '', ' ' + t(r.colour) + ' · ' + t('since') + ' ' + hhmm(r.since)));
      if (r.record) d.appendChild(el('small', '', ' · ' + t('right') + ' ' + r.record.right + ' ' + t('lastOf') + ' ' + r.record.considered + (r.record.candidate ? ' · ' + t('candidate') : '')));
      d.addEventListener('click', function () { location.hash = r.open || ('#/item/' + encodeURIComponent(r.key)); });
      list.appendChild(d);
    });
  }
  function drawChat(box) {
    box.textContent = '';
    if (!selected) { box.appendChild(el('div', 'empty', t('pick'))); return; }
    api('GET', '/api/chat/' + encodeURIComponent(selected)).then(function (v) {
      if (selected !== v.chat) return;
      box.textContent = '';
      box.appendChild(el('h2', '', v.name || v.chat));
      var meta = el('div', '', ''); var dot = el('span', 'dot ' + v.colour); meta.appendChild(dot);
      meta.appendChild(el('span', '', ' ' + (v.colour === 'none' ? t('none2') : t(v.colour)) + ' · ' + t('state') + ': ' + (t('states')[v.state] || v.state))); box.appendChild(meta);
      var acts = el('div', 'actions');
      var take = el('button', 'primary', t('takeOver')); take.disabled = v.state !== 'bot';
      take.addEventListener('click', function () { act(take, function () { return api('POST', '/api/chat/' + encodeURIComponent(v.chat) + '/take-over').then(refresh); }); });
      var back = el('button', '', t('handBack')); back.disabled = v.state === 'bot';
      back.addEventListener('click', function () { act(back, function () { return api('POST', '/api/chat/' + encodeURIComponent(v.chat) + '/hand-back').then(refresh); }); });
      var done = el('button', '', t('done'));
      done.addEventListener('click', function () { act(done, function () { return api('POST', '/api/chat/' + encodeURIComponent(v.chat) + '/done').then(refresh); }); });
      acts.appendChild(take); acts.appendChild(back); acts.appendChild(done); box.appendChild(acts);
      if (v.card) { box.appendChild(el('h3', '', t('card'))); box.appendChild(el('pre', '', v.card)); }
      if (v.pending.length) {
        box.appendChild(el('h3', '', t('pending')));
        v.pending.forEach(function (p) {
          box.appendChild(el('pre', '', (p.draft || handlerName(p.handler)) + (p.band ? '\n[' + t('band') + ': ' + (t('bands')[p.band] || p.band) + ']' : '')));
          box.appendChild(decideControls(p.id));
        });
      }
      box.appendChild(el('h3', '', t('history')));
      if (!v.history.length) box.appendChild(el('div', 'empty', t('noHistory')));
      v.history.forEach(function (l) { var d = el('div', 'line'); d.appendChild(el('b', '', t(l.from))); d.appendChild(document.createTextNode(l.text)); box.appendChild(d); });
    }).catch(function () { box.appendChild(el('div', 'empty', '—')); });
  }
  function drawItem(main, key) {
    var p = el('div', 'panel'); main.style.gridTemplateColumns = '1fr'; main.appendChild(p);
    api('GET', '/api/item/' + encodeURIComponent(key)).then(function (v) {
      if (!v.item) { p.appendChild(el('div', 'empty', t('none'))); return; }
      p.appendChild(el('h2', '', v.item.title));
      var meta = el('div', ''); meta.appendChild(el('span', 'dot ' + v.item.colour)); meta.appendChild(el('span', '', ' ' + t(v.item.colour) + ' · ' + t('since') + ' ' + hhmm(v.item.since))); p.appendChild(meta);
      if (v.item.summary) p.appendChild(el('pre', '', v.item.summary));
      if (v.detail) p.appendChild(el('pre', '', v.detail.text));
      var acts = el('div', 'actions');
      v.item.actions.forEach(function (a) {
        var b = el('button', 'primary', a.label);
        b.addEventListener('click', function () { act(b, function () { return api('POST', '/api/item/' + encodeURIComponent(key) + '/act/' + encodeURIComponent(a.id)).then(function () { location.hash = '#/'; refresh(); }); }); });
        acts.appendChild(b);
      });
      p.appendChild(acts);
    });
  }
  function decideControls(id) {
    var wrap = el('div', 'actions');
    var reason = el('select', ''); reason.appendChild(el('option', '', '— ' + t('reason')));
    Object.keys(t('reasons')).forEach(function (k) { var o = el('option', '', t('reasons')[k]); o.value = k; reason.appendChild(o); });
    var note = el('input', ''); note.placeholder = t('note'); note.maxLength = 200;
    function send(decision, btn) { act(btn, function () { return api('POST', '/api/proposal/' + encodeURIComponent(id) + '/decide', { decision: decision, reason: reason.value, note: note.value }).then(refresh); }); }
    var yes = el('button', 'primary', t('approve')); yes.addEventListener('click', function () { send('approve', yes); });
    var no = el('button', '', t('decline')); no.addEventListener('click', function () { send('decline', no); });
    wrap.appendChild(yes); wrap.appendChild(no); wrap.appendChild(reason); wrap.appendChild(note); return wrap;
  }
  function drawAudit(main) {
    var p = el('div', 'panel'); main.style.gridTemplateColumns = '1fr'; main.appendChild(p);
    api('GET', '/api/audit').then(function (a) {
      p.appendChild(el('h3', '', t('records')));
      a.records.forEach(function (r) {
        p.appendChild(el('div', 'line', handlerName(r.handlerId) + ' (' + r.model + '): ' + t('right') + ' ' + r.right + ' ' + t('lastOf') + ' ' + r.considered + (r.considered < r.of ? ' · ' + t('collecting') : '') + (r.candidate ? ' · ' + t('candidate') : '')));
      });
      p.appendChild(el('h3', '', t('counts')));
      a.counts.forEach(function (c) { p.appendChild(el('div', 'line', handlerName(c.handlerId) + ': ' + Object.keys(c.counts).map(function (k) { return (k === 'unmarked' ? t('unmarked') : t('marks')[k]) + ' ' + c.counts[k]; }).join(' · '))); });
      if (!a.rows.length) { p.appendChild(el('div', 'empty', t('auditNone'))); return; }
      a.rows.forEach(function (r) {
        var box = el('div', 'row ' + (r.marking ? 'none' : 'yellow'));
        box.style.cursor = 'default';
        box.appendChild(el('b', '', (r.name || r.chat || '') + ' · ' + handlerName(r.handlerId) + (r.band ? ' · ' + t('band') + ' ' + (t('bands')[r.band] || r.band) : '')));
        if (r.customerText) box.appendChild(el('pre', '', t('customerSaid') + ':\n' + r.customerText));
        box.appendChild(el('pre', '', t('botDrafted') + ':\n' + (r.draft || '—')));
        box.appendChild(el('pre', '', t('humanDid') + ':\n' + (r.humanReply || r.humanAction || t('noHuman'))));
        var acts = el('div', 'actions');
        Object.keys(t('marks')).forEach(function (k) {
          var b = el('button', r.marking === k ? 'primary' : '', t('marks')[k]);
          b.addEventListener('click', function () {
            var keys;
            if (k === 'wrong_fact' && r.factKeys.length > 1) { var pick = window.prompt(t('whichFact') + '\n' + r.factKeys.join('\n'), r.factKeys[0]); if (!pick) return; keys = [pick]; }
            act(b, function () { return api('POST', '/api/audit/' + encodeURIComponent(r.id) + '/mark', keys ? { marking: k, factKeys: keys } : { marking: k }).then(function () { draw(); }); });
          });
          acts.appendChild(b);
        });
        box.appendChild(acts); p.appendChild(box);
      });
    });
  }
  /* ---- the log (DSH-2 Registo): what the store's audit table holds ---- */
  function actorName(a) { a = String(a || ''); if (a.indexOf('dashboard:') === 0) return a.slice(10); return ({ gate: LANG === 'pt' ? 'sistema' : 'system', config: LANG === 'pt' ? 'configuração' : 'configuration' })[a] || a; }
  function drawLog(main) {
    var p = el('div', 'panel'); main.appendChild(p);
    api('GET', '/api/log').then(function (r) {
      p.appendChild(el('h2', '', t('log')));
      if (!r.rows.length) { p.appendChild(el('div', 'empty', t('logNone'))); return; }
      r.rows.forEach(function (row) {
        var what = t('kinds')[row.kind] || String(row.kind).replace(/_/g, ' ');
        if (row.toStatus) what += ': ' + (t('statuses')[row.toStatus] || String(row.toStatus).replace(/_/g, ' '));
        var d = el('div', 'line'); d.appendChild(el('b', '', hhmm(row.at))); d.appendChild(document.createTextNode(what + ' · ' + actorName(row.actor))); p.appendChild(d);
      });
    }).catch(fail);
  }

  /* ---- the shell: tabs, routes, live frames ---- */
  var SHELL = [{ id: 'home', hash: '#/', key: 'home', level: 'simple', order: 10 }, { id: 'sheet', hash: '#/sheet', key: 'sheet', level: 'simple', order: 20 },
    { id: 'audit', hash: '#/audit', key: 'audit', level: 'advanced', order: 40 }, { id: 'log', hash: '#/log', key: 'log', level: 'advanced', order: 50 }];
  var level = 'simple';
  try { level = localStorage.getItem('cyborg.level') === 'advanced' ? 'advanced' : 'simple'; } catch (e) { level = 'simple'; }
  function routeOf() {
    var h = location.hash, m = /^#\/t\/([a-z][a-z0-9-]*)$/.exec(h);
    if (m) return 't:' + m[1];
    if (h === '#/sheet') return 'sheet';
    if (h === '#/audit') return 'audit';
    if (h === '#/log') return 'log';
    if (/^#\/item\//.test(h)) return 'item';
    return 'home';
  }
  function drawNav() {
    var nav = document.getElementById('nav'), cur = routeOf(), sig = LANG + '|' + level + '|' + cur;
    if (nav.getAttribute('data-sig') === sig) return;
    nav.setAttribute('data-sig', sig); nav.textContent = '';
    var tabs = SHELL.map(function (x) { return { id: x.id, hash: x.hash, label: t(x.key), level: x.level, order: x.order }; });
    TAB_DEFS.forEach(function (d) { tabs.push({ id: 't:' + d.id, hash: '#/t/' + d.id, label: d.label[LANG] || d.label.pt, level: d.level, order: d.order }); });
    tabs.sort(function (a, b) { return a.order - b.order; });
    tabs.forEach(function (tab) {
      var on = tab.id === cur || (cur === 'item' && tab.id === 'home');
      if (tab.level === 'advanced' && level !== 'advanced' && !on) return;
      var a = el('a', on ? 'on' : '', tab.label); a.href = tab.hash; if (on) a.setAttribute('aria-current', 'page'); nav.appendChild(a);
    });
    var lv = document.getElementById('level'); lv.textContent = level === 'advanced' ? t('advanced') : t('simple'); lv.title = t('levelTitle'); lv.setAttribute('aria-pressed', level === 'advanced' ? 'true' : 'false');
  }
  /* WZP-40: each tab gets the same small kit; a tab that fails to build is shown as empty, never as a broken page. */
  TAB_DEFS.forEach(function (d) {
    var kit = {
      el: el, lang: function () { return LANG; }, act: act, fail: fail, handler: handlerName,
      t: function (k) { var own = (d.text[LANG] || {})[k]; return own !== undefined ? own : t(k); },
      api: function (method, name, body) { return api(method, '/api/tab/' + d.id + '/' + name, body); }
    };
    try { d.view = d.build(kit); } catch (e) { d.view = null; }
  });
  var homeList = null, homePanel = null;
  function draw() {
    if (!state) return;
    drawHeader();
    var main = document.getElementById('main'); main.textContent = ''; main.className = ''; homeList = homePanel = null;
    var r = routeOf();
    if (r.indexOf('t:') === 0) {
      var d = TAB_DEFS.filter(function (x) { return x.id === r.slice(2); })[0];
      if (!d || !d.view) { main.appendChild(el('div', 'empty', t('none'))); return; }
      try { d.view.draw(main); } catch (e) { fail(e); }
      return;
    }
    if (r === 'item') { drawItem(main, decodeURIComponent(/^#\/item\/(.+)$/.exec(location.hash)[1])); return; }
    if (r === 'audit') { drawAudit(main); return; }
    if (r === 'log') { drawLog(main); return; }
    if (r === 'sheet') {
      var p = el('div', 'panel'); main.appendChild(p);
      api('GET', '/api/sheet').then(function (s) { p.appendChild(el('pre', '', s.text)); }).catch(fail);
      return;
    }
    main.className = 'two';
    var m = /^#\/chat\/(.+)$/.exec(location.hash); selected = m ? decodeURIComponent(m[1]) : null;
    homeList = el('div', ''); homePanel = el('div', 'panel'); main.appendChild(homeList); main.appendChild(homePanel);
    drawBoard(homeList); drawChat(homePanel);
  }
  /* DSH-7: a live update redraws the header, the alerts and the board's list, and nothing else. A tab is never redrawn by it, and the open chat is
     left alone while someone is typing in it, so what is typed and where they scrolled are never lost. A change of language is a full redraw. */
  function onFrame(s) {
    var langChanged = s.language !== LANG;
    state = s; LANG = s.language; alertNew(s.items);
    if (langChanged) { draw(); return; }
    drawHeader();
    if (routeOf() === 'home' && homeList) {
      drawBoard(homeList);
      if (selected && homePanel && !homePanel.contains(document.activeElement)) drawChat(homePanel);
    }
  }
  function refresh() { return api('GET', '/api/state').then(function (s) { state = s; LANG = s.language; alertNew(s.items); draw(); }); }

  var langBtn = document.getElementById('lang');
  langBtn.addEventListener('click', function () { act(langBtn, function () { return api('POST', '/api/language', { language: LANG === 'pt' ? 'en' : 'pt' }).then(refresh); }); });
  var levelBtn = document.getElementById('level');
  levelBtn.addEventListener('click', function () {
    level = level === 'advanced' ? 'simple' : 'advanced';
    try { localStorage.setItem('cyborg.level', level); } catch (e) { /* private window */ }
    document.getElementById('nav').removeAttribute('data-sig'); drawNav();
  });
  window.addEventListener('hashchange', draw);
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then(function (r) { reg = r; }).catch(function () { reg = null; });
    navigator.serviceWorker.addEventListener('message', function (e) { if (e.data && e.data.open) location.hash = e.data.open.replace(/^\/?/, ''); });
  }
  refresh().catch(fail).then(function () {
    if (window.EventSource) {
      var es = new EventSource('/api/stream?token=' + encodeURIComponent(TOKEN));
      es.onmessage = function (e) { try { onFrame(JSON.parse(e.data)); } catch (x) { /* ignore a bad frame */ } };
    } else { setInterval(refresh, 3000); }
  });
})();
</script>
</body>
</html>
`;
