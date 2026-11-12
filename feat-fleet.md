# feat-fleet: fleet management as a cyborg module (frota, ported)

Written 2026-11-06 from zapa. Branch `feat/fleet` (worktree `../cyborg-fleet`). IDs `FLT-*`. Builds on docs/07 ("Later modules", fleet maintenance), docs/10 ADM-92..95 (attention sources) and docs/12 CMP-23..29 (modules working together, add-on facts). "must" is a requirement, "may" an option. `PROPOSED` is mine and waits for a yes; `OPEN` is settled when the build reaches it.

## Why

A small fleet (tour vans, taxis, delivery vehicles) keeps its records in a driver's head, a WhatsApp group and a spreadsheet, and finds out a service or an inspection is due when something breaks or a fine arrives. `~/Projects/cyborg/frota` is a Python prototype of the fix: a vehicle sheet, a daily run that works out what is due, an office briefing. It is the **spec of record** (zapa, 2026-11-06): its rules and sample data feed this spec, a parity list (below) tracks what is ported, then the folder is archived. Nothing is read or run from it during the build.

The framework is bare and modules plug into it (zapa, 2026-11-06). `@cyborg/module-fleet` is one such module. It is **tailored per business**: only when a customer needs it and has filled in the intake is a plug-in for that business's records written (FLT-3). The module itself carries no business, no vehicle make, no country and no data source.

## What it is, in one paragraph

A set of **scheduled jobs and a record per vehicle** (zapa, 2026-11-06). The jobs: each morning work out what is due (insurance, inspection, services), remind ahead of each deadline, and at the end of the day read the vehicle's odometer from the GPS **only to confirm the kilometres**. The record: for each vehicle, its identifiers, its deadlines and its **history of past changes** (every oil change and other service, with date and km), which is what the next due date is worked out from. Which jobs run, when, how far ahead to remind and what the GPS is are all the customer's (FLT-43): a business with no GPS runs the morning check and the reminders only. What is due shows on the dashboard board (red, yellow), in the morning sheet, and later as a short briefing for the office. The model, when used at all, only words a message. Nothing is booked, ordered or sent to a mechanic or an authority: every outcome is a proposal or a person's button press.

## Hard rules for this module

- FLT-1 **Deadlines come from the company's own records and the authority's published interval, never inferred by the module** (docs/07). A missing date or km is shown as missing, never guessed.
- FLT-2 **No model call decides what is due.** Due computation is code, the same answer every time. The model may only phrase a message from what the code computed (FL4), and a draft that states a date, a distance or a plate the code did not compute is refused, as the sales checks do.
- FLT-3 **The records source is a per-business plug-in.** The module defines the port (FLT-10); it ships no source that talks to an outside system. A spreadsheet reader, a dashboard form, a telematics feed or a mechanic's invoice reader is written for a business when it needs it, in that business's customer repository or as its own package, and is switched on by its config.
- FLT-4 **Proposal-only** (HR-1). The module books no inspection, orders no part, messages no driver or authority. A button press on the board is a person's approval and is recorded with who pressed it.
- FLT-5 **Module independence** (MOD-17, CMP-24). `module-fleet` must not import another `@cyborg/module-*`. It meets `module-maintenance` only through events, the shared fact `fleet.assets` and the alert list. A test fails if it imports one (its package is added to the CMP-24 list).
- FLT-6 **Positions, driver names and plates never reach a model raw** (CMP-29, HR-2). A plate is an identifier of class `public` here only if the business says so in its config; otherwise it is `identity` and a prompt sees a code. OPEN (decide during build): the default class for a plate.
- FLT-7 **Numbers are the business's** (HR-10, WZP-9). Every warning distance, warning window, interval and colour threshold is read from config or the vehicle's record. frota's starting values are copied below with their source and are used only as the scaffold's suggested values; no number is typed in code.
- FLT-8 **No business-specific word in the source** (MOD-6, CMP-25). "Oil", "brake", "MOT/IPO" are items in a business's list, not words in the module.
- FLT-9 **No mock data** (HR-4). Tests use computed cases (a vehicle whose km, dates and intervals are generated so the right answer is arithmetic) and, for the proof, a real fleet file read from a run-time path and never committed.

