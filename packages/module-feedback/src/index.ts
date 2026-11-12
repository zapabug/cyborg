import { defineModule, type ModuleDefinition } from '@cyborg/core';
import { reviewComplaintsHandler } from './handlers.ts';

export * from './handlers.ts';
export * from './section.ts';

/** docs/10 ADM-58. */
export const feedbackManifest = {
  id: 'feedback',
  version: '0.1.0',
  coreRange: '^0.0.0',
  handlers: ['feedback.review.complaints'],
  profileKeys: [],
  packs: [],
  capabilities: ['strict_schema'],
  privacy: { classes: ['public'], mechanisms: [] },
  dependencies: [{ kind: 'connector', name: 'reviews', how: 'the adapter hands over reviews as review.received events, or a person pastes them in' }],
} as const;

export const feedbackModule: ModuleDefinition = defineModule({
  manifest: feedbackManifest,
  create: () => [reviewComplaintsHandler()],
});
