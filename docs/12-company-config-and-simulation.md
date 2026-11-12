# 12 · Company config, simulation, per-module tests, how modules work together

Written 2026-11-01 from zapa's requests: a per-company config file, a checklist for how to test and run a simulation setup, per-module tests, and how modules might work together. `[x]` means built and machine-verified; `[ ]` is for zapa to do or confirm.

## Part A. The spec

### Company config (`@cyborg/company`)

- CMP-1 One JSON file per company says how its install is wired (`docs/simulation/company.config.template.json`). It must never hold a key: the file is refused if it contains something that looks like one, and `inference.apiKeyEnv` is the NAME of an environment variable (L16). A file with `<fill in` in it is refused.
- CMP-2 `mode` is `shadow` unless set to `live`. Relative `store.path` and `store.vaultPath` are taken from the config file's folder.
- CMP-3 `inference.model` is the model every handler uses; `inference.handlers.<handlerId>.model` gives one handler another model (a chat model for one, a thinking model for another). `inference.reasoning` holds the per-model reasoning options (GWY-6) and `inference.providerOptions` the provider options (GWY-5).
- CMP-4 `pnpm company check <file>` must report errors that stop an install and warnings that do not. A live install must have `limits.maxModelCallsPer24h` (GWY-31) and at least one `chat.authorisedSenders` entry; a shadow install only gets warnings for both.
- CMP-5 Warnings: key variable not set here, no price for a used model, no prices at all, no `originChannel` in shadow mode, no ops chat.
- CMP-6 The live gate (N-7, the checklist, confirmed facts) is checked per handler at run time; the config cannot prove it passed.
- CMP-12 `pnpm company capability <file>` runs the capability test for every model in the file against the real endpoint and stores the results. It must run before a company is created, because a module whose handlers need an untested endpoint is refused at load (MOD-8).

### The operations layer

- CMP-9 `createCompany(loaded, adapters, deps)` wires one company: store, vault, gateway, modules, runner, channel gate, notifiers, shadow controller (in shadow mode). It holds no business rule.
- CMP-10 The channel belongs to the adapter. The company is given three sinks: `ack` (command acknowledgements), `review` (shadow output, never the origin channel) and optional `ops` (alerts and handoff cards). Without `ops` alerts reach only the dashboard list (ADM-45).
- CMP-11 Roles in the file are applied once, audited as `config`; later changes are `.role` commands.
- CMP-13 `process(event)` runs an origin event through the gate and, if the gate says run, through the handlers (shadow mode: logged, output to the review sink only). `personReplied` settles a chat and, in shadow, records what the person said against the customer's last message. `handoff` builds and posts the card. `review` runs a review. `morningSheet` assembles the sheet from the modules' sections. `usage` gives the report.
- CMP-14 `beforeLoad(store)` lets facts that arrive with a run (a simulation's company model) be in the store before the modules load.

### Add-ons feed the model (zapa, 2026-11-01)

The company's own tools (Demo Tours' vehicle GPS data, the job sheet from the work, other plug-ins and the LLMs it already uses) add information to the model that runs, through run-time facts.

- CMP-27 A `RuntimeFactSource` supplies one sentence built in code from an add-on's data, with the time the data was true. Its class is `public` or `deal`; a source declared `identity` or `secret` is refused at registration. A fact that can go stale has `maxAgeMs`: older data, no data, or a source that throws all block the handler that needs it, with the reason in the refusal. A fact with an age limit shows `(as of <time>)` in the prompt. The ledger marks the fact `runtime`; the live gate and the wrong-fact marking skip it, because it is not in the profile. The on-duty toggle (ADM-52) is the first such source and never goes stale.
- CMP-28 The sales config names the add-on facts the reply handler is shown in `contextKeys`, each `live.<name>`. The module manifest declares the family `live.*` (a key ending in `.*`). A key with no source makes the draft fail loudly, never silently without it. The handler's prompt and version change only when the list of keys changes.
- CMP-29 `fileFactSource` is the generic add-on: anything that can export a file plugs in. The adapter writes `derive(contents)` to turn the file into one sentence, so raw rows, coordinates and names stay on the machine; the file's modification time is when the data was true. A sentence over 600 characters or one the scrubber catches (a phone number, an email) is refused. Vehicle positions, driver names and customer details must be derived into a sentence like "Vehicle 2 is running 20 minutes behind"; they never go to a model raw.
- CMP-32 `modules.sales.persona` sets how the bot presents itself (ADM-67, ADM-68). The reply handler is version 3. The company layer tells the handler whether a chat is new from its in-memory lines.
- CMP-30 OPEN: an add-on that is itself an LLM or assistant (the other LLM tools a company already uses). What it writes is untrusted text like a customer's, never a fact; its output can become a sentence only through the adapter's `derive`. Whether two bots on one WhatsApp number can coexist (each ignoring the other's messages, as the loop guard already does for the bot's own) is a channel question for that adapter.
- CMP-31 OPEN: customer-facing statements from live data (a pickup ETA, seats left). They are drafts a person approves, with the time shown; auto-reply for them is off until a calibration review says otherwise (PRF-34).

