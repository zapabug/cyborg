# feat-audit: the audit session, a "Start audit" button and the support period

Written 2026-11-06 from zapa. Branch `feat/audit` (worktree `../cyborg-audit`). IDs `AUD-*`. Builds on docs/13 (steps 3 and 4: shadow and audits), docs/06 PRF-15, 16, 24..26, docs/10 ADM-91 (the audit tab and markings), docs/02 N-9, N-18. "must" is a requirement, "may" an option. `PROPOSED` is mine and waits for a yes; `OPEN` is settled when the build reaches it.

## Why

The shadow period is not only the bot's test. It is a **support period** zapa offers the business, and the audit session in it is the thing he delivers and can sell again (a recurring service: every 3 days or weekly in the shadow, then monthly, N-18, N-9). Today the dashboard has an Audit tab where one draft at a time is marked (ADM-91), and the digest and usage commands print counts. It has no *session*: no start, no period, no what-if, no report. This feat adds that.

## What a shadow day is, and is not (zapa, 2026-11-06)

- AUD-1 In shadow the staff have a **normal day**. The bot listens and drafts to the review chat only; the staff are **not asked to rate** it, because to them it did very little. Nothing in the live shadow asks staff for a verdict.
- AUD-2 Staff give their verdict in the **test panel**, where they try the bot on purpose with questions of their own: the reply, a toast, and two answers, "answered well" or "needed more context" (with a field for what the context was). Those answers are entries in the same queue the audit reads (AUD-12). Not specified here beyond that; the panel's buttons are OPEN (a later milestone).
- AUD-3 The **audit session** is for zapa (or the person who supports the business) and is where each pair is judged.

## The data an audit sees (zapa, 2026-11-06: "not real chats")

- AUD-4 An audit reads **only the filtered form**, the same as a cloud bot gets (docs/04): identity and secrets replaced by vault codes, free text scrubbed (PRV-6). No name, number, address or email is in anything an audit shows, exports or sends to a model. A test fails on a planted phone number, email and name in a stored entry.
- AUD-5 An audit entry is a **pair**: the customer's message (scrubbed), the facts and context the handler was given (their keys and statuses; a contact's facts as facts, never the identity), the draft, what the office really answered (scrubbed), the handler version and the time.
- AUD-6 The business's real chats never leave its machine (HR-9). Claude, when zapa uses it in a session, sees only an **export of the filtered pairs** (AUD-14), never a live chat.

## The session

- AUD-7 **Start audit** is a button on the dashboard's Audit tab (level `advanced`, not the staff's everyday view). It creates a session record `{ id, startedAt, from, by, mode }`: `from` is the end of the last session (or the start of the shadow); `mode` is `with support` or `self`.
- AUD-8 The button's text **recommends a session with the support person** and links to the business's contact page. A session may be started alone; the record then says `self`. Whether the app says anything about price is OPEN (zapa); PROPOSED: nothing commercial is shown in the app, only the mode is recorded.
- AUD-9 **Period summary** first: the pairs in the period by handler version, the failures and refusals (what `pnpm digest` prints), the spend (`pnpm usage`), counts per marking. Never a single score (PRF-26).
- AUD-10 **The queue.** Each pair is marked with the ADM-91 reason tags (wrong fact, promised something, missed the question, wrong tone, too long, unclear, other) and one new tag **needed more context**, with a note on what the context was (a note the scrubber checks, PRV-6).
- AUD-11 **What if.** For a pair marked needed more context, the person adds the missing fact or lesson as a **candidate** (an unconfirmed proposal, HR-1, PRF-5) and the harness **replays that entry** with the candidate attached. The new draft is shown beside the office's real answer, and the result (would it now match, same, better, worse) is recorded. The replay's model call is recorded like any other (HR-6) and uses the business's own endpoint. A candidate becomes a fact only when a person accepts it.
- AUD-12 The test panel's verdicts (AUD-2) enter the same queue, marked as `test`. **Amended by zapa, 2026-11-09 (feat-desk DSK-76): they count together with real traffic**, because both are intended; the mark is for provenance and the audit view shows the split, but the counts are not kept apart.
- AUD-13 **Decisions.** Each finding ends as one of: a fact, a lesson, a check, a prompt change, or no change, with a reason. A change bumps the handler version (PRF-24) and is replayed over the earlier entries before it is accepted (PRF-25).
- AUD-14 **Export.** One command writes the session's pairs, already filtered, as a file zapa can open in his own Claude session (no key and no chat ever sits on the client's machine for that). OPEN (decide during build): whether a Claude call may also run from the dashboard; PROPOSED: no, the business's own model does the what-if replay only.
- AUD-15 **End and report.** Ending a session writes a report in the Status layout (what was reviewed, what was found, what was decided, what changed, the counts) and saves it with the date, the mode and who took part. The next audit's due date is set from the cadence config.
- AUD-16 **Audit due.** When the cadence date passes, an attention item appears on the board (yellow; ADM-94 pattern) saying an audit is due and offering Start audit. The cadence is config, never a number in code (HR-10); N-18 says "every 3 days or weekly, the rule for choosing is OPEN" and stays OPEN.

## Hard rules for this feature

- AUD-20 No identity in any audit output (AUD-4); the leak test covers the audit view, the export and the replay prompt.
- AUD-21 An audit changes nothing live by itself: facts, lessons and checks it proposes are proposals a person accepts (HR-1).
- AUD-22 The session record and report are kept locally with the business's data (HR-9) and never in the framework repository (HR-4).

## Milestones

| # | Title | Exit criteria |
| --- | --- | --- |
| AU1 | Session record, Start audit button, period summary (no model) | AUD-7..9, 4, 5, 20, 22 |
| AU2 | The queue with the new tag, and the export | AUD-10, 14, 12 |
| AU3 | The what-if replay | AUD-11 |
| AU4 | Decisions, the report and the audit-due item | AUD-13, 15, 16 |

PROPOSED: the order and titles. AU2..AU4 exit criteria are written when AU1 is confirmed (OPEN).

### AU1 exit criteria

- AU1-EC1 Start audit creates a session record with `from`, `by` and `mode`; a second start while one is open resumes the open one. Machine check.
- AU1-EC2 The period summary equals the counts the store holds for that period (pairs, refusals, spend, markings per version) and shows no single score. Machine check on a generated shadow period.
- AU1-EC3 A planted name, phone number and email in a stored entry never appear in the audit view or its summary (AUD-4, AUD-20). Machine check.
- AU1-EC4 The button is on the Audit tab only and its text names the support option (AUD-8). Machine check on the page; user check by zapa.
- AU1-EC5 The session record is stored in the business's own store and nothing is written to the framework repository (AUD-22).

## Open (decide during build)

- OPEN whether the app shows anything about price or the paid support (AUD-8).
- OPEN the test panel's two buttons and where they sit (AUD-2).
- OPEN whether a Claude call may run from the dashboard (AUD-14). Amended by zapa, 2026-11-09: the Start audit button may plug in any LLM to perform the audit (team first, an LLM eventually); see DSK-35..38 in `feat-desk.md`.
- OPEN the rule that picks the 3-day or weekly cadence (N-18).
- OPEN contact cards (a contact's remembered facts, kept by code, shown to the model without identity) are their own feat, first written as DSK-24..27 in `feat-desk.md` (PROPOSED); the what-if replay (AUD-11) is where a missing card fact is found first.
