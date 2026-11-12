import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { DeterministicHandler, ModelHandler, ProposalBody, ResolvedFacts } from '@cyborg/core';
import type { SalesConfig } from './config.ts';
import { introText, replyLanguage, testNoticeText } from './texts.ts';
import { commitmentHits, conversationRuleFailures, humanClaimHits, officeTopicFailures, principleFailures, principlesForStage, profileStatementFailures, untracedNumbers } from './draft-checks.ts';
import { detectLanguage, PRESENCE_FACT_KEY, type Band, type ConfidenceSpec } from '@cyborg/core';

interface EnquiryInput {
  text: string;
  sender: string;
}

interface ReplyInput extends EnquiryInput {
  first: boolean;
  /** WZP-51: facts computed by the company's booking step for this chat; empty when no booking is running. */
  conversation: string;
  /** feat-desk DSK-8: the stage of the conversation, set by code (greet, qualify, offer); empty when the company does not set it. */
  stage?: string | undefined;
}

const enquiryInput = {
  schema: z.object({ text: z.string(), sender: z.string() }),
  classes: { text: 'freetext', sender: 'identity' } as const,
  fromEvent: (event: { payload: Record<string, unknown> }) => ({ text: event.payload['text'], sender: event.payload['sender'] }),
};

/** CMP-32: `first` is the adapter's word that this is the first message of the chat. When it is not given the chat is treated as new, so the introduction is never silently dropped. */
const replyInput = {
  schema: z.object({ text: z.string(), sender: z.string(), first: z.boolean(), conversation: z.string(), stage: z.string().optional() }),
  classes: { text: 'freetext', sender: 'identity', first: 'public', conversation: 'freetext', stage: 'public' } as const,
  fromEvent: (event: { payload: Record<string, unknown> }) => ({ text: event.payload['text'], sender: event.payload['sender'], first: event.payload['first'] !== false, conversation: typeof event.payload['conversation'] === 'string' ? event.payload['conversation'] : '', stage: typeof event.payload['stage'] === 'string' ? event.payload['stage'] : '' }),
};

const fact = (facts: ResolvedFacts, key: string): unknown => facts.profile.find((f) => f.key === key)?.value;

/** The prompt depends on the config, so the version carries a short hash of it. */
const versionFor = (base: string, config: unknown) =>
  `${base}+${createHash('sha256').update(JSON.stringify(config)).digest('hex').slice(0, 8)}`;

const effectFor = (id: string, config: SalesConfig) => (config.autoReply.includes(id) ? ('auto_reply' as const) : ('proposal' as const));

/** SAL-1 */
export function intakeHandler(config: SalesConfig): ModelHandler<EnquiryInput, { items: { field: string; value: string; sourcePhrase: string }[] }> {
  const names = config.enquiryFields.map((f) => f.name) as [string, ...string[]];
  const id = 'sales.enquiry.intake';
  return {
    kind: 'model',
    id,
    version: versionFor('1', config.enquiryFields),
    trigger: [{ type: 'event', kind: 'message.received' }],
    input: enquiryInput,
    profileKeys: [],
    packFacts: [],
    prompt: {
      template:
        'Read the customer message below and fill in the fields it answers. For each field you can fill, give the value ' +
        'and the exact words from the message that show it (sourcePhrase). Leave a field out if the message does not say it. Do not guess.\n' +
        `Fields:\n${config.enquiryFields.map((f) => `- ${f.name}: ${f.description}`).join('\n')}\n\nMessage:\n{{text}}`,
      slots: { text: 'text' },
    },
    output: z.object({ items: z.array(z.object({ field: z.enum(names), value: z.string().min(1), sourcePhrase: z.string().min(1) })) }),
    model: { level: 'strict_schema', name: 'default' },
    checks: (output) => {
      const seen = new Set<string>();
      return output.items.flatMap((i) => (seen.has(i.field) ? [`field "${i.field}" is given twice`] : (seen.add(i.field), [])));
    },
    toProposal: (output, input) => {
      if (output.items.length === 0) return { none: 'the message answers none of the enquiry fields' };
      const missing = names.filter((n) => !output.items.some((i) => i.field === n));
      return {
        subject: input.sender,
        changes: output.items.map((i) => ({ field: i.field, oldValue: null, newValue: i.value, sourcePhrase: i.sourcePhrase })),
        findings: [],
        questions: missing.map((m) => `Not stated in the message: ${m}`),
      };
    },
    effect: effectFor(id, config),
    commitment: false,
    limits: {},
  };
}

