// feat-tailored TLR-10, TLR-13: the business sheet, how a business runs in the client's own words. Plain lines, no model: `Label: value`, and a label with
// nothing after the colon opens a list (`- item` lines). The labels are in English and Portuguese. Nothing is guessed: a line that cannot be read is listed,
// and a label that is not known becomes an answer for customers under that label, so no word the client wrote is dropped.

import { PRINCIPLE_CHECKS, PRINCIPLE_STAGES } from '@cyborg/module-sales';

export interface SheetItem {
  name: string;
  price?: number;
  priceFrom?: boolean;
  currency?: string;
  note?: string;
  /** ADM-114: "up to 15 passengers" on the service line. */
  capacity?: number;
  /** For the writer: a starting price is never given as a flat one. The code check holds it to this (module-sales draft checks). */
  priceNote?: string;
}

export interface Unread {
  line: number;
  text: string;
  why: string;
}

export interface Sheet {
  /** Profile facts by key, ready for `mergeIntakeModel` (every one is unconfirmed until the client confirms, WZP-29). */
  statements: Record<string, unknown>;
  /** What each statement came from, in plain words, for the person who reads the draft with the client. */
  notes: string[];
  unread: Unread[];
  /** The facts the sales module needs that the sheet did not give. */
  missing: string[];
}

const NAME = ['name', 'nome', 'business', 'negocio', 'negócio', 'empresa'];
const TONE = ['tone', 'tom', 'style', 'estilo', 'voice'];
const SERVICES = ['services', 'serviços', 'servicos', 'menu', 'prices', 'preços', 'precos', 'products', 'produtos', 'items', 'catalogue', 'catalog'];
const QUESTIONS = ['questions', 'perguntas', 'faq', 'q&a'];
/** feat-desk DK2: the business's numbered rules, tied to a stage and optionally to a check the code holds the draft to. */
const PRINCIPLES = ['principles', 'princípios', 'principios', 'how we work', 'como trabalhamos'];
const NEVER = ['never', 'nunca', 'rules', 'regras', 'never say', 'nunca dizer', 'never promise', 'nunca prometer'];
/** Labels with a fixed question; any other label asks about itself. */
const ASKED: { labels: string[]; q: string }[] = [
  { labels: ['where', 'location', 'address', 'morada', 'localização', 'localizacao', 'onde'], q: 'Where is your office?' },
  { labels: ['hours', 'opening hours', 'horário', 'horario', 'abertura'], q: 'What are your opening hours?' },
  { labels: ['payment', 'pagamento', 'pagamentos'], q: 'How can I pay?' },
  { labels: ['cancellation', 'cancelamento', 'cancelamentos'], q: 'What is your cancellation policy?' },
];

/** Lines the form adds that are not about the business. */
const IGNORED = ['filled in by', 'preenchido por'];
const KNOWN = [...NAME, ...TONE, ...SERVICES, ...QUESTIONS, ...PRINCIPLES, ...NEVER, ...IGNORED, ...ASKED.flatMap((a) => a.labels)];

const WEEKDAYS: [string, number][] = [
  ['sun', 0], ['dom', 0], ['mon', 1], ['seg', 1], ['tue', 2], ['ter', 2], ['wed', 3], ['qua', 3], ['thu', 4], ['qui', 4], ['fri', 5], ['sex', 5], ['sat', 6], ['sab', 6], ['sáb', 6],
];

const fold = (s: string): string => s.normalize('NFC').toLowerCase().trim();
const clean = (s: string): string => s.replace(/^\s*[*_]+|[*_]+\s*$/g, '').trim();
const isLabel = (label: string, set: readonly string[]): boolean => set.includes(fold(label));

