# feat-wazaa-port: all of wazaa, on cyborg, set up from the intake

Written 2026-11-05 from zapa. Branch `feat/wazaa-port`. IDs `WZP-*`. Builds on, and where it says so replaces, docs/10 (ADM-102..111) and docs/14. "must" is a requirement, "may" an option. `PROPOSED` is mine and waits for a yes; `OPEN` is settled when the build reaches it.

## Why

wazaa was the test bot for Demo Tours (WhatsApp concierge for a tour operator). cyborg is the framework it is being rebuilt on: typed handlers, checks in code, every output a draft a person approves, shadow first. zapa's ruling: **wazaa is retired because everything in it is ported** (docs/14 stays right on that). The 2026-11-05 check found it is not true yet: wazaa has 6 dashboard tabs and about 50 routes, cyborg's dashboard has 3 tabs and 8 routes. This feat closes the gap, and does the install the way zapa sells it, not the way wazaa did it.

This feat **replaces** two earlier rules:
- ADM-105 (chats named by hand as digits in a `whatsapp.json`). Chats are now found and chosen from the account itself (WZP-30..39).
- docs/14 "Demo Tours starts from scratch, nothing carried over from wazaa's code". wazaa's code and docs are the spec for every part below; wazaa's own facts still enter only as unconfirmed statements (docs/14 point 2).

zapa's ruling of 2026-11-05: **the old wazaa code is not needed.** Its design docs, YAML config and scripted test chats were copied into the Demo Tours repository (`docs/wazaa/`), and a full archive of the source was made in zapa's loadstone staging (without `node_modules`, `session` and `.env`). `docs/wazaa-parity.md` lists every wazaa route, command, tab, setting and test area with where it lives or which milestone ports it. Everything still to build is specified from those docs and tests, never by reading or running the old code, and the old folder is removed from `~/Projects` so nobody confuses it with the framework.

## The install flow (what zapa sells)

1. **Intake.** The client fills in the intake nsite (`plebworld/public/wazaa/intake`, also `intake-form/inputform`). Answers arrive as private messages.
2. **QR scan.** The client links WhatsApp from the dashboard. Nothing is typed in.
3. **Custom setup.** The intake answers and the account's own chats build a draft company model, config and chat roles. Every part is unconfirmed.
4. **Shadow.** A person confirms the draft in the dashboard; the bot reads and drafts to the review chat only.
5. **Tweak.** The audits (docs/13) change facts, lessons and settings until zapa and the client switch a task on.

- WZP-1 The install must not need a hand-edited file, and no phone number, JID or name may appear in code, config templates or docs. Numbers are learned at link time and kept only in the channel file and the vault (ADM-104).
- WZP-2 Every step above must be doable from the dashboard on the client's machine, with zapa's help at the screen, in the order shown. A step that fails leaves the earlier steps' results in place.

## wazaa's principles, and what carries each one

| wazaa principle | Carried by |
| --- | --- |
| Deterministic first: rules do the work, the model is persona and fallback, never a source of truth | handlers, checks in code (HDL, SAL), HR-1 |
| Replies are finals: no thinking, no "let me check", no announcing | draft checks and persona (ADM-74..80), WZP-12 |
| Never talk about bots or automation; write like the bookings desk | persona (CMP-32) |
| Prices, dates, capacity from facts, never invented | draft checks over the profile (SAL-5), confirmed facts only live |
| Team chats are read-only and use zero model calls | `monitor` role, WZP-60 |
| When it does not know, it asks the office and relays the answer verbatim | office answers and handoff (PRF-65, ADM-56), WZP-45 |
| Learns from the office's answers and from lessons | improvements (PRF-65), lessons, WZP-46 |
| A handoff freezes the bot until a person resumes | ADM-14, WZP-41 |
| Nothing reaches a customer before approval | HR-1, HR-8, shadow mode |
| Auditable and local: everything on the company PC | local stores, vault, ADM-87 |

- WZP-3 No wazaa behaviour may be dropped or changed without a line in the parity list (WZP-80) saying what and why.

## Hard rules (these never break)