const LANGUAGE_NAMES: Record<string, string> = { pt: 'Portuguese', en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian' };

const fill = (text: string, name: string | undefined, business: string) => text.replaceAll('{name}', name ?? '').replaceAll('{business}', business);

/**
 * CMP-32, ADM-76: the words around a draft that the code adds, so a model cannot leave them out or reword them. They are in the
 * language the customer will read: the draft's, else the customer's, else the company's default.
 */
function withDisclosure(draft: string, customerText: string, facts: ResolvedFacts, config: SalesConfig, first: boolean): string {
  const business = String(fact(facts, 'business.name') ?? 'the business');
  const { name, disclosure } = config.persona;
  const lang = replyLanguage(draft, replyLanguage(customerText, config.defaultLanguage));
  const opening = first && disclosure !== 'none' ? fill(introText(config.persona, lang), name, business) : null;
  const closing = disclosure === 'testing' ? fill(testNoticeText(config.persona, lang), name, business) : null;
  return [opening, draft, closing].filter((x): x is string => x !== null).join('\n\n');
}

/** Shared by the two drafting handlers: block a draft the profile does not support, and raise a question. */
function draftProposal(draft: string, subject: string, facts: ResolvedFacts, config: SalesConfig, first = false, customerText = '', computed = '', stage = ''): ProposalBody {
  const problems = [
    ...humanClaimHits(draft, config.humanClaimPhrases).map((m) => `claims to be a person: ${m}`),
    ...commitmentHits(draft, config.commitmentPhrases).map((m) => `commitment: ${m}`),
    ...profileStatementFailures(draft, facts, computed),
    ...conversationRuleFailures(draft, computed),
    ...(config.principles ? principleFailures(draft, facts, stage) : []),
    ...officeTopicFailures(customerText, facts, config.officeTopics),
    ...config.extraDraftChecks.flatMap((check) => check(draft, facts)),
  ];
  if (problems.length === 0) return { subject, changes: [], draft: withDisclosure(draft, customerText, facts, config, first), findings: [], questions: [] };
  // SAL-2, SAL-5: no draft is offered; a person gets the reasons as questions.
  return {
    subject,
    changes: [],
    blocked: true,
    findings: problems.map((p) => ({ statement: `the drafted reply was blocked: ${p}`, evidence: 'checked in code against the business profile' })),
    questions: ['A reply could not be drafted safely. A person must answer this customer; see the findings for what was blocked.'],
  };
}

const factSlots = {
  name: 'business.name',
  items: 'offer.items',
  availability: 'offer.availability',
  commitments: 'rules.commitments',
  tone: 'tone.style',
  faq: 'faq.entries',
  presence: PRESENCE_FACT_KEY,
};
const REPLY_KEYS = Object.values(factSlots);

/** SAL-2 */
type DraftOutput = { draft: string; selfAssessment?: { band: Band; reason: string } | undefined };

/** The self-assessment field exists only when the config asks for it: a strict-schema endpoint fills every field it is given. */
const draftOutputFor = (config: SalesConfig) =>
  z.object({
    draft: z.string().min(1),
    ...(config.selfAssessment ? { selfAssessment: z.object({ band: z.enum(['low', 'medium', 'high']), reason: z.string() }).optional() } : {}),
  });

/** PRF-72: confidence for the two drafting handlers. */
function draftConfidence(): ConfidenceSpec {
  return {
    selfAssessment: (output: DraftOutput) => output.selfAssessment ?? null,
    grounding: (output: DraftOutput, input: EnquiryInput, facts: ResolvedFacts) => {
      const untraced = untracedNumbers(output.draft, `${input.text}\n${(input as Partial<ReplyInput>).conversation ?? ''}`, facts);
      return { ok: untraced.length === 0, untraced };
    },
    // ADM-75: a reply in another language than the customer's goes to the low band, where a person reads it.
    language: (output: DraftOutput, input: EnquiryInput) => {
      const c = detectLanguage(input.text);
      const d = detectLanguage(output.draft);
      if (!c || !d) return null; // too little to tell: no signal, rather than a pass that was never checked
      return c.lang === d.lang ? { ok: true, detail: '' } : { ok: false, detail: `the customer wrote ${c.lang}, the draft is in ${d.lang}` };
    },
  };
}

const SELF_ASSESSMENT_LINE = '\nAlso give selfAssessment: your own band (low, medium or high) for how sure you are the reply is right, and one line why.';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** ADM-114: days as words for the writer ("Monday to Saturday"), so it never says a day number. */
export function dayWords(days: unknown): unknown {
  if (!Array.isArray(days)) return days;
  const d = days.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  if (d.length === 0) return days;
  const run = d.length > 2 && d.every((n, i) => i === 0 || n === d[i - 1]! + 1);
  return run ? `${WEEKDAYS[d[0]!]} to ${WEEKDAYS[d.at(-1)!]}` : d.map((n) => WEEKDAYS[n]).join(', ');
}
const renderAvailability = (value: unknown): unknown => (value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>), ...('days' in (value as object) ? { days: dayWords((value as { days?: unknown }).days) } : {}) } : value);
const renderItems = (value: unknown): unknown => (Array.isArray(value) ? value.map((i) => (i && typeof i === 'object' && 'days' in i && Array.isArray((i as { days?: unknown }).days) && (i as { days: unknown[] }).days.length > 0 ? { ...(i as object), days: dayWords((i as { days: unknown }).days) } : i)) : value);

