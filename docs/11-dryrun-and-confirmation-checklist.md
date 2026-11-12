# 11 Dry run and confirmation checklist

For zapa. Two jobs: (1) set up a dry run where you draft a company model, give the
bot your own tasks and see where it fails; (2) tick off what only you can confirm.
Nothing here sends anything to a customer or a channel.

## Part 1. The dry run

### What it is
`pnpm dryrun` loads your drafted company model as profile facts (unconfirmed, which
shadow mode accepts), loads the sales module with your enquiry fields, then runs each
task through intake, reply draft and (if you gave criteria) qualify against a real
model. It prints, per task, what the bot found, what it drafted, and where it failed.
Everything lands in a SQLite file, so `pnpm digest` can read the run afterwards.

### Before you start
- [ ] `pnpm install` has been run in `~/Projects/atlabs/cyborg`.
- [ ] A model endpoint is up. Your local llama.cpp (`http://127.0.0.1:8081/v1` on
      this machine) passed the capability test; the run tests the endpoint first and
      says so if it cannot return structured output.
- [ ] You know where the prompts go. A local endpoint keeps everything on the box.
      A cloud endpoint receives your drafted profile and the task text. Scrubbed
      text only: phone, email, IBAN, NIF and ID patterns stop the call, but names in
      free text are not detected (PRV-7).
- [ ] Use a new `--db` file for each experiment. The old one stays as a record.

### Draft the company model
Copy `docs/dryrun/company-model.template.json` somewhere outside the repo (it will
hold your business facts) and fill it in. `pnpm dryrun --company yours.json --check`
refuses anything still saying `<fill in`, and names every wrong shape.

| Key | Shape | Watch for |
| --- | --- | --- |
| `enquiryFields` | list of `{ name, description }` | These are YOUR tasks: what must the bot learn from a message? One lower_case name each. |
| `business.name` | text | |
| `tone.style` | text | One or two lines of how the desk talks. |
| `offer.items` | list of `{ name, price, unit?, capacity? }` | `price` is a number. Any price the bot writes that is not in this list is blocked. No `capacity` means any capacity it states is blocked. |
| `offer.availability` | `{ days, closedDates }` | `days` are the weekdays you RUN, 0 = Sunday. Check this against a second source: the Demo Tours "Days" field lists closed days and fooled two readers. |
| `rules.commitments` | list of text | What the bot may never promise. Also add business-specific phrases in `commitmentPhrases`. |
| `faq.entries` | list of `{ q, a }` | Only what you would say yourself. |
| `sales.criteria` (optional) | list of `{ id, description }` | Without it qualify is skipped. |
| `sales.followup_after_hours` (optional) | number | Follow-ups are not part of the dry run yet. |

### Write your tasks
Copy `docs/dryrun/tasks.template.json`. Use real messages, copied as they came (keep
real customer details out of the file, or expect the scrubber to stop that task). Per
task you can add:
- `expectFields`: enquiry fields the intake must find.
- `mustInclude` / `mustNotInclude`: text the draft must or must not contain.

Include on purpose: a message the profile cannot answer, one that asks for a price you
do not list, one that asks for a booking, one in Portuguese, one with a phone number,
one vague one. Those are the ones that show the edges.

### Run it
```
pnpm dryrun --company yours.json --check                 # shape check, no model
pnpm dryrun --company yours.json --tasks tasks.json \
  --base-url http://127.0.0.1:8081/v1 --model <model name> \
  --db ./dry-1.sqlite --out ./dry-1-report.json
pnpm digest --db ./dry-1.sqlite                          # failures and refusals by handler version
```
Change the model, the company model or the tasks, then run again with `--db ./dry-2.sqlite`.

### Reading a failure
| The report says | It means | Usually fix |
| --- | --- | --- |
| `draft_blocked: price 40 is not a price in offer.items` (or capacity, weekday, date) | The model stated something your profile does not support. The code blocked the draft. | If the profile is wrong, fix it. If the model is wrong, add a FAQ entry or a lesson later; do not loosen the check. |
| `draft_blocked: commitment ...` | The draft confirmed, promised or guaranteed. | Check `rules.commitments` and `commitmentPhrases`. |
| `invalid_output` | The model failed the schema or a code check twice. | A smaller model, a stronger endpoint, or fewer enquiry fields. |
| `missing_field` | The intake did not find a field you expected. | Reword the field description, or the model is too weak. |
| `expectation` | Your `mustInclude` or `mustNotInclude` was not met. | This is the bot failing your task. |
| `refused: ... capability` | The endpoint cannot enforce the schema. | Another model or endpoint. |
| `refused: ... profile fact ...` | A fact the handler needs is missing. | Add the key. |
| `watch: scrubber stopped` | The message had personal data, so no model call was made. | Expected; a person handles it. |
| `watch: low confidence` | A number in the draft is in neither the message nor the profile. | Look at the draft. |

