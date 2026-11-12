# wazaa parity (feat-wazaa-port WZP-80..83)

Written 2026-11-05 from wazaa's own code and docs, on zapa's ruling that the old code is not needed once this list is complete. Every wazaa route, command, tab, setting and test area is a line here: `[x]` ported or replaced (where), `[ ]` still to do (which milestone). A line may only be dropped with zapa's yes and the date.

Where wazaa's knowledge lives now: the docs, the YAML config and the scripted test chats are kept in the Demo Tours repository (`docs/wazaa/`), and a full archive of the source is in zapa's loadstone staging (`wazaa-2026-11-05.tar.zst`, made 2026-11-05, without `node_modules`, `session` and `.env`). The old code is not a dependency of anything.

## Routes (from `src/api/server.ts`)

- [ ] `GET /api/assets`: W7 Manutenção / Viaturas
- [ ] `POST /api/assets/:id/readings`: W7 Manutenção / Viaturas
- [x] `GET /api/bookings`: ported W6: the Bookings tab (`list`)
- [x] `POST /api/bookings/:id/status`: ported W6: the Bookings tab (`decide`: confirm or decline); nothing is sent to the customer in shadow mode
- [x] `GET /api/chats`: ported W4: the Configurar tab (`chats`, `save`); no typed numbers
- [x] `GET /api/config`: replaced: the company config file and its check (`pnpm company check`)
- [x] `GET /api/conversations`: ported W5: the Chats tab (`list`)
- [x] `GET /api/conversations/:id/messages`: ported W5: the Chats tab (`view`: history, card, replies waiting)
- [x] `POST /api/conversations/:id/reply`: replaced: the reply box is off in shadow mode and says why (DSH-5); the person answers in WhatsApp
- [x] `POST /api/conversations/:id/resume`: ported W5: the Chats tab (`hand`)
- [x] `GET /api/events`: replaced: `/api/stream`
- [x] `GET /api/learned`: ported W7: the Questions tab lists the kept answers
- [x] `DELETE /api/learned/:id`: ported W7: the Questions tab (`forget`: takes it out of the FAQ, which goes back to unconfirmed)
- [x] `POST /api/learned/:id`: replaced: to change a kept answer, forget it and answer again, or edit the FAQ fact
- [x] `GET /api/lessons`: ported W5: the Lessons tab (`list`)
- [x] `POST /api/lessons`: ported W5: the Lessons tab (`add`)
- [x] `DELETE /api/lessons/:id`: ported W5: the Lessons tab (`retire`)
- [x] `POST /api/lessons/:id`: ported W5: the Lessons tab (`add` with `replaces`: retire and add)
- [x] `GET /api/maintenance`: ported W7: the Maintenance tab (`list`: records and each asset's track record)
- [x] `POST /api/maintenance/:id`: ported W7: the Maintenance tab (`schedule`, `done`, `dismiss`)
- [ ] `POST /api/maintenance/bulk`: W7 Manutenção / Viaturas
- [ ] `GET /api/maintenance/worklist`: W7 Manutenção / Viaturas
- [ ] `POST /api/maintenance/worklist/send`: W7 Manutenção / Viaturas
- [x] `GET /api/partners`: ported W7: the Partners tab (`list`)
- [x] `POST /api/partners`: ported W7: the Partners tab (`add`)
- [x] `DELETE /api/partners/:id`: ported W7: the Partners tab (`remove`)
- [x] `GET /api/partners/:id/account`: ported W7: the Partners tab (`account`, per month)
- [x] `GET /api/qr`: ported: the link panel (ADM-111)
- [x] `GET /api/questions`: ported W5: the Questions tab (`list`)
- [x] `POST /api/questions/:ref/answer`: ported W5: the Questions tab (`answer`)
- [x] `POST /api/questions/:ref/remember`: ported W5: `answer` with remember, the FAQ entry as an unconfirmed statement
- [ ] `POST /api/retention/run`: W5 Configurar (retention run)
- [x] `GET /api/roles`: ported W4: the Configurar tab (`chats`, `save`); no typed numbers
- [x] `POST /api/roles`: ported W4: the Configurar tab (`chats`, `save`); no typed numbers
- [ ] `GET /api/scratchpad`: W5 Guardados
- [ ] `GET /api/sheets`: W7 Folhas de serviço (needs image input in the gateway)
- [ ] `POST /api/sheets/:id/:action`: W7 Folhas de serviço (needs image input in the gateway)
- [ ] `POST /api/sheets/upload`: W7 Folhas de serviço (needs image input in the gateway)
- [x] `POST /api/simulate`: ported W1: the Test tab (`turn`, `office`)
- [x] `POST /api/simulate/ops`: ported W1: the Test tab (`turn`, `office`)
- [x] `GET /api/status`: replaced: `/api/state` and the header chips
- [x] `GET /api/targeting`: ported W4: the Configurar tab (`chats`, `save`); no typed numbers
- [x] `POST /api/targeting`: ported W4: the Configurar tab (`chats`, `save`); no typed numbers
- [x] `GET /api/tickets`: ported W5: the Saved tab (`list`: notes and tickets)
- [x] `POST /api/tickets/:id/status`: ported W5: the Saved tab (`fix`)
- [ ] `GET /api/triggers`: W7 Manutenção / Viaturas
- [ ] `DELETE /api/triggers/:name`: W7 Manutenção / Viaturas

## Owner commands in a customer chat (wazaa docs/04)

- [x] `stop` (off): the gate's `.stop <chat>` (ADM-36); the test chat acts on its own chat
- [x] `pause` (hold): `.pause`
- [x] `start` (resume, on, bot): `.start`
- [ ] `new` (reset, clear): not built in the real gate (the test chat has `.new`); resetting what the model sees needs a chat-memory reset in the company layer
- [x] `save <note>`: ported W5: `.save` and the Saved tab (the conversation is not copied, PRV)
- [x] `bug <note>` (fail, wrong): ported W5: `.bug`
- [x] `idea <text>` (feature, request, improve, question, suggestion): ported W5: `.idea`
- [x] `stopall / startall`: `.stopall`, `.startall`
- [x] `help`: the test chat has `.help`; the real gate: W5

## Office (ops chat) commands, English and Portuguese (wazaa docs/05, docs/12)

- [x] `CONFIRM B-x [note] / CONFIRMAR`: ported W6: `.confirm <B-n> [note]` / `.confirmar`
- [x] `DECLINE B-x [reason] / RECUSAR`: ported W6: `.decline <B-n> [note]` / `.recusar`; `.bookings` / `.reservas` lists what waits
- [x] `ANSWER AQ-x text / RESPONDER`: ported W5: `.answer <n> <text>` / `.responder` (the number from `.questions`)
- [x] `LEARN AQ-x [text] / APRENDER`: ported W5: `.learn <n> <text>` / `.aprender` (the answer is also kept as an unconfirmed FAQ entry)
- [ ] `RESUME [ref] / RETOMAR`: not built in the ref form; `.back` / `.start <chat>` hand a chat back
- [x] `DONE MNT-x / DISMISS MNT-x / FEITO / DISPENSAR`: ported W7: `.done MNT-n`, `.dismiss MNT-n` (`.done <chat>` stays the gate's)
- [x] `SCHEDULE MNT-x date / AGENDAR`: ported W7: `.schedule MNT-n YYYY-MM-DD`, `.agendar`; `.maintenance` / `.manutencao` lists what is open
- [ ] `SHEET OK n / SHEET DROP n / FOLHA OK / FOLHA APAGAR`: W7
- [x] `FIXED TCK-x / CORRIGIDO`: ported W5: the Saved tab's fix button (no command form)
- [x] `STATUS / ESTADO`: ported W5: `.status` / `.estado`
- [x] `HELP / AJUDA`: ported W5: `.help` / `.ajuda`

## Dashboard tabs (wazaa `dashboard/index.html`)

- [x] Reservas: ported W6: the Bookings tab
- [x] Parceiros: ported W7: the Partners tab (registry and monthly account; per-guest requests and change/cancel by guest are not)
- [x] Perguntas: ported W5
- [x] Lições: ported W5
- [x] Manutenção (and Viaturas): ported W7: the Maintenance tab (records and vehicles)
- [x] Configurar: link and QR, chats and groups, roles: W4: the Configurar tab
- [x] Configurar: test chat: W1: the Test tab

## Settings (wazaa `config/agent.yaml` and the others; keys only)

- [x] `persona (company_name, bot_name, tone, business)`: modules.sales.persona and the profile facts `business.name`, `tone.style`
- [x] `targeting (mode, allowlist)`: replaced by chat roles chosen in Configurar (W4)
- [x] `agent_rules`: persona, draft checks (SAL-5) and ADM-74..80
- [x] `office_hours (timezone, days, start, end, enforce, after_hours_message)`: `office` and the office wording (ADM-60..73)
- [x] `booking (confirm_words, cancel_words, alternative_days_ahead, last_minute_days, last_minute_note, currency_symbol)`: ported W6: `modules.bookings` in the company config, with wazaa's values in Demo Tours'
- [ ] `booking (trigger_keywords, team_notify_chat, client_confirm_line, client_confirmed_line, client_declined_line)`: not carried: every message is read, not matched on keywords; a new request is on the Bookings tab and `.bookings`, not pinged to a chat; the fixed customer lines are not sent in shadow mode (decide before live)
- [ ] `side_channel (chat, auto_ask_on_general, answer_timeout_hours, asked_office_reply, relay_prefix, timeout_reply, ops_intro)`: W5 (the office question flow)
- [ ] `reviews (enabled, link, on_booking_confirmed, on_smooth_close, min_customer_messages, cooldown_days, message)`: partly: the feedback module reads complaints; asking for a review is not built
- [ ] `support (welcome_message, greeting/thanks/bye/out_of_scope/handoff/deescalate/bot_probe replies, escalation, max_failed_before_offer, auto_create_on_streak, ticket)`: partly: wording and persona (ADM-71..80); canned replies and the escalation streak are not built
- [ ] `llm (max_reply_chars, temperature, context_window, guide_funnel, brain)`: inference config (CMP-3); the brain read/write split is W6
- [x] `owner_commands (enabled, delete_command, ack_to_self, pause_on_manual_reply)`: gate commands and ADM-107 (a person answering pauses the chat)
- [x] `humanize (enabled, typing_ms_per_char, min_typing_ms, max_typing_ms)`: ported: the reply delay (N-13), `replyDelayMs` in the Demo Tours adapter's channel file
- [x] `monitor (groups, issues, dedup_hours, context_window_msgs, context_window_minutes)`: ported W7: `modules.maintenance` (issues by urgency, dedupHours, contextWindowMsgs, contextWindowMinutes); the chats are chosen in Configure (role monitor)
- [ ] `privacy (retention_days, scrub_phone, scrub_email, scratchpad_enabled, scratchpad_retention_days, terms_source)`: the scrubber and retention (PRV); the scratchpad is W5
- [ ] `catalog (currency, store sync, calendar closed_dates, tours, fleet_classes, consumables)`: profile facts (imported into Demo Tours as unconfirmed); fleet and consumables W7; the store sync is not built
- [x] `assets (fleet plates, tags, nicknames)`: ported W7: the profile fact `fleet.assets` (id, label, identifiers, aliases, consumables)
- [x] `faq (faqs)`: profile `faq.entries` (imported into Demo Tours as unconfirmed)
- [x] `madeira (local knowledge entries)`: a knowledge pack (Demo Tours' `knowledge.json`)

## Test areas (wazaa `tests/`, kept in the Demo Tours repository)

- [ ] `brain, dialog-parsers, c25, invented-places, faq, router`: W6 (the funnel and the checks); becomes simulation scripts or module tests (WZP-82)
- [ ] `orchestrator, owner, targeting`: W4/W5 (gate and commands; targeting is replaced by roles); becomes simulation scripts or module tests (WZP-82)
- [ ] `sidechannel, ops-language, ops-reviews, learning, learned, lessons`: W5; becomes simulation scripts or module tests (WZP-82)
- [x] `cancel-day, reminders`: ported W7: runReminders and the two-step day cancel (company tests); scripted chats become simulation scripts with `pnpm wazaa-script` (WZP-82)
- [x] `partner`: partly W7: registry, account, no prices in partner chats (code); per-guest funnel not built
- [x] `monitor, scanner-scrub`: ported W7: the scan and watch tests in module-maintenance and company
- [ ] `sheets`: W7; becomes simulation scripts or module tests (WZP-82)
- [ ] `scratchpad, store`: W5 / core; becomes simulation scripts or module tests (WZP-82)
- [x] `wwebjs-patch`: replaced: the WhatsApp client and its self-healing are the Demo Tours adapter's own (16 tests in the Demo Tours repository)

## Not carried on purpose (need zapa's yes to stay dropped)

- [ ] Nostr developer reports (`src/nostr/devreport.ts`, wazaa docs/07): docs/14 has the heads-up monitor; no Nostr sink is chosen.
- [ ] Jumpseller catalog sync (`store/jumpseller.ts`): not built; profile import covers the first load.
- [ ] Multi-day tours and the WhatsApp package (wazaa docs/11): the Demo Tours "Days" field is out of date (planning.md known issue); decide with the company model.