export function replyDraftHandler(config: SalesConfig): ModelHandler<ReplyInput, DraftOutput> {
  const id = 'sales.enquiry.reply_draft';
  // CMP-28: the company's add-on facts, one slot each. The prompt and the version change only when the list of keys does.
  const contextSlots = Object.fromEntries(config.contextKeys.map((key, i) => [`live${i}`, key]));
  const topicsBlock = config.officeTopics.length
    ? 'YOU DO NOT KNOW the following, so pass them to the office and never answer them yourself:\n' + config.officeTopics.map((t) => `- ${t.label}`).join('\n') + '\n'
    : '';
  const conversationBlock = config.conversationContext
    ? 'This chat so far, recorded by the business\'s code (use it exactly; it wins over everything above). Never ask again for anything the customer has already told you. Any booking or quote the code computed is stated as given; if none is shown, none is in progress:\n{{conversation}}\n'
    : '';
  const principlesBlock = config.principles
    ? 'How this business works at this stage of the conversation (follow these; where a principle and the facts above disagree, the facts win):\n{{principles}}\n'
    : '';
  const principleSlots = config.principles ? { principles: 'rules.principles' } : {};
  const renderPrinciples = (value: unknown, input: Record<string, unknown>): unknown => {
    const lines = principlesForStage(value, typeof input['stage'] === 'string' ? input['stage'] : '').map((p) => `${String(p.id ?? '-')}. ${String(p.text ?? '')}`);
    return lines.length ? lines.join('\n') : 'none for this stage';
  };
  const contextBlock = config.contextKeys.length
    ? "Live information from the business's own systems. It is current only as of the time shown; use it to answer, never state more than it says:\n" +
      config.contextKeys.map((key, i) => `${key}: {{live${i}}}\n`).join('')
    : '';
  const versionParts = { ...(config.defaultLanguage === 'pt' ? {} : { defaultLanguage: config.defaultLanguage }), ...(config.selfAssessment ? { selfAssessment: true } : {}), ...(JSON.stringify(config.persona) === JSON.stringify({ disclosure: 'none' }) ? {} : { persona: config.persona }), ...(config.contextKeys.length ? { contextKeys: config.contextKeys } : {}), ...(config.conversationContext ? { conversationContext: true } : {}), ...(config.officeTopics.length ? { officeTopics: config.officeTopics } : {}), ...(config.principles ? { principles: true } : {}) };
  return {
    kind: 'model',
    id,
    version: Object.keys(versionParts).length ? versionFor('9', versionParts) : '9',
    trigger: [{ type: 'event', kind: 'message.received' }],
    input: replyInput,
    profileKeys: [...REPLY_KEYS, ...(config.principles ? ['rules.principles'] : []), ...config.contextKeys],
    // PRF-24b, DSK-10: the principles are rules in the prompt, so their text is part of the version a run records.
    ...(config.principles ? { versionFacts: ['rules.principles'] } : {}),
    packFacts: [],
    prompt: {
      template:
        'You are the receptionist for {{name}}. You write the replies. Tone: {{tone}}\n' +
        'Reply in the language of the customer\'s message, whatever it is. If a message mixes languages, for example a greeting in one and the question in another, reply in the language of the question, not the greeting. If you cannot tell, reply in ' + LANGUAGE_NAMES[config.defaultLanguage] + '. ' +
        'Write as the business\'s own desk, in its voice: short, direct, natural, no stiff boilerplate. Do not introduce yourself or say what you are unless asked, and never say or imply that you are a person. ' +
        'If you are asked whether you are a person or a bot: when the FAQ has an answer to that question, give that answer; otherwise answer truthfully in one short plain sentence: this is the business\'s automatic reply system and a colleague can take over. ' +
        'A placeholder such as [PHONE_1], [EMAIL_1] or [NUMBER_1] in the customer\'s message stands for a detail they wrote that you cannot see: never repeat it or comment on it, the team has it. ' +
        'Use only these facts. If the facts do not answer the question, or it needs the office, say what a person on the desk would say: that you will pass it to the office and they will come back to the customer. Do not say you cannot help. ' +
        'Never confirm a booking, promise, guarantee or take payment. Never state a price, day or number of places that is not in the facts.\n' +
        'Offer: {{items}}\nAvailability: {{availability}}\nNever promise: {{commitments}}\nFAQ: {{faq}}\n' +
        'Staff: {{presence}} Say it only if the customer asks when a person will answer, and never give a time that is not in that line.\n' +
        contextBlock +
        conversationBlock +
        topicsBlock +
        principlesBlock +
        'Lessons from the team (follow them; where a lesson and the facts above disagree, the facts win):\n{{lessons}}\n\n' +
        'Customer message:\n{{text}}\n\nReply with the draft.' + (config.selfAssessment ? SELF_ASSESSMENT_LINE : ''),
      slots: { text: 'text', ...(config.conversationContext ? { conversation: 'conversation' } : {}) },
      factSlots: { ...factSlots, ...contextSlots, ...principleSlots },
      factRender: { items: renderItems, availability: renderAvailability, ...(config.principles ? { principles: renderPrinciples } : {}) },
      lessonsSlot: 'lessons',
    },
    output: draftOutputFor(config) as never,
    model: { level: 'json_object', name: 'default' },
    checks: () => [],
    toProposal: (output, input, facts) => draftProposal(output.draft, input.sender, facts, config, input.first, input.text, input.conversation, input.stage ?? ''),
    confidence: draftConfidence(),
    effect: effectFor(id, config),
    commitment: false,
    limits: {},
  };
}

