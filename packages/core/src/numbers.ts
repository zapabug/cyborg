// Numbers from docs/02-behavior-model.md (HR-10). Change them in the doc first.

/** N-1: validation retries before `invalid_output` (BEH-13). */
export const N1_VALIDATION_RETRIES = 1;

/** N-2: gateway request timeout in milliseconds. Enforced by the gateway (M3). */
export const N2_GATEWAY_TIMEOUT_MS = 60_000;

/** N-4: prompt ledger retention in days (PRV-10). PROPOSED; decide per client. */
export const N4_LEDGER_RETENTION_DAYS = 30;

/** N-19: how often a running install does its timed work: auto-resume (N-14), ledger purge (N-4), reminder check (WZP-63). PROPOSED. */
export const N19_HOUSEKEEPING_INTERVAL_MS = 15 * 60_000;

/** N-16: capability-test trials per request shape (docs/05, GWY-18). PROPOSED. */
export const N16_CAPABILITY_TRIALS = 3;

/** N-13: reply delay after a customer's message, in milliseconds (zapa, 2026-10-31). */
export const N13_REPLY_DELAY_MS = 60_000;

/** N-14: customer silence before a handed-off chat auto-resumes; 12 h default, set by the admin per business (zapa). */
export const N14_HANDOFF_RESUME_MS = 12 * 60 * 60 * 1000;

/** N-12: open flags for a handler version that trigger a supplier heads-up (zapa's example, 2026-10-31). */
export const N12_HEADSUP_FLAGS = 10;

/** N-17: conversation messages kept in a flag ticket (wazaa's `.bug` keeps the last 10). */
export const N17_TICKET_MESSAGES = 10;