## The data

- FLT-10 **The records port.** A `FleetRecordSource` gives the module, per vehicle: an `id`, a label, identifiers and aliases (the `fleet.assets` fields), the latest odometer reading with its date, a list of `serviceKinds` it follows and a list of `deadlines`. A source may also give readings over time. It says when its data was true (CMP-27); data older than the config's `maxAgeDays` is flagged stale, not trusted.
- FLT-11 **Service kind.** `{ id, label, intervalKm?, intervalDays?, warnKm?, warnDays? }`; `lastKm` and `lastDate` are not stored on the kind but read from the newest history entry of that kind (FLT-41). Due when `lastKm + intervalKm` or `lastDate + intervalDays` is reached, whichever comes first. A kind with neither interval is not computed. frota's oil change and brake check are two such kinds.
- FLT-12 **Deadline.** `{ id, label, date, warnDays? }`: an inspection, insurance, road tax. Due on its date. frota's inspection and insurance are two such deadlines.
- FLT-13 **Where it lives.** The module's own state in the company store (`ModuleStateStore`), under its module name, versioned (ARC-9). Nothing in the profile is the fleet's record; the profile holds only `fleet.assets` (shared with the maintenance watch) and the business's thresholds.
- FLT-14 A business with no source and no records has an empty, idle module: no alert, no error, the board says "no vehicles yet".

## Behaviour (numbers are config, FLT-7)