/** SAL-3: findings and questions, never a decline. */
export function qualifyHandler(config: SalesConfig): ModelHandler<
  EnquiryInput,
  { assessments: { criterion: string; status: 'met' | 'not_met' | 'unknown'; evidence: string }[]; missing: string[]; nextQuestion: string | null }
> {
  const id = 'sales.enquiry.qualify';
  const criteriaOf = (facts: ResolvedFacts): { id: string }[] => {
    const value = fact(facts, 'sales.criteria');
    return Array.isArray(value) ? (value as { id: string }[]) : [];
  };
  return {
    kind: 'model',
    id,
    version: '1',
    trigger: [{ type: 'event', kind: 'message.received' }],
    input: enquiryInput,
    profileKeys: ['sales.criteria'],
    packFacts: [],
    prompt: {
      template:
        'Judge the customer message against each criterion. For every criterion give status met, not_met or unknown, and for met or ' +
        'not_met the exact words from the message as evidence. List what is still missing and, if useful, one next question to ask. ' +
        'You only assess; you never decide whether to decline.\nCriteria: {{criteria}}\n\nMessage:\n{{text}}',
      slots: { text: 'text' },
      factSlots: { criteria: 'sales.criteria' },
    },
    output: z.object({
      assessments: z.array(z.object({ criterion: z.string().min(1), status: z.enum(['met', 'not_met', 'unknown']), evidence: z.string() })),
      missing: z.array(z.string()),
      nextQuestion: z.string().nullable(),
    }),
    model: { level: 'strict_schema', name: 'default' },
    checks: (output, input, facts) => {
      const ids = criteriaOf(facts).map((c) => c.id);
      const failures: string[] = [];
      for (const a of output.assessments) {
        if (!ids.includes(a.criterion)) failures.push(`"${a.criterion}" is not a criterion in sales.criteria`);
        if (a.status !== 'unknown' && !input.text.includes(a.evidence)) failures.push(`evidence for "${a.criterion}" does not occur in the message`);
      }
      for (const wanted of ids.filter((i) => !output.assessments.some((a) => a.criterion === i))) failures.push(`criterion "${wanted}" was not assessed`);
      return failures;
    },
    toProposal: (output, input) => ({
      subject: input.sender,
      changes: [],
      findings: output.assessments.map((a) => ({
        statement: `criterion "${a.criterion}": ${a.status.replace('_', ' ')}`,
        evidence: a.status === 'unknown' ? 'not stated in the message' : a.evidence,
      })),
      questions: [...output.missing.map((m) => `Missing: ${m}`), ...(output.nextQuestion ? [output.nextQuestion] : [])],
    }),
    effect: effectFor(id, config),
    commitment: false,
    limits: {},
  };
}

