import { defineModule } from '@cyborg/core';
import { maintenanceConfigSchema } from './config.ts';
import { RECORD_HANDLER_ID, recordHandler } from './handlers.ts';

export * from './config.ts';
export * from './handlers.ts';
export * from './scan.ts';

/** feat WZP-60: the maintenance watch's manifest (MOD-10). */
export const maintenanceManifest = {
  id: 'maintenance',
  version: '0.1.0',
  coreRange: '^0.0.0',
  handlers: [RECORD_HANDLER_ID],
  profileKeys: [{ key: 'fleet.assets', type: 'json', optional: true }],
  packs: [],
  capabilities: [],
  privacy: { classes: ['public'], mechanisms: ['scrubber'] },
  dependencies: [],
} as const;

export const maintenanceModule = defineModule({
  manifest: maintenanceManifest,
  create: (ctx) => {
    maintenanceConfigSchema.parse(ctx.config);
    return [recordHandler()];
  },
});
