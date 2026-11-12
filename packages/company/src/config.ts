import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import { CHAT_ROLES, scheduleProblems, STAFF_LANGUAGES, WEEKDAYS, type OfficeSchedule, type Prices } from '@cyborg/core';
import { bookingsConfigSchema } from '@cyborg/module-bookings';
import { maintenanceConfigSchema } from '@cyborg/module-maintenance';
import { humanClaimHits, salesConfigSchema } from '@cyborg/module-sales';
import { TOAST_DETAILS } from './board.ts';

// docs/12 CMP-1..8: one file per company says how this install is wired. It never holds a key (L16).

const pricesSchema = z.record(z.string(), z.object({ inputPerMillion: z.number().nonnegative(), outputPerMillion: z.number().nonnegative(), currency: z.string().min(1) }));

export const companyConfigSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'a lower-case id such as "my-business"'),
  name: z.string().min(1),
  /** ADM-77: the language the system speaks to the people who run the business (toasts, ops-chat cards, command replies, cards, the morning sheet). Portuguese unless set; `.lang pt|en` switches it at run time. */
  language: z.enum(STAFF_LANGUAGES).default('pt'),
  /** CMP-2: shadow until a person has gone through the live gate (PRF-18). */
  mode: z.enum(['shadow', 'live']).default('shadow'),
  store: z.object({
    /** Relative paths are taken from the folder the config file is in. */
    path: z.string().min(1),
    vaultPath: z.string().min(1),
  }),
  inference: z.object({
    baseUrl: z.string().url(),
    /** The name of the environment variable that holds the company's own key. */
    apiKeyEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'the NAME of an environment variable such as OPENROUTER_API_KEY, never the key').optional(),
    timeoutMs: z.number().int().positive().optional(),
    providerOptions: z.record(z.string(), z.unknown()).optional(),
    /** Reasoning-mode options per model name (GWY-6): how a thinking model is asked to think. */
    reasoning: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
    /** The model every handler uses unless `handlers` says otherwise. */
    model: z.string().min(1),
    /** CMP-3: a chat model for one handler, a thinking model for another. */
    handlers: z.record(z.string(), z.object({ model: z.string().min(1) })).optional(),
  }),
  /**
   * ADM-60: when the office is staffed, and the days it is closed. It tells the bot whether to assume a person is there; it does not
   * stop the bot, and a person may answer at any hour. Without it the bot assumes a person is always there unless `.ooo` says not.
   */
  office: z.object({
    timezone: z.string().min(1),
    hours: z.partialRecord(z.enum(WEEKDAYS), z.array(z.string())).default({}),
    closedDates: z.array(z.string()).default([]),
    /** ADM-64: out of hours, a handoff card is built after each customer message and sent to the ops chat. */
    cardsOutsideHours: z.boolean().default(true),
  }).optional(),
  /**
   * ADM-71: the sentences the bot is given about who is at the office. Plain, one line, at most 300 characters. `{note}` stands for the
   * staff note or the time the office is back. Leave a line out to keep the built-in English wording.
   */
  wording: z.object({
    onDuty: z.string().min(1).max(300).optional(),
    outOfOffice: z.string().min(1).max(300).optional(),
    outOfOfficeWithNote: z.string().min(1).max(300).optional(),
  }).default({}),
  /**
   * ADM-96, N-20: when a kind of reply has been right often enough to show as a candidate for automation: at least `minRight` of the last
   * `of` replies a person judged. The default is zapa's example, 9 of 10. It only flags; nothing is switched on by it.
   */
  automation: z.object({
    candidate: z.object({ minRight: z.number().int().positive(), of: z.number().int().positive() }).refine((c) => c.minRight <= c.of, 'minRight cannot be more than of').default({ minRight: 9, of: 10 }),
  }).default({ candidate: { minRight: 9, of: 10 } }),
  /** N-19: when a chat nobody has answered counts as stale (yellow). Unset: nothing is flagged stale. */
  board: z.object({ staleAfterHours: z.number().positive().optional() }).default({}),
  /** ADM-83: what a toast shows. A toast can be seen by anyone near the screen, so a company may hide the name and the summary. */
  toast: z.object({ detail: z.enum(TOAST_DETAILS).default('name_and_summary') }).default({ detail: 'name_and_summary' }),
  limits: z.object({ maxModelCallsPer24h: z.number().int().positive().optional() }).default({}),
  prices: pricesSchema.optional(),
  chat: z.object({
    commandPrefix: z.string().min(1).default('.'),
    /** Opaque sender references (ADM-34) allowed to give commands. */
    authorisedSenders: z.array(z.string().min(1)).default([]),
    /** N-14, in hours; unset means the 12 h default. */
    handoffResumeHours: z.number().positive().optional(),
    /** The real channel in a shadow run: nothing is ever sent here (PRF-15). */
    originChannel: z.string().min(1).optional(),
    /** Initial roles by opaque chat reference; later changes are `.role` commands. */
    roles: z.record(z.string(), z.enum(CHAT_ROLES as [string, ...string[]])).default({}),
  }).default({ commandPrefix: '.', authorisedSenders: [], roles: {} }),
  modules: z.object({
    sales: salesConfigSchema.omit({ extraDraftChecks: true }).optional(),
    feedback: z.object({}).optional(),
    /** feat WZP-50..55: the booking funnel. It needs the sales module with `conversationContext` on, so the reply can state what the code computed. */
    bookings: bookingsConfigSchema.optional(),
    /** feat WZP-60: the team-chat maintenance watch (no model call). The assets come from the profile fact `fleet.assets`. */
    maintenance: maintenanceConfigSchema.optional(),
    /** Handler ids that are on; absent means every handler of a loaded module. */
    enabledHandlers: z.record(z.string(), z.array(z.string())).optional(),
  }).default({}),
});