### Simulation

- CMP-15 A simulated day is a script of steps on a simulated clock: `customer`, `staff`, `admin` (a command from the first authorised sender), `handoff`, `review`, `advance`, `sheet`. Real handlers, real store, real model endpoint; the channel is the script, and nothing leaves the process except the model calls.
- CMP-16 A script with `<fill in`, no steps or an unknown step is refused before anything runs.
- CMP-17 `pnpm simulate ... --estimate` counts the model calls a script will make (one per model handler matching each customer, handoff and review step) and compares them to the company's cap, without touching a database or the endpoint.
- CMP-18 `--company-model` seeds the profile from a drafted company model (the dry-run file, docs/11) as `unconfirmed` client statements, which shadow mode accepts and live mode refuses (PRF-5).
- CMP-19 A simulation refuses `mode: live`. Point `store.path` at a scratch file, never at a live install's database.
- CMP-20 A refused call, an invalid output or a missing card is a PROBLEM on its step; a message from a chat with no role is shown as ignored by the gate.
- CMP-21 The bot's replies are never sent in shadow mode, so a handoff transcript holds the customer's and the staff's lines only.
- CMP-22 The report is in the Status layout: one block per step with what the company did and what each sink received, the sheets as printed, then the end-of-day state (open alerts, proposals by status, model calls and tokens) and the final sheet.
- CMP-26 The shipped templates cannot run until filled in.

### How modules work together

- CMP-23 Modules combine only through five things, and a test runs a day with sales, feedback and admin together:
  1. **Events.** One module's trigger is another's or the adapter's output: `message.received` → sales; `handoff.requested` → the sales card; `review.received` → feedback. The company layer or the adapter raises them; no module raises another's.
  2. **Shared profile facts.** Modules read the business profile by key (the manifest lists them). A fact is declared once.
  3. **Runtime facts.** The on-duty sentence (`presence.status`, ADM-52) is computed from the admin toggle and offered to any handler that lists the key; today only the sales reply handler does.
  4. **Morning sheet sections** (`MorningSection`, ADM-59). A module contributes a heading and blocks; admin assembles them in the order the company lists them. Waiting customers are always last.
  5. **The notifier and the alert list.** Any component may raise an admin alert; the store keeps it, the ops chat shows it, a cause that ends clears it (ADM-45..48). The call cap and the key alert reach every module the same way.
- CMP-24 A module package must not import another module package. Only the core, the stores and the operations layer know them all. A test fails when `module-sales`, `module-feedback` or `module-admin` imports another `@cyborg/module-*`; add a new module's package to that list.
- CMP-25 What a new module must have before it is added to a company: a manifest the loader accepts; per handler a happy-path test, a test where the quoted words are not in the input (invalid output), a test where there is nothing to do (no proposal), a test that personal data is stopped by the scrubber if its input is free text; a version that changes when its prompt changes; a morning-sheet section if it leaves work for a person; and no business-specific word in its source (MOD-6).

## Part B. Checklist: test the machine first (about 5 minutes, no model, no cost)

- [x] `pnpm check` is green: typecheck, then every test (one is skipped on purpose: the leak test that needs `CYBORG_LEAK_INPUT`).
- [ ] Run the leak test with real identity values: `CYBORG_LEAK_INPUT=<file> pnpm test` (docs/04, PRV-13). This is the one test only you can supply data for.
- [ ] `pnpm db info <any sqlite file you have>` prints a version and says up to date or older.

