# 14 · Redoing wazaa on cyborg

> **2026-11-05:** `feat-wazaa-port.md` (branch `feat/wazaa-port`) is the spec for porting all of wazaa onto the framework and for the intake-driven install. Where it conflicts with "Demo Tours starts from scratch" below, the feat wins; this file's mapping table stays as the source list.

Written 2026-11-01 after zapa asked to "redo wazaa according to this framework". Read-only study of `~/Projects/cyborg/wazaa` (master, 8f03cee, about 10,400 lines in `src`, 17 docs, 220 tests). Nothing in wazaa was changed. wazaa is a test that is not live; the section "How it is done" at the end says how Demo Tours is started again from scratch.

## What wazaa is

Not only a chat desk. From its own Status.md and docs: a customer chat brain (an LLM reads, code checks prices, dates and capacity, an LLM writes, a guard checks), booking requests that wait for the office's CONFIRM or DECLINE, pickups, an ops chat with commands, owner commands inside customer chats, learning from office answers, lessons, tickets and Nostr developer reports, a team-chat maintenance monitor, fleet from plates, next-day driver lists and driver readings (partly built), day-before reminders and cancelling a tour day, partner chats (hotel desks), service sheets read from photos, a Jumpseller catalog sync, an office dashboard, and a WhatsApp client with a self-healing ladder.

## Mapping

| wazaa (where) | In cyborg | Work | Phase |
| --- | --- | --- | --- |
| WhatsApp client and self-heal (`whatsapp/client.ts`, docs/08) | the channel adapter | **keep as it is**; wrap it. It is the most valuable infrastructure and cyborg has none like it | 1 |
| Chat roles, allowlist, groups (docs/05, `targeting.ts`) | gate roles `reply` `ops` `monitor` `ignored` | map; the allowlist becomes roles | 1 |
| Owner commands `stop pause start new save bug idea stopall startall help` (docs/04) | gate commands | have: stop, pause, start, stopall, startall, done, ooo, back, lang, role. **Missing:** `new` (reset what the model sees), `save`, `bug`, `idea`, `help` (map to tickets and flags) | 1 |
| Ops-chat `CONFIRM DECLINE ANSWER RESUME STATUS` (docs/05) | approve and decline on proposals, `.done`, the dashboard | CONFIRM and DECLINE are a decision on a booking proposal; ANSWER feeds learning | 2 |
| Brain read call (intent, language, tour, pax, date, confirm) (docs/03) | a booking-read handler beside the sales intake | new handler; wazaa's JSON shape is the starting spec | 2 |
| Code checks: price, running days, closed dates, capacity, alternatives, group pricing (docs/03, 09) | draft checks and a deterministic quote handler over the profile | cyborg checks a finished draft; wazaa also *computes* the quote and alternatives in code: port as a deterministic handler | 2 |
| **Funnel state** (stage per chat, booking in progress) | **nothing: the core keeps no conversation state** | **the biggest gap.** A module-owned state store keyed by chat (JSON, versioned, audited), not a core feature | 2 |
| Brain write call, persona, FAQ, guard, humanize (docs/03) | the reply-draft handler, persona, lessons, checks, reply delay | have most; the typing delay and "humanize" map to N-13 and the delay scheduler, which is not wired | 1–2 |
| Booking record `proposed`, team ping, CONFIRM sets it (docs/03) | a proposal with an applier, an attention item | booking store and applier | 2 |
| Pickup (`PICKUP B-x hotel 09:05`) (docs/00) | booking module | after bookings | 3 |
| Learning from office answers, learned facts, FAQ matcher (docs/10) | office answer → fact improvement proposal → profile fact; lessons | have the pieces (PRF-65, improvements); wire the ops-chat ANSWER | 1–2 |
| Lessons `LIÇÃO` (docs/17) | lessons | alias; same idea | 1 |
| Tickets, `bug`, `idea`, Nostr developer reports (docs/07, `nostr/devreport.ts`) | flags, tickets, the heads-up monitor | reuse `devreport.ts` as the heads-up sink; the Nostr sink was always deferred | 1 |
| Team-chat maintenance monitor, zero LLM (`monitor/`, docs/15 §1) | a fleet maintenance module (deterministic handlers) | new module; wazaa's keyword rules are the spec | 4 |
| Fleet from plates, next-day driver lists, readings, scheduled maintenance (docs/15) | the fleet module and outbound proposals to drivers | new module; messages to third parties are drafts a person approves | 4 |
| Day-before reminders, cancel a tour day (docs/14) | schedule triggers and outbound proposals to customers | a message to a customer is a commitment-adjacent send: draft first | 4 |
| Partner chats (docs/16) | a chat role and per-guest requests | new role; one request per guest | 4 |
| Service sheets from photos (docs/06) | a handler with image input | **cyborg's gateway sends text only**; vision needs a gateway extension | 4 |
| Jumpseller catalog sync (`store/jumpseller.ts`) | profile facts through an import or a connector | have `pnpm import-profile`; wazaa's real catalog and FAQ already round-tripped through it in M4 | 1 |
| Office dashboard, Simple and Advanced (docs/13) | **wazaa's dashboard in the framework**: a shell in its look, every tab from a module or an integration (zapa, 2026-11-03; see "Office dashboard" below) | the shell and the tab contract, then each module's tabs | D1–D6 |
| Privacy: names, phones, rooms stay on the Mac; the AI sees a ref, a group size, a place code | data classes, the scrubber, the vault | same principle; check parity case by case | 1 |
| Retention job, `PRIVACY_TERMS.md` | `retention.ts` | map | 1 |
| Simulator and replay (`src/simulator`) | `pnpm simulate`, shadow replay | wazaa's scripted chats become simulation scripts | 1 |
| Portuguese team side and command words (docs/12) | the staff messages in Portuguese and the command aliases | extend the aliases to wazaa's words | 1 |

