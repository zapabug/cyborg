import demoModel from '../../../docs/demo/company-model.demo.json' with { type: 'json' };
import { Demo, type DemoCompany } from './engine.ts';
import { h, replay, turnView, type Recorded } from './view.ts';
import { DEMO_SETTINGS } from './demo-settings.ts';

// The page. Text from the model, the customer or the data goes on the page with textContent, never as markup.

/** An OpenAI-compatible endpoint that a browser may call (it must answer CORS). */
export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
  /** Where a visitor gets a key. */
  keyUrl: string;
  /** One line on what the key costs. */
  note: string;
  /** A key the site carries for this provider. It is public to anyone who opens the page, so it must be capped (PPQ) or limited to free models (OpenRouter). */
  apiKey?: string;
}

export interface DemoConfig {
  providers: Provider[];
}

const PROVIDERS: Provider[] = [
  {
    id: 'ppq', name: 'PPQ.ai (pay per query, Bitcoin)', baseUrl: 'https://api.ppq.ai', keyUrl: 'https://ppq.ai/api-docs',
    note: 'Not free but tiny: about 0.01 US cents a turn on these models. A key can be made without an account and funded over Lightning from $0.10, with a spending cap.',
    models: ['mistralai/mistral-nemo', 'google/gemma-4-26b-a4b-it', 'openai/gpt-oss-20b', 'meta-llama/llama-3.1-8b-instruct'],
  },
  {
    id: 'openrouter', name: 'OpenRouter (free models)', baseUrl: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys',
    note: 'Free models, shared limits. A free key needs an OpenRouter account.',
    models: ['google/gemma-4-31b-it:free', 'nvidia/nemotron-3.5-lightning:free', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'openrouter/free'],
  },
];

const COMPANY: DemoCompany = { profile: demoModel.profile as Record<string, unknown>, label: demoModel.demo, enquiryFields: demoModel.enquiryFields };

const STORE = 'cyborg.demo';
type Saved = { provider?: string; model?: string; keys?: Record<string, string> };
const read = (): Saved => { try { return JSON.parse(localStorage.getItem(STORE) ?? '{}'); } catch { return {}; } };
const save = (v: Saved) => { try { localStorage.setItem(STORE, JSON.stringify(v)); } catch { /* private window */ } };

