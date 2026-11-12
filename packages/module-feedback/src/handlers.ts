import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CyborgEvent, ModelHandler } from '@cyborg/core';

export const REVIEW_HANDLER_ID = 'feedback.review.complaints';

interface ReviewInput {
  site: string;
  ref: string;
  text: string;
}

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** ADM-58: review text is public on the site it came from, so it is class public; the reviewer's name is never passed on. */
const reviewInput = {
  schema: z.object({ site: z.string(), ref: z.string(), text: z.string().min(1) }),
  classes: { site: 'public', ref: 'public', text: 'public' } as const,
  fromEvent: (event: { payload: Record<string, unknown> }) => ({ site: event.payload['site'], ref: event.payload['ref'] ?? '', text: event.payload['text'] }),
};

/** ADM-58: what a review complains about, each with the reviewer's own words. Praise is not a complaint. */
export function reviewComplaintsHandler(): ModelHandler<ReviewInput, { complaints: { topic: string; sourcePhrase: string }[] }> {
  return {
    kind: 'model',
    id: REVIEW_HANDLER_ID,
    version: '1',
    trigger: [{ type: 'event', kind: 'review.received' }],
    input: reviewInput,
    profileKeys: [],
    packFacts: [],
    prompt: {
      template:
        'Read the customer review below. List every complaint the reviewer makes. For each give the topic in a few words and the exact words ' +
        'from the review that show it (sourcePhrase). Praise, neutral remarks and suggestions that are not complaints are left out. ' +
        'Do not guess what the reviewer meant, and do not judge whether the complaint is fair. If there is no complaint, give an empty list.\n\n' +
        'Review from {{site}}:\n{{text}}',
      slots: { site: 'site', text: 'text' },
    },
    output: z.object({ complaints: z.array(z.object({ topic: z.string().min(1), sourcePhrase: z.string().min(1) })) }),
    model: { level: 'strict_schema', name: 'default' },
    checks: (output, input) => output.complaints.filter((c) => !norm(input.text).includes(norm(c.sourcePhrase))).map((c) => `"${c.sourcePhrase}" does not occur in the review`),
    toProposal: (output, input) => {
      if (output.complaints.length === 0) return { none: 'the review makes no complaint' };
      return {
        subject: `${input.site}${input.ref ? `:${input.ref}` : ''}`,
        changes: [],
        findings: output.complaints.map((c) => ({ statement: `complaint: ${c.topic}`, evidence: c.sourcePhrase })),
        questions: [],
      };
    },
    effect: 'proposal',
    commitment: false,
    limits: {},
  };
}

/**
 * ADM-58: a review a person pastes in by hand, or that an adapter's connector hands over, as the event the handler reads. The
 * id is a hash of site and text, so pasting the same review twice raises the same event and runs once.
 */
export function reviewEvent(review: { site: string; text: string; ref?: string; at: string; source?: string }): CyborgEvent {
  const id = createHash('sha256').update(`${review.site}\n${review.ref ?? ''}\n${review.text}`).digest('hex').slice(0, 16);
  return {
    id,
    source: review.source ?? 'paste',
    kind: 'review.received',
    at: review.at,
    payload: { site: review.site, ref: review.ref ?? '', text: review.text },
  };
}
