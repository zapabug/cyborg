# feat-tailored: one cyborg, a tailored system for each customer

Written 2026-11-06 from zapa. Branch `feat/tailored`, cut from `feat/wazaa-port`. IDs `TLR-*`. "must" is a requirement, "may" an option. `PROPOSED` is mine and waits for zapa's yes. `OPEN` is settled when the build reaches it.

This **replaces** `feat-verticals` (first draft kept in git history, commits b02edf6 and c885a77). That draft modelled a hairdresser, a gym and a cake maker in advance. zapa's ruling of 2026-11-06: "we don't need to know any of this; we need to know how cyborg works and how the WhatsApp intake works; how the business runs is the intake questionnaire."

**zapa's ruling of 2026-11-06: HR-1 is changed.** The business may switch on any task, commitments included, and the business owns its copy of cyborg and may change it, with Claude or any coding AI. zapa is committed to a framework that can "make any AI know your business". HR-1 (AGENTS.md) and HDL-3 (docs/03, `registry.ts`) are reworded when T4 is built (TLR-47), not before.

## The idea

- **Top level: cyborg, working the wazaa way.** It knows how a WhatsApp business is read (chats, roles), how the intake works, how to run in shadow and how to protect names and data. It knows nothing about any trade.
- **Customer level: the intake questionnaire says how this business runs.** From its answers a tailored system is built: facts, rules, wording, the tasks to switch on. It runs in shadow. Afterwards, tasks that repeat and go smoothly may be switched to automatic, by a person's decision.
- **It must work at the start, and zapa must be able to fix it when it breaks.**
- **The knowledge is the product.** What the business knows (facts, rules, lessons, wording) is held by cyborg in the business's repository, not inside any model, so any AI can be put on top of it and swapped (TLR-53). The business owns the whole thing and may change it (TLR-50).

| Layer | Holds | Changed by |
| --- | --- | --- |
| cyborg (framework) | handlers, proposals, scrubber, vault, shadow, checks, the tab shell | zapa, by a feat |
| the wazaa layer (company layer and channel adapter) | WhatsApp link, chat picker, roles, office commands, test chat, intake importer | zapa |
| the customer repository | config, facts, lessons, rules, wording; own code only if the business is truly unusual | zapa with the client, from the intake |
| the automation switches | which tasks answer on their own, all of them | **the business**, from its dashboard (TLR-42) |
| the business's own copy of cyborg | the whole source, under AGPL | **the business**, with Claude or another coding AI (TLR-50..52) |

## Hard rules (these never break)

- TLR-1 No trade in the framework. No business word of any trade appears in framework or module source (MOD-6, the source scan). A trade lives only in a customer's data.
- TLR-2 Shadow first (HR-8). Nothing answers a customer or changes a record on its own before a recorded shadow run. After it, the business decides what runs without a person (TLR-42, 43); until the business switches a task on, its output is a draft or a proposal a person approves. This replaces HR-1's "a person always approves".
- TLR-2a Data protection does not change in what ships: identity (names, addresses, phone numbers) never reaches a prompt or a cloud model (HR-2), businesses are isolated (HR-9), every action and every switch is audited. This is zapa's own rule, not a client request. Clients are not asked about it, it adds no step to the install, it is on by default and not a dashboard switch, and it is not part of the sales pitch. A business that changes its own copy (TLR-50) owns that change; the shipped tests (TLR-52) say what it breaks.
- TLR-3 No mock data (HR-4). Everything the system says comes from the client's own answers, confirmed.
- TLR-4 Numbers come from the client (HR-10, WZP-9). The questionnaire asks for each one; a missing one stops the check and is named.
- TLR-5 **Fixable by hand.** Everything that decides what the bot says is a fact, a lesson, a rule or a wording line that zapa can read and edit in the customer repository or the dashboard. No hidden state, and no code per customer is needed for the first system.

## A. The questionnaire (how the business runs)

It extends the intake (WZP-20..29): the same message format and importer.