### Per-module tests

Run one module by itself with `node --import tsx --test <glob>`.

| Module | Command | What it proves | What you check by hand in a simulation |
| --- | --- | --- | --- |
| core (runner, gate, alerts, usage) | `node --import tsx --test "packages/core/test/*.test.ts" "packages/store-sqlite/test/*.test.ts" "packages/gateway/test/*.test.ts"` | the handler contract, proposals, scrubber and vault, ledger, gateway and capability test, credential failure, migrations, usage report, call cap | send a message with a phone number: it must stop at the scrubber and give a "person must handle" proposal; set a call cap of 1: the second model call must be refused with an alert |
| sales | `node --import tsx --test "packages/module-sales/test/*.test.ts"` | intake with source phrases, reply draft checks against the profile, commitment block, confidence bands, shadow log and markings, handoff card, office-answers section | read each reply draft: does it state a price or day that is not in your profile? (It must be blocked, not shown.) |
| admin | `node --import tsx --test "packages/module-admin/test/*.test.ts"` | checklist and its checks, gate manners, commands, waiting pings, reply delay, alerts, ops-chat card, presence toggle, morning sheet assembly | `.stop`, `.ooo`, `.back`, `.done` from the authorised sender work; the same text from a customer does nothing |
| feedback | `node --import tsx --test "packages/module-feedback/test/*.test.ts"` | complaints extracted with the reviewer's words, praise gives nothing, invented words are rejected, a pasted review runs once, the complaints section | paste one review with a complaint and one without |
| profile | `node --import tsx --test "packages/profile/test/*.test.ts"` | fact statuses, ground-truth checks, import, onboarding report | `pnpm import-profile` a small JSON tree and read the report |
| company and simulation | `node --import tsx --test "packages/company/test/*.test.ts"` | config rules, the simulated day, estimate, module cooperation, no cross-module import | the simulation below |
| proof | `node --import tsx --test "proof/test/*.test.ts"` | the same sales code serves a wazaa-shaped and a second-shaped business with zero special cases | `pnpm proof --base-url <url incl. /v1> --model <name>` runs it against a real model (it makes calls); read its special-case count |

### Modules together (CMP-23)

- [x] One simulated day with sales, feedback and admin runs with no problems (company test). By hand, in your own simulation:
- [ ] `.ooo` then a customer message: the reply draft's prompt (see the ledger, or the review sink's text) must not promise a time that is not in your note.
- [ ] A customer who needs the office, then `handoff`: the card appears in the ops sink, and the sheet lists it first, before review complaints, with waiting customers last.
- [ ] A staff line for that chat: the next sheet no longer lists it. `.done <chat>` does the same.
- [ ] A review with a complaint: it is on the sheet until you approve or decline its proposal (approve or decline it on the dashboard).

## Part C. Checklist: set up and run a simulation

You need a scratch folder, an endpoint, and your own real test material. Nothing here touches wazaa or a live install.

1. [ ] `mkdir ~/sim/<company> && cd ~/sim/<company>`; copy `docs/simulation/company.config.template.json` to `company.config.json`, `docs/simulation/day.template.json` to `day.json`, and `docs/dryrun/company-model.template.json` to `company.json`.
2. [ ] Fill in `company.config.json`. Point `store.path` and `store.vaultPath` at files in this folder. Choose the endpoint and model. If the endpoint needs a key, `export` it in your shell under the name you wrote in `apiKeyEnv` (type it yourself; it must not go in any file, and it should be a key with a small limit for testing).
3. [ ] Fill in `company.json` (the drafted company model, docs/11) and check it: `pnpm dryrun --company company.json --check`.
4. [ ] `pnpm company check company.config.json` → no errors, then `pnpm company wording company.config.json` and read every text the way a customer or the bot will meet it (ADM-73); rewrite what you want in `wording` and `modules.sales.persona`.
4b. [ ] `pnpm company check company.config.json` again. Read each warning; the call-cap and price warnings tell you what the usage report cannot show yet.
5. [ ] Fill in `day.json` with real material: real questions your customers ask, a follow-up that needs the office, a real review with a complaint, what a person on your desk would really answer.
6. [ ] Estimate first: `pnpm simulate --config company.config.json --script day.json --company-model company.json --estimate`. Check the number of calls against your cap and your budget.
7. [ ] `pnpm company capability company.config.json` (a few real calls). Every model should show `strict_schema` or `json_object`; `none` means that model cannot run the handlers.
8. [ ] Run it: `pnpm simulate --config company.config.json --script day.json --company-model company.json --out report.json`.
8b. [ ] `pnpm dashboard --config company.config.json` and open the address it prints in the browser on this machine; allow notifications when asked. A simulation leaves its chats in the store, so the board shows them (chats from runs before the chat index existed do not appear).
9. [ ] Read the report top to bottom. Each step says what the company did. Look for:
   - a PROBLEM line (refused, invalid output, no card);
   - a draft that states something not in your profile (it should have been blocked);
   - the review sink text for each customer line (this is what staff would see in shadow);
   - the card: are the "wants", "needs", "the bot said" and "still open" lines what a colleague taking over needs?
   - the sheet at each print: is the first thing a person sees the thing they must do first?