## What does not map cleanly

1. **Conversation state.** wazaa's booking funnel lives across turns. cyborg's handlers are stateless and its proposals are the only memory. A booking module needs its own state store. This is a framework decision, not a port.
2. **Two LLM calls per turn.** wazaa reads, checks in code, then writes. cyborg's handlers are one call each with a fixed prompt and one proposal per run. The sequence can be expressed as read handler → deterministic quote → reply handler, but the ordering and the shared state need the state store above.
3. **Images.** wazaa uses a local vision model for service sheets. The gateway has no image input.
4. **wazaa's brain impressed Demo Tours as a test.** The project notes say it beat Hermes and Meta's business AI because it has the real business information and checks around the model. That is the standard to meet; cyborg is measured on Demo Tours' own chats in the shadow, not assumed to match.
5. **Toolchains differ.** wazaa is npm, CommonJS-style TypeScript and Node 22 types; cyborg is pnpm, ESM, Node 26, TypeScript 7. Running both in one process is possible but fragile; a second process fed by a small tap is simpler and safer.

## How it is done (zapa, 2026-11-01)

Corrections from zapa after the first version of this file: **wazaa is not live.** It was built as a test and Demo Tours is too busy to help develop it further, so there is no live bot to protect and nothing to run beside. **The shadow phase is still definite**: it is the method of every customer (docs/13): the bot drafts beside what the business's own people actually do, nothing is sent, the audits follow. And **Demo Tours starts from scratch**: a normal customer on the framework, through the whole process, not a port of wazaa. wazaa stays untouched as a reference.

**Repositories (ARC-15).** The framework is this repository. Every business is a repository of its own outside the framework, `~/Projects/cyborg/<id>/` on Homebase09 (zapa corrected the first layout on 2026-11-03; the framework itself is `~/Projects/atlabs/cyborg`), made by `pnpm new-customer <id> --name "..." --into <folder>`: its configuration, company model, questionnaire answers, adapter code, simulation scripts and audit notes, linked to the framework by path. Customer data never enters the open-source repository, and each customer can be backed up, handed over or deleted on its own.