- TLR-10 One business questionnaire, in plain words, in the client's language, answered once: what customers ask for (the things sold or booked), what they usually want to know, what needs the owner's decision (never automatic), prices and which are "from" prices, notice needed, cancelling, how money is taken and who takes it, opening times, who does the work and when, **what is limited** (TLR-20), busy and quiet times, closed days, tone, words never to say.
- TLR-11 Follow-up questions per customer: after reading the first answers zapa may add questions for that one customer. Answers are stored the same way.
- TLR-12 Every answer becomes an `unconfirmed` statement with the message as source (WZP-29). The client confirms in the dashboard.
- TLR-13 The importer reads the answers without a model. A model may propose where a free-text answer belongs (a fact, a rule, a limit, a wording line) with the source phrase; low confidence means "decide" (WZP-33). Nothing is applied until a person confirms.

## B. Building the tailored system

- TLR-14 A **build** step turns the confirmed answers into the customer repository's draft: `company.json`, config, facts, the task list (WZP-23, 24) and a limits section when the business has something limited. Running it again after an answer changes gives a **diff**, never an overwrite.
- TLR-15 `pnpm company check` names every missing number or fact in plain words and says which question it came from.
- TLR-16 The build writes no code for a customer. An answer config cannot express goes on a "not covered yet" list for zapa (WZP-24 `not_covered`), and the bot hands that kind of request to the office.

## C. Limits: one idea, not three modules

A hairdresser is task time against a calendar. A gym is time slots against total attendees. A cake maker is cakes at once, and which cakes can be made together. All three are a limited thing used for a length of time.

