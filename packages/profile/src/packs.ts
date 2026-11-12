import { z } from 'zod';
import { GRADE_ORDER, type Pack, type PackFact } from '@cyborg/core';

/** PRF-11: a pack is data only (ARC-4); this schema is how a JSON pack file is validated. */
export const packSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  asOf: z.string().min(1),
  facts: z.array(
    z.object({
      key: z.string().min(1),
      value: z.unknown(),
      grade: z.enum(['checked', 'secondary', 'unverified']),
      sourceUrl: z.string().min(1),
      sourceDate: z.string().min(1),
      asOf: z.string().min(1),
      reviewBy: z.string().min(1).optional(),
    }),
  ),
  openQuestions: z.array(z.string()),
});

export const GRADE_RANK = GRADE_ORDER;

export class PackRegistry {
  private readonly facts = new Map<string, PackFact>();
  readonly packs: Pack[] = [];

  add(input: unknown): Pack {
    const pack = packSchema.parse(input) as Pack;
    for (const fact of pack.facts) {
      if (this.facts.has(fact.key)) throw new Error(`pack fact "${fact.key}" is already defined by another pack`);
    }
    for (const fact of pack.facts) this.facts.set(fact.key, fact);
    this.packs.push(pack);
    return pack;
  }

  get(key: string): PackFact | undefined {
    return this.facts.get(key);
  }

  /** PRF-12: `unverified` facts appear only here, never in a prompt. */
  openQuestions(): { packId: string; text: string }[] {
    return this.packs.flatMap((p) => p.openQuestions.map((text) => ({ packId: p.id, text })));
  }
}

/** PRF-13 */
export function packFactIsStale(fact: PackFact, now: Date): boolean {
  return fact.reviewBy !== undefined && new Date(fact.reviewBy).getTime() < now.getTime();
}
