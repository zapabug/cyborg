// docs/05 GWY-28..31: what a company's inference is costing, from its own prompt ledger, and the cap on model calls.

export interface UsageRow {
  at: string;
  handlerId: string;
  handlerVersion: string;
  model: string | null;
  endpoint: string | null;
  /** As the provider returned it. */
  usage: unknown;
  error: string | null;
}

/** GWY-28: a model call is a ledger row with an endpoint; a failed attempt is a call too, because the provider counted it. */
export interface UsageStore {
  usageRows(since: string): UsageRow[];
  countModelCalls(since: string): number;
}

/** GWY-30: per million tokens, in the company's own currency. Set by the installer from the provider's price page; never guessed. */
export type Prices = Readonly<Record<string, { inputPerMillion: number; outputPerMillion: number; currency: string }>>;

export interface UsageTotals {
  calls: number;
  failed: number;
  promptTokens: number;
  completionTokens: number;
  /** Calls whose response carried no token counts, so the totals above are a floor. */
  callsWithoutUsage: number;
}

export interface UsageReport {
  since: string;
  until: string;
  totals: UsageTotals;
  byDay: ({ day: string } & UsageTotals)[];
  byModel: ({ model: string } & UsageTotals)[];
  byHandler: ({ handlerId: string } & UsageTotals)[];
  /** Null when no prices were given. Otherwise the cost of the models that have a price, and the models that do not. */
  cost: { currency: string; amount: number; unpricedModels: string[] } | null;
  cap: { maxPer24h: number; usedLast24h: number } | null;
}

const empty = (): UsageTotals => ({ calls: 0, failed: 0, promptTokens: 0, completionTokens: 0, callsWithoutUsage: 0 });

const tokens = (usage: unknown): { prompt: number; completion: number } | null => {
  if (typeof usage !== 'object' || usage === null) return null;
  const u = usage as Record<string, unknown>;
  const prompt = u['prompt_tokens'] ?? u['input_tokens'];
  const completion = u['completion_tokens'] ?? u['output_tokens'];
  return typeof prompt === 'number' && typeof completion === 'number' ? { prompt, completion } : null;
};

function add(into: UsageTotals, row: UsageRow): void {
  into.calls += 1;
  if (row.error !== null) into.failed += 1;
  const t = tokens(row.usage);
  if (t) {
    into.promptTokens += t.prompt;
    into.completionTokens += t.completion;
  } else into.callsWithoutUsage += 1;
}

function group<K extends string>(rows: readonly UsageRow[], key: (row: UsageRow) => string, name: K): ({ [P in K]: string } & UsageTotals)[] {
  const map = new Map<string, UsageTotals>();
  for (const row of rows) {
    const k = key(row);
    const totals = map.get(k) ?? empty();
    add(totals, row);
    map.set(k, totals);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, totals]) => ({ [name]: k, ...totals }) as { [P in K]: string } & UsageTotals);
}

/** GWY-29, GWY-30: no estimate is invented. A model without a price is named, not costed. */
export function buildUsageReport(rows: readonly UsageRow[], options: { since: string; until: string; prices?: Prices; cap?: { maxPer24h: number; usedLast24h: number } }): UsageReport {
  const inRange = rows.filter((r) => r.endpoint !== null && r.at >= options.since && r.at <= options.until);
  const totals = empty();
  for (const row of inRange) add(totals, row);
  const byModel = group(inRange, (r) => r.model ?? '(unknown)', 'model');
  let cost: UsageReport['cost'] = null;
  if (options.prices && Object.keys(options.prices).length > 0) {
    const currencies = new Set(Object.values(options.prices).map((p) => p.currency));
    if (currencies.size !== 1) throw new Error('prices in more than one currency cannot be added up');
    let amount = 0;
    const unpriced: string[] = [];
    for (const m of byModel) {
      const price = options.prices[m.model];
      if (!price) unpriced.push(m.model);
      else amount += (m.promptTokens / 1e6) * price.inputPerMillion + (m.completionTokens / 1e6) * price.outputPerMillion;
    }
    cost = { currency: [...currencies][0]!, amount, unpricedModels: unpriced };
  }
  return { since: options.since, until: options.until, totals, byDay: group(inRange, (r) => r.at.slice(0, 10), 'day'), byModel, byHandler: group(inRange, (r) => r.handlerId, 'handlerId'), cost, cap: options.cap ?? null };
}

const line = (label: string, t: UsageTotals) =>
  `${label}: ${t.calls} calls, ${t.failed} failed, ${t.promptTokens} in / ${t.completionTokens} out${t.callsWithoutUsage ? ` (${t.callsWithoutUsage} without token counts)` : ''}`;

/** GWY-29: the report in zapa's Status layout, for the installer and the company's admin. */
export function formatUsageReport(report: UsageReport): string {
  const rule = '────────────────────────────────────────';
  const blocks = [
    `Spec: usage ${report.since.slice(0, 10)} to ${report.until.slice(0, 10)}\nState: ${line('total', report.totals).replace(/^total: /, '')}`,
    `Spec: by day\nState: ${report.byDay.map((d) => line(d.day, d)).join('\n       ') || 'no calls'}`,
    `Spec: by model\nState: ${report.byModel.map((m) => line(m.model, m)).join('\n       ') || 'no calls'}`,
    `Spec: by handler\nState: ${report.byHandler.map((h) => line(h.handlerId, h)).join('\n       ') || 'no calls'}`,
    `Spec: cost\nState: ${
      report.cost
        ? `${report.cost.amount.toFixed(4)} ${report.cost.currency}${report.cost.unpricedModels.length ? `, not including ${report.cost.unpricedModels.join(', ')} (no price set)` : ''}`
        : 'not shown: no prices set (--prices)'
    }`,
    `Spec: call cap\nState: ${report.cap ? `${report.cap.usedLast24h} of ${report.cap.maxPer24h} used in the last 24 hours` : 'no cap set'}`,
  ];
  return blocks.join(`\n${rule}\n`);
}
