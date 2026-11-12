import type { Checklist } from '@cyborg/core';
import type { ItemResult } from './checks.ts';
import { AFFECTED_BY } from './items.ts';

/**
 * ADM-21: a handler never passes an item itself. This is the one place a pass is recorded: no findings
 * and enough real traffic. Findings fail the item (with their references); too little traffic changes nothing.
 */
export function recordResults(checklist: Checklist, channel: string, results: readonly ItemResult[], actor: string): { passed: string[]; failed: string[]; unchanged: string[] } {
  const out = { passed: [] as string[], failed: [] as string[], unchanged: [] as string[] };
  for (const r of results) {
    if (r.outcome === 'pass') {
      checklist.pass(channel, r.itemId, 'machine', actor, r.evidence);
      out.passed.push(r.itemId);
    } else if (r.outcome === 'fail') {
      checklist.fail(channel, r.itemId, actor, r.findings.map((f) => `${f.statement} [${f.evidence}]`).join('; '));
      out.failed.push(r.itemId);
    } else out.unchanged.push(r.itemId);
  }
  return out;
}

/** ADM-5, ADM-42: a change to roles, model, endpoint or handler version puts the affected items back to `unchecked`. */
export function invalidateOnChange(checklist: Checklist, channel: string, change: keyof typeof AFFECTED_BY, actor: string): string[] {
  return checklist.invalidate(channel, AFFECTED_BY[change], actor, `${change} changed`).map((r) => r.itemId);
}
