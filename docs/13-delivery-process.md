# 13 · Delivery process: from the first call to going live

Recorded 2026-11-01 from zapa. This is how a company is taken on. **The install and the operation are zapa's own work at the client's location; this file is not an install guide or an operator guide.** It says what each step takes from cyborg and gives back, so the framework serves the process (L18).

## The steps

1. **A 30-minute questionnaire** by call or meeting with the prospect's business. The answers fill the company model (docs/11, `docs/dryrun/company-model.template.json`) and the company config (docs/12).
2. **A custom, job-specific setup**, built from the existing modules (sales, admin, feedback, later ones). Nothing is added to a module for one company (MOD-6); a company differs by its config, its profile facts and its enabled handlers. If a company needs something no module does, that is a new module or a core change, decided first.
3. **Two weeks of shadow** (N-7: 14 days; the minimum number of messages is OPEN). The bot listens, drafts to the review channel only, and the human's real answer is recorded beside each draft (PRF-15, PRF-16).
4. **Audits during the shadow**, every 3 days or weekly depending on how the shadow is performing (N-18; the rule that picks between them is OPEN). Each audit is: markings on the new shadow entries, the failures and refusals since the last audit (`pnpm digest`), the spend (`pnpm usage`), the flags and corrections, and what to change (fact, prompt, lesson, check), replayed against the earlier entries before it is accepted (PRF-25).
5. **The live gate** (PRF-18): the minimum shadow run met, the facts in use confirmed, the deployment checklist (docs/10) signed by the business and the supplier. Then handlers are switched on one at a time. After that the calibration review is monthly (N-9).

## What each step takes and gives

| Step | Takes from cyborg | Gives back |
| --- | --- | --- |
| Questionnaire | the list of profile keys the modules need (below) | `company.json` and `company.config.json` drafts |
| Setup | `pnpm company check`, `pnpm dryrun` (docs/11), `pnpm simulate` (docs/12) | the first look at where the bot fails the company's own tasks, before any real customer text |
| Shadow | the shadow log, the review channel, `.ooo` / `.back` / `.done`, the handoff card, the morning sheet | real exchanges with the human's answers |
| Audit | `pnpm digest`, `pnpm usage`, markings, improvement proposals, the admin checklist | a decision per finding, with reasons, kept for the next upgrade pass |
| Live gate | `checkLiveGate`, the checklist | a handler enabled, or the list of what is missing |

## Questionnaire draft (30 minutes)

One adaptive form on the intake site (zapa, 2026-11-06), not two: the client ticks the tasks they do, and the questions below appear only for the tasks that need them (a nail salon is never asked about vehicles). Questions 2 3 5 6 7 follow the selling tasks, 8 the follow-up task, 12 the reviews task, 15 to 20 the vehicle task; the rest are asked of everyone. The answers stay in the client's browser as a draft until sent, so the form can be left and resumed.

A draft to be changed by zapa. Each question names where the answer lands, so nothing is asked that the framework cannot use. Ask for documents (price list, FAQ page, terms) instead of asking people to say them aloud.

