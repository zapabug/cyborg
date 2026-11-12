import type { DashboardTab } from './tabs.ts';

// feat-model MDL-1..10: the AI service is set here: address, model and key, with a Test before a Save. The shell knows no provider: something gives the
// tab a ModelPanel (the company package's ModelControl is one) and the tab does the rest. The key goes to the panel in a request body and never comes back.

export interface ModelPanelView {
  baseUrl: string;
  model: string;
  keySet: boolean;
  local: boolean;
  presets: { id: string; label: { pt: string; en: string }; baseUrl: string; local: boolean }[];
  needsRestart: boolean;
}

export interface ModelPanel {
  view(): ModelPanelView;
  /** Tries the values without saving. `kind` is one of works, key_refused, unreachable, model_not_found, busy, no_structured. */
  test(input: { baseUrl: string; model: string; apiKey?: string }): Promise<{ ok: boolean; kind: string; level: string }>;
  save(input: { baseUrl: string; model: string; apiKey?: string }, by: string): Promise<ModelPanelView>;
}

const text = {
  pt: {
    mTitle: 'Serviço de IA', mIntro: 'O bot usa um serviço de IA que o cliente paga com a sua própria conta. Escolha o fornecedor, o modelo e cole a chave. Experimente antes de guardar.',
    mProvider: 'Fornecedor', mAddress: 'Endereço', mModel: 'Modelo', mKey: 'Chave', mKeySet: 'Já há uma chave. Deixe em branco para a manter.', mKeyNone: 'Cole aqui a chave do serviço',
    mKeyLocal: 'Neste computador não é preciso chave.', mTest: 'Experimentar', mSave: 'Guardar', mTesting: 'A experimentar…',
    mSaved: 'Guardado. O bot usa já este serviço.', mRestart: 'Há passos do bot que só carregam no próximo arranque: feche e abra o programa.',
    mOut: 'O texto das conversas vai para este serviço, com os números trocados por marcas. Os nomes não são trocados. A conta que o paga é a do cliente.',
    mNeedTest: 'Experimente primeiro: só se guarda o que foi experimentado.',
    works: 'Funciona. O serviço responde no formato de que o bot precisa.', key_refused: 'O serviço recusou a chave. Confirme a chave e se a conta tem saldo.',
    unreachable: 'Não foi possível chegar a esse endereço.', model_not_found: 'O serviço não conhece esse nome de modelo.',
    busy: 'O serviço está ocupado ou limitado agora. Tente daqui a um minuto.', no_structured: 'O serviço respondeu, mas não no formato de que o bot precisa. Experimente outro modelo.',
  },
  en: {
    mTitle: 'AI service', mIntro: 'The bot uses an AI service that the client pays for with their own account. Choose the provider, the model and paste the key. Test before you save.',
    mProvider: 'Provider', mAddress: 'Address', mModel: 'Model', mKey: 'Key', mKeySet: 'A key is already set. Leave empty to keep it.', mKeyNone: 'Paste the service key here',
    mKeyLocal: 'On this computer no key is needed.', mTest: 'Test', mSave: 'Save', mTesting: 'Testing…',
    mSaved: 'Saved. The bot uses this service now.', mRestart: 'Some steps of the bot only load at the next start: close and open the program.',
    mOut: 'The text of the chats goes to this service, with numbers replaced by placeholders. Names are not replaced. The account that pays for it is the client\'s.',
    mNeedTest: 'Test first: only what was tested can be saved.',
    works: 'Works. The service answers in the format the bot needs.', key_refused: 'The service refused the key. Check the key and that the account has credit.',
    unreachable: 'That address could not be reached.', model_not_found: 'The service does not know that model name.',
    busy: 'The service is busy or limited right now. Try again in a minute.', no_structured: 'The service answered, but not in the format the bot needs. Try another model.',
  },
};