export type CompanyConfig = z.infer<typeof companyConfigSchema>;

export interface LoadedConfig {
  config: CompanyConfig;
  /** Absolute paths, resolved against the config file's folder. */
  paths: { store: string; vault: string };
  file: string;
}

const looksLikeKey = /\b(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{12,})/;

export function loadCompanyConfig(file: string): LoadedConfig {
  const text = readFileSync(file, 'utf8');
  if (looksLikeKey.test(text)) throw new Error(`${file}: the file contains something that looks like an API key. Put the key in an environment variable and name it in inference.apiKeyEnv (CMP-1).`);
  if (text.includes('<fill in')) throw new Error(`${file}: still has "<fill in" in it; fill in every marked value first`);
  const parsed = companyConfigSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new Error(`${file}:\n${parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(file)'}: ${i.message}`).join('\n')}`);
  }
  const config = parsed.data;
  const here = dirname(resolve(file));
  const abs = (p: string) => (isAbsolute(p) ? p : resolve(here, p));
  return { config, paths: { store: abs(config.store.path), vault: abs(config.store.vaultPath) }, file: resolve(file) };
}

export interface ConfigCheck {
  errors: string[];
  warnings: string[];
}

/** CMP-4..6: what must be true before this install can go live, and what is only worth a look. Pure: it reads nothing but its arguments. */
export function checkCompanyConfig(config: CompanyConfig, env: NodeJS.ProcessEnv = process.env): ConfigCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { inference, limits, chat } = config;

  if (inference.apiKeyEnv && !env[inference.apiKeyEnv]) warnings.push(`inference.apiKeyEnv: ${inference.apiKeyEnv} is not set in this environment, so a call to a paid endpoint will be rejected`);
  if (!inference.apiKeyEnv && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(inference.baseUrl)) warnings.push('inference.apiKeyEnv: not set, and the endpoint is not on this machine');

  // PRV-7 (audit 2026-11-03): customer free text can carry names the scrubber cannot see, so a chat install on a model off this machine is said out loud
  const localEndpoint = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(inference.baseUrl);
  if (!localEndpoint && Object.values(chat.roles).includes('reply')) warnings.push('inference.baseUrl: customer chats are connected and the endpoint is not on this machine. Names written inside a customer\'s message reach that provider, because the scrubber cannot detect them (PRV-7); keep the replies as drafts a person reads, and tell the company');

  if (config.office) for (const problem of scheduleProblems(config.office as OfficeSchedule)) errors.push(`office: ${problem}`);
  else warnings.push('office: not set, so the bot assumes a person is always at the office unless someone sends the out-of-office command');
  // ADM-71, ADM-72: every text the company can rewrite is held to the same rules as the bot's own drafts.
  const persona = config.modules.sales?.persona;
  const texts: [string, string | undefined][] = [
    ['wording.onDuty', config.wording.onDuty], ['wording.outOfOffice', config.wording.outOfOffice], ['wording.outOfOfficeWithNote', config.wording.outOfOfficeWithNote],
    ...Object.entries(typeof persona?.intro === 'object' ? persona.intro : { all: persona?.intro }).map(([l, t]): [string, string | undefined] => [`modules.sales.persona.intro${l === 'all' ? '' : `.${l}`}`, t]),
    ...Object.entries(typeof persona?.testNotice === 'object' ? persona.testNotice : { all: persona?.testNotice }).map(([l, t]): [string, string | undefined] => [`modules.sales.persona.testNotice${l === 'all' ? '' : `.${l}`}`, t]),
  ];
  for (const [where, text] of texts) {
    if (text === undefined) continue;
    if (/[\r\n]/.test(text)) errors.push(`${where}: must be one line`);
    if (humanClaimHits(text, config.modules.sales?.humanClaimPhrases ?? []).length > 0) errors.push(`${where}: says or implies the bot is a person, which a customer-facing text must not do`);
  }
  if (config.wording.outOfOffice?.includes('{note}')) warnings.push('wording.outOfOffice: has {note}, but this line is used when there is no note; put it in outOfOfficeWithNote');
  if (config.wording.outOfOfficeWithNote && !config.wording.outOfOfficeWithNote.includes('{note}')) warnings.push('wording.outOfOfficeWithNote: has no {note}, so the note or the time the office is back is never shown');
  if (config.board.staleAfterHours === undefined) warnings.push('board.staleAfterHours: not set, so chats nobody answers are never flagged stale (yellow). Choose how long a customer may wait (N-19)');
  if (config.modules.sales === undefined && config.modules.feedback === undefined && config.modules.maintenance === undefined) errors.push('modules: switch at least one module on (sales, feedback or maintenance)');
  if (config.modules.maintenance && !Object.values(chat.roles).includes('monitor')) warnings.push('modules.maintenance: no chat has the monitor role yet, so nothing is watched (choose the team chats in Configure)');
  if (config.modules.bookings && !config.modules.sales?.conversationContext) errors.push('modules.bookings: needs modules.sales with conversationContext: true, or the reply cannot state the quote the code computed'); 

  const pricedModels = new Set(Object.keys(config.prices ?? {}));
  const usedModels = new Set([inference.model, ...Object.values(inference.handlers ?? {}).map((h) => h.model)]);
  for (const m of usedModels) if (config.prices && !pricedModels.has(m)) warnings.push(`prices: no price for "${m}", so the usage report cannot cost it`);
  if (!config.prices) warnings.push('prices: not set, so the usage report shows tokens but no cost');

  if (limits.maxModelCallsPer24h === undefined) {
    (config.mode === 'live' ? errors : warnings).push('limits.maxModelCallsPer24h: not set. A live install must have a call cap (GWY-31); set it from the company\'s inference budget');
  }
  if (chat.authorisedSenders.length === 0) (config.mode === 'live' ? errors : warnings).push('chat.authorisedSenders: nobody can give a command (.stop, .ooo, .done), so nobody can stop the bot');
  if (config.mode === 'shadow' && !chat.originChannel) warnings.push('chat.originChannel: not set. Shadow output could then be sent to the real channel; set it so the guard can refuse that (PRF-15)');
  if (!Object.values(chat.roles).includes('ops') && !chat.authorisedSenders.length) warnings.push('chat.roles: no ops chat, so alerts and cards go only to the dashboard list');
  if (config.mode === 'live') warnings.push('mode live: the live gate (N-7 and the checklist) is checked per handler at run time; this file cannot prove it passed');
  return { errors, warnings };
}

export type { Prices };
