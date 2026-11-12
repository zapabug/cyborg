# 02 Behavior model

Requirement IDs: `BEH-n`. Numbers here are the only source for limits (HR-10).
Every number is `PROPOSED` unless it says "zapa".

## Proposal state machine

```
          ┌──────────── invalid_output (terminal, cannot be applied)
          │
 (run) → proposed ──approve──► approved ──apply ok──► applied
                 │                       └─apply fail─► apply_failed
                 ├──decline──► declined (terminal)
                 ├──supersede─► superseded (terminal, a newer proposal replaced it)
                 └──expire───► expired (terminal)   [only if expiry is configured]
 applied ──revert──► reverted   (a person reverts; old values were recorded)
```

- BEH-1 A proposal must start in `proposed` or `invalid_output`.
- BEH-2 Only the transitions in the diagram are legal. Any other transition must
  throw and write nothing.
- BEH-3 `approve` and `decline` must record who decided and when. The actor is an
  adapter-supplied reference (an `identity`-class value is never stored in the
  proposal row, only its vault code).
- BEH-4 `apply` must run only from `approved`. Before applying, the adapter's
  `prepareApply()` must re-read the current state of the target; if it changed
  since the proposal, the proposal goes to `apply_failed` with a reason, never
  overwritten silently.
- BEH-5 Applying must record every changed field's old and new value (the basis
  for revert).
- BEH-6 A proposal marked `invalid_output` must never be offered for approval.
- BEH-7 The audit log must be append-only: no update or delete API exists.

## Triggers

