# 08 MVP: milestones and exit criteria

Exit criterion IDs: `Mn-ECk`. Each criterion says how it is checked:
**[M]** machine check (runs in `pnpm test`/`pnpm check`), **[U]** user check
(zapa confirms), **[M+U]** both. A milestone is done only when all its criteria
pass and zapa confirms (root AGENTS.md lifecycle).

Order is by dependency. Every milestone is committed separately.

## M1 Workspace, core contract, runner, SQLite store

Spec: docs/01, 02, 03.

- M1-EC1 [M] `git init`, pnpm workspace, TypeScript 7.0.2 strict; `pnpm install
  --frozen-lockfile`, `pnpm typecheck` and `pnpm test` succeed from a clean clone.
  This confirms TypeScript 7.0.2 works with tsx 4.23.15 and zod 4.6.7.
- M1-EC2 [M] A handler registered through `registerHandler` runs from a trigger
  with a scripted model and persists exactly one proposal (`proposed`) through
  `ProposalStore` backed by `node:sqlite`.
- M1-EC3 [M] Every legal transition in docs/02 has a passing test; every illegal
  transition throws and writes nothing (BEH-2).
- M1-EC4 [M] Each transition writes an append-only audit row; no update or delete
  API exists (BEH-7).
- M1-EC5 [M] The same event selects the same handlers in the same order, and a
  test asserts the model is never called for selection (HDL, HR-3, BEH-9).
- M1-EC6 [M] The runner is idempotent per event id (BEH-10).
- M1-EC7 [M] Registration rejects a handler with an undeclared data class, a
  tools/function output, or `auto_reply` without adapter opt-in (HDL-1..3).

## M2 Data classes, prompt builder, ledger, vault, leak test

Spec: docs/04.

- M2-EC1 [M] A type test shows passing an `identity` or `secret` value to the
  prompt builder fails typechecking.
- M2-EC2 [M] At runtime the builder throws on `identity`, `secret` or undeclared
  values (PRV-3).
- M2-EC3 [M] A `freetext` field with a scrubber hit stops the call and produces a
  manual-handling proposal, never a silent removal (PRV-6).
- M2-EC4 [M] Every model call writes a ledger row with the exact request and raw
  response before the response is used (PRV-8).
- M2-EC5 [M+U] The leak test (PRV-13) with zapa's real identity values and real
  inputs finds zero occurrences in ledger, proposals and audit rows. Zapa runs it.
- M2-EC6 [M] The vault is a separate file with owner-only permissions and
  proposals refer to vault codes only (PRV-2, PRV-11).

## M3 Model gateway and endpoint capability test

Spec: docs/05.

- M3-EC1 [M] The outgoing request body never contains `tools`, `tool_choice`,
  `functions` or `function_call` (GWY-3).
- M3-EC2 [M+U] The capability test classifies zapa's real local llama.cpp
  endpoint and one real cloud OpenAI-compatible endpoint as `strict_schema`,
  `json_object` or `none`, finds the accepted schema request shape, and stores
  result and date (GWY-4, GWY-9, GWY-10).
- M3-EC3 [M] A handler requiring `strict_schema` refuses to run on a lesser
  endpoint and writes an audit event (GWY-11).
- M3-EC4 [M] Invalid or timed-out output retries N-1 times, then yields
  `invalid_output`, which cannot be offered for approval (BEH-6, BEH-13).
- M3-EC5 [M] Usage is stored with each ledger row (GWY-8).

## M4 Business profile, ground-truth checks, onboarding report

Spec: docs/06.

- M4-EC1 [M] Facts require a source; status transitions follow PRF-2 and write
  audit rows.
- M4-EC2 [M] Only a handler's declared `profileKeys` are injected; statuses are
  filtered per shadow vs live (PRF-4, PRF-5).
- M4-EC3 [M] A ground-truth check whose source equals the fact's source is
  rejected (PRF-8).
- M4-EC4 [M+U] Importing wazaa's real `config/catalog.yaml` and `faq.yaml` into a
  profile round-trips without loss, and every fact is `unconfirmed` with its
  source.
- M4-EC5 [M+U] Replaying the Demo Tours "Days" case with real inputs (the Jumpseller
  field and a real service sheet or the live page script): the check against an
  independent source flags the inversion, and a second read of the same field
  cannot confirm it.
