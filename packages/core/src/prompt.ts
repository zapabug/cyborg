import { PromptSafe, PromptSafetyError } from './prompt-safe.ts';
import { redact, type ScrubHit } from './scrubber.ts';
import type { ResolvedFacts } from './profile-types.ts';
import type { AnyHandler, ModelHandler } from './types.ts';

const SLOT = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/**
 * The prompt builder (PRV-3): it accepts only `PromptSafe` values. Passing anything else
 * fails typechecking, and a value cast past the type system throws here.
 */
export function buildPrompt(template: string, slots: Readonly<Record<string, PromptSafe>>): string {
  return template.replace(SLOT, (_match, slot: string) => {
    const value: unknown = slots[slot];
    if (!PromptSafe.is(value)) {
      throw new PromptSafetyError(`prompt slot "${slot}" was not given a prompt-safe value (PRV-3)`);
    }
    return value.text;
  });
}

export interface ScrubFinding {
  field: string;
  hits: ScrubHit[];
}

/** PRV-6: every `freetext` field of the input is scrubbed, not only those used in a slot. */
export function scrubFreetextFields(handler: AnyHandler, input: Record<string, unknown>): ScrubFinding[] {
  const findings: ScrubFinding[] = [];
  for (const [field, cls] of Object.entries(handler.input.classes)) {
    if (cls !== 'freetext') continue;
    const value = input[field];
    if (typeof value !== 'string') continue;
    const result = PromptSafe.ofScrubbedFreetext(value);
    if ('hits' in result) findings.push({ field, hits: result.hits });
  }
  return findings;
}

export interface FreetextRedaction {
  input: Record<string, unknown>;
  /** What was replaced, per field: the rule and the placeholder, never the matched text. */
  replaced: { field: string; rule: string; placeholder: string }[];
}

/** PRV-6: every `freetext` field is redacted (hits replaced by placeholders); the rest of the input is untouched. */
export function redactFreetextFields(handler: AnyHandler, input: Record<string, unknown>): FreetextRedaction {
  const out: Record<string, unknown> = { ...input };
  const replaced: FreetextRedaction['replaced'] = [];
  const counters: Record<string, number> = {};
  for (const [field, cls] of Object.entries(handler.input.classes)) {
    if (cls !== 'freetext') continue;
    const value = input[field];
    if (typeof value !== 'string') continue;
    const r = redact(value, counters);
    if (r.replaced.length === 0) continue;
    out[field] = r.text;
    for (const x of r.replaced) replaced.push({ field, ...x });
  }
  return { input: out, replaced };
}

/** Classifies the slot fields of a model handler. Call `scrubFreetextFields` first; it throws on a scrubber hit. */
export function promptSlots(handler: ModelHandler, input: Record<string, unknown>): Record<string, PromptSafe> {
  const slots: Record<string, PromptSafe> = {};
  for (const [slot, field] of Object.entries(handler.prompt.slots)) {
    const safe = PromptSafe.fromField(handler.input.classes[field], field, input[field]);
    if ('hits' in safe) throw new PromptSafetyError(`freetext field "${field}" has scrubber hits; the call must not be made`);
    slots[slot] = safe;
  }
  return slots;
}

/** Slots filled from resolved profile and pack facts (PRF-56). Their classes are `public` or `deal`. */
export function factPromptSlots(handler: ModelHandler, facts: ResolvedFacts, input: Record<string, unknown> = {}): Record<string, PromptSafe> {
  const slots: Record<string, PromptSafe> = {};
  for (const [slot, key] of Object.entries(handler.prompt.factSlots ?? {})) {
    const fact = facts.profile.find((f) => f.key === key);
    if (!fact) throw new PromptSafetyError(`profile fact "${key}" was not resolved for slot "${slot}"`);
    const render = handler.prompt.factRender?.[slot];
    slots[slot] = PromptSafe.ofPublicOrDeal(fact.class, render ? render(fact.value, input) : fact.value);
  }
  for (const [slot, key] of Object.entries(handler.prompt.packSlots ?? {})) {
    const fact = facts.pack.find((f) => f.key === key);
    if (!fact) throw new PromptSafetyError(`pack fact "${key}" was not resolved for slot "${slot}"`);
    slots[slot] = PromptSafe.ofPublicOrDeal('public', fact.value);
  }
  return slots;
}