1. **Demo Tours' repository** `~/Projects/cyborg/test-business`, the only Demo Tours on the framework (wazaa is not needed any more, zapa 2026-11-03), started from the scaffold with nothing carried over from wazaa's code.
2. **The questionnaire.** Demo Tours has little time. The scaffold writes the 30-minute questions as an answer sheet; `~/Projects/intake-form` already holds Demo Tours' report and questionnaire pages. What wazaa already recorded of Demo Tours' own facts (its `config/catalog.yaml`, `faq.yaml`, `madeira.yaml`) is *their data*, not code: use it only as the first draft of the answers, imported as **unconfirmed client statements** that Demo Tours confirms, never as confirmed facts.
3. **The company model and a simulation**, from real chats (wazaa's 220 tests and scripted chats are a ready source of realistic customer messages, Portuguese and English).
4. **Two weeks of shadow beside Demo Tours' own people**, with an audit every 3 days or weekly (N-18). This asks almost nothing of Demo Tours' staff: the cost is the channel adapter and zapa's audits. Demo Tours' staff answer as they always do; the human's real answer is recorded beside each draft.
5. **What Demo Tours wanted beyond the chat** (bookings and pickups, driver lists, fleet, reminders, partner chats, service sheets) is the backlog in the table above. Each becomes a module or a customer-side adapter *when Demo Tours or the next customer needs it*, in the order the audits show.

The mapping table above stays as the requirements backlog: it says what wazaa learned a tour desk needs, so it is not rediscovered. The biggest gap it names, **conversation state for a booking in progress**, is a framework decision to take when the first customer needs a booking flow.

## Office dashboard: wazaa's, in the framework (zapa, 2026-11-03)

zapa asked for this during the merge and it was not written down then. **The office dashboard is wazaa's** (the look of `dashboard/index.html`, `app.js`, `style.css`: the header chips, the tabs, the Simple and Advanced split, the Portuguese wording), and it is **part of the framework**: `@cyborg/dashboard` becomes a shell in wazaa's style, and **every tab comes from a module or an integration**, the way attention items already do (ADM-92..95). A company shows the tabs of the modules and integrations it has turned on, and nothing else. Demo Tours is the first company to use it; nothing of it is Demo Tours' own code. wazaa's files are the reference and stay untouched.

- DSH-1 **Shell and tabs.** The shell owns the header (company name, the chips, the language switch, Simple/Advanced), the tab bar, the alerts and the token. A **tab** is contributed by a module or an integration: an id, its label in each staff language, Simple or Advanced, an order, its routes (under `/api/tab/<id>/`, served through the shell's checks) and the script that draws it. The shell knows no module, no channel and no business (ADM-92, ADM-102): a tab it does not have is not shown.
- DSH-2 **Who contributes what.** The **shell** itself: Início (the attention list, the alerts and the chips) and Registo (the audit rows). The **chat desk and the sales module**: Conversas, Guardados, Perguntas, Lições, and Auditoria (the shadow audit and marking, ADM-91, with the track records). The **WhatsApp integration** (`@cyborg/channel-whatsapp`, a framework package, ADM-102): the link panel and QR (ADM-111), the channel chip, and Configurar (which chats it reads, which is the office chat, the test chat). **Modules not built yet** bring their own tabs when they exist: bookings (Reservas), partners (Parceiros), fleet and maintenance (Manutenção, Viaturas), service sheets (Folhas de serviço), learned names (Nomes comuns).
- DSH-3 **Safe as ADM-87.** `127.0.0.1` only, Host and Origin checked, the token injected into the page (wazaa asked staff to type it; this does not), nothing loaded from outside, nothing cached, `node:http`, no new dependency. A tab's routes get the same checks and the operator's name for the audit.
- DSH-4 **No mock data.** A tab exists only when the module or integration behind it does. No sample rows, no placeholder tabs.
- DSH-5 **Shadow and privacy hold.** In shadow mode nothing on the page sends to a customer (ADM-108, HR-8): a reply box is shown off, with why. Chats are shown by reference and the contact name from the vault (ADM-81); a phone number appears only in the channel's Configurar, where staff choose chats, and is stored only in the channel file and the vault.
- DSH-6 (zapa, 2026-11-04: "Levada, by far the best", chosen from three looks: Levada, Calçada, Bordado) **The look is Levada**: basalt and laurel forest, with the contour lines of the levada channels as the one pattern (a thin band under the header, nowhere else). The shell keeps wazaa's structure (header chips, tabs, Simple and Advanced) in this look; wazaa's own dark cyan theme is not carried over. Tokens (light): header `#1c211b` with text `#eef2e8` and muted `#a9b6a2`, chips `#2c342a`, active tab `#a9c48a` on `#14190f`; page `#e9ede3`, cards `#f7f9f3`, message bubble `#e3e9da`, muted text `#5e6a58`, lines `#b9c4b0`; accent (primary buttons, selection) laurel `#3f6a3a` on `#f3f8ee`. Severity, always with its word beside it: urgent `#c4472f`, follow-up `#d39b3a`, ongoing `#4f8a49`. Type: Unbounded for the brand and headings, Figtree for everything people read, JetBrains Mono for small labels and times. The fonts are bundled with the package (all three are under the SIL Open Font License), never fetched, because the page loads nothing from outside (ADM-87). The dark theme uses the same roles; its values are set when D1 is built and logged for zapa. Pill buttons at least 44 px tall; rows carry a severity stripe and a pill with the word. The reference is the Levada frame in the "Demo Tours Dashboard Looks" page.
- DSH-7 **Fixed in the shell**, from the design pass of 2026-11-04: a live update never wipes what someone is typing or where they scrolled (only the board and header redraw); every action shows a plain Portuguese error when it fails and is disabled while it runs; no state is told by colour alone; staff never see internal names (`handoff`, `low`, handler ids); the brand is the company's name.

Milestones (each committed and confirmed by zapa before the next):

| # | What | Exit criteria |
| --- | --- | --- |
| D0 | The WhatsApp integration moves into the framework as `@cyborg/channel-whatsapp` (ADM-102), with its tests; Demo Tours keeps only its channel file and wiring | Demo Tours' `pnpm whatsapp` runs from the package; the session is kept (no new QR); all framework and Demo Tours tests pass |
| D1 | The shell in the Levada look (DSH-6) with the DSH-7 fixes, the tab contract (DSH-1), the shell's Início and Registo, and the channel integration's link panel and chip | `pnpm whatsapp` opens the new page with no token typed; the QR shows and refreshes in the page and linking works from the browser; Início and Registo show the store's real rows; the existing dashboard tests pass on the new shell; a test proves a tab from a test module appears and one not turned on does not |
| D2 | The channel integration's Configurar: the account's chats by name, choose the ones to read and the office chat, the test chat | zapa picks a test chat by name in the browser, the choice is written to the channel file and the run restarts by itself without a new QR (roles are set when the company starts, ADM-9); a message from that chat gets a draft in the review chat; the test chat drafts with no WhatsApp, on a store of its own |
| D3 | The chat desk's and sales module's tabs: Conversas, Guardados, Auditoria | a real chat from the test number shows with its history and drafts; take over, hand back and done work; marking a draft is recorded; the reply box is off (DSH-5) |
| D4 | Perguntas and Lições | an office answer from the page becomes a fact improvement proposal (PRF-65); a lesson added is used in the next draft |
| D5 | Reservas, with the booking module | spec first: the booking module and the conversation state it needs ("What does not map cleanly" 1) |
| D6 | Parceiros, Manutenção, Viaturas, Folhas de serviço, Nomes comuns | spec first, one module at a time, when Demo Tours needs it (rows 26–30) |

## Decisions still open

- What record on Demo Tours' chats (ADM-96) is enough to take a feature live.
- The channel adapter for Demo Tours' WhatsApp. wazaa's client and its self-healing ladder (docs/08, `whatsapp/client.ts`) are the working reference; whether to reuse that code or write a new adapter is for when the adapter is built.
- Whether Demo Tours, who owns the number and the data, agrees in writing to the shadow reading their customers' messages in a second system (`PRIVACY_TERMS.md` in wazaa is the starting point).