- M4-EC6 [M] The onboarding report lists, per module, missing, unconfirmed,
  contradicted and stale required keys, with no readiness score (PRF-3).
- M4-EC7 [M] A pack fact of grade `unverified` never reaches a prompt (PRF-12).

## M5 Module contract and loader

Spec: docs/07.

- M5-EC1 [M] The manifest schema validates; an invalid manifest is rejected with
  all errors listed.
- M5-EC2 [M] The loader refuses a module with unmet core range, profile keys,
  packs, capabilities or dependencies, and lists every unmet item (MOD-1).
- M5-EC3 [M] A module cannot reach an adapter, a store implementation or the
  network except through a declared connector in `ctx` (MOD-2).
- M5-EC4 [M] Two modules in one business cannot register colliding handler ids
  (MOD-3), and unloading keeps stored proposals and audit rows (MOD-5).

## M6 Sales module

Spec: docs/07 (SAL-1..5).

- M6-EC1 [M] `sales.enquiry.intake` turns a real enquiry into a proposal of
  changes with source phrases, validated against the input (HDL-6).
- M6-EC2 [M] `sales.enquiry.reply_draft` blocks any draft whose price, date or
  capacity fails the profile check and raises a question instead (SAL-2).
- M6-EC3 [M] No sales handler can emit a commitment; auto-reply is off unless the
  adapter enables a named handler (SAL-5, HDL-3).
- M6-EC4 [M+U] The same module code, with different config, handles real wazaa
  test-chat messages and a real buyer intake supplied by zapa. This criterion
  stays open until zapa supplies the buyer intake.

## M7 Shadow mode, evaluation loop and the two-consumer proof

Spec: docs/06 (PRF-15..26), docs/07 (MOD-7, MOD-8).

- M7-EC1 [M] During a shadow run no message reaches the origin channel (PRF-15).
- M7-EC2 [M] The shadow-run log pairs each draft with the human's actual reply
  and a marking (PRF-16, PRF-20).
- M7-EC3 [M] A `wrong fact` marking sets the fact `contradicted` (PRF-17); an
  improvement proposal can target a fact, a prompt, a lesson or a check (PRF-21).
- M7-EC4 [M] Replaying stored shadow events through a new handler version reports
  per-entry changes (PRF-25). Per-version marking counts show no single score
  (PRF-26).
- M7-EC5 [M] Enabling a handler live fails without a recorded shadow run that
  meets N-7 and without all used facts `confirmed` (PRF-18). The checklist part of
  the gate is completed in M7b.
- M7-EC6 [M+U] The proof report lists every special case the sales module needed
  for the two consumers; zapa reviews it. Target: zero. This criterion stays open
  until a real buyer intake exists.

## M7b Admin module and deployment checklist

Spec: docs/10 (ADM-1..22), docs/03 (HDL-13), docs/06 (PRF-18). Depends on M7
(the shadow-run log). Named M7b to keep the other milestone numbers stable.

- M7b-EC1 [M] The checklist model works: items, statuses, waivers, evidence
  references, and every change audited; unwaivable items refuse a waiver
  (ADM-1..3).
- M7b-EC2 [M] ADM-6: shadow outputs are scanned for reasoning markers and a hit
  fails the item; the scratchpad write is tested and nothing is posted.
- M7b-EC3 [M] ADM-7: a replay of real group traffic yields zero outputs for
  unaddressed events.
- M7b-EC4 [M] ADM-8: during shadow nothing reaches the origin channel, and command
  acknowledgements go to the self chat, never the customer.
- M7b-EC5 [M] ADM-9: an unknown chat is `ignored` and produces no output; a role
  change is audited and applies immediately.
- M7b-EC6 [M] ADM-10: a bot-authored message and another bot's message produce no
  output; a duplicated event produces one.
- M7b-EC7 [M] ADM-11/12: commands work only from authorised senders, the same text
  from a customer has no effect, and stop-all creates and sends no output for any
  chat while incoming messages are still stored.
- M7b-EC8 [M] ADM-13/15: no shadow output contains a commitment word or an
  internal (prompt, ledger id, profile key, model name).
- M7b-EC9 [M] The go-live gate requires every item passed or waived and a named
  sign-off, and a changed role, model, endpoint or handler version marks affected
  items `unchecked` (ADM-4, ADM-5, PRF-18).