/** "25", "25,50", "€25", "25 EUR", "from 25": the first amount in the text and what is around it. Null when there is none. */
export function findPrice(text: string): { price: number; priceFrom: boolean; currency?: string; rest: string } | null {
  const m = /(?:(€|\$|£|eur|usd|gbp)\s*)?(\d+(?:[.,]\d{1,2})?)\s*(€|\$|£|eur(?:os?)?|usd|gbp)?/i.exec(text);
  if (!m) return null;
  const symbol = (m[1] ?? m[3] ?? '').toLowerCase();
  const currency = symbol === '' ? undefined : symbol === '€' || symbol.startsWith('eur') ? 'EUR' : symbol === '$' || symbol === 'usd' ? 'USD' : 'GBP';
  const before = text.slice(0, m.index);
  const priceFrom = /\b(from|desde|a partir de|starting at|a começar em)\s*$/i.test(before);
  const rest = `${before.replace(/\b(from|desde|a partir de|starting at|a começar em)\s*$/i, '')} ${text.slice(m.index + m[0].length)}`.replace(/\s+/g, ' ').trim();
  return { price: Number(m[2]!.replace(',', '.')), priceFrom, ...(currency ? { currency } : {}), rest };
}

const startingNote = (price: number): string => `starting price: always say "from ${price}", never just "${price}"`;

/** ADM-114: the limit a service line states in words ("up to 15 passengers", "até 8 pessoas"), or undefined. */
export function capacityFrom(text: string): number | undefined {
  const m = /\b(?:up to|max(?:imum)?(?: of)?|at most|até|no máximo)\s+(\d{1,4})\s*(?:passengers?|people|persons?|guests?|pax|seats?|places?|spots?|participants?|pessoas?|passageiros?|lugares|vagas)\b/i.exec(text)
    ?? /\b(\d{1,4})\s*(?:passengers?|people|persons?|guests?|pax|seats?|places?|spots?|participants?|pessoas?|passageiros?|lugares|vagas)\s*(?:max|maximum)\b/i.exec(text);
  return m ? Number(m[1]) : undefined;
}

function withCapacity(item: SheetItem | null, text: string): SheetItem | null {
  if (!item) return item;
  const capacity = capacityFrom(text);
  return capacity !== undefined ? { ...item, capacity } : item;
}

function readItem(text: string): SheetItem | null {
  return withCapacity(readItemPlain(text), text);
}

function readItemPlain(text: string): SheetItem | null {
  const parts = text.split('|').map((p) => p.trim()).filter((p) => p !== '');
  if (parts.length === 0) return null;
  if (parts.length > 1) {
    const priced = parts.slice(1).map((p, i) => ({ i, f: findPrice(p) })).find((x) => x.f);
    const note = parts.slice(1).filter((_, i) => i !== priced?.i).join('; ');
    return { name: parts[0]!, ...(priced?.f ? { price: priced.f.price, ...(priced.f.priceFrom ? { priceFrom: true, priceNote: startingNote(priced.f.price) } : {}), ...(priced.f.currency ? { currency: priced.f.currency } : {}) } : {}), ...(note ? { note } : {}) };
  }
  const m = /^(.*?)\s*[-–—:]\s+(.*\d.*)$/.exec(text);
  const f = m ? findPrice(m[2]!) : null;
  if (m && f) {
    const note = f.rest.replace(/\s+/g, ' ').trim();
    return { name: m[1]!.trim(), price: f.price, ...(f.priceFrom ? { priceFrom: true, priceNote: startingNote(f.price) } : {}), ...(f.currency ? { currency: f.currency } : {}), ...(note ? { note } : {}) };
  }
  return { name: text.trim() };
}

/** The days of the week an hours line names ("Mon-Sat 9-19", "seg a sáb", "every day", "todos os dias"), or null when it does not say. */
export function daysFromHours(text: string): number[] | null {
  const t = fold(text);
  if (/\b(every day|daily|todos os dias|7 days|7 dias)\b/.test(t)) return [0, 1, 2, 3, 4, 5, 6];
  const day = (w: string): number | null => WEEKDAYS.find(([k]) => w.startsWith(k))?.[1] ?? null;
  const range = /(?<![a-zçáàâãéêíóôõú])([a-zçáàâãéêíóôõú]{3})[a-zçáàâãéêíóôõú]*\s*(?:-|–|to|a|até|ate)\s*([a-zçáàâãéêíóôõú]{3})[a-zçáàâãéêíóôõú]*/.exec(t);
  if (range) {
    const [a, b] = [day(range[1]!), day(range[2]!)];
    if (a !== null && b !== null) {
      const out: number[] = [];
      for (let d = a; ; d = (d + 1) % 7) {
        out.push(d);
        if (d === b || out.length === 7) break;
      }
      return out;
    }
  }
  const named = [...new Set(t.split(/[^a-zçáàâãéêíóôõú]+/).map(day).filter((d): d is number => d !== null))];
  return named.length ? named.sort((x, y) => x - y) : null;
}