- BEH-8 A trigger is one of: `event` (adapter-emitted), `schedule` (a time of day
  in the business's configured timezone, plus a catch-up run for work newer than
  the last processed marker), `manual` (a person's command).
- BEH-9 Each handler's trigger rules are config. The same event must always
  select the same handlers in the same order.
- BEH-10 The runner must keep a processed marker per source so an event is not
  handled twice (idempotent by event id).

## Model-call behavior

- BEH-11 Each handler call is one request and one response. No tool loop, no
  multi-turn autonomy.
- BEH-12 Output must be validated against the handler's output schema, then
  against its code checks (docs/03). Values that the handler marks "extracted
  from input" must carry the source phrase, and the validator must confirm the
  phrase occurs in the input.
- BEH-13 On validation failure the runner must retry once, then record
  `invalid_output`.

## Numbers

| ID | Number | Value | Status |
| --- | --- | --- | --- |
| N-1 | validation retries before `invalid_output` | 1 | PROPOSED |
| N-2 | gateway request timeout | 60 s | PROPOSED |
| N-3 | proposal expiry | none by default; per-handler config | OPEN (default none) |
| N-4 | prompt ledger retention | 30 days | PROPOSED, OPEN (privacy impact; decide per client) |
| N-5 | proposals per user per handler kind per day | OPEN (freehub brief left "3" unsettled) | OPEN |
| N-6 | audit log retention | indefinite | PROPOSED |
| N-7 | minimum shadow run before live (messages and days) | days: 14; messages OPEN | zapa, 2026-11-01 ("two weeks running shadow") |
| N-8 | idle unload of a local model | config; wazaa uses 600 s | OPEN |
| N-9 | calibration review cadence | monthly | zapa, 2026-10-31 |
| N-20 | a kind of reply is flagged as a candidate for automation when at least this many of the last this-many a person judged were right | 9 of 10 (`automation.candidate`) | zapa, 2026-11-01 ("right 9 out of 10 times") |
| N-19 | a chat nobody has answered or settled since the customer's last message is stale (yellow) after | `board.staleAfterHours`, no default; OPEN (zapa to set; 24 h proposed) | OPEN |
| N-18 | audit cadence during the shadow run | every 3 days or weekly, chosen by how the shadow is performing; the rule for choosing is OPEN | zapa, 2026-11-01 |
| N-10 | calibration sample size per review | OPEN | OPEN |
| N-11 | confidence bands | low, medium, high | PROPOSED |
| N-12 | open flags per handler version that trigger a supplier heads-up | 10 | zapa's example, 2026-10-31; PROPOSED as the default |
| N-13 | reply delay: wait this long after a customer's message before a reply-type handler runs | 60 s | zapa, 2026-10-31 (whether each new message restarts the wait, and whether the wait scales with message length, are OPEN) |
| N-14 | customer silence before a handed-off chat auto-resumes | 12 h default, set by the business admin per business | zapa, 2026-10-31 ("usually enough"; admin decides) |
| N-16 | capability-test trials per request shape (docs/05, GWY-18) | 3 | PROPOSED (build decision, M3) |
| N-17 | conversation messages kept in a flag ticket's transcript | 10 | PROPOSED (wazaa's `.bug` keeps the last 10) |
| N-19 | how often a running install does its timed work: returns silent handed-off chats to the bot (N-14), drops ledger rows older than N-4, and checks the evening-before reminders (WZP-63) | 15 minutes | PROPOSED (audit 2026-11-10: the reminder check already used wazaa's 15 minutes; the other two never ran in an install) |
| N-20 | chat card: longest stored value of a field; earlier values kept per field when it changes | 120 characters; 5 earlier values | PROPOSED (audit 2026-11-10: already in `chat-card.ts`, DSK-79) |
| N-21 | size limits of what a person types into the dashboard or a command: a note (`save`, `bug`, `idea`); an answer to a customer question (`answer`, `learn`); the business sheet text; chats chosen in one request | 500; 1000; 20 000 characters; 500 chats | PROPOSED (audit 2026-11-10: already in `desk.ts`, `business-tab.ts`, `directory.ts`) |
| N-22 | agreement: longest operator label kept with the record; longest business terms file shown | 120; 20 000 characters | PROPOSED (audit 2026-11-10: already in `agreement.ts`, WZP-5) |
| N-23 | research (DSK-85, DSK-86): page text given to the model per page; services, questions and longest copied phrase the answer may hold | 20 000 characters; 30 services, 20 questions, 300 characters | PROPOSED (audit 2026-11-10: already in `research.ts`; pages, bytes and time are stated in DSK-85) |
| N-24 | the confirmation code that goes with a cancel-a-day preview | 4 digits (1000 to 9999), random | PROPOSED (audit 2026-11-10: already in `bookings-schedule.ts`; the preview's minutes are the business's setting) |
| N-15 | how often the admin is reminded while a customer is waiting for a person | OPEN | OPEN |

## Limits and per-user config

- BEH-14 Per-user needs (which handlers are on, which model) must be config, not
  code.
- BEH-15 Limits (N-5) must be enforced by the runner before a model call and
  must record a `rate_limited` audit event when they block.

## Reply delay (zapa, 2026-10-31)

Replies wait for the customer to finish. A burst of messages becomes one run, not
several, which also stops a double answer or a double booking proposal.

- BEH-16 A reply-type handler's `event` trigger for a conversation must fire N-13
  (60 s) after the customer's message, not on arrival. Messages arriving during
  the wait join the same run. Whether a new message restarts the wait is OPEN;
  PROPOSED: yes, restart, with a maximum total wait (OPEN, number needed).
- BEH-17 The delay applies only to reply-type handlers. Owner and staff commands,
  kill switches, ops-chat events and manual triggers must not be delayed.
- BEH-18 If a new customer message arrives after a proposal was created but before
  it was approved or sent, the earlier proposal must move to `superseded` and a
  new run must follow (PROPOSED), so two proposals for one conversation never
  stay open for the same ask.
- BEH-19 The delay is a model of human pacing, not a rate limit. The idea of
  scaling the wait with message length (a longer or more complex question gets a
  longer wait, measured in characters) is zapa's, with "idk" attached: OPEN. No
  character count or multiplier is specified until real message data supports one.
