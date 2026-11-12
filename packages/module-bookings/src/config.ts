import { z } from 'zod';

// feat WZP-51..55, the conversation brain spec: the booking funnel's settings. Every number is the business's to give (HR-10, WZP-9): none has a default
// here. The previous bot's configuration values (alternative_days_ahead 14, last_minute_days 1, a group of 1 to 200) are where a first config starts.

export const bookingsConfigSchema = z.object({
  /** Words that count as an explicit yes once the customer has been given the quote, in every language the business uses (WZP-53). A model's reading never counts. */
  confirmWords: z.array(z.string().min(1)).min(1),
  /** Words that clear a booking in progress. */
  cancelWords: z.array(z.string().min(1)).min(1),
  /** The date asked for, this many days from today or fewer (today is 0) is last minute and the customer is told so honestly (WZP-55). */
  lastMinuteDays: z.number().int().nonnegative(),
  /** What the bot is told to say about a last-minute date. */
  lastMinuteNote: z.string().min(1).max(400),
  /** How many days ahead to look for open days to offer when the asked day is not possible. */
  alternativeDaysAhead: z.number().int().positive(),
  /** The most people one booking request may have. */
  maxGroup: z.number().int().positive(),
  /** How money is written in the computed lines, e.g. `EUR` or `€`. */
  currency: z.string().min(1),
  /** The evening-before reminder for a confirmed booking: from this time of day (HH:MM, the business's day) until midnight. Absent: no reminders. */
  reminders: z.object({ sendAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), message: z.string().min(1).max(400) }).optional(),
  /** Cancelling a service day: how long the preview's code is good for, and the first line of the notice each customer gets. Absent: no day cancelling. */
  cancellations: z.object({ previewMinutes: z.number().positive(), message: z.string().min(1).max(400) }).optional(),
});
export type BookingsConfig = z.infer<typeof bookingsConfigSchema>;
