import { missingAsks, parseBusinessSheet } from '@cyborg/company';
import type { Company } from '@cyborg/company';
import type { DashboardTab, TabRequest } from './tabs.ts';

// feat-tailored T1 (TLR-10, 12, 13): the Business tab. The client's own words about how the business runs go in a box, the page shows what was read (and what was
// not), and "Use this" puts the facts in the company, unconfirmed, so the next test-chat message already answers from them. No model is called.

/** N-21 (docs/02). */
const SHEET_MAX = 20_000;
const str = (body: unknown, key: string): string => (typeof (body as Record<string, unknown>)?.[key] === 'string' ? ((body as Record<string, string>)[key] as string) : '');

/** Where the sheet is kept, so the client's words survive a restart and stay the record of what was said. */
export interface SheetStore {
  read(): string | null;
  write(text: string): void;
}

const text = {
  pt: {
    shTitle: 'O negócio', shIntro: 'Escreva como o negócio funciona, nas suas palavras. O que leio aparece ao lado. «Usar isto» passa os factos para o bot, por confirmar, e a conversa de teste já responde com eles.',
    shRead: 'O que li', shUse: 'Usar isto', shDone: 'Feito. Os factos estão por confirmar.', shNothing: 'Ainda nada.', shUnread: 'Não consegui ler', shLine: 'linha', shAsk: 'Falta perguntar', shAll: 'Nada em falta para responder a clientes.',
    shTooLong: 'Texto demasiado longo.',
    shTemplate: 'Nome: \nTom: simpático, curto e claro\nOnde: \nHorário: seg a sáb 9h-19h\nPagamento: \n\nServiços:\n- Nome do serviço | preço | nota\n\nPerguntas:\n- Pergunta frequente | A sua resposta\n\nNunca:\n- o que o bot nunca deve dizer nem prometer\n',
  },
  en: {
    shTitle: 'The business', shIntro: 'Write how the business runs, in your own words. What I read shows beside it. "Use this" gives the facts to the bot, unconfirmed, and the test chat answers from them straight away.',
    shRead: 'What I read', shUse: 'Use this', shDone: 'Done. The facts are unconfirmed.', shNothing: 'Nothing yet.', shUnread: 'Could not read', shLine: 'line', shAsk: 'Still to ask', shAll: 'Nothing missing to answer customers.',
    shTooLong: 'The text is too long.',
    shTemplate: 'Name: \nTone: friendly, short and plain\nWhere: \nHours: Mon-Sat 9:00-19:00\nPayment: \n\nServices:\n- Service name | price | note\n\nQuestions:\n- A question customers ask | Your answer\n\nNever:\n- what the bot must never say or promise\n',
  },
};

const script = String.raw`
var el = ctx.el, t = ctx.t, api = ctx.api, act = ctx.act;
return { draw: function (box) {
  box.textContent = '';
  var panel = el('div', 'panel'); box.appendChild(panel);
  panel.appendChild(el('h2', '', t('shTitle')));
  panel.appendChild(el('p', 'tc-note', t('shIntro')));
  var area = el('textarea', ''); area.rows = 18; area.style.width = '100%'; area.style.fontFamily = 'inherit'; area.setAttribute('aria-label', t('shTitle'));
  var use = el('button', 'primary', t('shUse')), status = el('span', 'tc-note', '');
  var side = el('div', ''); side.style.marginTop = '12px';
  panel.appendChild(area); panel.appendChild(el('div', 'actions', '')); panel.lastChild.appendChild(use); panel.lastChild.appendChild(status); panel.appendChild(side);
  function show(r) {
    side.textContent = '';
    side.appendChild(el('h3', '', t('shRead')));
    if (!r.notes.length) side.appendChild(el('div', 'empty', t('shNothing')));
    r.notes.forEach(function (n) { side.appendChild(el('div', 'line', n)); });
    if (r.unread.length) {
      side.appendChild(el('h3', '', t('shUnread')));
      r.unread.forEach(function (u) { side.appendChild(el('div', 'row amber', t('shLine') + ' ' + u.line + ': ' + u.text + ' (' + u.why + ')')); });
    }
    side.appendChild(el('h3', '', t('shAsk')));
    if (!r.asks.length) side.appendChild(el('div', 'line', t('shAll')));
    r.asks.forEach(function (a) { side.appendChild(el('div', 'line', a)); });
  }
  var timer = null;
  function read() { return api('POST', 'read', { text: area.value }).then(show); }
  area.addEventListener('input', function () { status.textContent = ''; clearTimeout(timer); timer = setTimeout(function () { read().catch(ctx.fail); }, 400); });
  use.addEventListener('click', function () { act(use, function () { return api('POST', 'apply', { text: area.value }).then(function (r) { show(r); status.textContent = t('shDone'); }); }); });
  api('GET', 'load').then(function (d) { area.value = d.text || t('shTemplate'); return read(); }).catch(ctx.fail);
} };
`;

export function businessTab(company: Company, sheet?: SheetStore): DashboardTab {
  const view = (raw: string) => {
    if (raw.length > SHEET_MAX) throw new Error('The text is too long.');
    const parsed = parseBusinessSheet(raw);
    return { parsed, notes: parsed.notes, unread: parsed.unread, asks: missingAsks(parsed.missing) };
  };
  return {
    id: 'business',
    label: { pt: 'O negócio', en: 'The business' },
    level: 'simple',
    order: 25,
    text,
    routes: {
      load: () => ({ text: sheet?.read() ?? '' }),
      read: ({ body }: TabRequest) => {
        const { notes, unread, asks } = view(str(body, 'text'));
        return { notes, unread, asks };
      },
      apply: ({ body, operator }: TabRequest) => {
        const raw = str(body, 'text');
        const { parsed, notes, unread, asks } = view(raw);
        const at = new Date().toISOString();
        const keys = Object.keys(parsed.statements);
        for (const key of keys) company.store.putFact({ key, value: parsed.statements[key], class: 'public', source: 'client_statement', sourceRef: 'business-sheet' }, operator, at);
        sheet?.write(raw);
        return { notes, unread, asks, applied: keys };
      },
    },
    script,
  };
}
