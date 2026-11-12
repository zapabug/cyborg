import type { DataClass } from './data-class.ts';
import { scrub, type ScrubHit } from './scrubber.ts';

export class PromptSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromptSafetyError';
  }
}

/**
 * A value that may be placed in a prompt (PRV-3, HR-2). The private field makes the
 * type nominal: a plain string, or any value of class `identity` or `secret`, does not
 * typecheck where a `PromptSafe` is required, and the class check at run time
 * (`instanceof`) rejects a cast.
 */
export class PromptSafe {
  readonly #brand = true;
  private constructor(readonly text: string) {}

  /** The only ways to make one: a `public` or `deal` value, or free text the scrubber passed. */
  static ofPublicOrDeal(cls: 'public' | 'deal', value: unknown): PromptSafe {
    return PromptSafe.make(cls, value);
  }

  static ofScrubbedFreetext(text: string): PromptSafe | { hits: ScrubHit[] } {
    const hits = scrub(text);
    return hits.length > 0 ? { hits } : new PromptSafe(text);
  }

  /** Run-time classification for a declared field (PRV-3): identity, secret and undeclared throw. */
  static fromField(
    cls: DataClass | undefined,
    field: string,
    value: unknown,
  ): PromptSafe | { hits: ScrubHit[] } {
    if (cls === 'public' || cls === 'deal') return PromptSafe.make(cls, value);
    if (cls === 'freetext') {
      if (typeof value !== 'string') throw new PromptSafetyError(`freetext field "${field}" is not a string`);
      return PromptSafe.ofScrubbedFreetext(value);
    }
    throw new PromptSafetyError(
      cls === undefined
        ? `field "${field}" has no declared data class and cannot reach a prompt (PRV-3)`
        : `field "${field}" is class "${cls}" and cannot reach a prompt (HR-2)`,
    );
  }

  private static make(cls: string, value: unknown): PromptSafe {
    if (cls !== 'public' && cls !== 'deal') throw new PromptSafetyError(`class "${cls}" is not prompt-safe`);
    return new PromptSafe(typeof value === 'string' ? value : JSON.stringify(value));
  }

  static is(value: unknown): value is PromptSafe {
    return value instanceof PromptSafe;
  }
}
