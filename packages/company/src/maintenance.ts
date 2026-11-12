import type { CyborgEvent, Proposal } from '@cyborg/core';
import { assetsIn, hitsFor, HIT_EVENT, issuesIn, RECORD_HANDLER_ID, redact, type Asset, type MaintenanceConfig, type Seen } from '@cyborg/module-maintenance';
import type { Company } from './runtime.ts';

// feat WZP-60..62: the maintenance watch in the company layer. A message in a team chat the bot only reads (role `monitor`) is scanned in code for an asset and
// a problem; a hit becomes a maintenance record for a person to deal with. The raw message is never stored: the buffer that joins nearby messages is in memory,
// holds ids and words only, and a record keeps a scrubbed snippet. No model call.

const MODULE = 'maintenance';
const OPEN: Proposal['status'][] = ['proposed', 'approved'];

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** The business's assets, from the profile fact `fleet.assets`: an array of `{ id, label?, identifiers, aliases, consumables? }`. */
export function assetsOf(company: Company): Asset[] {
  const value = company.store.getFact('fleet.assets')?.value;
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): Asset[] => {
    const a = raw as Record<string, unknown>;
    if (typeof a['id'] !== 'string' || a['id'] === '') return [];
    return [{
      id: a['id'], ...(typeof a['label'] === 'string' ? { label: a['label'] } : {}),
      identifiers: isStrings(a['identifiers']) ? a['identifiers'] : [], aliases: isStrings(a['aliases']) ? a['aliases'] : [],
      ...(isStrings(a['consumables']) ? { consumables: a['consumables'] } : {}),
    }];
  });
}

interface RecordState {
  mentions: number;
  lastAt: string;
  scheduledFor?: string;
}

const records = (company: Company): Proposal[] => company.store.list({ handlerId: RECORD_HANDLER_ID }).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
const field = (p: Proposal, name: string): string => String(p.changes.find((c) => c.field === name)?.newValue ?? '');
const stateOf = (company: Company, id: string): RecordState | null => company.store.getModuleState<RecordState>(MODULE, id)?.value ?? null;

export interface WatchOptions {
  config: MaintenanceConfig;
  now?: () => Date;
}

export function withMaintenance(company: Company, options: WatchOptions): Company {
  if (!company.registry.get(RECORD_HANDLER_ID)) return company;
  const now = options.now ?? (() => new Date());
  const { config } = options;
  const buffer = new Map<string, Seen[]>();

  return {
    ...company,
    async process(event: CyborgEvent) {
      const p = event.payload;
      const text = typeof p['text'] === 'string' ? p['text'] : '';
      const chat = typeof p['chat'] === 'string' ? p['chat'] : '';
      if (event.kind === 'message.received' && text.trim() !== '' && company.store.getRole(chat) === 'monitor' && !company.store.getGlobalStop()) {
        const assets = assetsOf(company);
        const named = assetsIn(text, assets);
        const at = Date.parse(event.at) || now().getTime();
        const seen: Seen = { at, assets: named.map((a) => a.id), issue: issuesIn(text, config.issues, named.flatMap((a) => a.consumables ?? [])) };
        const before = buffer.get(chat) ?? [];
        const hits = hitsFor(seen, before, { messages: config.contextWindowMsgs, ms: config.contextWindowMinutes * 60_000 });
        buffer.set(chat, [...before, seen].slice(-(config.contextWindowMsgs + 1)));
        const snippet = redact(text).slice(0, 200);
        for (const hit of hits) {
          const since = new Date(at - config.dedupHours * 3_600_000).toISOString();
          // The window runs from the record's last mention, in the time the messages carry, so a slow team does not split one problem into many.
          const open = records(company).filter((r) => OPEN.includes(r.status) && field(r, 'asset') === hit.asset && (stateOf(company, r.id)?.lastAt ?? r.createdAt) >= since).at(-1);
          if (open) {
            const state = stateOf(company, open.id) ?? { mentions: 1, lastAt: open.createdAt };
            company.store.setModuleState(MODULE, open.id, { ...state, mentions: state.mentions + 1, lastAt: new Date(at).toISOString() }, 'maintenance:watch', now().toISOString());
            continue;
          }
          const outcomes = await company.runner.handle({
            id: `${event.id}~mnt~${hit.asset}`, source: event.source, kind: HIT_EVENT, at: event.at,
            payload: { chat, asset: hit.asset, priority: hit.priority, terms: hit.terms.join(', '), snippet },
          });
          const made = outcomes.flatMap((o) => (o.outcome === 'proposal' ? [o.proposal] : []))[0];
          if (made) company.store.setModuleState(MODULE, made.id, { mentions: 1, lastAt: new Date(at).toISOString() } satisfies RecordState, 'maintenance:watch', now().toISOString());
        }
      }
      return company.process(event);
    },
  };
}

