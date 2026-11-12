import { effectiveStatus, type ProfileStore } from '@cyborg/core';

export { effectiveStatus };

/** PRF-54: persists `confirmed -> stale` for every fact past its review date. Returns the keys moved. */
export function markStaleFacts(store: ProfileStore, now: Date, actor = 'system'): string[] {
  const moved: string[] = [];
  for (const fact of store.listFacts()) {
    if (fact.status === 'confirmed' && effectiveStatus(fact, now) === 'stale') {
      store.moveFact(fact.key, 'stale', { actor, at: now.toISOString(), reason: `reviewBy ${fact.reviewBy} has passed` });
      moved.push(fact.key);
    }
  }
  return moved;
}
