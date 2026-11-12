// PRV-6: the scrubber runs on every `freetext` field before a prompt is built. Rules
// for phone, email, IBAN, NIF pattern and ID number pattern. `scrub` detects; `redact`
// replaces every hit with a placeholder so the model call goes ahead without the data
// (zapa, 2026-11-08). A hit records the rule and the field, never the matched text,
// because the matched text is an identity value (PRV-2). Names inside free text cannot
// be detected (PRV-7).

export interface ScrubRule {
  id: string;
  pattern: RegExp;
  /** A match counts only when this agrees (a card number must pass the Luhn check). */
  valid?: (match: string) => boolean;
}

/** The Luhn check digit test for a payment card number, on digits only. */
export function luhn(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}


export const SCRUB_RULES: readonly ScrubRule[] = [
  { id: 'email', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/ },
  // IBAN: two letters, two check digits, then 11 to 30 letters or digits, optionally in groups of four.
  // A payment card number (PRV-6b): 13 to 19 digits in one run or in groups of 4 to 6, and it passes the Luhn check.
  { id: 'card', pattern: /\b\d{4,6}(?:[ -]\d{4,6}){2,4}\b|\b\d{13,19}\b/, valid: (m) => luhn(m.replace(/[ -]/g, '')) },
  { id: 'iban', pattern: /\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]{4}){2,7}(?:[ -]?[A-Z0-9]{1,4})?\b/ },
  // International phone numbers: +351 912 345 678, 00351 ...
  { id: 'phone', pattern: /(?:\+|\b00)\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,4}){2,4}/ },
  // Portuguese ID (cartão de cidadão): 8 digits, check digit, two letters, a digit.
  { id: 'id_number', pattern: /\b\d{8}[\s-]?\d[\s-]?[A-Z]{2}\d\b/ },
  // Passport-style numbers: one or two letters then 6 to 8 digits.
  { id: 'id_number', pattern: /\b[A-Z]{1,2}\d{6,8}\b/ },
  // Nine digits in one run or in groups of three: a Portuguese NIF or a national phone number.
  { id: 'nif_or_phone', pattern: /\b\d{3}[\s.-]?\d{3}[\s.-]?\d{3}\b/ },
  // Any other long digit run (account, document or card numbers).
  { id: 'long_number', pattern: /\b\d{8,}\b/ },
];

export interface ScrubHit {
  rule: string;
  /** Character offsets, so a person can find the spot without the value being copied anywhere. */
  start: number;
  end: number;
}

export function scrub(text: string): ScrubHit[] {
  const hits: ScrubHit[] = [];
  for (const rule of SCRUB_RULES) {
    const global = new RegExp(rule.pattern.source, 'g');
    for (const match of text.matchAll(global)) {
      if (rule.valid && !rule.valid(match[0])) continue;
      hits.push({ rule: rule.id, start: match.index, end: match.index + match[0].length });
    }
  }
  return hits.sort((a, b) => a.start - b.start || a.rule.localeCompare(b.rule));
}

/** The word a placeholder carries for each rule. */
const KIND: Record<string, string> = { email: 'EMAIL', card: 'CARD', iban: 'IBAN', phone: 'PHONE', nif_or_phone: 'NUMBER', id_number: 'ID', long_number: 'NUMBER' };

/** Matches a placeholder `redact` made, so a draft that repeats one can be flagged. */
export const PLACEHOLDER = /\[(?:EMAIL|CARD|IBAN|PHONE|ID|NUMBER)_\d+\]/g;

export interface Redaction {
  text: string;
  /** One entry per replaced span: the rule that matched first and the placeholder put in. Never the matched text. */
  replaced: { rule: string; placeholder: string }[];
}

/**
 * PRV-6: replaces every scrubber hit with `[KIND_n]` (numbered per kind, from `counters` so one call can span several fields). Overlapping hits
 * (a nine-digit number is also a phone pattern) become one placeholder. The original is not kept here: it stays in the chat.
 */
export function redact(text: string, counters: Record<string, number> = {}): Redaction {
  const hits = scrub(text);
  const spans: { start: number; end: number; rule: string }[] = [];
  for (const h of hits) {
    const last = spans.at(-1);
    if (last && h.start < last.end) {
      last.end = Math.max(last.end, h.end);
      continue;
    }
    spans.push({ start: h.start, end: h.end, rule: h.rule });
  }
  let out = '';
  let at = 0;
  const replaced: Redaction['replaced'] = [];
  for (const span of spans) {
    const kind = KIND[span.rule] ?? 'NUMBER';
    counters[kind] = (counters[kind] ?? 0) + 1;
    const placeholder = `[${kind}_${counters[kind]}]`;
    out += text.slice(at, span.start) + placeholder;
    at = span.end;
    replaced.push({ rule: span.rule, placeholder });
  }
  return { text: out + text.slice(at), replaced };
}
