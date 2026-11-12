import { z } from 'zod';

// feat WZP-60: the team-chat maintenance watch's settings. The words a team uses for a problem are the business's to give (in its own language); none is built in.
// Every number is the business's too (HR-10, WZP-9): a previous bot used 24 hours, 3 messages and 10 minutes as its starting values.

const words = z.array(z.string().min(1)).default([]);

export const maintenanceConfigSchema = z.object({
  /** What a problem sounds like, by how urgent it is. A phrase is matched as whole words, ignoring case and accents. */
  issues: z.object({ high: words, medium: words, low: words }),
  /** A second mention of the same asset within this many hours is the same record, not a new one. */
  dedupHours: z.number().positive(),
  /** An asset named in one message and a problem in another count together when they are this many messages apart or fewer... */
  contextWindowMsgs: z.number().int().nonnegative(),
  /** ...and no more than this many minutes apart. */
  contextWindowMinutes: z.number().nonnegative(),
});
export type MaintenanceConfig = z.infer<typeof maintenanceConfigSchema>;
