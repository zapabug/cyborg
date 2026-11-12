import type { BlockedFact, FactProvider, ProfileStore, ResolvedFacts, RuntimeFactSource } from '@cyborg/core';
import { GRADE_RANK, packFactIsStale, type PackRegistry } from './packs.ts';
import { effectiveStatus } from './status.ts';

/**
 * PRF-4, PRF-5, PRF-12, PRF-13, PRF-57: hands the runner only the declared keys, and only the
 * facts whose status allows them into a prompt in the current mode.
 */
export class ProfileFactProvider implements FactProvider {
  constructor(
    private readonly profile: ProfileStore,
    private readonly packs: PackRegistry,
    /** CMP-27: facts an add-on supplies at run time (who is on duty, a job sheet, a GPS feed), not stored in the profile. */
    private readonly runtime: Readonly<Record<string, RuntimeFactSource>> = {},
  ) {
    for (const [key, source] of Object.entries(runtime)) {
      if ((source.class as string) !== 'public' && (source.class as string) !== 'deal') throw new Error(`runtime fact "${key}" must be public or deal, not ${String(source.class)} (PRV-2)`);
    }
  }

  resolve(request: Parameters<FactProvider['resolve']>[0]): ReturnType<FactProvider['resolve']> {
    const blocked: BlockedFact[] = [];
    const facts: ResolvedFacts = { profile: [], pack: [] };

    for (const key of request.profileKeys) {
      const live = this.runtime[key];
      if (live) {
        let reading: ReturnType<RuntimeFactSource['read']>;
        try {
          reading = live.read(request.now);
        } catch (error) {
          blocked.push({ kind: 'profile', key, reason: `the add-on failed: ${(error as Error).message}` });
          continue;
        }
        if (!reading) {
          blocked.push({ kind: 'profile', key, reason: 'the add-on has no data right now' });
        } else if (live.maxAgeMs !== null && request.now.getTime() - new Date(reading.asOf).getTime() > live.maxAgeMs) {
          blocked.push({ kind: 'profile', key, reason: `stale: the add-on's data is from ${reading.asOf}, older than ${Math.round(live.maxAgeMs / 60_000)} min` });
        } else {
          // A fact that can go stale carries its time into the prompt, so the model and the reader see how fresh it is.
          const value = live.maxAgeMs === null ? reading.sentence : `${reading.sentence} (as of ${reading.asOf})`;
          facts.profile.push({ key, value, class: live.class, status: 'confirmed', runtime: true, asOf: reading.asOf });
        }
        continue;
      }
      const fact = this.profile.getFact(key);
      if (!fact) {
        blocked.push({ kind: 'profile', key, reason: 'missing' });
        continue;
      }
      const status = effectiveStatus(fact, request.now);
      const allowed = request.mode === 'shadow' ? status === 'unconfirmed' || status === 'confirmed' : status === 'confirmed';
      if (!allowed) {
        blocked.push({ kind: 'profile', key, reason: `${status}, not allowed in ${request.mode} mode` });
        continue;
      }
      facts.profile.push({ key, value: fact.value, class: fact.class, status });
    }

    for (const { key, minGrade } of request.packFacts) {
      const fact = this.packs.get(key);
      if (!fact) {
        blocked.push({ kind: 'pack', key, reason: 'missing' });
      } else if (fact.grade === 'unverified') {
        blocked.push({ kind: 'pack', key, reason: 'grade unverified never feeds a prompt' });
      } else if (packFactIsStale(fact, request.now)) {
        blocked.push({ kind: 'pack', key, reason: `stale since ${fact.reviewBy}` });
      } else if (GRADE_RANK[fact.grade] < Math.max(GRADE_RANK[minGrade], GRADE_RANK.secondary)) {
        blocked.push({ kind: 'pack', key, reason: `grade ${fact.grade} is below the required ${minGrade}` });
      } else {
        facts.pack.push({ key, value: fact.value, grade: fact.grade, sourceUrl: fact.sourceUrl });
      }
    }

    return blocked.length > 0 ? { ok: false, blocked } : { ok: true, facts };
  }
}