export type MaintenanceStatus = 'open' | 'scheduled' | 'done' | 'dismissed';
const STATUS: Partial<Record<Proposal['status'], MaintenanceStatus>> = { proposed: 'open', approved: 'scheduled', applied: 'done', declined: 'dismissed' };

export interface MaintenanceRecord {
  id: string;
  ref: string;
  asset: string;
  label: string | null;
  priority: 'high' | 'medium' | 'low';
  issue: string;
  note: string;
  mentions: number;
  lastAt: string;
  scheduledFor: string | null;
  status: MaintenanceStatus;
  createdAt: string;
}

const RANK = { high: 3, medium: 2, low: 1 } as const;

/** WZP-62: every maintenance record, open ones first and the most urgent first among them, with a reference like MNT-000001. */
export function listMaintenance(company: Company): MaintenanceRecord[] {
  const labels = new Map(assetsOf(company).map((a) => [a.id, a.label ?? null]));
  return records(company)
    .map((p, i): MaintenanceRecord => {
      const s = stateOf(company, p.id);
      return {
        id: p.id, ref: `MNT-${String(i + 1).padStart(6, '0')}`, asset: field(p, 'asset'), label: labels.get(field(p, 'asset')) ?? null, priority: field(p, 'priority') as MaintenanceRecord['priority'],
        issue: field(p, 'issue'), note: field(p, 'note'), mentions: s?.mentions ?? 1, lastAt: s?.lastAt ?? p.createdAt, scheduledFor: s?.scheduledFor ?? null,
        status: STATUS[p.status] ?? 'dismissed', createdAt: p.createdAt,
      };
    })
    .sort((a, b) => Number(a.status === 'done' || a.status === 'dismissed') - Number(b.status === 'done' || b.status === 'dismissed') || RANK[b.priority] - RANK[a.priority] || b.createdAt.localeCompare(a.createdAt));
}

const must = (company: Company, id: string): Proposal => {
  const p = records(company).find((r) => r.id === id);
  if (!p) throw new Error('that is not a maintenance record');
  return p;
};

/** WZP-62: a person schedules it. The date is the day the work is planned for. */
export function scheduleMaintenance(company: Company, id: string, date: string, by: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new Error('give the date as YYYY-MM-DD');
  const p = must(company, id);
  if (p.status !== 'proposed') throw new Error('only an open record can be scheduled');
  company.decide(id, 'approve', by, { note: `scheduled ${date}` });
  const s = stateOf(company, id) ?? { mentions: 1, lastAt: p.createdAt };
  company.store.setModuleState(MODULE, id, { ...s, scheduledFor: date }, by, new Date().toISOString());
}

/** WZP-62: the work is done. An open record is approved first, then applied. */
export function doneMaintenance(company: Company, id: string, by: string): void {
  const p = must(company, id);
  if (p.status === 'proposed') company.decide(id, 'approve', by, { note: 'done' });
  else if (p.status !== 'approved') throw new Error('that record is already closed');
  company.store.transition(id, 'applied', { actor: by, at: new Date().toISOString() });
}

export function dismissMaintenance(company: Company, id: string, by: string, note?: string): void {
  const p = must(company, id);
  if (p.status !== 'proposed' && p.status !== 'approved') throw new Error('that record is already closed');
  if (p.status === 'approved') throw new Error('a scheduled record is closed with done, not dismissed');
  company.decide(id, 'decline', by, note ? { note } : {});
}

export interface AssetRecord {
  id: string;
  label: string | null;
  open: number;
  total: number;
  lastAt: string | null;
  worst: 'high' | 'medium' | 'low' | null;
}

/** WZP-60: each asset's track record: how many records, how many are open, when it was last mentioned and the most urgent open one. */
export function assetRecords(company: Company): AssetRecord[] {
  const all = listMaintenance(company);
  return assetsOf(company).map((a) => {
    const mine = all.filter((r) => r.asset === a.id);
    const open = mine.filter((r) => r.status === 'open' || r.status === 'scheduled');
    return {
      id: a.id, label: a.label ?? null, open: open.length, total: mine.length, lastAt: mine.map((r) => r.lastAt).sort().at(-1) ?? null,
      worst: open.map((r) => r.priority).sort((x, y) => RANK[y] - RANK[x])[0] ?? null,
    };
  });
}