- TLR-20 A **limit** is a named thing (a person, a room, an oven, a class) with: how many uses at once (its capacity), when it is available (weekly hours, closures), and what uses it: items with a length of time and optionally a sharing group (items of one group may share it). The client describes them in the questionnaire; the build writes them in the config.
- TLR-21 Code checks limits. The model never decides a time, a seat or a count (it reads the customer's words; code resolves, computes and offers only what fits). The funnel is the one bookings uses: read (model), step (code), request proposal a person approves, reply draft with the computed facts (WZP-51..53).
- TLR-22 The maths (times in the business's zone including daylight saving, intervals, capacity over time, holds on pending requests) is a pure library package `@cyborg/slots`: no I/O, no clock. It is built when the first real intake with a limit arrives (TLR-60), because what the client says decides its shape.
- TLR-23 A calendar the business already keeps (read-only, ICS) and a waitlist come in only when a customer's intake asks for them. The first draft's text for both (VRT-59..70, VRT-40..46) is the starting point.

## D. Shadow, and fixing it

- TLR-30 The shadow loop that exists is the one used (PRF-18..26): each draft is paired with what the person actually did, marked, and every miss can raise an improvement proposal that names a fact, a prompt, a lesson or a check.
- TLR-31 Every draft can show **why**: the facts used, the rule and the checks that passed or blocked it. A shadow entry can be **replayed** in the test chat with the same facts, so a break can be reproduced.
- TLR-32 The **fix menu**: for a wrong answer, one of edit a fact, add a lesson, add a rule in config, change a wording line. Each is a proposal a person approves, is audited, and can be reverted (handler versions, PRF-24).
- TLR-33 A **health view** for each customer, one list: drafts blocked by checks (count and why), handler errors, questions with no answer, facts still unconfirmed, a source that has gone stale, the last time anything arrived. It extends the heads-up monitor.
- TLR-34 The whole tailored system lives in the customer repository and its data folder; copying both is a backup, restoring them is a restore (HR-9).

## E. Automating what repeats

- TLR-40 For each task (a handler and a kind of request) the dashboard shows, from the shadow entries: how many times it came, from how many different customers, how often the person sent the draft unchanged, how often changed, how often flagged.
- TLR-41 A task becomes a **candidate** when those counts pass thresholds set in config (least occurrences, least customers, least unchanged share, no flags in the last stretch). The starting numbers ship with the product (zapa's, HR-10) and only decide when a task is *suggested*; they do not decide whether it may be switched on. The dashboard lists candidates and switches nothing by itself.
- TLR-42 **The business holds the switch, not zapa.** Each task has an on/off toggle in the business's own dashboard, for its owner and ops operators; zapa's approval is not needed. A toggle can be switched on only while the live gate is met (PRF-18, HR-8: a recorded shadow run, the facts the task uses confirmed, the checklist signed by the business). When it is not met the toggle is off and says which part is missing. The switch uses the existing auto-reply policy for that named handler and is audited with who flipped it and when. A task may be switched on without being a candidate; the candidate list is advice.
- TLR-43 **Commitments have a switch too.** Confirming a booking or order, promising a price, cancelling and the like are tasks like any other. The first time the business switches on a task that can commit it, the dashboard says in plain words what it will then do without a person and asks the owner to confirm; the confirmation is recorded with name and time. A task the client marked "never automatic" in the questionnaire (WZP-26) shows that answer in their own words when they switch it on. The framework has no payment or signing connector; if the business adds one (TLR-50), its switch is theirs.
- TLR-48 The code checks stay in force on automatic sends: a computed fact is stated as computed, a time, price or seat the code did not compute is blocked (VRT-3). A draft that fails a check is not sent; it goes to the office as a card, as in shadow. Automatic never means unchecked.
- TLR-44 A flag on an automatic reply (wrong fact, promised something) puts that task back on drafts at once, shows the business the reason, and opens a ticket for zapa to fix (PRF-45). The business may switch it on again after reading the reason. Putting a task back, by a flag or by the business, needs no approval. The existing global stop stays with the business.
- TLR-47 What changes in the existing rules, done in T4: AGENTS.md HR-1 is reworded to the business-holds-the-switch rule (TLR-2); HDL-3 and `registry.ts` stop refusing `auto_reply` for a handler flagged `commitment` and instead require the owner's recorded confirmation (TLR-43) in the business's config; docs/03 line 22 and the tests that assert the old refusal are changed with them; the `commitment` flag stays, as the marker that triggers the confirmation.
- TLR-46 zapa can see, in the health view (TLR-33), which tasks each business has switched on and every switch with its time and who, so a break can be traced to a change.
- TLR-45 The same view shows customer flow: when chats arrive (hours and days), from the event times. It is counting, no model. It shows the client where an automatic answer would save the most.

## F. The business owns it, and any AI can sit on it

- TLR-50 The customer repository is the business's. The framework source is open (AGPL-3.0-only); the business may change cyborg, its modules and its repository with Claude or any coding AI, and add connectors of its own.
- TLR-51 Each customer repository is scaffolded with an `AGENTS.md` written for an AI coding agent: where things live, the exact verify commands (`pnpm check`, the simulation scripts), what a change must keep (TLR-2a, TLR-52), and how to try a change in the test chat before it reaches a live chat. A plain-words note for the owner sits beside it.
- TLR-52 What protects the business from a careless AI edit is the repository's own tests, which run in its `pnpm check`: the leak test (identity never reaches a prompt), the module source scan, the data-class checks, and the business's own simulation scripts. A change that fails them is not ready, and the AGENTS.md says so. These tests are shipped with the repository and are not hidden from the AI.
- TLR-53 Model-agnostic. The gateway talks to any OpenAI-compatible endpoint (a local model, OpenRouter, a hosted Claude); the business picks. Because the knowledge lives in cyborg, switching model keeps it. Before switching, the shadow entries can be replayed on the new model and compared with what the person actually sent (PRF-25), so the business sees the difference first.
- TLR-54 OPEN: AGPL's duties when a business changes cyborg and runs its own copy for its own customers' chats; zapa to check before the first shipped repository.
- TLR-55 (feat-desk DK2, 2026-11-09) **A `Principles:` list in the business sheet.** Lines like `- [qualify] Always end with one question for the next missing detail | check: ends-with-a-question`: the rule in the client's words, an optional stage in square brackets (greet, qualify, offer, close, handoff), and an optional check by name from the fixed list the framework offers (`ends-with-a-question`, `one-question-only`, `no-pressure-words`). The reader numbers them P1, P2 and keeps them as the fact `rules.principles` (unconfirmed like every fact). A stage or a check the framework does not offer is listed as unread with the names that are offered, never guessed. `pnpm tailor` turns on `modules.sales.principles` when the sheet has them; the Business tab does not change the config, so a business that adds principles later needs that flag (OPEN). Labels in Portuguese: `Princípios:`.

## Milestones

Each is a committed run on `feat/tailored`, confirmed by zapa before the next. `[M]` machine check, `[U]` zapa.

| # | What | Exit criteria |
| --- | --- | --- |
| T1 | The business questionnaire and its importer (A) | [M] a real answer set parses with every line accounted for, and an unreadable line is listed, not guessed. [U] zapa reads the draft and says what is missing. |
| T2 | Build step, diff and check (B) | [M] building twice changes nothing; changing one answer shows a diff of that answer only; the check names the question behind a missing number. [U] zapa builds a customer from a real intake. |
| T3 | Fix tools (D) | [M] a shadow entry replays in the test chat with the same facts; each fix-menu item is a proposal, audited and revertable; the health view lists what it should. [U] zapa breaks something on purpose and fixes it from the menu. |
| T4 | Repetition view and candidates (E) | [M] counts come from the shadow entries and match a hand count; thresholds come from config; a task that commits the business is never a candidate; a flag puts a task back on drafts. [U] after a real week of shadow. |
| T7 | The business owns it (F) | [M] a scaffolded repository contains the AGENTS.md of TLR-51; its `pnpm check` fails when a test edit lets a name into a prompt; the replay on a second model gives a side-by-side with the person's replies. [U] zapa gives a repository to Claude with a plain request and the checks catch a deliberate mistake. |
| T5 | Limits (C) | Built when the first real intake with a limit is in hand; exit criteria are written from it. |
| T6 | A first customer end to end | [U] intake, build, shadow, a tweak, and the first candidate. |

Order: T1, T2, T3 first, then T7 (it decides how the first customer's repository is handed over). Then T6 with whichever customer is first. T4 once shadow data exists. T5 when an intake needs it.

## PROPOSED (waiting for zapa's yes)

- P1 This file replaces `feat-verticals`; the branch is `feat/tailored`.
- P2 The three layers above.
- P3 A generic questionnaire plus per-customer follow-up questions (TLR-10, 11).
- P4 Limits as one idea built on demand (TLR-20..23), and the first draft's calendar and waitlist text kept as reference.
- P5 Candidates are counted from the shadow entries and listed as advice; the business flips the switch, subject to the live gate, with no approval from zapa (TLR-40..42, 46).
- P6 Commitments have a switch with a recorded owner confirmation (TLR-43); the code checks stay on automatic sends and a failed check goes to the office (TLR-48). HR-2 and HR-9 do not change.
- P7 The business owns its copy and may change it with an AI; the repository ships an AGENTS.md and its own protective tests (TLR-50..52).
- P8 Any model through the gateway, with replay before a switch (TLR-53).

## OPEN (decide during the build)

- Where the questionnaire page lives (zapa's nsite repository) and who edits it; whether the follow-up round is a second form or a chat.
- What counts as "the same kind of request" when counting repeats (the handler plus the intent the read step gives, or something else).
- Replaying a shadow entry needs the facts as they were then: whether the store keeps fact versions, or the entry keeps a copy of what it used.
- Starting values for the candidate thresholds (asked at the first audit).
- Who counts as an operator who may flip a switch (PROPOSED: the owner and ops roles of the business's own staff list).
- Where backups go.
- Who the first customer is, and whether they have a limit (decides T5).