- M7b-EC10 [M] A verification handler never marks an item passed without enough
  real traffic of the needed type (ADM-20, ADM-21).
- M7b-EC11 [M] A burst of messages inside N-13 yields one run, run N-13 after the
  last message; commands, kill switches and ops events are not delayed; a message
  arriving after a proposal exists supersedes it (BEH-16..18).
- M7b-EC12 [M] A customer message in a chat in handoff, pause or stop pings the
  admin once per waiting period with the chat reference and waiting time and no
  message text, and the ping and its end are audited (ADM-23..26).
- M7b-EC13 [M] A handed-off chat returns to the bot after N-14 of customer silence
  as configured, and a failed ping does not stop the bot (ADM-14, ADM-27).
- M7b-EC14 [M+U] Zapa runs the checklist for one real business's shadow phase,
  sees a real toast on the business machine, and confirms it matches how he sets
  up a business today. It stays open until a real shadow run exists.
- M7b-EC15 [M] A voice event reaches the handler only as a local transcript with
  `source: voice`; a failed transcription hands the chat off and pings the admin;
  an image or file event creates no model call and no output and is forwarded to
  the admins (in shadow, to the review channel only) (ADM-28..33).

## M8 Confidence signals and monthly calibration review

Spec: docs/06 (PRF-27..38), docs/05 (GWY-17).

- M8-EC1 [M] Every reply-type and classification proposal carries a band and its
  signals. The band rule is deterministic and tested: a failed check or an
  untraced statement caps the band at `low`; self-assessment can lower the band
  and never raise it (PRF-27..29).
- M8-EC2 [M] The capability test records whether log-probabilities are returned;
  the log-probability signal is used only when they are (GWY-17).
- M8-EC3 [M] Changing the handler version, model or endpoint marks the calibration
  `stale` and makes a review due (PRF-30).
- M8-EC4 [M] The monthly sample builder is seeded, reproducible and stratified per
  config, and draws only from stored real entries (PRF-32, HR-4).
- M8-EC5 [M] The calibration report shows counts per band for each marking and
  each confidence verdict, shows no single score, and when exported for the
  supplier contains no customer text or identity (PRF-33, PRF-34, PRF-37).
- M8-EC6 [M] A `high`-band entry marked wrong suspends auto-reply for that
  handler until a person re-enables it, and no threshold changes by itself
  (PRF-35, PRF-36).
- M8-EC8 [M] Staff can flag a reply with a reason tag at any time; the flag is
  stored against the proposal and the handler version, model and endpoint
  (PRF-39, PRF-46).
- M8-EC9 [M] The report shows the flagged/not-flagged by band counts, and every
  `false confidence` entry is included in full beside the sample (PRF-40, PRF-41).
- M8-EC10 [M] For each `false confidence` entry the report lists each signal's
  value, and counts how often each signal passed on flagged replies, without a
  combined score (PRF-42).
- M8-EC11 [M] An improvement proposal from a flagged entry names its target and
  the signal that missed it, and a replay shows its effect on that entry and on
  entries marked `match` before approval (PRF-43, PRF-44).
- M8-EC12 [M] A `wrong_fact` or `promised_something` flag on an auto-replied entry
  suspends auto-reply for that handler until a person re-enables it (PRF-45).
- M8-EC13 [M] A flag files a ticket holding the last messages and the bot trace;
  closing it as fixed wipes the transcript and keeps the note and trace (PRF-47).
- M8-EC14 [M] When open flags for a handler version reach N-12, exactly one
  heads-up is emitted, containing counts, flag-by-band counts and ticket refs with
  traces, and no transcript or identity value; a scrubber-failing note is
  withheld (PRF-48, PRF-49). It does not alert again until N-12 more flags are
  open (PRF-51).
- M8-EC15 [M] No code path reads, parses or obeys anything arriving from the
  supplier channel, and a failed send never stops the bot (PRF-50).
- M8-EC16 [M+U] Zapa receives a real heads-up on his own channel from a real
  shadow run and confirms he can find the failing replies from it (PRF-52).
- M8-EC7 [M+U] Zapa runs one real review with a client's staff on real shadow
  entries and confirms the report is usable by the business owner. This stays open
  until a client's shadow data exists.

## After M8 (not in v1)

See docs/09.
