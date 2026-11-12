import { officeStatus, presenceSentence, presenceWording, type Language, type OfficeSchedule, type Presence } from '@cyborg/core';
import { humanClaimHits, introText, testNoticeText } from '@cyborg/module-sales';
import type { CompanyConfig } from './config.ts';

/**
 * ADM-73: every text the code adds on the company's behalf, as a customer or the bot would meet it, so it can be read and edited
 * before anything goes live. `pnpm company wording <file>` prints this. Texts the config cannot change yet are listed last.
 */
export function describeWording(config: CompanyConfig, now: Date = new Date()): { where: string; text: string }[] {
  const lang = () => config.language;
  const w = presenceWording(config.wording, lang);
  const persona = config.modules.sales?.persona;
  const business = '<business name>';
  const fill = (t: string) => t.replaceAll('{name}', persona?.name ?? '').replaceAll('{business}', business);
  const out: { where: string; text: string }[] = [
    { where: 'wording.onDuty   (given to the bot when the office is staffed)', text: w.onDuty },
    { where: 'wording.outOfOffice   (no note)', text: w.outOfOffice },
    { where: 'wording.outOfOfficeWithNote   ({note} is a staff note or the time the office is back)', text: w.outOfOfficeWithNote.replaceAll('{note}', 'back Monday 09:00') },
  ];
  if (config.office) {
    const closed = officeStatus(null, config.office as OfficeSchedule, new Date('2000-01-01T03:00:00Z'), config.wording, lang);
    out.push({ where: 'what the bot hears at 03:00 with no toggle (from the schedule)', text: closed.sentence });
  }
  const manual: Presence = { state: 'out_of_office', label: 'at the dentist', since: now.toISOString(), by: 'owner' };
  out.push({ where: 'what the bot hears after ".ooo at the dentist"', text: presenceSentence(manual, config.wording, lang) });
  if (config.modules.sales) {
    const sales = config.modules.sales;
    const langs: Language[] = [...new Set<Language>([sales.defaultLanguage, 'pt', 'en', ...(Object.keys(typeof persona?.intro === 'object' ? persona.intro : {}) as Language[])])];
    if (persona?.disclosure === 'none') out.push({ where: 'modules.sales.persona.disclosure   (what a customer is told)', text: 'nothing: no introduction and no notice; if a customer asks whether it is a person or a bot, the answer is truthful and plain' });
    for (const lang of langs) {
      if (persona?.disclosure !== undefined && persona.disclosure !== 'none') out.push({ where: `modules.sales.persona.intro [${lang}]   (first message of a chat written in ${lang}, added by code)`, text: fill(introText(sales.persona, lang)) });
      if (persona?.disclosure === 'testing') out.push({ where: `modules.sales.persona.testNotice [${lang}]   (every draft in testing mode)`, text: fill(testNoticeText(sales.persona, lang)) });
    }
    const extra = sales.humanClaimPhrases;
    out.push({ where: 'modules.sales.humanClaimPhrases   (a draft containing one is blocked; the built-in English and Portuguese patterns always apply)', text: extra.length ? extra.map((p) => `"${p}"`).join(', ') : '(none added)' });
  }
  const bad = out.filter((o) => !o.where.startsWith('modules.sales.humanClaimPhrases') && humanClaimHits(o.text, config.modules.sales?.humanClaimPhrases ?? []).length > 0);
  for (const b of bad) b.text += '   <-- MUST CHANGE: this says or implies the bot is a person';
  return out;
}

/** Texts the company cannot change from the config yet (they are in the code and need a code change to edit). */
export const FIXED_TEXTS: string[] = [
  'the staff-facing sentences (ops-chat prefixes, alerts, command replies, the card and sheet words) come in Portuguese and English and switch with .lang, but are not edited per company; a change to them is a code change',
  'the explanations of a blocked draft and the shadow-review lines, which are English for now (ADM-80)',
  'the prompts of the handlers (change their guidance with approved lessons, which are versioned and replayed, or edit the handler)',
];