| # | Ask | Lands in | Needed to start |
| --- | --- | --- | --- |
| 1 | What do you call the business to customers, and how do you talk to them (tone, language)? | `business.name`, `tone.style` | yes |
| 2 | What do you sell? Name, price, per what, and the most people each can take. | `offer.items` | yes |
| 3 | On which days does each thing run, and which dates are closed? Who confirms availability, and how long does that take? | `offer.availability`; the wording for "needs confirmation" is learned in shadow (ADM-54) | yes (days) |
| 4 | What must the bot never promise or do? (confirm a booking, quote a price, take payment, ...) | `rules.commitments`, `commitmentPhrases` | yes |
| 5 | The ten questions customers ask most, and the answers you give. | `faq.entries` | yes |
| 6 | What do you need to know from a customer before you can quote or book? | the sales `enquiryFields` | yes |
| 7 | What makes an enquiry a good fit, and what is not worth your time? | `sales.criteria` | no |
| 8 | If a customer goes quiet, when do you follow up? | `sales.followup_after_hours` | no |
| 9 | Which channel do customers use, and who answers today? Who may give the bot commands? | channel adapter, `chat.authorisedSenders`, `chat.roles` | yes |
| 10 | Who should be told when a customer is waiting for a person or something breaks, and how (ops chat, dashboard)? | ops chat, alerts (ADM-45..48) | yes |
| 11 | When is the office staffed (hours, lunch, days off), which days is it closed, and what do customers hear then? Is the office PC on and awake overnight, or can a small always-on machine be used? | `office` in the config (ADM-60..65), the `.ooo` / `.back` habit | yes |
| 11a | Which language do your staff want the system to speak (Portuguese by default), and which languages do your customers write in? | `language`, `modules.sales.defaultLanguage`, `persona` texts per language (ADM-74..80) | no |
| 11b | Should the bot use a first name, does the business want customers told up front that replies are automatic (default: no, only if they ask), and is it in test mode for the first weeks? | `modules.sales.persona` (ADM-68) | no |
| 12 | Which review sites do you have, and what do you do with a complaint? | the feedback module's connector (ADM-58), by the adapter | no |
| 13 | Which model provider will you pay, and what is a comfortable monthly spend? | `inference`, `limits.maxModelCallsPer24h`, `prices` (the company's own key, never ours) | yes |
| 14 | What does the customer tell you that you must never send to a cloud model (ID numbers, health, payment details)? | data classes, scrubber, whether a local model is needed (docs/04) | yes |
| 15 | Fleet, only if you have vehicles: how many, and for each the make, model and plate. | `fleet.assets` ids and identifiers (feat-fleet.md) | no |
| 16 | Fleet: how do your drivers name each vehicle when they write (the letters of the plate, a number, a nickname)? | `fleet.assets` aliases (FLT-51) | no |
| 17 | Fleet: is there a WhatsApp group with the drivers? What do they write there when a service is done (oil, tyres, brakes) or when they give the distance? In their words. | the chat's `monitor` role, the fleet word lists (FLT-50..52) | no |
| 18 | Fleet: for each vehicle, the inspection date, the insurance date and any other deadline (road tax, licences); who handles each; how far ahead do you want to be told? | deadlines and reminder lead times (FLT-12, FLT-40) | no |
| 19 | Fleet: which services do you track and at what interval (for example oil every so many km)? Where are the last ones written down (invoices, a sheet, a notebook)? | service kinds and the history import (FLT-11, FLT-41) | no |
| 20 | Fleet: is there GPS or tracking? Which one? Can it give each vehicle's odometer at the end of the day (a report, an export, an API)? The login stays with you. | the per-business source (FLT-3), `fleet.reading.confirm` (FLT-42) | no |

## Commercial terms (zapa's draft, 2026-11-01, not locked: "let's say")

- The 30-minute meeting is included, free.
- Shadow run: at least 2 weeks (N-7), then a 2-week live test run. Neither is charged.
- If the trial succeeds: an install and set-up fee of at least 300 (currency EUR, as in his earlier idea), plus 30% of the yearly time savings.
- Inference stays the company's own cost, paid to its own provider with its own key (L16); cyborg never holds a client key.

What the framework must supply for this to be settled without argument (not built, listed in order of need):

1. **A savings report from measured counts only:** messages handled, drafts approved as they were, drafts changed or declined, handoff cards used, chats settled from the morning sheet, per week. Minutes saved come only from figures the company agrees in writing before the shadow starts (for example "a reply takes about 3 minutes by hand") and from an hourly cost the company gives. The formula is shown on the report: handled items × minutes saved each × hourly cost, then the company's own yearly volume. cyborg invents none of these figures.
2. **Success criteria agreed in writing before the live test**, so "if it succeeds" is not decided afterwards. cyborg can measure candidates (share of drafts approved as they were, no commitment breaches, no high-band reply later marked wrong, staff's own verdict) but the thresholds are zapa's and the client's to set.
3. **Seasonality:** four weeks of data scaled to a year can be far off for a seasonal business. The yearly figure should come from the company's own yearly volume, not from the trial weeks alone.

Kinds of saving (zapa, 2026-11-01). The report names the kind, because they are measured differently:

- **Office time** (a tour desk such as Demo Tours): zapa's estimate is 1 to 2 hours a day from the morning handoff alone (the prepared sheet and the cards). That is an estimate to be tested in the shadow, not a result. Measure: sheets read and cards used per day, times the minutes the company says each replaces.
- **Downtime avoided** (a fleet manager): fewer days off the road through maintenance alerts and help scheduling inspections (for example the MOT). Measure: alerts raised before the due date, inspections booked before expiry, vehicles that went past due; the saving needs a baseline the company holds (days off the road last year) and its own cost of a vehicle off the road per day. The shadow alone cannot supply that baseline.

Plugging in the company's own stack (zapa): the more of the tools a business already pays for that connect to the system, the more useful it becomes. Rules for that, all PROPOSED until built: a tool connects through a connector the module declares in its manifest (as `channel`, `contacts` and `reviews` already are); connectors are read-only until a proposal a person approved says otherwise; what a connector brings in carries a data class like anything else; its credentials are secrets on the company's own machine, with the least access the tool allows; each connector that works adds events, facts or morning-sheet sections, so a module gets more useful without changing its code.

OPEN for zapa: is the 30% paid once on the first year's savings or every year; is the fee payable at the end of the live test or on a date; what, if anything, is charged for upkeep after that (his earlier idea had a monthly line); who owns the figure if the company disputes it.

## OPEN

- N-7 messages, and the rule that picks a 3-day or a weekly audit (for example by the share of entries marked worse or wrong in the last audit). Until zapa sets them, he chooses at each audit and the choice is written in the audit's notes.
- Who on the business side marks entries and confirms facts, and from which surface (the dashboard is not built).
- Whether the questionnaire becomes zapa's own skill (questionnaire, then company model, then dry run), as he planned in L16.