- WZP-4 Shadow mode only (HR-8). No path from a handler or a dashboard control to a customer chat in this feat. The test chat (WZP-10..19) never touches a channel.
- WZP-5 Reading a client's real chats needs the client's written agreement first. Settled 2026-11-06 (zapa: "the fine print with an acknowledgement check"): before the account's chat list is shown, before any chat can be chosen, and before any message of a chosen chat is read, the dashboard (Configurar) shows the fine print and the client's person presses one "I agree" button (no tick box, no typed name: the install stays short). The record (when, the version of the text, the dashboard's operator label) is kept on the install machine in the channel's data folder, never sent to a model. The fine print is the framework's short statement of what is read, what is stored, what goes to the AI service and what never happens (nothing is sent to customers in shadow mode), followed by the business's own terms file (`terms.md` in the business folder) when it has one. The text states only what the scrubber does (docs/04 PRV-6): phone numbers, email addresses and other numbers are replaced by placeholders; it never says names are replaced, because names inside free text are not detectable (PRV-7), and it says that names a customer writes in a message reach the AI service the client chose (audit 2026-11-10). A change to the text changes its version and asks again. Until the record exists the channel watches nothing, even with a `whatsapp.json` that already names chats, and no message of a customer chat is stored or logged.
- WZP-85 (zapa, 2026-11-09: "there is nowhere I can log in or log out from WhatsApp") **Unlink.** The Configure tab shows which account is linked and has an **Unlink WhatsApp** button. It asks first, in words ("this logs the account out of this computer; chats stay on the phone; to use the bot again you scan a new code"), and only the second press does it. Unlinking logs the account out of the linked device, stops the client, **deletes the stored session** (the channel's `session` folder, the only thing on the machine that keeps the account signed in), writes an audit row (`channel_unlinked`, who, when; no number), and starts a fresh client so the link panel shows a new QR code. The channel file, the roles, the agreement and every record stay; nothing is read or sent while unlinked. It needs the dashboard's token like every change (DSH-1). A failed log out (the phone offline) is said in the tab and the stored session is deleted anyway, so this computer no longer holds the account, and the person is told to remove the linked device in WhatsApp on the phone.
- WZP-6 No mock data (zapa's standing rule). Every fact the bot answers from is the client's, a drafted-from-their-published-facts unconfirmed statement, or marked demo (WZP-16). No sample rows on a page.
- WZP-7 Names, numbers, rooms and messages stay on the machine; the model sees refs and scrubbed text (PRV, ADM-104, ADM-110).
- WZP-8 No new dependency in `@cyborg/dashboard` (ADM-87, DSH-3). Node 26.12.0, TypeScript 7.0.2, pnpm as in AGENTS.md; `pnpm check` stays green at every milestone.
- WZP-9 A number is never invented in code. Every time, count, limit or delay is read from the config or a doc (numbers in wazaa's `agent.yaml` are the starting values, copied with their source).

## A. The test chat (the demo)

wazaa: `POST /api/simulate` and `/api/simulate/ops`, the "Conversas de teste" panel under Configurar, `npm run sim`.

- WZP-10 The dashboard must have a test chat: staff or a prospect types as a customer, and the company answers through the same gate, handlers and checks as a real chat, with the channel replaced by the page.
- WZP-11 Several independent test chats must be possible, each with its own conversation lines, kept by the page in the browser as in wazaa.
- WZP-12 A test reply shows: the draft, its confidence band, the facts it used, the checks that passed or blocked it, and the card when it needs the office. No internal names (DSH-7).
- WZP-13 A second box types as the office (wazaa's `/simulate/ops`): the ops commands of WZP-45 work in it and show what the customer chat would then get.
- WZP-14 Owner commands (`stop pause start new save bug idea help`, wazaa docs/04) work in test chats and show their acknowledgement as the reply.
- WZP-15 A test chat runs on a store and vault of its own (D2), never the shadow install's, and makes model calls only (nothing else leaves the process). A test chat with no WhatsApp linked must work.
- WZP-16 **Demo base.** `pnpm new-customer demo --name "<name>" --into ~/Projects/cyborg` makes a business repository whose facts are marked `demo` in the profile and in the page header. PROPOSED: the demo facts are written by zapa for a made-up tour company; this is the one place mock facts exist and it needs zapa's yes (WZP-6). OPEN: or Demo Tours' own published facts with Demo Tours' OK.
- WZP-17 **Try it with your business.** A copy of the demo base takes a client's intake answers (WZP-20..29) as unconfirmed statements, so the prospect tests the bot with their own tasks and facts. The copy is a separate repository folder and carries nothing from other clients.
- WZP-18 The test chat must read the same `company.config.json` as the install (model, persona, wording), so a demo shows what the shadow would do.
- WZP-18a The test chat and a simulated day (`pnpm simulate`, the editable script) run the same scrubber as a real chat (PRV-6). A phone, tax or ID number, a bank number or an email address in a line is replaced by a placeholder before the model, and the task is still done; the Test tab says in words what was replaced ("the model saw [PHONE_1]") and the simulation step names the rules and the count. A name typed in a message is not caught (PRV-7), here as in a real chat.
- WZP-19 `pnpm simulate` stays as the scripted version; a test chat can be saved as a simulation script (day.json step list).

## B. The intake in

The intake page builds one text message (`*Title*`, `Filled in by: …`, numbered task lines `N. <task>: who · time · Yes/No/Maybe · "notes"`, then `*<short>:* <answer>` lines, an optional pickups block). It arrives as a private message tagged `t=intake` (`inputform/README.md`).

- WZP-20 An importer must read an intake message into a structure with no model call: for each numbered task, who, time, the automate choice and notes, plus the eight answers by their short label. A line it cannot read is listed, not guessed.
- WZP-21 The importer must read the intake task list from the intake site's own data file, not from a copy typed in cyborg, so the two cannot drift. OPEN: how the file is read (a path in the business repository, or published with the site).
- WZP-22 Source: `pnpm inbox` of the intake app lists the clients; the importer takes a message by npub from that tool or from a pasted text. cyborg must not hold the intake app's key. OPEN: whether a command in the intake app writes the structure, or cyborg reads the inbox through its own tool.
- WZP-23 The structure becomes a draft `company.json` and a draft task list in `company.config.json`: each ticked task is mapped to the module and handler that does it (WZP-24), with the client's automate choice kept beside it.
- WZP-24 **Task map** (a table in a config file, not in code, MOD-6): answering questions, prices and quotes, availability, bookings and orders, unanswered questions, reviews and complaints, after-hours messages map to existing handlers; follow-ups, reminders, changes and cancellations, daily planning, staff reports and maintenance map to modules this feat builds (WZP-52, 60..); payments never map to an auto handler (ADM-13); listings and website have no handler and are listed as "not covered".
- WZP-25 Automate **Yes** marks the task a candidate for the live gate (PRF-18); **Maybe** is a candidate after the first audit; **No** keeps the task draft-only and locked. Nothing becomes automatic in this feat (WZP-4).
- WZP-26 Q6 (never automatic) and Q7 (never promise) must become entries in the commitment-block list and the persona rules as text the client wrote, quoted, with their source, and must be shown to the client to confirm before shadow.
- WZP-27 Q5 languages set the staff languages and the reply languages; Q4 volume sets the call-cap draft (a draft only, zapa confirms; WZP-9).
- WZP-28 Q3 channels other than WhatsApp are listed in the report as out of scope for now, never silently dropped.
- WZP-29 Every imported value is an `unconfirmed` client statement with the message as source. A client confirms in the dashboard (WZP-35).

## C. Link, chat intake and roles (replaces ADM-105)

wazaa: `/api/qr`, `/api/chats`, `/api/targeting`, `/api/roles`, the Configurar tab (targeting list, ops chat, maintenance groups, partner chats), `seen_chats`.

- WZP-30 **Link.** The dashboard shows the QR (ADM-111 stays). After link the adapter learns the account number and keeps it in the channel file and vault only. The first start needs no `whatsapp.json`.
- WZP-31 **Chats by name.** After link, with the agreement of WZP-5 recorded (until then the tab shows the fine print and no chats), the dashboard must list the account's chats and groups by display name, kind (1:1 or group) and last-activity time. Numbers and JIDs are not shown, except in the channel's own configuration view (DSH-5).
- WZP-32 **Choose what to read.** The person ticks which chats the intake may read. The default is none. Only ticked chats are read (privacy first; OPEN: whether reading the account's existing history of a ticked chat is allowed at all, or only new messages).
- WZP-33 **Read and sort.** For each ticked chat the adapter reads recent messages (how many: OPEN, a config value, WZP-9), scrubs them (ADM-110) and the company proposes a role: `reply` (customer), `monitor` (team), `ops` (office), `partner` (WZP-61) or `ignored`. PROPOSED: the proposal is deterministic first: group or 1:1, who writes (the account's own person or others), booking/price keywords from the intake task answers and config, fleet asset names from the fleet list (WZP-60), command words. A model may add a proposal only with source phrases (HDL-6), and a low-confidence chat is shown as "decide" and not given a role.
- WZP-34 **Tasks per chat.** Each chat gets, with its role, the list of the client's ticked tasks that apply there, shown by the intake's own task names. A `reply` chat gets the customer tasks, a `monitor` chat the staff ones, an `ops` chat the office ones. The person may add or remove.
- WZP-35 **Confirm.** Nothing is watched until a person confirms the proposal in the dashboard (one screen: the chats, each role, each task, the commitments of WZP-26, the facts of WZP-29). Confirming writes the channel file and the roles, and restarts the run without a new QR (D2 of docs/14).
- WZP-36 The ops chat and the review chat must never be a `reply` chat (ADM-8). The dashboard must say why when a choice is refused. The review chat is the account's own "message yourself" chat unless one is chosen.
- WZP-37 A new chat that writes to the account after confirmation is listed as "new, not watched" on the board (wazaa's `seen_chats`); it is never read until chosen.
- WZP-38 Changing a role or a task later is one control in Configurar and takes effect after the same silent restart; it is written to the audit table with the operator (DSH-3).
- WZP-39 Authorised senders (who may use commands) are chosen the same way from the account's own person and the ops chat's members, never typed as digits.

## D. Dashboard: the tab contract and wazaa's tabs

Implements DSH-1..7 of docs/14 for the tabs below; the Levada look (DSH-6) applies.

- WZP-40 The shell and the tab contract (DSH-1) before any tab: a module or an integration contributes a tab id, label per staff language, level (Simple/Advanced), order, routes under `/api/tab/<id>/` and the script that draws it. A test proves a tab from a test module shows and one not turned on does not.
- WZP-41 **Conversas** (wazaa `/api/conversations*`): the chat list with names, the lines of a chat, who has it (bot, person, handoff), take over, hand back, mark done. The reply box is shown off in shadow, with the reason (DSH-5).
- WZP-42 **Configurar**: link status and QR, WZP-31..39, the test chat (section A), language, retention run (wazaa `/api/retention/run`, PRV-10).
- WZP-43 **Início** and **Registo** from the shell (DSH-2); **Auditoria** (ADM-91) stays.
- WZP-44 **Guardados** (what was saved with `save`/`bug`/`idea`, tickets): wazaa `/api/tickets*`, `/api/scratchpad` (the reasoning scratchpad stays on the machine and is shown to staff only in Advanced).
- WZP-44b **A note holds no number it should not.** A `save`, `bug` or `idea` note is scrubbed when it is saved (docs/04 PRV-6, PRV-6a): a phone, email or other number in it is replaced by its placeholder and the note is kept; the audit row holds the placeholders, never the original (audit 2026-11-10).
- WZP-45b **`LEARN` keeps no personal detail.** What `LEARN` adds to the FAQ is a business fact the next customer is told, so it must hold nothing the scrubber would replace (docs/04 PRV-6). When the question or the answer has a phone, email or other number, nothing is learned, the command says so, and the answer is not given either (it is checked before anything is done); the person uses `ANSWER` for this customer, and puts the business's own numbers in the sheet where the client confirms them (audit 2026-11-10).
- WZP-45 **Perguntas** (wazaa `/api/questions*`): the questions the bot asked the office with their answers; answering from the page or by `ANSWER <ref> <text>` in the ops chat gives the customer's draft the answer verbatim (nothing sent in shadow, shown in the review) and, with `LEARN`, creates a fact improvement proposal (PRF-65).
- WZP-46 **Lições** (wazaa `/api/lessons*`, `/api/learned*`, docs/17): list, add, edit, delete; a lesson is in the next draft's prompt and changes the handler version (HDL-2).
- WZP-47 Every action shows a plain Portuguese error when it fails and is disabled while it runs (DSH-7). A live update never wipes typing or scroll.
- WZP-48 The ops-chat commands of wazaa docs/05 are accepted from the authorised sender or ops chat: `ANSWER`, `LEARN`, `RESUME <ref>`, `STATUS`, `HELP` here; `CONFIRM`/`DECLINE <ref>` with WZP-52; `DONE`/`SCHEDULE` with WZP-62. Portuguese aliases as in wazaa docs/12.

## E. Conversation state and bookings

wazaa: the funnel (tour → people → date → slot check → proposal with price → confirm), docs/03, docs/09, `/api/bookings*`.

- WZP-50 The conversation state store: per chat, module-owned, versioned and audited, holding the stage and the booking being built. It is a module feature, not a core one (docs/14 "What does not map cleanly" 1). It must never hold identity values (vault codes only).
- WZP-51 Booking read handler (intent, language, **service** (the thing booked: whatever the business calls it, from its own `offer.items`), group, date, explicit yes). No trade word is in the code or the prompt (TLR-1, MOD-18): the field, the funnel and every line the customer or staff reads say "service" or the business's own name for it, which comes from the sheet, a deterministic quote handler (price, running days, closed dates, capacity, group pricing, alternatives within a number of days from config) and the existing reply draft, in that order. wazaa's JSON shape is the starting spec; its numbers come from `config/agent.yaml` and `catalog.yaml` with their source (WZP-9).
- WZP-52 A booking is a proposal with a status `proposed` → `confirmed`/`declined` by a person (CONFIRM/DECLINE in the ops chat or on the Reservas tab). The customer is told "You will receive confirmation" only as a draft; nothing is sent in shadow (WZP-4).
- WZP-53 A booking only moves forward on an explicit yes word from the customer (wazaa's multilingual list, in config), never on a model's reading.
- WZP-54 **Reservas** tab: the bookings with status, group, date, price, the chat by name; confirm/decline.
- WZP-55 "Last minute" days (today and tomorrow) give the honest line from config, as wazaa.
- WZP-56 OPEN: pick-ups (`PICKUP B-x hotel 09:05`) and the day-before reminders, with WZP-62.

## F. Team, fleet, partners, sheets

- WZP-60 **Maintenance module**, no model call (wazaa `monitor/`, docs/15 §1): a `monitor` chat is scrubbed (phones, emails), scanned for fleet assets (plates, tags, nicknames from the client's fleet list) and issue words, with a co-occurrence window and a 24 h dedupe of records (numbers from config, WZP-9), and builds a maintenance record per asset with a track record. Raw group messages are never stored, only scrubbed snippets.
- WZP-61 **Partner chats** (wazaa docs/16): a role `partner`, one request per guest, a partner list with name and pick-up; tab **Parceiros** (`/api/partners*`).
- WZP-62 **Fleet and plan** (wazaa docs/15): next-day lists, readings (`/api/assets/:id/readings`), due dates, the maintenance worklist and its send. Any message to a driver, partner or customer is a draft a person approves (WZP-4). Tabs **Manutenção**, **Viaturas**.
- WZP-63 **Schedule triggers**: follow-ups, day-before reminders, cancel a service day and tell those affected (wazaa docs/14, BEH-8). Outbound text is always a draft.
- WZP-64 **Service sheets** (wazaa docs/06): a handler with image input; the gateway sends text only today, so this needs a gateway extension decided first. OPEN. Until then, images follow ADM-18 (forwarded to the admins).
- WZP-65 Learned names (wazaa `/api/learned`): common names for services and places that the bot learned, shown and removable, as facts, never as an unconfirmed claim a customer sees.

## G. Port parity and retiring wazaa

- WZP-80 A parity list `docs/wazaa-parity.md` must exist, one row per wazaa route (`app.get/post/delete` in `src/api/server.ts`), per owner command (docs/04), per ops command (docs/05), per tab, per config key of `config/*.yaml`, and per test file area. Each row says: ported (where), replaced (why), or dropped (zapa's yes with date). It is generated from wazaa's code by a script and kept by hand after.
- WZP-81 A check must fail when a wazaa route or command is in neither the ported, the replaced nor the dropped column.
- WZP-82 wazaa's 220 tests and scripted chats become simulation scripts (docs/12), Portuguese and English; the share that passes is reported, not hidden.
- WZP-83 (zapa, 2026-11-05, replacing "retired only when WZP-80..82 are met") The old wazaa folder is removed from `~/Projects`; its knowledge is in `test-business/docs/wazaa/` and its archive in loadstone. WZP-80..82 now decide when the port is *complete*, not when the old code may go.
- WZP-84 Every milestone from W5 on takes its behaviour from `test-business/docs/wazaa/docs/*.md` and its scripted chats from `test-business/docs/wazaa/tests/`, as the spec of record; a behaviour those do not cover is OPEN and asked, not guessed from memory of the code.

## Data

- Real: the client's intake messages, chats, facts (all unconfirmed until confirmed), the account's own chats, wazaa's `catalog.yaml`, `faq.yaml`, `agent.yaml`, `assets.yaml` as unconfirmed statements with the file as source.
- Where it lives: the business repository's `data/` (gitignored), the vault, the channel file's `dataDir`. Nothing of a client in the framework repository (ARC-15).
- Demo: WZP-16 only.

## Milestones

Each is a committed run on `feat/wazaa-port` and is confirmed by zapa before the next (docs/14). `[M]` machine check, `[U]` zapa.

| # | What | Exit criteria |
| --- | --- | --- |
| W1 | Test chat and the demo base (A, WZP-10..19) | [M] a scripted test chat gives a draft with its facts and checks; a test chat leaves nothing in the shadow store; a send path to a channel does not exist for it; owner and ops commands work in it. [U] zapa types as a customer and as the office and the page tells him what happened. |
| W2 | Shell and tab contract (D, WZP-40, 43, 47) | [M] the tab test of WZP-40; existing dashboard tests pass on the new shell. [U] it opens with no token typed, in Levada. |
| W3 | Intake in (B, WZP-20..29) | [M] a real intake message (zapa supplies one; none is invented) parses with every line accounted for; a malformed line is listed; the draft files pass `pnpm company check`. [U] zapa reads the draft and says what is wrong. |
| W4 | Link, chat intake and roles (C, WZP-30..39) | [M] a stub channel lists chats by name with no numbers; nothing is read until ticked; the proposal for a fixed set of chats is the same twice; confirming writes the channel file and roles. [U] zapa links his own account, ticks one chat, confirms, and sees a draft in the review chat with no new QR. |
| W5 | Conversas, Configurar, Guardados, Perguntas, Lições (D, WZP-41..48) | [M] the routes' tests; an office answer becomes a fact improvement proposal; a lesson changes the next prompt and the handler version. [U] zapa uses each tab on a real chat. |
| W6 | State, funnel, Reservas (E, WZP-50..56) | [M] the funnel on wazaa's scripted chats; no booking without an explicit yes; every number traced to config. [U] a real conversation from start to a proposed booking. |
| W7 | Maintenance, partners, fleet, triggers, sheets (F, WZP-60..65) | [M] per module (docs/12 CMP-25 list). [U] one tab at a time on real material, only when the client needs it. |
| W8 | Parity and retirement (G, WZP-80..83) | [M] the parity check passes with no unmapped row. [U] zapa's yes to retire wazaa. |

W1 and W3 are independent; W4 needs W3 for the task names. W7 is by need, as docs/14 says.

## PROPOSED (waiting for zapa's yes)

- P1 Order W1 → W2 → W3 → W4 → W5 → W6 → W7 → W8 (the test chat is the demo and the first thing a prospect can touch).
- P2 WZP-16: demo facts written by zapa for a made-up company, marked `demo`, the only mock data allowed.
- P3 WZP-33: deterministic first, a model proposal only with source phrases, low confidence = "decide".
- P4 WZP-32: the default of reading nothing until a chat is ticked.
- P5 WZP-25: Yes/Maybe/No mean candidate now, candidate later, draft forever.
- P6 This file is the spec; docs/14 gets a pointer; the spec edits docs/10 ADM-105 only when W4 is built.

## OPEN (decide during the build)

- WZP-5 whether the admin checklist (ADM-1..5) also gets an item that points at the agreement record (the record itself is settled: a file in the channel's data folder).
- WZP-21, 22 how cyborg reads the intake list and inbox (PROPOSED: a command in the intake app that prints the structure as JSON; cyborg never holds the app key).
- WZP-32, 33 history depth and the number of messages read (a config value zapa sets).
- WZP-16 demo facts: made-up or Demo Tours' with consent.
- WZP-56 pick-ups and day-before reminders; WZP-64 vision input in the gateway.
- The intake as the base for non-tour businesses: its 15 tasks are generic English; per-business wording lives in `form-data.js` copies (the intake README).
- Whether Configurar and the test chat stay under one tab or split (zapa's call when W2 shows them).
