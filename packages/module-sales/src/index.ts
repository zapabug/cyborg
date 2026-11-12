import { defineModule, type ModuleDefinition } from '@cyborg/core';
import { salesConfigSchema } from './config.ts';
import { followupHandler, handoffCardHandler, intakeHandler, qualifyHandler, replyDraftHandler } from './handlers.ts';

export * from './card.ts';
export * from './config.ts';
export * from './draft-checks.ts';
export * from './handlers.ts';
export * from './morning.ts';
export * from './texts.ts';

/** docs/07: the manifest the loader validates (MOD-10). */
export const salesManifest = {
  id: 'sales',
  version: '0.1.0',
  coreRange: '^0.0.0',
  handlers: ['sales.enquiry.intake', 'sales.enquiry.reply_draft', 'sales.enquiry.qualify', 'sales.followup.draft', 'sales.handoff.card'],
  profileKeys: [
    { key: 'business.name', type: 'string' },
    { key: 'offer.items', type: 'json' },
    { key: 'offer.availability', type: 'json' },
    { key: 'rules.commitments', type: 'json' },
    { key: 'tone.style', type: 'string' },
    { key: 'faq.entries', type: 'json' },
    // ADM-52: computed from the on-duty toggle at run time, not stored in the profile.
    { key: 'presence.status', type: 'string', optional: true },
    // CMP-28: the company's add-on facts, named in the sales config's contextKeys.
    { key: 'live.*', type: 'string', optional: true },
    // feat-desk DK2: the business's principles, read only when `modules.sales.principles` is on.
    { key: 'rules.principles', type: 'json', optional: true },
    { key: 'sales.criteria', type: 'json', optional: true },
    { key: 'sales.followup_after_hours', type: 'number', optional: true },
  ],
  packs: [],
  capabilities: ['strict_schema'],
  privacy: { classes: ['public', 'deal', 'freetext', 'identity'], mechanisms: ['scrubber', 'vault'] },
  dependencies: [
    { kind: 'connector', name: 'channel', how: 'the adapter supplies the message source and the reply sink' },
    { kind: 'connector', name: 'contacts', how: 'the adapter supplies the contact store' },
  ],
} as const;

export const salesModule: ModuleDefinition = defineModule({
  manifest: salesManifest,
  create: (ctx) => {
    const config = salesConfigSchema.parse(ctx.config);
    return [intakeHandler(config), replyDraftHandler(config), qualifyHandler(config), followupHandler(config), handoffCardHandler(config)];
  },
});
