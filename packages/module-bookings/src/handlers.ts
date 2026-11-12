import { z } from 'zod';
import type { DeterministicHandler, ModelHandler } from '@cyborg/core';
import type { BookingsConfig } from './config.ts';

export const READ_HANDLER_ID = 'bookings.request.read';
export const RECORD_HANDLER_ID = 'bookings.request.record';
export const READ_EVENT = 'booking.read';
export const REQUEST_EVENT = 'booking.request';
export const NOTICE_HANDLER_ID = 'bookings.notice.draft';
export const NOTICE_EVENT = 'booking.notice';

interface ReadInput {
  text: string;
  sender: string;
  today: string;
  known: string;
}

const FIELDS = ['service', 'party_size', 'date'] as const;

/**
 * the brain spec's "read call": what the customer's message says about the booking, with the exact words (HDL-6), nothing guessed. It runs on its own event
 * (`booking.read`), raised by the company's booking step before the reply is drafted, so the code can compute the quote from it first. Its output is a
 * working note, not a business record: the booking step settles it at once.
 */
export function readHandler(): ModelHandler<ReadInput, { items: { field: (typeof FIELDS)[number]; value: string; sourcePhrase: string }[] }> {
  return {
    kind: 'model',
    id: READ_HANDLER_ID,
    version: '2',
    trigger: [{ type: 'event', kind: READ_EVENT }],
    input: {
      schema: z.object({ text: z.string(), sender: z.string(), today: z.string(), known: z.string() }),
      classes: { text: 'freetext', sender: 'identity', today: 'public', known: 'public' } as const,
      fromEvent: (event: { payload: Record<string, unknown> }) => ({ text: event.payload['text'], sender: event.payload['sender'], today: event.payload['today'], known: event.payload['known'] ?? '' }),
    },
    profileKeys: ['offer.items'],
    packFacts: [],
    prompt: {
      template:
        'Read the customer message below about a service booking and fill in only what it says. Fields: service (the name or the words the customer uses for the service), ' +
        'party_size (how many people, a number), date (the day they want the service, as YYYY-MM-DD). For each field you can fill, give the value and the exact words ' +
        'from the message that show it (sourcePhrase). Leave a field out if the message does not say it. Do not guess and do not repeat what is already known.\n' +
        'Today is {{today}}.\nThe services: {{services}}\nAlready known from earlier in this chat: {{known}}\n\nMessage:\n{{text}}',
      slots: { text: 'text', today: 'today', known: 'known' },
      factSlots: { services: 'offer.items' },
    },
    output: z.object({ items: z.array(z.object({ field: z.enum(FIELDS), value: z.string().min(1), sourcePhrase: z.string().min(1) })) }),
    model: { level: 'strict_schema', name: 'default' },
    checks: (output) => {
      const seen = new Set<string>();
      return output.items.flatMap((i) => (seen.has(i.field) ? [`field "${i.field}" is given twice`] : (seen.add(i.field), [])));
    },
    toProposal: (output, input) => {
      if (output.items.length === 0) return { none: 'the message says nothing about a booking' };
      return { subject: input.sender, changes: output.items.map((i) => ({ field: i.field, oldValue: null, newValue: i.value, sourcePhrase: i.sourcePhrase })), findings: [], questions: [] };
    },
    effect: 'proposal',
    commitment: false,
    limits: {},
  };
}

interface RecordInput {
  chat: string;
  service: string;
  partySize: number;
  date: string;
  perPerson: number;
  total: number;
  currency: string;
}

/**
 * WZP-52: a booking request for a person to review. It is a proposal with `proposed` → `approved` (the office confirms) or `declined`; nothing is booked
 * until a person approves it (HR-1), so it is flagged as carrying a commitment and can never be an auto-reply. No model call.
 */
export function recordHandler(_config: BookingsConfig): DeterministicHandler<RecordInput> {
  return {
    kind: 'deterministic',
    id: RECORD_HANDLER_ID,
    version: '1',
    trigger: [{ type: 'event', kind: REQUEST_EVENT }],
    input: {
      schema: z.object({ chat: z.string(), service: z.string(), partySize: z.number(), date: z.string(), perPerson: z.number(), total: z.number(), currency: z.string() }),
      classes: { chat: 'public', service: 'public', partySize: 'public', date: 'public', perPerson: 'public', total: 'public', currency: 'public' } as const,
      fromEvent: (event: { payload: Record<string, unknown> }) => event.payload,
    },
    profileKeys: [],
    packFacts: [],
    run: (input) => ({
      subject: input.chat,
      changes: [
        { field: 'service', oldValue: null, newValue: input.service },
        { field: 'party_size', oldValue: null, newValue: input.partySize },
        { field: 'date', oldValue: null, newValue: input.date },
        { field: 'total', oldValue: null, newValue: `${input.total} ${input.currency}` },
      ],
      findings: [],
      questions: [],
    }),
    effect: 'proposal',
    commitment: true,
    limits: {},
  };
}

interface NoticeInput {
  chat: string;
  kind: string;
  text: string;
}

/**
 * WZP-63: a message to a customer about a booking (a reminder, a cancelled day) as a draft for a person to send. The text is made by the company's code from the
 * booking and the business's own wording; no model writes it, and nothing is sent from here (HR-1, HR-8). It carries a commitment, so it can never be an auto-reply.
 */
export function noticeHandler(): DeterministicHandler<NoticeInput> {
  return {
    kind: 'deterministic',
    id: NOTICE_HANDLER_ID,
    version: '1',
    trigger: [{ type: 'event', kind: NOTICE_EVENT }],
    input: {
      schema: z.object({ chat: z.string(), kind: z.string(), text: z.string() }),
      classes: { chat: 'public', kind: 'public', text: 'public' } as const,
      fromEvent: (event: { payload: Record<string, unknown> }) => event.payload,
    },
    profileKeys: [],
    packFacts: [],
    run: (input) => ({ subject: input.chat, changes: [{ field: 'kind', oldValue: null, newValue: input.kind }], draft: input.text, findings: [], questions: [] }),
    effect: 'proposal',
    commitment: true,
    limits: {},
  };
}