// No backticks and no dollar-brace: a plain string the page runs. Everything from the panel goes on the page with textContent or .value.
const script = String.raw`
var el = ctx.el, t = ctx.t, api = ctx.api, act = ctx.act;
var data = null, passed = null, note = '', verdict = null;
function load(box) { return api('GET', 'view').then(function (d) { data = d; if (box) render(box); }); }
function field(label, input) { var w = el('label', 'line'); w.style.display = 'block'; w.appendChild(el('div', 'tc-note', label)); input.style.width = '100%'; w.appendChild(input); return w; }
function render(box) {
  box.textContent = '';
  var panel = el('div', 'panel'); box.appendChild(panel);
  panel.appendChild(el('h2', '', t('mTitle')));
  panel.appendChild(el('p', 'tc-note', t('mIntro')));
  if (!data) return;
  var lang = ctx.lang();
  var preset = el('select', ''); preset.setAttribute('aria-label', t('mProvider'));
  var current = 'custom';
  data.presets.forEach(function (p) { if (p.baseUrl && p.baseUrl === data.baseUrl) current = p.id; });
  data.presets.forEach(function (p) { var o = el('option', '', p.label[lang] || p.label.en); o.value = p.id; if (p.id === current) o.selected = true; preset.appendChild(o); });
  var addr = el('input', ''); addr.type = 'url'; addr.value = data.baseUrl; addr.setAttribute('aria-label', t('mAddress')); addr.autocomplete = 'off';
  var model = el('input', ''); model.value = data.model; model.setAttribute('aria-label', t('mModel')); model.autocomplete = 'off';
  var key = el('input', ''); key.type = 'password'; key.autocomplete = 'new-password'; key.setAttribute('aria-label', t('mKey'));
  key.placeholder = data.keySet ? t('mKeySet') : t('mKeyNone');
  panel.appendChild(field(t('mProvider'), preset));
  panel.appendChild(field(t('mAddress'), addr));
  panel.appendChild(field(t('mModel'), model));
  panel.appendChild(field(t('mKey'), key));
  var outNote = el('p', 'tc-note', ''); panel.appendChild(outNote);
  var result = el('div', 'tc-note', ''); panel.appendChild(result);
  var test = el('button', '', t('mTest')), save = el('button', 'primary', t('mSave')); save.disabled = true;
  function values() { var v = { baseUrl: addr.value.trim(), model: model.value.trim() }; if (key.value.trim() !== '') v.apiKey = key.value.trim(); return v; }
  function sig() { return JSON.stringify(values()); }
  function showOut() {
    var local = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(addr.value.trim());
    outNote.textContent = local ? t('mKeyLocal') : t('mOut');
  }
  function edited() { save.disabled = passed !== sig(); if (passed !== sig() && passed !== null) { result.textContent = t('mNeedTest'); result.className = 'tc-note'; } showOut(); }
  preset.addEventListener('change', function () {
    var p = data.presets.filter(function (x) { return x.id === preset.value; })[0];
    if (p && p.baseUrl) addr.value = p.baseUrl; if (p && p.id === 'custom') addr.focus(); edited();
  });
  [addr, model, key].forEach(function (i) { i.addEventListener('input', edited); });
  test.addEventListener('click', function () {
    var s = sig(); result.textContent = t('mTesting'); result.className = 'tc-note';
    act(test, function () {
      return api('POST', 'test', values()).then(function (r) {
        result.textContent = t(r.kind); result.className = r.ok ? 'tc-note' : 'tc-prob';
        passed = r.ok ? s : null; save.disabled = passed !== sig();
      });
    });
  });
  save.addEventListener('click', function () {
    act(save, function () {
      return api('POST', 'save', values()).then(function (d) { data = d; passed = null; note = t('mSaved') + (d.needsRestart ? ' ' + t('mRestart') : ''); render(box); });
    });
  });
  var acts = el('div', 'actions'); acts.appendChild(test); acts.appendChild(save); panel.appendChild(acts);
  showOut();
  if (note) { panel.appendChild(el('div', 'tc-note', note)); }
}
return { draw: function (box) { note = ''; passed = null; load(box).catch(ctx.fail); } };
`;

function asInput(body: unknown): { baseUrl: string; model: string; apiKey?: string } {
  const b = body as { baseUrl?: unknown; model?: unknown; apiKey?: unknown } | null;
  return { baseUrl: typeof b?.baseUrl === 'string' ? b.baseUrl : '', model: typeof b?.model === 'string' ? b.model : '', ...(typeof b?.apiKey === 'string' && b.apiKey !== '' ? { apiKey: b.apiKey } : {}) };
}

/** The AI service tab. Routes: `view`, `test` and `save`. */
export function modelTab(panel: ModelPanel): DashboardTab {
  return {
    id: 'model',
    label: { pt: 'Serviço de IA', en: 'AI service' },
    level: 'simple',
    order: 36,
    text,
    routes: {
      view: () => panel.view(),
      test: ({ body }) => panel.test(asInput(body)),
      save: ({ body, operator }) => panel.save(asInput(body), operator),
    },
    script,
  };
}