const SUGGESTIONS = ['Hi, how much is the Coast Walk?', 'We are 4 people, on Saturday', 'Yes please, send it', 'Can I bring my dog?', 'Can children come?', 'Coast Walk for 2 on Monday'];
function live(root: HTMLElement, config: DemoConfig): void {
  const saved = read();
  let demo: Demo | null = null;
  let chatN = 1;
  const thread = h('div', { class: 'cy-thread', 'aria-live': 'polite' } as never);
  const status = h('div', { class: 'cy-status' });
  const input = h('input', { class: 'cy-input', placeholder: 'Type as the customer…', maxLength: 500, disabled: true } as never);
  const send = h('button', { class: 'btn btn-primary', disabled: true }, 'Send');
  const chips = h('div', { class: 'cy-suggest' });
  const bookings = h('div', { class: 'cy-bookings' });
  const office = h('input', { class: 'cy-input', placeholder: 'Office: .bookings  ·  .confirm B-000001', disabled: true } as never);
  const officeOut = h('pre', { class: 'cy-office' });
  const lessons = h('div', { class: 'cy-lessons' });
  const lessonIn = h('input', { class: 'cy-input', placeholder: 'A rule for the bot, e.g. When you give a price, say pick-up is included.', maxLength: 300, disabled: true } as never);
  const card = h('button', { class: 'btn', disabled: true }, 'Pass to the office');
  let busy = false;

  const say = (text: string, bad = false) => { status.textContent = text; status.className = 'cy-status' + (bad ? ' bad' : ''); };
  const draw = () => {
    bookings.textContent = '';
    const list = demo?.bookings() ?? [];
    if (!list.length) bookings.append(h('div', { class: 'cy-empty' }, 'No booking requests yet.'));
    for (const b of list) {
      const row = h('div', { class: 'cy-row ' + b.status }, h('b', {}, `${b.ref} · ${b.service} × ${b.partySize} · ${b.date}`), h('small', {}, `${b.total} · ${b.status === 'proposed' ? 'waiting for the office' : b.status === 'approved' ? 'confirmed' : 'declined'}`));
      if (b.status === 'proposed') {
        const yes = h('button', { class: 'btn btn-primary' }, 'Confirm'); const no = h('button', { class: 'btn' }, 'Decline');
        yes.onclick = () => { officeOut.textContent = demo!.office(`confirm ${b.ref}`); draw(); };
        no.onclick = () => { officeOut.textContent = demo!.office(`decline ${b.ref}`); draw(); };
        row.append(h('div', { class: 'cy-actions' }, yes, no));
      }
      bookings.append(row);
    }
    lessons.textContent = '';
    for (const l of demo?.lessons.listLessons().filter((x) => x.status === 'active') ?? []) {
      const rt = h('button', { class: 'btn' }, 'Retire');
      rt.onclick = () => { demo!.retireLesson(l.id); draw(); };
      lessons.append(h('div', { class: 'cy-row' }, h('b', {}, l.text), rt));
    }
  };
  const enable = (on: boolean) => { for (const el of [input, send, office, lessonIn, card]) (el as HTMLInputElement).disabled = !on; };

  async function go(text: string): Promise<void> {
    if (!demo || busy || text.trim() === '') return;
    busy = true; enable(false); say('The model is writing…');
    const chat = `visitor-${chatN}`;
    try {
      const view = await demo.customer(chat, text);
      thread.append(turnView(view));
      lastChat = chat;
      thread.scrollTop = thread.scrollHeight;
      say(view.problems.length ? 'The code held something back. Open "How it got there".' : '');
    } catch (e) {
      say((e as Error).message, true);
    } finally {
      busy = false; enable(true); draw(); input.focus();
    }
  }
  let lastChat = 'visitor-1';
  send.onclick = () => { const t = input.value; input.value = ''; void go(t); };
  input.onkeydown = (e) => { if (e.key === 'Enter') send.click(); };
  office.onkeydown = (e) => { if (e.key === 'Enter' && demo) { officeOut.textContent = demo.office(office.value); office.value = ''; draw(); } };
  lessonIn.onkeydown = (e) => { if (e.key === 'Enter' && demo) { try { demo.addLesson(lessonIn.value); lessonIn.value = ''; draw(); } catch (err) { say((err as Error).message, true); } } };
  card.onclick = async () => {
    if (!demo || busy) return;
    busy = true; enable(false); say('The model is writing the card…');
    try { const text = await demo.handoff(lastChat); thread.append(h('div', { class: 'cy-turn' }, h('div', { class: 'cy-bot' }, h('h4', {}, 'The card the office would get (not sent)'), h('pre', {}, text)))); say(''); } catch (e) { say((e as Error).message, true); } finally { busy = false; enable(true); }
  };
  for (const s of SUGGESTIONS) { const c = h('button', { class: 'cy-chipbtn', type: 'button' }, s); c.onclick = () => { input.value = s; input.focus(); }; chips.append(c); }

  const providers = config.providers;
  const providerSel = h('select', { class: 'cy-input', 'aria-label': 'Provider' } as never, ...providers.map((p) => h('option', { value: p.id, selected: p.id === (saved.provider ?? providers[0]!.id) }, p.name)));
  const modelSel = h('select', { class: 'cy-input', 'aria-label': 'Model' } as never);
  const key = h('input', { class: 'cy-input', type: 'password', autocomplete: 'off' } as never);
  const note = h('div', { class: 'cy-note' });
  const current = () => providers.find((p) => p.id === providerSel.value) ?? providers[0]!;
  const keys: Record<string, string> = { ...(saved.keys ?? {}) };
  const refresh = () => {
    const p = current();
    modelSel.textContent = '';
    for (const m of p.models) modelSel.append(h('option', { value: m, selected: m === saved.model }, m));
    key.value = keys[p.id] ?? '';
    key.placeholder = p.apiKey ? 'Using the key this page carries (or paste your own)' : 'Paste your key';
    note.textContent = p.note;
    note.append(' ', h('a', { href: p.keyUrl, target: '_blank', rel: 'noopener' }, 'Get a key'));
  };
  providerSel.onchange = () => { keys[current().id] ??= ''; refresh(); };
  refresh();
  const start = h('button', { class: 'btn btn-primary' }, 'Start the live demo');
  start.onclick = async () => {
    const p = current();
    const apiKey = key.value.trim() || p.apiKey || '';
    if (!apiKey) { say(`Paste a key for ${p.name} first. It stays in this browser and is sent only to ${new URL(p.baseUrl).host}.`, true); return; }
    start.disabled = true; say('Testing the model once with a few real calls…');
    try {
      demo = new Demo(COMPANY, { baseUrl: p.baseUrl, model: modelSel.value, apiKey }, DEMO_SETTINGS);
      const level = await demo.prepare();
      if (key.value.trim()) keys[p.id] = key.value.trim();
      save({ provider: p.id, model: modelSel.value, keys });
      say(`Ready: ${modelSel.value} answers with ${level}.`); enable(true); input.focus(); draw();
    } catch (e) {
      demo = null; say((e as Error).message, true);
    } finally {
      start.disabled = false;
    }
  };
  const newChat = h('button', { class: 'btn' }, 'New chat');
  newChat.onclick = () => { chatN += 1; thread.textContent = ''; input.focus(); };
  root.append(
    h('div', { class: 'cy-setup' }, h('label', {}, 'Provider ', providerSel), h('label', {}, 'Model ', modelSel), h('label', {}, 'Key ', key), start),
    note,
    status,
    h('div', { class: 'cy-grid' },
      h('div', { class: 'cy-main' }, thread, chips, h('div', { class: 'cy-send' }, input, send), h('div', { class: 'cy-actions' }, card, newChat)),
      h('aside', { class: 'cy-side' }, h('h3', {}, 'Bookings'), bookings, h('h3', {}, 'Office'), office, officeOut, h('h3', {}, 'Lessons'), lessonIn, lessons)),
  );
  draw();
}

