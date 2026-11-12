import type { ChecklistItemDef } from '@cyborg/core';

/** docs/10 ADM-6..20. Item ids are the requirement ids. */
export const ITEMS: readonly ChecklistItemDef[] = [
  { id: 'ADM-6', rule: 'No thinking in chat: reasoning goes to the scratchpad, never to a channel', verification: 'both', unwaivable: true },
  { id: 'ADM-7', rule: 'Speak only when addressed (groups); reply role only in 1:1 chats', verification: 'machine', unwaivable: true },
  { id: 'ADM-8', rule: 'Reply target: shadow output only to the review channel; acknowledgements never to the customer', verification: 'machine', unwaivable: true },
  { id: 'ADM-9', rule: 'Chat roles: unknown chats are ignored; no output in ignored or monitor chats', verification: 'machine', unwaivable: false },
  { id: 'ADM-10', rule: 'Loop guard: never answer itself, other bots or system messages; one trigger, one output', verification: 'machine', unwaivable: false },
  { id: 'ADM-11', rule: 'Commands only from authorised senders', verification: 'machine', unwaivable: false },
  { id: 'ADM-12', rule: 'Kill switches: per-chat and global stop and start, tested', verification: 'both', unwaivable: false },
  { id: 'ADM-13', rule: 'No commitments before approval', verification: 'machine', unwaivable: true },
  { id: 'ADM-14', rule: 'Handoff and escalation: hand off and go quiet instead of guessing', verification: 'machine', unwaivable: false },
  { id: 'ADM-15', rule: 'No internals leaked in outputs', verification: 'machine', unwaivable: false },
  { id: 'ADM-16', rule: 'Language and tone match the customer and the profile', verification: 'person', unwaivable: false },
  { id: 'ADM-17', rule: 'Retention and privacy terms are set and mention the bot and the supplier heads-up', verification: 'person', unwaivable: false },
  { id: 'ADM-18', rule: 'Media policy: voice is transcribed locally, everything else goes to the admins', verification: 'machine', unwaivable: false },
  { id: 'ADM-19', rule: 'Quiet hours and business hours are set per channel', verification: 'person', unwaivable: false },
  { id: 'ADM-20', rule: 'Shadow evidence meets N-7 and contains the traffic types the checks need', verification: 'machine', unwaivable: false },
];

/** ADM-42 (PROPOSED): what a change puts back to `unchecked` (ADM-5). */
export const AFFECTED_BY: Record<'roles' | 'model' | 'endpoint' | 'handler_version', readonly string[]> = {
  roles: ['ADM-7', 'ADM-8', 'ADM-9', 'ADM-10', 'ADM-11', 'ADM-12', 'ADM-14', 'ADM-18'],
  model: ['ADM-6', 'ADM-13', 'ADM-14', 'ADM-15', 'ADM-16', 'ADM-20'],
  endpoint: ['ADM-6', 'ADM-13', 'ADM-14', 'ADM-15', 'ADM-16', 'ADM-20'],
  handler_version: ['ADM-6', 'ADM-13', 'ADM-14', 'ADM-15', 'ADM-16', 'ADM-20'],
};