- FLT-20 **Status of one item** is one of `ok`, `due_soon`, `due`, `overdue`, `unknown`. `unknown` is a kind or deadline whose inputs are missing (no lastKm, no date): it is shown, not hidden, as frota does ("data missing").
- FLT-21 **Colour.** Overdue, or due within `redWithinDays` / `redWithinKm`: red. Past the kind's own warning but not red: yellow. Otherwise no item. `unknown` is yellow. The thresholds are config: `fleet.thresholds.default` with an override per kind.
- FLT-22 **One attention item per vehicle** (not per kind), titled with the vehicle's label, summarising its worst colour, listing each item that is not `ok`. The key is stable between runs (ADM-92).
- FLT-23 **Actions on an item** (a person's button, FLT-4): `Done` (opens a short entry: date, km, optional note, which is added to the vehicle's history, FLT-41, and so moves that kind's next due), `Booked for <date>` (silences the item until that date plus a grace in config), `Not applicable` (retires the kind for this vehicle, reversible). Each is recorded with who pressed it.
- FLT-24 **When it runs.** A `schedule` trigger once a day at the office's morning time, and on any change of a record; no clock inside the module (schedule and manual triggers are event kinds, planning.md M1 entry).
- FLT-25 **Morning sheet.** A section "Fleet" with the red then yellow vehicles in the Status layout (ADM-57). Empty when nothing is open.
- FLT-26 **Estimates.** "About N weeks" is shown only when the vehicle has a reading history long enough to derive a rate (config `minReadingsForRate`); otherwise the item says the distance and nothing about time. frota used a fixed 1000 km a week; that number is not carried over. OPEN: the rate window (last N days of readings).
- FLT-27 **Fuel efficiency** (frota's fifth rule) needs refill records, which are a different source. Not in M1..M3. OPEN: its own kind of source and whether it belongs in this module.

## The jobs and the record (zapa, 2026-11-06)

- FLT-40 **Three scheduled jobs**, each a `schedule` event kind (FLT-24) that a business switches on in its config and gives a time:
  - `fleet.due.check`: each morning at the business's time, works out every vehicle's items (FLT-20..22) and updates the board and the sheet.
  - `fleet.deadline.remind`: for each deadline, at each lead time the business lists (for example so many days and so many days before), once per lead time per deadline, raises a reminder item for a person. A reminder already raised for that lead time is not raised again (idempotent per vehicle, deadline, date and lead time).
  - `fleet.reading.confirm`: at the end of the day, asks the business's source (FLT-3) for each vehicle's odometer, to confirm the kilometres (FLT-42). Off for a business with no source.
- FLT-41 **Service history.** Each vehicle has a history of entries `{ kind, date, km, note?, by, status }`, added by a person's `Done` (FLT-23), typed at setup, or imported by the business's source from its old records (the past oil changes). An entry is never edited or deleted, only superseded by a later entry or marked wrong by a person with a reason (the audit trail is the point). An entry that came from an import is `unconfirmed` until a person confirms it, and the due engine says when it is working from an unconfirmed entry.
- FLT-42 **Daily kilometres are a confirmation.** The end-of-day reading is stored as a reading with its date (FLT-10). It is compared with the vehicle's last confirmed kilometres:
  - within `kmTolerance` (config): confirmed, and it becomes the vehicle's current kilometres for the due engine;
  - lower than the last reading, or higher by more than `maxDailyKm` (config): not used, and a yellow "kilometres do not match" item asks a person to look (a swapped unit, a broken feed, a vehicle changed);
  - missing for more than `staleReadingDays` (config): the vehicle's kilometres are shown as unconfirmed.
  A reading never creates or changes a history entry (FLT-41); only a person does.
- FLT-43 **Everything is the customer's.** Which of the three jobs run, at what time, the reminder lead times, the tolerance and the limits in FLT-42, what a service kind or deadline is called and what the GPS is, come from the business's config, intake and source. The module has no default job, time or number (FLT-7). A business is set up by filling in the intake (docs/13), then a source is written for it if needed (FLT-3).

## The drivers' chat (zapa, 2026-11-06)

If the business has a WhatsApp group with its drivers, the module can listen to it for key words, the way Demo Tours' team already writes: they name a vehicle by **the letters of its licence plate** ("AA" for 16-AA-85), not by the whole plate.

- FLT-50 **Listening is read-only and uses no model.** The chat is one the business chose as a `monitor` chat in the picker (WZP-30..39). A message is matched in code against the business's words; nothing is written to the chat, and no raw message is stored (only a scrubbed snippet, as in the maintenance watch).
- FLT-51 **A vehicle is named the way the drivers name it.** The business lists, per vehicle, the plate and the short forms its drivers use (the plate letters, a number, a nickname) in `fleet.assets` (the fact the maintenance watch also reads, FLT-5). Matching ignores case, accents, spaces and dashes and takes whole words, so "aa", "AA" and "16 AA" are one. A short form that fits two vehicles is **ambiguous**: no vehicle is chosen, the hit is shown with both for a person to pick.
- FLT-52 **The words are the business's, in its own language.** Per meaning, a list: a service was done (oil, tyres, brakes, in the drivers' words), a distance was given (a number followed by "km"), and nothing built in (HR-10, MOD-6). A hit never changes a record: it becomes a **suggested history entry** `{ vehicle, kind, km?, snippet }` that a person confirms into the vehicle's history (FLT-41), edits, or dismisses. A distance in a message is a **suggested reading**, held to the same rule as the GPS (FLT-42).
- FLT-53 **Faults are the maintenance watch's job.** Words for a problem ("noise on the brakes", "need a tyre") stay with `module-maintenance`, which already makes a record from them. The fleet module listens for service-done and distance words only; both may read the same chat. Two modules never import each other (FLT-5), so the matcher both need is either written twice or moved to a small shared library package (the verticals spec does the same for its shared maths). OPEN (decide during build): proposed, a shared library package.
- FLT-54 **A model may help later, never first.** If the keywords prove not enough on a real chat in shadow, a model-assisted reading may be added in FL3 as a second step that proposes the same suggested entry (frota's "clerk"). It is OPEN and needs shadow evidence; until then the listening is keywords only.

## Words

- FLT-30 Every sentence the module shows or drafts (item summaries, the sheet, the briefing) comes from the wording mechanism (ADM-71..73), with defaults in Portuguese and English, editable by the business. No sentence is hard-coded in one language. frota's Portuguese wording ("mudança de óleo em atraso", "A vigiar") is the starting text for the Portuguese defaults, with the oil/brake words moved to the business's kinds.

## Milestones

| # | Title | Exit criteria |
| --- | --- | --- |
| FL1 | Records, history, the morning check and the reminders (no model) | FLT-10..14, 20..22, 24, 25, 40 (`due.check`, `deadline.remind`), 41, 43, FLT-1, 2, 5, 7, 8 |
| FL2 | The end-of-day kilometre confirmation and the board actions | FLT-40 (`reading.confirm`), 42, 23, 26, 13 versioning |
| FL3 | The drivers' chat: key words into suggested history entries and readings, a person approves | FLT-50..54, 6 |
| FL4 | The office briefing, worded by the model | FLT-30, 2 |
| FL5 | Parity with frota, then retire it; the first per-business source | frota parity list, FLT-3 |

PROPOSED: the order and titles. The split follows zapa's answer of 2026-11-06 (due engine and alerts first, no model).

### FL1 — Records port and the due engine

- FL1-EC1 `@cyborg/module-fleet` exists with a manifest the loader accepts, the `FleetRecordSource` port, the due engine, an `AttentionSource` and a morning-sheet section. Machine check: package builds, loads in `createCompany`.
- FL1-EC2 The due engine is pure: same records, same config, same `today` give the same items. Machine check: a table test of generated cases for each status (`ok`, `due_soon`, `due`, `overdue`, `unknown`) for km-only, days-only, both, and a deadline.
- FL1-EC3 Colours follow FLT-21 and only config. Machine check: the same vehicle gives different colours under two configs, and no threshold appears in the source (a test greps the source for numeric literals outside an allowed list).
- FL1-EC4 Missing data is `unknown`, never `ok` and never a guess (FLT-1). Machine check: a vehicle with no date and one with no km.
- FL1-EC5 One item per vehicle, stable key, worst colour first on the board (FLT-22). Machine check: `collectAttention` with three vehicles.
- FL1-EC6 No source, no records: idle, no throw (FLT-14). A source that throws or returns data older than `maxAgeDays` is flagged on the board and does not break the other sources (ADM-95 open point: this closes it for this source).
- FL1-EC7 `module-fleet` imports no other module (FLT-5), no business word appears in its source (FLT-8). Machine check: the CMP-24 test with the package added, and a source scan.
- FL1-EC8 A day with sales, feedback, admin and fleet together (CMP-23 harness) runs and the fleet items appear in the sheet.
- FL1-EC9a The history decides the next due: a new `Done` entry moves the due date, an unconfirmed imported entry is flagged, and an entry cannot be edited or deleted (FLT-41). Machine check.
- FL1-EC9b A deadline reminder is raised once per lead time and not again on the next run (FLT-40). Machine check with a generated calendar.
- FL1-EC9c The questionnaire asks what this module needs (below), and the intake import turns the answers into unconfirmed `fleet.assets`, thresholds and lead times. Machine check on a generated answer message; user check on a real intake.
- FL1-EC9 Proof on a real fleet file: zapa supplies one (frota's `config/fleet.yaml` and `data/vehicles.csv` are the candidates), read from a run-time path, never committed (FLT-9, HR-4). User check: zapa reads the board against what he knows of the vehicles.

FL2..FL5 exit criteria are written when FL1 is confirmed, one milestone at a time (OPEN).

## What frota does, and where it lands (parity list)

| frota | Lands in |
| --- | --- |
| `compute_due_items`: oil by km, brake by km | FLT-11 service kinds (FL1) |
| `_date_due`: inspection, insurance | FLT-12 deadlines (FL1) |
| `Priority` HIGH / MEDIUM / LOW | FLT-21 red / yellow (FL1) |
| "data missing" medium item | FLT-20 `unknown` (FL1) |
| `format_office_briefing`, `format_status_table` | FLT-25 sheet (FL1), FLT-30 briefing (FL4) |
| `gps` agent: end-of-day km | `fleet.reading.confirm` (FLT-40, 42, FL2); the source itself is per business (FLT-3, FL5) |
| `intake` agent (LLM #1, the clerk): driver message to a log | FL3 by key words (FLT-50..53); a model only if shadow shows it is needed (FLT-54) |
| `profile` agent: merge the log into the vehicle record | FL1 history (FLT-41), `Done` in FL2 |
| `advisor` agent (LLM #2): recommendations | FL4, and only wording (FLT-2) |
| `notify` agent: post the briefing to the office chat | FL4, as a draft the office approves (HR-1) |
| alias matching (`plate_for_alias`) | the shared `fleet.assets` fact and the existing matcher's behaviour, re-specified here (no import, FLT-5) |
| fuel efficiency alert | FLT-27, OPEN |
| the `frota` CLI, OpenClaw skill, cron, Docker | not carried: the framework's dashboard, schedule trigger and install replace them |

Pieces of frota **not** ported, on purpose: fixed 1000 km a week (FLT-26), the Portuguese strings inside code (FLT-30), the CSV as the store (FLT-13), the Anthropic key in `.env` (the gateway and the business's own endpoint).

## Starting values copied from frota (suggestions for the scaffold, FLT-7)

| frota setting | Value | Becomes |
| --- | --- | --- |
| `oil_warning_km` | 1000 | `warnKm` of an oil-type kind |
| `brake_warning_km` | 2000 | `warnKm` of a brake-type kind |
| `inspection_warning_days` | 30 | `warnDays` of the inspection deadline |
| `insurance_warning_days` | 30 | `warnDays` of the insurance deadline |
| high when overdue, or the date within 7 days, or the km within half the warning | 7 days / half | `redWithinDays`, `redWithinKm` (PROPOSED: half of `warnKm`) |
| `oil_interval_km` / `brake_interval_km` in the sheet | 10000 / 20000 | per-vehicle `intervalKm` (the vehicle's, not the module's) |

These are a mechanic-minded guess by the prototype's author, not the authority's published intervals; the business confirms each before it counts (unconfirmed until then, as every fact).

## Open (decide during build)

- OPEN the shared matcher: written twice, or a library package (FLT-53).

- OPEN default class of a plate (FLT-6); proposed `identity` unless the business says otherwise.
- OPEN the rate window for "about N weeks" (FLT-26).
- OPEN fuel efficiency (FLT-27).
- OPEN the grace after `Booked for` (FLT-23).
- PROPOSED a confirmed reading becomes the current kilometres without approval (FLT-42); it never touches the history. OPEN whether HR-1 allows that reading of "edits a record".
- OPEN the first per-business source and which customer it is written for (FL5).

## What the questionnaire asks for this module (zapa, 2026-11-06)

Asked only of a business that has vehicles. Each question names where the answer lands; the wording is in docs/13 (questions 15..20) and in the intake forms. Every answer is an unconfirmed statement until the business confirms it.

| Ask | Lands in |
| --- | --- |
| The vehicles: how many, make, model, plate | `fleet.assets` ids and identifiers |
| How the drivers name each vehicle in the chat (the letters of the plate, a number, a nickname) | `fleet.assets` aliases (FLT-51) |
| The drivers' WhatsApp group, and the words they write for a service done or a distance | the chat's `monitor` role, the word lists (FLT-52) |
| Each vehicle's inspection and insurance dates, other deadlines, who handles them, how far ahead to be told | deadlines, reminder lead times (FLT-12, FLT-40) |
| Which services are tracked, at what interval, and where the last ones are written down | service kinds, the history import (FLT-11, FLT-41) |
| Whether there is GPS, which, and whether it gives the odometer at the end of the day (the login stays with the business, never in a chat) | the per-business source (FLT-3), `fleet.reading.confirm` (FLT-42) |
| Who is told when something is due or the kilometres do not match, and at what time | the morning time, the ops chat (FLT-40, FLT-25) |
