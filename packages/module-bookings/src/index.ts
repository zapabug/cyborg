import { defineModule } from '@cyborg/core';
import { bookingsConfigSchema } from './config.ts';
import { NOTICE_HANDLER_ID, noticeHandler, READ_HANDLER_ID, RECORD_HANDLER_ID, readHandler, recordHandler } from './handlers.ts';

export * from './config.ts';
export * from './dates.ts';
export * from './flow.ts';
export * from './handlers.ts';
export * from './quote.ts';

/** feat WZP-50..55: the booking funnel's manifest (MOD-10). */
export const bookingsManifest = {
  id: 'bookings',
  version: '0.1.0',
  coreRange: '^0.0.0',
  handlers: [READ_HANDLER_ID, RECORD_HANDLER_ID, NOTICE_HANDLER_ID],
  profileKeys: [
    { key: 'offer.items', type: 'json' },
    { key: 'offer.availability', type: 'json' },
  ],
  packs: [],
  capabilities: ['strict_schema'],
  privacy: { classes: ['public', 'freetext', 'identity'], mechanisms: ['scrubber', 'vault'] },
  dependencies: [],
} as const;

export const bookingsModule = defineModule({
  manifest: bookingsManifest,
  create: (ctx) => {
    const config = bookingsConfigSchema.parse(ctx.config);
    return [readHandler(), recordHandler(config), noticeHandler()];
  },
});
export * from './notices.ts';
