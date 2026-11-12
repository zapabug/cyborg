import type { ResolvedFacts } from '@cyborg/core';

// SAL-2: statements of price, date and capacity in a drafted reply are checked in code against the
// profile, whatever the model wrote (PRF-6). SAL-5: a draft that sounds like a commitment is blocked.

const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  domingo: 0, segunda: 1, 'segunda-feira': 1, terça: 2, 'terça-feira': 2, terca: 2, quarta: 3, 'quarta-feira': 3,
  quinta: 4, 'quinta-feira': 4, sexta: 5, 'sexta-feira': 5, sábado: 6, sabado: 6,
};

const BUILT_IN_COMMITMENTS: RegExp[] = [
  /\bbooking (is |has been )?confirmed\b/i,
  /\bconfirm(ed)? your (booking|reservation|spot|place)\b/i,
  /\byou('| a)?re (all )?(booked|set|confirmed)\b/i,
  /\b(i|we)('ve| have) (booked|reserved)\b/i,
  /\breserved for you\b/i,
  /\b(?:booked|reserved) (?:a|an|the|your|you|it|that|this)\b/i,
  /^\W*(?:booked|reserved|confirmed)\b/i,
  /\b(?:reserv[aá]mos|marc[aá]mos|agend[aá]mos)\b/i,
  /\bpayment (has been )?(received|confirmed)\b/i,
  /\b(i|we) (promise|guarantee)\b/i,
  /\bguaranteed\b/i,
  /\breserva confirmada\b/i,
  /\bficou reservad[oa]\b/i,
  /\best[aá] reservad[oa]\b/i,
  /\bgarantimos\b/i,
  /\bpagamento (recebido|confirmado)\b/i,
  // ADM-114: a booking said in other words.
  /\block(?:ed|ing)?(?: it| that| this| you| them| your \w+| the date| the slot| a slot)? in\b/i,
  /\b(?:book|booked|pencil|penciled|penciled) you in\b/i,
  /\bgot you (?:booked|down|in)\b/i,
  /\b(?:i|we)(?:'ll| will) hold (?:the|a|that|your) (?:date|slot|spot|place|booking)\b/i,
];

// ADM-113: the bot never says it did something it did not do, and never promises its own follow-up; the team coming back is said as the team's.
const ACTION_CLAIMS: RegExp[] = [
  /\b(?:i|we)(?:'ve| have) sent (?:a|an|the|your) (?:request|booking|reservation|enquiry|inquiry|message|email)\b/i,
  /\b(?:request|booking|reservation) (?:has been|was) (?:sent|submitted|placed|made)\b/i,
  /\bj[aá] enviei (?:o|um|a|uma) (?:pedido|reserva|mensagem)\b/i,
  /\b(?:i|we)(?:'ll| will) (?:check back|get back to you|let you know|chase|follow up with (?:them|the team))\b/i,
  /\b(?:vou|voltamos?) (?:voltar a contactar|dar-lhe (?:uma )?resposta)\b/i,
];

// CMP-32: the bot is never to claim to be a person, whatever the persona's voice. Matched in code on every draft.
const HUMAN_CLAIMS: RegExp[] = [
  /\bI(?:'m| am) (?:a |an )?(?:real |actual |normal )?(?:human|person|human being)\b/i,
  /\b(?:I(?:'m| am)|this is) not (?:a |an )?(?:bot|robot|AI|machine|chatbot|automated)\b/i,
  /\bsou (?:uma )?(?:pessoa|humano|humana)\b/i,
  /\bn[ãa]o sou (?:um |uma )?(?:bot|rob[ôo]|IA|m[áa]quina|assistente autom[áa]tic[oa])/i,
];

export function humanClaimHits(draft: string, extra: readonly string[] = []): string[] {
  const hits = HUMAN_CLAIMS.filter((p) => p.test(draft)).map((p) => `matches the human-claim pattern ${p.source}`);
  const lower = draft.toLowerCase();
  for (const phrase of extra) if (lower.includes(phrase.toLowerCase())) hits.push(`contains the business's human-claim phrase "${phrase}"`);
  return hits;
}

export function commitmentHits(draft: string, extra: readonly string[]): string[] {
  const hits = BUILT_IN_COMMITMENTS.filter((p) => p.test(draft)).map((p) => `matches the commitment pattern ${p.source}`);
  hits.push(...ACTION_CLAIMS.filter((p) => p.test(draft)).map((p) => `says it did or will do something itself, which the bot does not (matches ${p.source})`));
  const lower = draft.toLowerCase();
  for (const phrase of extra) if (lower.includes(phrase.toLowerCase())) hits.push(`contains the business's commitment phrase "${phrase}"`);
  return hits;
}

const num = (s: string): number => Number(s.replace(',', '.'));

export function extractPrices(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(?:€|eur\s?)\s?(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s?(?:€|eur\b|euros?\b)/gi)) out.push(num((m[1] ?? m[2])!));
  return out;
}

export function extractCapacities(text: string): number[] {
  return [...text.matchAll(/\b(\d+)\s*(?:people|persons|pax|guests|passengers|seats|places|pessoas|lugares)\b/gi)].map((m) => Number(m[1]));
}

export function extractWeekdays(text: string): number[] {
  return weekdayClauses(text).map((w) => w.weekday);
}

/** The words that make a clause a statement of closure, in English and Portuguese (ADM-112). */
const NEGATION = /\b(?:closed|not|no|never|except|unavailable|fechad[oa]s?|encerrad[oa]s?|n[ãa]o|sem)\b|n't\b/i;
/** "Every day", "daily", "including weekends": a claim about all seven days, which is false when the business lists fewer (ADM-112). */
const EVERY_DAY = /\b(?:every ?day|seven days|7 days|7\/7|daily|all week|including (?:the )?weekends?|weekends? too|todos os dias|sete dias|todos os dias da semana|inclusive aos fins de semana)\b/i;
/** The narrower set: a clause that says the business is shut (used to catch "closed on Monday" when Monday is a running day). */
const CLOSURE = /\b(?:closed|not open|fechad[oa]s?|encerrad[oa]s?)\b|\b(?:isn't|aren't|is not|are not|n[ãa]o est[áa]|n[ãa]o estamos|n[ãa]o abrimos|n[ãa]o abre)\s+(?:open|aberto|abertos|abertas|a funcionar)\b/i;

const dayOf = (word: string): number | undefined => WEEKDAYS[word] ?? (word.endsWith('s') ? WEEKDAYS[word.slice(0, -1)] : undefined);

/** The clause around `at` in `text`: it ends at . ! ? ; , a line break, a dash, or but / mas / however. */
function clauseAround(text: string, at: number): string {
  const seps = /[.!?;:,\n—–]|\b(?:but|mas|however)\b/gi;
  let start = 0;
  let end = text.length;
  for (const m of text.matchAll(seps)) {
    if (m.index + m[0].length <= at) start = m.index + m[0].length;
    else if (m.index >= at) {
      end = m.index;
      break;
    }
  }
  return text.slice(start, end);
}

/** Every weekday named in `text` (singular or plural, English or Portuguese) with the clause it is named in. */
export function weekdayClauses(text: string): { weekday: number; clause: string }[] {
  const out: { weekday: number; clause: string }[] = [];
  const lower = text.toLowerCase();
  for (const m of lower.matchAll(/[a-zçáéíóúãõâêô-]+/g)) {
    const weekday = dayOf(m[0]);
    if (weekday !== undefined) out.push({ weekday, clause: clauseAround(text, m.index) });
  }
  return out;
}

export function extractIsoDates(text: string): { iso: string; weekday: number; monthDay: string }[] {
  return [...text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)].map((m) => ({
    iso: m[0],
    weekday: new Date(`${m[0]}T12:00:00Z`).getUTCDay(),
    monthDay: `${m[2]}-${m[3]}`,
  }));
}

interface Item {
  name?: unknown;
  price?: unknown;
  /** True: `price` is a starting price. A draft that gives it says "from" (feat-tailored). */
  priceFrom?: unknown;
  capacity?: unknown;
  /** The weekdays (0 = Sunday) this item runs. An empty list means any day. Absent means the business-wide `offer.availability.days` applies. */
  days?: unknown;
  /** Other words a customer or a draft uses for this item, besides its name. */
  keywords?: unknown;
}

const wordIn = (text: string, word: string): boolean => new RegExp(`(^|[^\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'iu').test(text);

/** The items a draft names, by name or by one of their keywords. */
export function itemsNamedIn(draft: string, list: readonly Item[]): Item[] {
  return list.filter((i) => [i.name, ...(Array.isArray(i.keywords) ? i.keywords : [])].some((w) => typeof w === 'string' && w.trim() !== '' && wordIn(draft, w.trim())));
}

/** Returns one failure message per statement that the profile does not support. */
/**
 * The topics the business listed as unknown that the customer raised and no profile fact covers: those must go to the office. A topic is covered when
 * any of its words appears in the facts the draft was written from.
 */
export function officeTopicFailures(customerText: string, facts: ResolvedFacts, topics: readonly { label: string; words: readonly string[] }[]): string[] {
  if (topics.length === 0) return [];
  const known = facts.profile.map((f) => JSON.stringify(f.value)).join('\n');
  const has = (text: string, word: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${word.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'iu').test(text);
  return topics
    .filter((t) => t.words.some((w) => has(customerText, w)) && !t.words.some((w) => has(known, w)))
    .map((t) => `the customer asks about ${t.label}, which the business's facts do not cover`);
}

const FROM_WORD = /(^|[^\p{L}])(from|starting at|as low as|desde|a partir de|a começar em|ab|dès|à partir de)($|[^\p{L}])/iu;

const PER_PERSON = /\b\d+(?:[.,]\d+)?\s*(?:€|eur\b|euros?\b)?\s*(?:per person|per head|a head|each|por pessoa|pro person|par personne)\b/i;

/**
 * Rules the company's own code states in the facts it computed for a chat (a line `Rule: ...`), held in code because a model may ignore a sentence:
 * no price before the group size is known, and a per-person price only together with the total.
 */
export function conversationRuleFailures(draft: string, computed: string): string[] {
  const failures: string[] = [];
  if (/^Rule: state no price yet\./m.test(computed) && (extractPrices(draft).length > 0 || PER_PERSON.test(draft))) failures.push('states a price before the group size is known');
  const total = /^Rule: state the total (\d+(?:[.,]\d+)?)/m.exec(computed)?.[1];
  if (total !== undefined && PER_PERSON.test(draft) && !draft.includes(total)) failures.push(`gives a per-person price without the total (${total})`);
  return failures;
}

/** `computed` is text the company's own code made for this chat (a quote's total): the amounts in it are allowed beside the profile's prices (WZP-51). */
export function profileStatementFailures(draft: string, facts: ResolvedFacts, computed = ''): string[] {
  const get = (key: string): unknown => facts.profile.find((f) => f.key === key)?.value;
  const failures: string[] = [];

  const items = get('offer.items');
  const list: Item[] = Array.isArray(items) ? (items as Item[]) : [];
  const prices = new Set([...list.map((i) => i.price).filter((p): p is number => typeof p === 'number'), ...extractPrices(computed)]);
  const capacities = list.map((i) => i.capacity).filter((c): c is number => typeof c === 'number');

  for (const price of extractPrices(draft)) {
    if (!prices.has(price)) failures.push(`price ${price} is not a price in offer.items`);
  }
  // A starting price is never stated as a flat one: an amount that only starting-price items have needs a "from" word in the draft.
  const startingOnly = (p: number): boolean => list.some((i) => i.price === p && i.priceFrom === true) && !list.some((i) => i.price === p && i.priceFrom !== true) && !extractPrices(computed).includes(p);
  if (!FROM_WORD.test(draft)) for (const price of extractPrices(draft)) if (startingOnly(price)) failures.push(`price ${price} is a starting price: the draft must say "from"`);
  // ADM-113: the reverse: a price that no item lists as a starting price is not written "from" (a flat price shown as a floor).
  const FROM_BEFORE_PRICE = /(?:^|[^\p{L}])(?:from|starting at|as low as|desde|a partir de|a começar em)\s*(?:€\s?|eur\s?)?(\d+(?:[.,]\d+)?)/giu;
  for (const m of draft.matchAll(FROM_BEFORE_PRICE)) {
    const price = num(m[1]!);
    if (prices.has(price) && !list.some((i) => i.price === price && i.priceFrom === true) && !extractPrices(computed).includes(price)) failures.push(`price ${price} is a fixed price: the draft must not say "from"`);
  }
  for (const n of extractCapacities(draft)) {
    if (capacities.length === 0) failures.push(`the draft states a capacity (${n}) but offer.items has none`);
    else if (n > Math.max(...capacities)) failures.push(`capacity ${n} is more than offer.items allows (${Math.max(...capacities)})`);
  }

  const availability = get('offer.availability') as { days?: unknown; closedDates?: unknown } | undefined;
  const globalDays = Array.isArray(availability?.days) ? (availability!.days as number[]) : null;
  const closed = Array.isArray(availability?.closedDates) ? (availability!.closedDates as string[]) : [];
  // ADM-100: a day named beside an offer item must be a day that item runs. With items named, only their days count; with none named,
  // any item's days count; an item with no days of its own falls back to the business-wide list.
  const named = itemsNamedIn(draft, list);
  const pool = named.length > 0 ? named : list;
  const ownDays = (i: Item): number[] | null => (Array.isArray(i.days) ? (i.days as number[]) : null);
  const perItem = pool.length > 0 && pool.every((i) => ownDays(i) !== null);
  const days: number[] | null = perItem ? (pool.some((i) => ownDays(i)!.length === 0) ? [0, 1, 2, 3, 4, 5, 6] : [...new Set(pool.flatMap((i) => ownDays(i)!))]) : globalDays;
  const where = perItem && named.length > 0 ? `a running day of ${named.map((i) => String(i.name)).join(' or ')}` : 'in offer.availability.days';
  // ADM-112: saying a day is closed is a correct answer. A non-running day passes in a clause that says it is closed; a running day in a clause that says it is closed does not.
  for (const { weekday, clause } of weekdayClauses(draft)) {
    if (!days) failures.push('the draft names a day but offer.availability lists no days');
    else if (!days.includes(weekday)) {
      if (!NEGATION.test(clause)) failures.push(`weekday ${weekday} is not ${where}`);
    } else if (CLOSURE.test(clause)) failures.push(`the draft says weekday ${weekday} is closed, but it is ${where}`);
  }
  if (days && days.length < 7) {
    for (const m of draft.matchAll(new RegExp(EVERY_DAY.source, 'gi'))) {
      if (!NEGATION.test(clauseAround(draft, m.index))) failures.push(`the draft says it is open every day, but ${where} lists only ${days.length} days`);
    }
  }
  for (const d of extractIsoDates(draft)) {
    const clause = clauseAround(draft, draft.indexOf(d.iso));
    const saysClosed = NEGATION.test(clause);
    if (days && !days.includes(d.weekday) && !saysClosed) failures.push(`${d.iso} falls on weekday ${d.weekday}, which is not ${where}`);
    if (closed.includes(d.monthDay) && !saysClosed) failures.push(`${d.iso} is a closed date (${d.monthDay})`);
  }
  return [...new Set(failures)];
}

/**
 * PRF-28b grounding: numbers in a draft that neither the customer's message nor a supplied profile
 * fact contains. Prices, capacities, weekdays and dates are checked harder elsewhere; this catches the
 * rest (a pick-up time, a duration, a distance). Returns the untraced numbers.
 */
export function untracedNumbers(draft: string, customerText: string, facts: ResolvedFacts): string[] {
  const known = `${customerText}\n${facts.profile.map((f) => JSON.stringify(f.value)).join('\n')}`;
  const knownTokens = new Set(known.match(/\d+(?:[.,:]\d+)*/g) ?? []);
  // A time the facts give as 09:00 or 19:00 is also traced when the draft writes it as "9", "9 AM", "7 PM" or "7:00".
  for (const m of known.matchAll(/\b(\d{1,2}):(\d{2})\b/g)) {
    const hour = Number(m[1]);
    const twelve = hour % 12 === 0 ? 12 : hour % 12;
    for (const h of [String(hour), String(hour).padStart(2, '0'), String(twelve)]) {
      knownTokens.add(h);
      knownTokens.add(`${h}:${m[2]}`);
    }
  }
  const found = draft.match(/\d+(?:[.,:]\d+)*/g) ?? [];
  return [...new Set(found.filter((n) => !knownTokens.has(n)))];
}


// ---- feat-desk DK2 / DSK-7..12: the company's principles --------------------------------------------------------------------------------------
/** The stages of a conversation a principle may be tied to (DSK-8). The stage is set by code, never by the model. */
export const PRINCIPLE_STAGES = ['greet', 'qualify', 'offer', 'close', 'handoff'] as const;

const PRESSURE = /\b(?:hurry|last chance|limited time|don'?t miss|act now|selling fast|before it'?s gone|only \d+ (?:left|spots|places|seats)|corra|[úu]ltima oportunidade|n[ãa]o perca|por tempo limitado)\b/i;

/** DSK-9: the checkable rules the framework offers; a business picks one by name for a principle. Each returns why the draft breaks it, or null. */
export const PRINCIPLE_CHECKS: Record<string, { describes: string; test: (draft: string) => string | null }> = {
  'ends-with-a-question': {
    describes: 'the reply ends with a question',
    test: (d) => (/\?[\s"'’)*_\p{Extended_Pictographic}\uFE0F]*$/u.test(d.trim()) ? null : 'the reply does not end with a question'),
  },
  'one-question-only': {
    describes: 'the reply asks one question at most',
    test: (d) => ((d.match(/\?/g) ?? []).length > 1 ? 'the reply asks more than one question' : null),
  },
  'no-pressure-words': {
    describes: 'the reply does not press the customer ("hurry", "last chance", "only 3 left")',
    test: (d) => (PRESSURE.test(d) ? 'the reply presses the customer' : null),
  },
};

export interface Principle {
  id?: unknown;
  text?: unknown;
  stage?: unknown;
  check?: unknown;
}

/** The principles written for this stage: a principle with no stage applies at every stage (DSK-8). */
export function principlesForStage(principles: unknown, stage: string): Principle[] {
  return (Array.isArray(principles) ? (principles as Principle[]) : []).filter((p) => p && typeof p === 'object' && (p.stage === undefined || p.stage === stage));
}

/** DSK-9: a checkable principle that fails blocks the draft like any failed check, and names the principle. */
export function principleFailures(draft: string, facts: ResolvedFacts, stage: string): string[] {
  const principles = facts.profile.find((f) => f.key === 'rules.principles')?.value;
  const failures: string[] = [];
  for (const p of principlesForStage(principles, stage)) {
    const rule = typeof p.check === 'string' ? PRINCIPLE_CHECKS[p.check] : undefined;
    const why = rule?.test(draft);
    if (why) failures.push(`principle ${String(p.id ?? '?')} is broken (${String(p.text ?? '')}): ${why}`);
  }
  return failures;
}