/** Mounts the demo: a recorded session that needs nothing, and the live one that needs a free model. */
export function mount(root: HTMLElement, config: DemoConfig, recorded: Recorded): void {
  const tabs = h('div', { class: 'cy-tabs', role: 'tablist' });
  const live$ = h('div', { class: 'cy-pane' });
  const rec$ = h('div', { class: 'cy-pane' });
  const select = (which: 'recorded' | 'live') => {
    live$.hidden = which !== 'live'; rec$.hidden = which !== 'recorded';
    for (const b of tabs.children) b.setAttribute('aria-selected', String((b as HTMLElement).dataset['tab'] === which));
  };
  for (const [id, label] of [['recorded', 'Watch a recorded session'], ['live', 'Try it live']] as const) {
    const b = h('button', { class: 'cy-tab', type: 'button', role: 'tab' }, label); b.dataset['tab'] = id; b.onclick = () => select(id); tabs.append(b);
  }
  replay(rec$, recorded);
  live(live$, config);
  root.append(tabs, rec$, live$);
  select('recorded');
}

declare global { interface Window { CYBORG_CONFIG?: { providers?: Partial<Provider>[] }; CYBORG_RECORDED?: Recorded } }

const el = document.getElementById('demo');
if (el) {
  // config.js (not committed) may give a provider a key of its own, or change a provider's models; anything else stays as above.
  const overrides = window.CYBORG_CONFIG?.providers ?? [];
  const providers = PROVIDERS.map((p) => ({ ...p, ...(overrides.find((o) => o.id === p.id) ?? {}) }));
  fetch('assets/sessions.json').then((r) => r.json()).then((recorded: Recorded) => mount(el, { providers }, recorded)).catch(() => el.append(h('p', { class: 'cy-prob' }, 'The recorded sessions could not be loaded.')));
}