/** SAL-4: the interval is a profile value (`sales.followup_after_hours`), not a number in the spec. */
export function followupHandler(config: SalesConfig): ModelHandler<EnquiryInput & { hoursSinceContact: number }, DraftOutput> {
  const id = 'sales.followup.draft';
  return {
    kind: 'model',
    id,
    version: '2',
    trigger: [{ type: 'schedule', name: 'sales.followup' }],
    input: {
      schema: z.object({ text: z.string(), sender: z.string(), hoursSinceContact: z.number() }),
      classes: { text: 'freetext', sender: 'identity', hoursSinceContact: 'deal' },
      fromEvent: (event) => ({ text: event.payload['text'], sender: event.payload['sender'], hoursSinceContact: event.payload['hoursSinceContact'] }),
    },
    profileKeys: ['business.name', 'tone.style', 'sales.followup_after_hours'],
    packFacts: [],
    prompt: {
      template:
        'You are the receptionist for {{name}}. You write the follow-ups. Tone: {{tone}}\nThe customer wrote the message below and has had no answer for {{hours}} hours. ' +
        'Write a short, polite follow-up. Never confirm a booking, promise or state a price.\n\nCustomer message:\n{{text}}\n\nReply with the draft.',
      slots: { text: 'text', hours: 'hoursSinceContact' },
      factSlots: { name: 'business.name', tone: 'tone.style' },
    },
    output: draftOutputFor(config) as never,
    model: { level: 'json_object', name: 'default' },
    checks: () => [],
    confidence: draftConfidence(),
    toProposal: (output, input, facts) => {
      const after = fact(facts, 'sales.followup_after_hours');
      if (typeof after !== 'number') return { none: 'sales.followup_after_hours is not a number in the profile' };
      if (input.hoursSinceContact < after) return { none: `follow-up not due: ${input.hoursSinceContact} h since contact, interval is ${after} h` };
      return draftProposal(output.draft, input.sender, facts, config, false, input.text);
    },
    effect: effectFor(id, config),
    commitment: false,
    limits: {},
  };
}

interface CardInput {
  chat: string;
  transcript: string;
}

/** ADM-56: the adapter assembles the recent lines of one chat ("customer:", "bot:", "staff:" prefixes) and raises `handoff.requested`. */
const cardInput = {
  schema: z.object({ chat: z.string(), transcript: z.string() }),
  classes: { chat: 'identity', transcript: 'freetext' } as const,
  fromEvent: (event: { payload: Record<string, unknown> }) => ({ chat: event.payload['chat'], transcript: event.payload['transcript'] }),
};

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();
const phraseOf = z.string().min(1);

