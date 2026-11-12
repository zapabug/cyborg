import { z } from 'zod';
import { LANGUAGES, type ResolvedFacts } from '@cyborg/core';

/**
 * What an adapter configures for the sales module (MOD-6). The same code serves any business that
 * turns requests into structured enquiries: only these values differ.
 */
export const salesConfigSchema = z.object({
  /** The fields an enquiry is broken into: what the business wants to know about a request. */
  enquiryFields: z.array(z.object({ name: z.string().regex(/^[a-z][a-z0-9_]*$/), description: z.string().min(1) })).min(1),
  /** Extra phrases (case-insensitive) that count as a commitment for this business, on top of the built-in ones (SAL-5). */
  commitmentPhrases: z.array(z.string().min(1)).default([]),
  /**
   * ADM-72: extra phrases (case-insensitive) that count as the bot claiming to be a person, in the customers' language, on top of the
   * built-in English and Portuguese ones. The built-in ones cannot be switched off from the config.
   */
  humanClaimPhrases: z.array(z.string().min(1).max(100)).default([]),
  /**
   * ADM-74: the language to use when the customer's own cannot be told (a one-word message). Replies otherwise follow the customer's
   * language, whatever it is. Portuguese unless the company says otherwise.
   */
  defaultLanguage: z.enum(LANGUAGES).default('pt'),
  /** Ask the model for its own confidence band (PRF-28c). It can only lower the computed band. Off by default. */
  selfAssessment: z.boolean().default(false),
  /**
   * feat WZP-51: the reply handler is given the facts the company's booking step computed for this chat (the offer item, the group size, the day and the
   * total) and may state them. Off, the prompt and the version are as they were.
   */
  conversationContext: z.boolean().default(false),
  /**
   * feat-desk DSK-82: hours of silence after which a chat starts a new chat card (what the customer told us in this chat). Unset: a chat's card is kept until the chat is forgotten.
   * It is the business's number; there is no default (HR-10).
   */
  chatCardIdleHours: z.number().positive().optional(),
  /** feat-desk DK2: the business wrote principles (`rules.principles`): the writer gets those of the conversation's stage, and the checkable ones are held in code. */
  principles: z.boolean().default(false),
  /**
   * Topics the business says the bot does not know. The prompt tells the model to pass them to the office, and the code holds it to that: a customer message that
   * uses one of a topic's words while no profile fact does gets no draft, only a question for a person (a model may answer anyway, as an 8B model does).
   */
  officeTopics: z.array(z.object({ label: z.string().min(1), words: z.array(z.string().min(1)).min(1) })).default([]),
  /**
   * Run-time facts from the company's add-ons (a job sheet, a GPS feed) that the reply handler is shown, as `live.<name>` keys (CMP-28).
   * Each key needs a runtime source registered by the adapter; a key with no data or stale data blocks the draft, so a customer is
   * never answered from a fact the system could not vouch for.
   */
  contextKeys: z.array(z.string().regex(/^live\.[a-z][a-z0-9_]*$/, 'a key such as live.todays_jobs')).default([]),
  /**
   * CMP-32: how the bot presents itself to customers. The voice is the business's own desk (short, natural, direct, no "as an AI"),
   * and the bot never says or implies it is a human. `none` (the default, zapa 2026-11-08): no introduction; the customer is not told
   * unless they ask, and then the answer is truthful and plain. `first_message`: the first message of a chat opens with a one-line
   * introduction saying the reply is automatic, for a business whose adviser wants it. `testing`: that, and every draft ends with a
   * notice that this is a test and a colleague reviews replies. The text is code, not the model's, so it cannot be forgotten. Override
   * the wording (in the customers' language) with `intro` and `testNotice`; `{name}` and `{business}` are filled in.
   */
  persona: z.object({
    name: z.string().regex(/^[\p{L}][\p{L} .'-]{0,29}$/u, 'a first name, up to 30 letters').optional(),
    disclosure: z.enum(['none', 'first_message', 'testing']).default('none'),
    /** One text for every language, or a text per language code (`{ "pt": "...", "en": "..." }`). A language without one falls back to the built-in text. */
    intro: z.union([z.string().min(1).max(200), z.partialRecord(z.enum(LANGUAGES), z.string().min(1).max(200))]).optional(),
    testNotice: z.union([z.string().min(1).max(200), z.partialRecord(z.enum(LANGUAGES), z.string().min(1).max(200))]).optional(),
  }).default({ disclosure: 'none' }),
  /** Handler ids the adapter wants to auto-reply. Empty by default (HR-1); the registry still needs its own opt-in. */
  autoReply: z.array(z.string()).default([]),
  /** Checks the adapter adds to a drafted reply (SAL-2): return one failure message per problem. */
  extraDraftChecks: z.array(z.custom<(draft: string, facts: ResolvedFacts) => string[]>((v) => typeof v === 'function')).default([]),
});

export type SalesConfig = z.infer<typeof salesConfigSchema>;
