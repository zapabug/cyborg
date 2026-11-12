import { detectLanguage, type Language } from '@cyborg/core';

// ADM-68, ADM-76: the words the code adds around a draft, per language. The company may replace any of them (`persona.intro`,
// `persona.testNotice`, one text or one per language). A language with no text of its own gets the English one, never none.
export const BUILT_IN_INTRO: Partial<Record<Language, { named: string; unnamed: string }>> = {
  pt: { named: 'Olá, sou {name}, a resposta automática de {business}.', unnamed: 'Olá, esta é a resposta automática de {business}.' },
  en: { named: "Hi, I'm {name}, the automatic reply of {business}.", unnamed: 'Hi, this is the automatic reply of {business}.' },
};
export const BUILT_IN_TEST_NOTICE: Partial<Record<Language, string>> = {
  pt: '(Modo de teste: esta é uma resposta automática e um colega revê-a.)',
  en: '(Test mode: this is an automatic reply, and a colleague reviews it.)',
};

type PerLanguage = string | Partial<Record<Language, string>> | undefined;

/** The language the reply is in: the customer's when it can be told, otherwise the company's default. */
export function replyLanguage(customerText: string, defaultLanguage: Language): Language {
  return detectLanguage(customerText)?.lang ?? defaultLanguage;
}

const pick = (value: PerLanguage, lang: Language): string | undefined => (typeof value === 'string' ? value : value?.[lang]);

export function introText(persona: { name?: string | undefined; intro?: PerLanguage }, lang: Language): string {
  const own = pick(persona.intro, lang);
  if (own !== undefined) return own;
  const built = BUILT_IN_INTRO[lang] ?? BUILT_IN_INTRO.en!;
  return persona.name ? built.named : built.unnamed;
}

export function testNoticeText(persona: { testNotice?: PerLanguage }, lang: Language): string {
  return pick(persona.testNotice, lang) ?? BUILT_IN_TEST_NOTICE[lang] ?? BUILT_IN_TEST_NOTICE.en!;
}
