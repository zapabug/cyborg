import { staffMessages, type ControlStore, type LanguageSource, type MorningSection } from '@cyborg/core';

const RULE = '────────────────────────────────────────';

export interface MorningInput {
  /** In the order a person should work them. Each module supplies its own (ADM-59). */
  sections: readonly MorningSection[];
  control: Pick<ControlStore, 'listOpenWaiting'>;
  now?: () => Date;
  /** ADM-77: the sheet's own words (head, headings, "nothing pending"). Default English at this level. */
  language?: LanguageSource;
}

/** ADM-57: customers still waiting for a person, unless an earlier section already shows that chat. Always the last section. */
export function waitingSection(control: Pick<ControlStore, 'listOpenWaiting'>, shownElsewhere: (chat: string) => boolean = () => false, language?: LanguageSource): MorningSection {
  return {
    get heading() {
      return staffMessages(language).sheet.waitingPerson;
    },
    blocks: () => {
      const m = staffMessages(language);
      return control
        .listOpenWaiting()
        .filter((w) => !shownElsewhere(w.chat))
        .map((w) => `${m.card.spec}: ${m.sheet.waitingTitle(w.chat)}\n${m.card.state}: ${m.sheet.waitingDetail(w.since, w.lastCustomerAt)}`);
    },
  };
}

/** ADM-57, ADM-59: the sheet a person reads first on arriving at the desk, in zapa's Status layout. */
export function renderMorningSheet(input: MorningInput): string {
  const now = (input.now ?? (() => new Date()))();
  const m = staffMessages(input.language);
  const all = [...input.sections, waitingSection(input.control, (chat) => input.sections.some((s) => s.blocks().some((b) => b.includes(chat))), input.language)];
  const parts = all.map((s) => ({ heading: s.heading, blocks: s.blocks() }));
  const head = `${m.sheet.morning}: ${now.toISOString().slice(0, 10)} · ${parts.map((p) => `${p.heading}: ${p.blocks.length}`).join(' · ')}`;
  const blocks = parts.flatMap((p) => p.blocks);
  return [head, RULE, ...(blocks.length ? [blocks.join(`\n${RULE}\n`)] : [m.sheet.nothing])].join('\n');
}
