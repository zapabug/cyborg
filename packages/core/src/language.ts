// docs/10 ADM-74..78: which language a customer is writing in, so the reply follows it. A word-list guess made in code, with no
// dependency; it is a safety net beside a model that already handles languages, so it says "unknown" rather than guess.

export const LANGUAGES = ['pt', 'en', 'es', 'fr', 'de', 'it'] as const;
export type Language = (typeof LANGUAGES)[number];

// Only words that belong to one language of the six. Greetings that are shared or mixed in tourists' messages ("bom dia" with the
// rest in English) are left out on purpose: the language of the substance decides, not the greeting.
const WORDS: Record<Language, string> = {
  pt: 'os as uma do da dos das no na nos nas não nao é são sao está estao você voce vocês nós obrigado obrigada quanto custa preço preco passeio passeios gostava gostaria queria queremos temos têm tem quando onde qual quais muito também tambem já ainda ao aos às pelo pela mas amanhã amanha hoje fazer vai vão posso podem pode reserva reservar lugares pessoas crianças criancas',
  en: 'the and is are you your we our to of for with this that what how when where which can could would do does have has not yes please thank thanks price much many about from there they them my be will want like need book available tomorrow today hello people children kids',
  es: 'el los las del es son están cuánto cuanto cuesta precio gracias hola quiero queremos tienen puedo mañana hoy qué cómo cuándo dónde sí reserva niños ninos personas',
  fr: 'les une des est sont pas avec pour bonjour merci combien prix je nous vous voudrais avez demain aujourd hui quelle comment quand oui plaît bonsoir réservation enfants personnes',
  de: 'der die das ein eine und ist sind nicht mit für fuer wie viel kostet preis danke bitte hallo guten tag morgen heute ich wir sie haben möchte moechte können koennen kinder personen',
  it: 'il lo gli di che è sono non per con quanto costa prezzo grazie ciao buongiorno vorrei vorremmo avete posso domani oggi come quando dove prenotare bambini persone',
};
const SETS = Object.fromEntries(LANGUAGES.map((l) => [l, new Set(WORDS[l].split(' '))])) as Record<Language, Set<string>>;
const MARKS: [RegExp, Language][] = [[/[ãõ]/g, 'pt'], [/ñ/g, 'es'], [/ß/g, 'de']];

export interface Detected {
  lang: Language;
  /** Words that matched. At least 2, and at least twice the next language's, or the answer is `null`. */
  score: number;
}

export function detectLanguage(text: string): Detected | null {
  const lower = text.toLowerCase();
  const scores = Object.fromEntries(LANGUAGES.map((l) => [l, 0])) as Record<Language, number>;
  for (const token of lower.match(/\p{L}+/gu) ?? []) for (const l of LANGUAGES) if (SETS[l].has(token)) scores[l] += 1;
  for (const [pattern, l] of MARKS) scores[l] += 2 * (lower.match(pattern)?.length ?? 0);
  const ranked = [...LANGUAGES].sort((a, b) => scores[b] - scores[a]);
  const best = ranked[0]!;
  const second = ranked[1]!;
  if (scores[best] < 2 || scores[best] < 2 * scores[second]) return null;
  return { lang: best, score: scores[best] };
}

/** ADM-75: the reply should be in the language of the customer's message. Null when either side is unclear, so an unclear case is never called wrong. */
export function languageMismatch(customerText: string, draft: string): { customer: Language; draft: Language } | null {
  const c = detectLanguage(customerText);
  const d = detectLanguage(draft);
  return c && d && c.lang !== d.lang ? { customer: c.lang, draft: d.lang } : null;
}
