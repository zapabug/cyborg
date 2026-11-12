import type { CapabilityResult, PackGradeValue, ProfileStore } from '@cyborg/core';
import { GRADE_RANK, packFactIsStale, type PackRegistry } from './packs.ts';
import { effectiveStatus } from './status.ts';

export interface ModuleRequirement {
  moduleId: string;
  profileKeys: readonly string[];
  packFacts?: readonly { key: string; minGrade: PackGradeValue }[];
}

export interface ModuleReport {
  moduleId: string;
  missing: string[];
  unconfirmed: string[];
  contradicted: string[];
  stale: string[];
  packIssues: { key: string; reason: string }[];
}

export interface OnboardingReport {
  generatedAt: string;
  modules: ModuleReport[];
  capabilities: CapabilityResult[];
  openDiscrepancies: number;
}

/** PRF-3: per module, which required keys are missing, unconfirmed, contradicted or stale. No score. */
export function onboardingReport(input: {
  profile: ProfileStore;
  packs: PackRegistry;
  modules: readonly ModuleRequirement[];
  capabilities: readonly CapabilityResult[];
  now: Date;
}): OnboardingReport {
  const modules = input.modules.map((module): ModuleReport => {
    const report: ModuleReport = { moduleId: module.moduleId, missing: [], unconfirmed: [], contradicted: [], stale: [], packIssues: [] };
    for (const key of module.profileKeys) {
      const fact = input.profile.getFact(key);
      if (!fact) {
        report.missing.push(key);
        continue;
      }
      const status = effectiveStatus(fact, input.now);
      if (status === 'unconfirmed') report.unconfirmed.push(key);
      else if (status === 'contradicted') report.contradicted.push(key);
      else if (status === 'stale') report.stale.push(key);
    }
    for (const { key, minGrade } of module.packFacts ?? []) {
      const fact = input.packs.get(key);
      if (!fact) report.packIssues.push({ key, reason: 'missing' });
      else if (fact.grade === 'unverified') report.packIssues.push({ key, reason: 'unverified: open question only' });
      else if (packFactIsStale(fact, input.now)) report.packIssues.push({ key, reason: `stale since ${fact.reviewBy}` });
      else if (GRADE_RANK[fact.grade] < GRADE_RANK[minGrade]) report.packIssues.push({ key, reason: `grade ${fact.grade} below ${minGrade}` });
    }
    return report;
  });
  return {
    generatedAt: input.now.toISOString(),
    modules,
    capabilities: [...input.capabilities],
    openDiscrepancies: input.profile.listDiscrepancies('open').length,
  };
}

export function renderOnboardingReport(report: OnboardingReport): string {
  const lines = [`Onboarding report, ${report.generatedAt}`];
  for (const m of report.modules) {
    lines.push(`\nModule ${m.moduleId}`);
    const section = (label: string, items: string[]) => lines.push(`  ${label} (${items.length})${items.length ? ': ' + items.join(', ') : ''}`);
    section('missing', m.missing);
    section('unconfirmed', m.unconfirmed);
    section('contradicted', m.contradicted);
    section('stale', m.stale);
    section('pack issues', m.packIssues.map((p) => `${p.key} [${p.reason}]`));
  }
  lines.push('\nEndpoint capabilities');
  for (const c of report.capabilities) lines.push(`  ${c.baseUrl} ${c.model}: ${c.level}${c.requestShape ? ` (${c.requestShape})` : ''}, log-probabilities ${c.logprobs ? 'yes' : 'no'}, tested ${c.testedAt}`);
  if (report.capabilities.length === 0) lines.push('  none tested');
  lines.push(`\nOpen discrepancies: ${report.openDiscrepancies}`);
  return lines.join('\n');
}