### What the dry run cannot see (read this before trusting a clean run)
- The code checks only prices, capacities, weekdays, ISO dates (`2026-11-05`),
  commitment wording and numbers. **A draft can still invent qualitative claims**
  ("gentle walks", "perfect for kids", "terraced vineyards") that are in none of your
  facts, and still score `high`. In the smoke test a kids question got exactly that.
  Put `mustNotInclude` on such claims, and read every draft yourself. Dates written as
  "12 November" or "12/11" are not checked.
- It does not judge tone or language. That is yours (ADM-16).
- It does not exercise groups, voice notes, images, handoff, stop-all, the reply
  delay or the toast. Those are tested with the unit tests (`pnpm test`) and have not
  run against a real channel.
- There is no command yet to mark a run's replies `match`, `worse` or `wrong fact`
  or to confirm facts. That is done in code today (`markEntry`, `moveFact`), and it
  is the first thing the adapter surface needs.

## Part 2. What only you can confirm

### Decisions waiting for a yes or no
- [ ] The 20 spec items (`planning.md`, P1 to P20) and the 71 guesses made during the
      build (`planning.md`, "Undiscussed decisions"). Each is confirmed (move it into
      the docs) or reverted. Read these first:
  - [ ] HR-8: enforced for auto-reply handlers only; draft-only handlers run live
        without the registry (accepted in principle, 2026-10-31).
  - [ ] The adapter must call `AutoReplyPolicy.decide` before any auto-send; the core
        does not enforce it.
  - [ ] `sales.enquiry.qualify` has no confidence record yet.
  - [ ] The band starts at `high` and only falls.
  - [ ] Draft checks are a floor (see "cannot see" above).
  - [ ] PRF-2 now allows `unconfirmed -> contradicted`.
  - [x] AGPL-3.0-only (zapa, 2026-11-12).
  - [ ] Whether a YAML parser (`yaml`) may be added as a dependency.

### Numbers nobody has set
- [ ] N-7 minimum shadow run (entries and days). The live gate fails until it is set.
- [ ] N-10 monthly sample size (draw sizes are explicit config).
- [ ] N-15 admin reminder interval, and whether a message restarts the 60 s wait plus
      its maximum.
- [ ] N-14 handoff resume (12 h default; you said the admin sets it per business).

### Things only you can supply
- [ ] **M2-EC5** leak test with real identity values and inputs
      (`CYBORG_LEAK_INPUT=<file> pnpm test`, format in docs/04).
- [x] **M3-EC2** a real cloud endpoint: OpenRouter free `nvidia/nemotron-3.5-super-vl:free` tested strict_schema (2026-10-31). Confirm.
- [ ] **M4-EC5** an independent source for the Demo Tours "Days" values (`pnpm check-fact`).
- [ ] **M6-EC4, M7-EC6** a real buyer intake (`pnpm proof --buyer-intake`).
- [ ] **M7b-EC14** a real business shadow run, and a toast on its machine.
- [ ] **M8-EC7** a real review with a client's staff.
- [ ] **M8-EC16** a real heads-up channel (the Nostr sink is not built).

### Choices not made yet
- [x] Inference-key alert (ADM-44) reaches a store-backed list and an ops-chat card (ADM-45..48); the dashboard panel and the sound are not built yet. Still to decide: what happens to the customers whose messages were refused while the key was down.
- [ ] Speech-to-text engine and model (local only; the interface exists).
- [x] Alert platform: web app on the office machine, no native app (L17). Confirm.
- [ ] Vault encryption and who holds the key (before the first real client).
- [ ] Who confirms facts and marks replies on the business side, and from which surface.
- [ ] Data processing agreement and the NIF downgrade, a lawyer's task.

### Before wazaa adopts any of this
- [ ] The Demo Tours "Days" fix still has to be ported into `~/Projects/cyborg/wazaa`, and its
      `report.md` must not be sent as written. Nothing in `wazaa` was touched.

### Last step
- [ ] Run `/vibe-audit` before your user test; nothing here has been audited yet.

### Before the first client install (built 2026-10-31, confirm)
- [x] Schema versions and a copy before every upgrade (docs/01 ARC-9..13). Try `pnpm db info <file>` on a client file after an upgrade.
- [x] Usage report from the company's own ledger (`pnpm usage`, GWY-29) and a rolling 24-hour call cap (GWY-31).
- [ ] Set a call cap per company (no default) and the model prices for the usage report (GWY-30). They need the per-company config file, which is not built.
- [ ] Decide how many copies to keep and where they go (ARC-10).