10. [ ] `pnpm usage --db sim-store.sqlite --days 3 --prices prices.json` and compare the calls with step 6. The ledger rows carry the script's simulated time (`start`), so keep `start` on today's date or earlier; a `start` in the future is outside every `--days` window and the command would show no calls. The report's own end-of-day line always has the numbers.
11. [ ] `pnpm digest --db sim-store.sqlite` and read what a later upgrade pass would see.
12. [ ] Run it again with the same script and a different `inference.model` (or a thinking model for one handler under `inference.handlers`). Compare the two reports and the two usage reports.

### Things to try to break (one script each)

- [ ] A bad key: set the key variable to a wrong value. The first model step must show a refusal, one `[NEEDS ATTENTION]` card in the ops sink, an open `inference_key` alert, and later steps refused without new requests.
- [ ] A small cap (`maxModelCallsPer24h: 2`): calls past it refused, one `call_cap` alert; an `advance` of more than 24 hours clears it.
- [ ] A customer message with a phone number or an email in it: stopped at the scrubber, no model call.
- [ ] A message from a chat you gave no role: ignored by the gate.
- [ ] A command from a sender who is not authorised, as a `customer` line starting with the command prefix: it is treated as an ordinary message and changes nothing.
- [ ] A customer asking something your profile does not answer: the reply should say a colleague will follow up, not guess.
- [ ] A message asking to book a date: the reply must not confirm, promise or take payment.
- [ ] A chat that has been waiting (`.stop <chat>` from the admin, then a customer line, and no `staff` line), then `advance` past `chat.handoffResumeHours` (12 h unless you set it; the chat must be in handoff, `.stop <chat>` first): handed back to the bot.

### Not built (so a simulation cannot test it)

Corrected after the 2026-11-03 audit: the dashboard exists (approve, decline and mark a shadow entry are built there, ADM-91..94), so the list below is only what is still missing.

- The gate has no command for a person to flag a reply (`.flag`), and nothing in the dashboard confirms a profile fact. Flags, tickets, the supplier heads-up, the monthly calibration review and the auto-reply policy (PRF-31..46) are library functions with no shipped surface.
- The admin module (manners checks), the deployment checklist and enabling live (`enableLive`, PRF-18, ADM-1..5) are library code: `createCompany` does not load the admin module, and no command or dashboard control signs a checklist row. The auto-resume after silence (`resumeDue`, ADM-26) and the ledger retention purge (PRV-10) run only in a simulation or a test, with no timer in an install.
- The reply delay (N-13, 60 s) is wired only in the Demo Tours WhatsApp adapter, and its supersede step there does nothing yet (ADM-109); the simulation applies no delay, so a simulated customer line runs at once.
- Voice notes (no speech engine chosen), images, groups and real WhatsApp: the channel is a script. The adapter for a real channel is separate work.
- The gate does not raise `handoff.requested` by itself; the script's `handoff` step stands in for the adapter.
- Schedule triggers (BEH-8): nothing emits the follow-up trigger (`sales.followup.draft`), and per-user limits (BEH-15, N-5) are declared but not enforced.
- The opening-time schedule that sends the morning sheet, the reminder ladder and direct messages to named staff (ADM-57 and the notes after it).