type CardOutput = {
  wants: { note: string; sourcePhrase: string }[];
  collected: { field: string; value: string; sourcePhrase: string }[];
  needs: { note: string; sourcePhrase: string }[];
  botSaid: { statement: string; sourcePhrase: string }[];
  open: string[];
};

/** ADM-56: what a colleague needs to see when they take over a chat. Every line carries the words it came from. */
export function handoffCardHandler(config: SalesConfig): ModelHandler<CardInput, CardOutput> {
  const names = config.enquiryFields.map((f) => f.name) as [string, ...string[]];
  const id = 'sales.handoff.card';
  return {
    kind: 'model',
    id,
    version: versionFor('1', config.enquiryFields),
    trigger: [{ type: 'event', kind: 'handoff.requested' }],
    input: cardInput,
    profileKeys: [],
    packFacts: [],
    prompt: {
      template:
        'A colleague is taking over the chat below. Write them a card. Each line of the chat starts with customer:, bot: or staff:. ' +
        'Use only what the chat says. For every item give the exact words from the chat it comes from (sourcePhrase). Never guess, never invent.\n' +
        'wants: one short line on what the customer is asking for. Do not repeat the customer\'s words at length; the colleague can read the chat.\n' +
        `collected: values for these fields, only if the customer gave them (fill every field the chat answers):\n${config.enquiryFields.map((f) => `- ${f.name}: ${f.description}`).join('\n')}\n` +
        'needs: preferences, limits or worries the customer mentioned that a colleague should keep in mind.\n' +
        'botSaid: anything the bot told the customer that the colleague must stay consistent with, such as dates, prices or when a person will answer.\n' +
        'open: what someone at the office must check or decide before the customer can be answered, for example whether the date or the number of people asked for is available. ' +
        'Do not copy the customer\'s own questions here; leave open empty if nothing needs the office.\n\nChat:\n{{transcript}}',
      slots: { transcript: 'transcript' },
    },
    output: z.object({
      wants: z.array(z.object({ note: z.string().min(1), sourcePhrase: phraseOf })),
      collected: z.array(z.object({ field: z.enum(names), value: z.string().min(1), sourcePhrase: phraseOf })),
      needs: z.array(z.object({ note: z.string().min(1), sourcePhrase: phraseOf })),
      botSaid: z.array(z.object({ statement: z.string().min(1), sourcePhrase: phraseOf })),
      open: z.array(z.string().min(1)),
    }),
    model: { level: 'strict_schema', name: 'default' },
    checks: (output, input) => {
      const chat = norm(input.transcript);
      const noFacts: ResolvedFacts = { profile: [], pack: [] };
      const lines: { text: string; phrase: string }[] = [
        ...output.wants.map((w) => ({ text: w.note, phrase: w.sourcePhrase })),
        ...output.collected.map((c) => ({ text: c.value, phrase: c.sourcePhrase })),
        ...output.needs.map((n) => ({ text: n.note, phrase: n.sourcePhrase })),
        ...output.botSaid.map((b) => ({ text: b.statement, phrase: b.sourcePhrase })),
      ];
      return lines.flatMap(({ text, phrase }) => [
        ...(chat.includes(norm(phrase)) ? [] : [`"${phrase}" does not occur in the chat`]),
        ...untracedNumbers(text, input.transcript, noFacts).map((n) => `the number ${n} in "${text}" is not in the chat`),
      ]);
    },
    toProposal: (output, input) => {
      const empty = [output.wants, output.collected, output.needs, output.botSaid, output.open].every((a) => a.length === 0);
      if (empty) return { none: 'the chat holds nothing to hand over' };
      return {
        subject: input.chat,
        changes: output.collected.map((c) => ({ field: c.field, oldValue: null, newValue: c.value, sourcePhrase: c.sourcePhrase })),
        findings: [
          ...output.wants.map((w) => ({ statement: `wants: ${w.note}`, evidence: w.sourcePhrase })),
          ...output.needs.map((n) => ({ statement: `needs: ${n.note}`, evidence: n.sourcePhrase })),
          ...output.botSaid.map((b) => ({ statement: `the bot said: ${b.statement}`, evidence: b.sourcePhrase })),
        ],
        questions: output.open,
      };
    },
    effect: 'proposal',
    commitment: false,
    limits: {},
  };
}

export type { DeterministicHandler };