export function parseBusinessSheet(text: string): Sheet {
  const statements: Record<string, unknown> = {};
  const notes: string[] = [];
  const unread: Unread[] = [];
  const items: SheetItem[] = [];
  const faq: { q: string; a: string }[] = [];
  const never: string[] = [];
  const principles: { id: string; text: string; stage?: string; check?: string }[] = [];
  let section: 'services' | 'questions' | 'never' | 'principles' | null = null;
  let pendingQ: { q: string; line: number } | null = null;
  let hours: string | null = null;

  const addItem = (body: string, n: number, line: string): void => {
    if (section === 'services') {
      const item = readItem(body);
      if (item) items.push(item);
    } else if (section === 'never') {
      never.push(body);
    } else if (section === 'principles') {
      // `- [stage] the rule | check: name`; the stage and the check are optional, and a name the framework does not offer is listed, never guessed.
      let text = body;
      let stage: string | undefined;
      let check: string | undefined;
      const st = /^\[([^\]]*)\]\s*(.*)$/.exec(text);
      if (st) {
        stage = st[1]!.trim().toLowerCase();
        text = st[2]!.trim();
      }
      const ck = /\|\s*check\s*:\s*([^|]+?)\s*$/i.exec(text);
      if (ck) {
        check = ck[1]!.trim().toLowerCase();
        text = text.slice(0, ck.index).trim();
      }
      if (text === '') unread.push({ line: n, text: line, why: 'a principle needs its rule in words' });
      else if (stage !== undefined && !(PRINCIPLE_STAGES as readonly string[]).includes(stage)) unread.push({ line: n, text: line, why: `"${stage}" is not a stage (${PRINCIPLE_STAGES.join(', ')})` });
      else if (check !== undefined && !(check in PRINCIPLE_CHECKS)) unread.push({ line: n, text: line, why: `"${check}" is not a check the framework offers (${Object.keys(PRINCIPLE_CHECKS).join(', ')})` });
      else principles.push({ id: `P${principles.length + 1}`, text, ...(stage ? { stage } : {}), ...(check ? { check } : {}) });
    } else {
      const asked = /^(?:q|p|pergunta|question)\s*:\s*(.*)$/i.exec(body);
      const answered = /^(?:a|r|resposta|answer)\s*:\s*(.*)$/i.exec(body);
      if (asked) pendingQ = { q: asked[1]!.trim(), line: n };
      else if (answered && pendingQ) {
        faq.push({ q: pendingQ.q, a: answered[1]!.trim() });
        pendingQ = null;
      } else if (body.includes('|')) {
        const [q, ...a] = body.split('|');
        if (q!.trim() && a.join('|').trim()) faq.push({ q: q!.trim(), a: a.join('|').trim() });
        else unread.push({ line: n, text: line, why: 'a question needs an answer after the bar' });
      } else {
        const m = /^(.+?\?)\s+(.+)$/.exec(body);
        if (m) faq.push({ q: m[1]!.trim(), a: m[2]!.trim() });
        else unread.push({ line: n, text: line, why: 'write a question as "question | answer", or "Q:" then "A:" on the next line' });
      }
    }
  };

  const lines = text.split(/\r?\n/);
  lines.forEach((raw, index) => {
    const n = index + 1;
    const trimmed = raw.trim();
    // A form's title (a whole line in bold) is not about the business.
    if (/^\*[^*]*[^*:\s]\*$/.test(trimmed)) return;
    const boldLabel = /^[*_]+[^*_:]{1,40}(?::[*_]+|[*_]+:)/.test(trimmed);
    const line = trimmed.replace(/^[*_]+([^*_:]{1,40}):[*_]+\s*/, '$1: ').replace(/^[*_]+([^*_:]{1,40})[*_]+:\s*/, '$1: ');
    if (line === '' || line.startsWith('#') || /^[-=_*]{3,}$/.test(line)) return;
    const bullet = /^(?:[-*•–]|\d+[.)])\s+(.*)$/.exec(line);
    const continues = section === 'questions' && /^(?:q|p|a|r|pergunta|resposta|question|answer)\s*:/i.test(line);
    let labelled = bullet || continues ? null : /^([^:|]{1,40}?)\s*:\s*(.*)$/.exec(clean(line));
    // Inside a list, "Cut: 25 EUR" is a list line; only a label the sheet knows (or one the form wrote in bold) ends the list.
    if (labelled && section !== null && !boldLabel && labelled[2]!.trim() !== '' && !KNOWN.includes(fold(clean(labelled[1]!)))) labelled = null;

    if (labelled) {
      const label = clean(labelled[1]!);
      const value = labelled[2]!.trim();
      if (isLabel(label, IGNORED)) return;
      const opens = isLabel(label, SERVICES) ? 'services' : isLabel(label, QUESTIONS) ? 'questions' : isLabel(label, PRINCIPLES) ? 'principles' : isLabel(label, NEVER) ? 'never' : null;
      if (value === '' || opens) {
        if (opens === null) {
          section = null;
          unread.push({ line: n, text: line, why: `"${label}" opens a list but is not a list the sheet knows (services, questions, principles, never)` });
          return;
        }
        section = opens;
        pendingQ = null;
        // A form puts the first line after the label; the rest follow on their own lines.
        if (value !== '') addItem(value, n, line);
        return;
      }
      section = null;
      if (isLabel(label, NAME)) {
        statements['business.name'] = value;
        notes.push(`name: ${value}`);
      } else if (isLabel(label, TONE)) {
        statements['tone.style'] = value;
        notes.push(`tone: ${value}`);
      } else {
        const asked = ASKED.find((a) => isLabel(label, a.labels));
        if (asked?.q === 'What are your opening hours?') hours = value;
        faq.push({ q: asked?.q ?? `${label}?`, a: value });
        if (!asked) notes.push(`"${label}" is not a label the sheet knows; kept as an answer to "${label}?"`);
      }
      return;
    }
    if (section !== null) {
      addItem((bullet ? bullet[1]! : line).trim(), n, line);
      return;
    }
    unread.push({ line: n, text: line, why: 'not a "Label: value" line and not in a list' });
  });
  if (pendingQ) unread.push({ line: (pendingQ as { line: number }).line, text: `Q: ${(pendingQ as { q: string }).q}`, why: 'a question with no answer line after it' });

  if (items.length) {
    statements['offer.items'] = items;
    notes.push(`${items.length} item${items.length === 1 ? '' : 's'}, ${items.filter((i) => i.price === undefined).length} without a price`);
  }
  if (faq.length) {
    statements['faq.entries'] = faq;
    notes.push(`${faq.length} answer${faq.length === 1 ? '' : 's'} for customers`);
  }
  if (principles.length) {
    statements['rules.principles'] = principles;
    notes.push(`${principles.length} principle${principles.length === 1 ? '' : 's'}, ${principles.filter((p) => p.check).length} held in code`);
  }
  if (never.length) {
    statements['rules.commitments'] = never;
    notes.push(`${never.length} thing${never.length === 1 ? '' : 's'} the bot never says or promises`);
  }
  const days = hours === null ? null : daysFromHours(hours);
  statements['offer.availability'] = days ? { days } : {};
  notes.push(days ? `opening days read from the hours line: ${days.join(',')} (0 = Sunday)` : 'opening days not read: availability is not checked, the hours answer has the client\'s own words');

  const missing = (['business.name', 'offer.items', 'tone.style', 'rules.commitments', 'faq.entries'] as const).filter((k) => statements[k] === undefined);
  return { statements, notes, unread, missing };
}

const ASK: Record<string, string> = {
  'business.name': 'Name:',
  'offer.items': 'Services: (one line each: name | price | note)',
  'tone.style': 'Tone: (how the business talks)',
  'rules.commitments': 'Never: (what the bot must never say or promise)',
  'faq.entries': 'Questions: (what customers always ask, with your answer)',
};

/** What to ask the client next, in the sheet's own words. */
export function missingAsks(missing: readonly string[]): string[] {
  return missing.map((k) => ASK[k] ?? k);
}
