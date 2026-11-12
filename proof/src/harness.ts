import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CORE_VERSION,
  PRESENCE_FACT_KEY,
  presenceFactSource,
  HandlerRegistry,
  loadModules,
  Runner,
  type CapabilityResult,
  type ModelPort,
} from '@cyborg/core';
import { PackRegistry, ProfileFactProvider } from '@cyborg/profile';
import { salesModule } from '@cyborg/module-sales';
import { SqliteStore, SqliteVault } from '@cyborg/store-sqlite';

export interface Consumer {
  name: string;
  /** The module config for this consumer: the only thing allowed to differ (MOD-7). */
  config: unknown;
  /** Real inputs, read from run-time paths by the caller (MOD-8). */
  messages: string[];
  /** Words that identify this consumer; finding one in the module source is a special case. */
  identifiers: string[];
}

export interface SpecialCase {
  consumer: string;
  where: 'module-source' | 'run';
  detail: string;
}

export interface ConsumerReport {
  consumer: string;
  messages: number;
  handlers: string[];
  outcomes: Record<string, number>;
}

export interface ProofReport {
  consumers: ConsumerReport[];
  /** MOD-7: every place module code needed a special case. The target is none. */
  specialCases: SpecialCase[];
  /** Config differences are expected and are not special cases. */
  configKeysUsed: string[];
}

/** Module source files, for the special-case scan. */
export function moduleSources(dir: string): { path: string; text: string }[] {
  return readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => ({ path: join(dir, f), text: readFileSync(join(dir, f), 'utf8') }));
}

const capability: CapabilityResult = {
  baseUrl: 'proof', model: 'proof', level: 'strict_schema', requestShape: 'json_schema_wrapped', logprobs: false, testedAt: '1970-01-01T00:00:00.000Z', attempts: [],
};

/**
 * MOD-7: runs the same sales module code, with each consumer's config, over each consumer's real
 * messages, and records every special case. The model is a parameter: a real gateway for the real proof.
 * Only the intake handler runs here; the reply handler needs a consumer's confirmed profile facts.
 */
export async function runProof(options: {
  consumers: Consumer[];
  model: ModelPort;
  sourceFiles: { path: string; text: string }[];
}): Promise<ProofReport> {
  const specialCases: SpecialCase[] = [];
  const reports: ConsumerReport[] = [];

  for (const consumer of options.consumers) {
    for (const word of consumer.identifiers) {
      const pattern = new RegExp(`\\b${word}\\b`, 'i');
      for (const file of options.sourceFiles) {
        file.text.split('\n').forEach((line, i) => {
          if (pattern.test(line)) specialCases.push({ consumer: consumer.name, where: 'module-source', detail: `${file.path}:${i + 1} mentions "${word}"` });
        });
      }
    }

    const store = new SqliteStore(':memory:');
    const vault = new SqliteVault(':memory:');
    const registry = new HandlerRegistry({ autoReplyHandlers: [] });
    const report = loadModules(registry, [salesModule], {
      coreVersion: CORE_VERSION, profile: { getFact: () => ({ key: 'proof' }) as never }, packs: [], capabilities: [capability],
      connectors: { channel: {}, contacts: {} },
      dependencyChecks: { 'connector:channel': () => ({ ok: true }), 'connector:contacts': () => ({ ok: true }) },
      moduleConfig: { sales: consumer.config },
      config: { sales: { enabledHandlers: ['sales.enquiry.intake'] } },
    });
    if (report.refused.length > 0) {
      specialCases.push({ consumer: consumer.name, where: 'run', detail: `the module was refused: ${JSON.stringify(report.refused[0]!.unmet)}` });
      continue;
    }
    const runner = new Runner({
      businessId: consumer.name, registry, store, ledger: store, model: options.model, vault,
      facts: new ProfileFactProvider(store, new PackRegistry(), { [PRESENCE_FACT_KEY]: presenceFactSource(store) }), mode: 'shadow',
    });
    const outcomes: Record<string, number> = {};
    for (const [i, text] of consumer.messages.entries()) {
      try {
        const results = await runner.handle({ id: `${consumer.name}-${i}`, source: consumer.name, kind: 'message.received', at: new Date().toISOString(), payload: { text, sender: `${consumer.name}-sender-${i}` } });
        for (const r of results) {
          const key = r.outcome === 'proposal' ? `proposal:${r.proposal.status}${r.proposal.reason ? ` (${r.proposal.reason})` : ''}` : r.outcome;
          outcomes[key] = (outcomes[key] ?? 0) + 1;
        }
      } catch (error) {
        specialCases.push({ consumer: consumer.name, where: 'run', detail: `message ${i} threw: ${(error as Error).message}` });
      }
    }
    reports.push({ consumer: consumer.name, messages: consumer.messages.length, handlers: report.loaded.flatMap((l) => l.handlerIds), outcomes });
    store.close();
    vault.close();
  }
  return { consumers: reports, specialCases, configKeysUsed: ['enquiryFields'] };
}

export function renderProof(report: ProofReport): string {
  const lines = ['Two-consumer proof (MOD-7)'];
  for (const c of report.consumers) {
    lines.push(`\n${c.consumer}: ${c.messages} real messages, handlers ${c.handlers.join(', ')}`);
    for (const [k, n] of Object.entries(c.outcomes)) lines.push(`  ${k}: ${n}`);
  }
  lines.push(`\nSpecial cases the module needed: ${report.specialCases.length}`);
  for (const s of report.specialCases) lines.push(`  [${s.consumer}] ${s.where}: ${s.detail}`);
  return lines.join('\n');
}
