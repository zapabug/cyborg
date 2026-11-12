# feat-intake: the short first-contact questionnaire (tap answers, fit summary)

Written 2026-11-12 from zapa. Status: **PROPOSED**, nothing built. IDs `INT-*`. Amends feat-desk DSK-84 (first contact is five answers) and builds on DSK-66 (the fit summary) and `docs/intake/task-map.json`. "must" is a requirement, "may" an option. `PROPOSED` is mine and waits for zapa's yes; `OPEN` is settled when the build reaches it.

## Why

A business owner will not fill in the 16-task questionnaire before they have talked to anyone (zapa, 2026-11-09). First contact must be short, and it must do three jobs (zapa, 2026-11-12): find **where the business is struggling**, show which of cyborg's modules already cover that and **which would have to be built**, and do it with the **fewest questions that give enough**. zapa's target: **about 15 questions in 5 minutes** (the form ended at 13 screens) (about 20 seconds each), so almost nothing may need typing: multiple choice and tick-lists, one question to a screen, on a phone.

pleb.world is the shop window and the pipeline in: it shows what cyborg can build, and businesses reach out there to hire zapa or to get his custom bots (zapa, 2026-11-11). This form is the first thing a business does there, linked from the cyborg page.

## The split: who owns what

- **pleb.world owns the form**: the page, its wording, how it is sent. It is a static page like `intake/` (a data file of questions, no server, answers kept in the browser until Send). It is a separate repository; nothing in it is cyborg source.
- **cyborg owns the reading**: turning the answers into a message `pnpm intake` already understands, and into the **fit summary** and the **needs-building list** for zapa. Data, not code: the maps are files in `docs/intake/` (MOD-6).
- cyborg never holds a customer's answers beyond a run on zapa's own machine; nothing is uploaded anywhere by cyborg.

## Hard rules

- INT-1 **The form asks about the business, never about its customers.** No customer names, numbers or messages are asked for. The only personal detail is the name of the person filling it in. Answers stay in the browser until the person presses Send (as the long form does).
- INT-2 **Tap first, type last.** Typing is allowed in exactly five places: the business name and website (Q1), the apps they use (Q2), their own extra tasks (Q5), a language they need beyond the covered ones (Q10), and one optional "anything we did not list" line (Q13). Every other question is a tap, a tick or a range.
- INT-3 **Thirteen screens, one question each, and no required question except Q1.** "Not sure" is a valid tap on every question. Skipping is allowed; the summary says what was skipped.
- INT-4 **The task wording is the existing task wording.** Q3..Q5 use the exact task titles from the long questionnaire, so the matching in `task-map.json` (`match` is a phrase in the title) works unchanged. No trade words are added (TLR-1, MOD-18); a business's own words come on the call.
- INT-5 **The summary is for zapa to decide on, never a score or a verdict** (DSK-66, HR-5). It is plain counts and plain lists. "Worth a call" is zapa's judgement, not a number in code (HR-10).
- INT-6 **No mock data** (HR-4). Tests of the reading use answer files filled in by a person (zapa, or a real prospect with permission), kept outside the repo and given at run time, plus computed cases for the arithmetic. No invented prospects.
- INT-7 **The form decides nothing about a build.** What a prospect ticks is a claim by them. Nothing from it is a confirmed fact (DSK-58); the call confirms.
- INT-8 **The first screen is a short brief, not a question** (zapa, 2026-11-12): what wazaa is (the form speaks as wazaa, not cyborg; zapa, 2026-11-12), why they are being asked, that it takes about 5 minutes, and what it is for (which of their tasks could be streamlined). Four short lines and a Start button. There is no timer anywhere in the real form; the clock exists only in the review preview (the artifact), for zapa to time himself. The first screen says it is not an offer. PROPOSED wording: "wazaa is a WhatsApp assistant built around your business. It answers your customers from the facts you give it, and a person approves anything that matters. We ask these questions to see which of your daily tasks could be streamlined, before we talk. It takes about 5 minutes, mostly taps." Nothing on it promises a price, a result or a date.
- INT-17 **The last screen is an overview the business confirms, then Send** (zapa, 2026-11-12). It lists their own answers in plain words (business, where customers reach them, the apps they named, the tasks they do with time and repetition longest first, and the rest), each with a **Change** button that goes straight to that screen and back. Under it, what happens next in one short paragraph: they press Send, the answers reach the team privately, the team looks at the business, then a 30-minute call. Buttons: Send, and Copy my answers. **The business never sees the fit summary or the needs-building list** (INT-11, INT-12): those are for zapa. PROPOSED wording: "Thanks, that's everything. Press Send and your answers reach us privately. We look at your business, then set up a 30-minute call to show you what we could take off your plate."
- INT-18 **Q5 lets them add their own tasks** (zapa, 2026-11-12): "Behind the scenes" has only four tasks and every business has others, so under the four there is a line, "What other tasks take you the longest? Add them." (zapa, 2026-11-12: the line asks about the tasks that take longest, not about a category), with an Add button (Enter also adds). Each added task appears as a ticked chip (tap to remove) and then gets the same time and repetition taps as any ticked task (Q6, Q7) and is sorted with them (INT-11). A task of their own is in no task map by definition: it goes on the needs-building list as "their own task", in their words (INT-12). OPEN: whether the other two groups (with customers, after the sale) get the same line; zapa asked for behind the scenes only. OPEN: more default tasks for this group, if zapa names them.
- INT-19 **Portuguese first or browser-detected** (zapa, 2026-11-12). The form and its welcome page exist in Portuguese (Portugal) and English. The language is `?lang=`, then the person's last choice, then the first Portuguese or English language in their browser, else Portuguese. What is stored and sent is always the English wording (task titles, bands, answers to the tick questions), with a `Form language:` line, so `pnpm intake` and the task map read one vocabulary. Text a person types stays as typed. Built on pleb.world; nothing in cyborg's source changes.
- INT-9 **Q2 keeps its tick list of where customers reach them, and its last field asks "what apps do you use today?" instead of a link to their best listing** (zapa, 2026-11-12). The apps field is open: they type the specific apps they use, in their own words, with an example in grey as a hint that does not repeat the ticks above it: "Excel, Viator, GetYourGuide, TripAdvisor" (zapa, 2026-11-12). The example names are the form's, on pleb.world; no app or trade name goes into cyborg source (MOD-18). The words are kept exactly as written and shown on the needs-building list (INT-12) as "Apps they named". Nothing in code guesses what an app is: zapa reads the line. Today cyborg reaches only WhatsApp (`@cyborg/channel-whatsapp`). OPEN: a small name-to-channel data map (like `task-map.json`) so the summary can say "reached" or "not reached" by itself once real answers show which names come up. zapa's idea, to be decided: the strongest thing to offer may be **watching several apps at once for the customer**, which is the shadow path (listen, draft to a separate chat for staff) over more than one inbox. That is a direction for the pleb.world pitch and for the next channels to build, not a promise: nothing here claims it exists.

## The thirteen questions (PROPOSED: wording is zapa's to edit)

Answer types: **type**, **one** (pick one), **many** (tick any), **range** (a few bands to tap).

| # | Question | Type | What it is for |
| --- | --- | --- | --- |
| Q1 | Business name and website | type | who, and what `pnpm research` reads (DSK-85) |
| Q2 | Where do customers reach you today? WhatsApp, phone, email, website, Instagram or Facebook, a booking site, an agency, in person. Then, typed and open: **what apps do you use today?** (replaces the old "paste a link to your best listing") | many, plus one open typed line | channels, and the apps in their own words |
| Q3 | **With customers**, which do you do? Answering customer questions · Giving prices and quotes · Checking availability · Taking a booking or an order · Questions nobody has written an answer for · Following up customers who went quiet · Messages after hours and at weekends | many | the task map |
| Q4 | **After the sale**, which do you do? Reminders before the service or appointment · Changes and cancellations · Taking payment, invoices and receipts · Reviews and complaints · Keeping the website and listings up to date | many | the task map |
| Q5 | **Behind the scenes**, which do you do? Planning the day for the team · Staff reporting something unusual · Vehicle inspections, insurance and servicing · Licences, equipment checks and other due dates | many | the task map |
| Q6 | How long does each task you ticked take on a normal day? Under 15 min · 15 to 30 · 30 to 60 · 1 to 2 hours · Over 2 hours · Only now and then | one tap per ticked task, may be skipped | what each task costs |
| Q7 | How repetitive is each one? Same every time · Some variety · Different every time | one tap per ticked task, may be skipped | repetitive work is the easiest to hand over |
| Q8 | How fast does a customer get an answer today? | one (within minutes, within hours, the next day, it varies) | the struggle, in the customer's terms |
| Q9 | Who answers customers today? Me, my staff, both, nobody in particular | one | who the bot works beside |
| Q10 | Do you need a specific language? English, French, German and Portuguese are covered; name any other, or leave it empty. (The bot answers customers in the language they write in, and the English and Portuguese versions exist; zapa, 2026-11-12) | type, open, optional | a language beyond those, on the needs-building list |
| Q11 | How do customers buy from you? A price list they choose from · A price I work out for each customer · A slot, seat or date they book · An order I prepare and deliver · Something else | one | which module shape (sales, bookings, ...) |
| Q12 | What must never be automatic? Payments · Prices · Confirming a booking · Discounts and refunds · Replying to complaints · Something else | many | never-list and HR-1 |
| Q13 | Anything we did not list? | type, optional | the needs-building list: what maps to no module |

This is 13 screens, under zapa's target of 15 in 5 minutes. **The form never asks the person to rank anything** (zapa, 2026-11-12): it asks time and repetition per ticked task, and the **code sorts** (INT-11). Q6 and Q7 are a list of the ticked tasks with one tap each; a row left alone counts as not given and sorts last. How many messages a day is not asked, and neither is team size: what counts is the tasks and the time they take. The 5 minutes is zapa's target and the build's exit criterion (I3).

## What the answers do (cyborg's part)

- INT-10 **A message the existing intake reads.** The form's Send produces the same plain-text message shape the long questionnaire produces (short labels, then the answer), so `pnpm intake` reads it with no new parser path for the tasks. New labels (Q6..Q12) become answers under their own labels, which the reader already keeps. OPEN: whether `intake.ts` reads the three task screens as one ticked list (same output as the long form) or the form writes the ticks itself; settled at I2.
- INT-11 **The fit summary** (DSK-66): each ticked task is looked up in `task-map.json` and counted as one of `exists` (can do now), `planned` (needs a module still to build, with its milestone), `never_automatic` (stays a person's, HR-1), `not_covered` (no handler, none planned). The summary lists the ticked tasks under each, **sorted by time (Q6), then by how repetitive (Q7), most first**, with ties and rows left blank last. The sort is in code and uses the order of the bands, not a score or a number of minutes (HR-10); the first rows are where it hurts most, for zapa to read, not a decision, because that is where it hurts.
- INT-12 **The needs-building list**: what the prospect needs and cyborg cannot do. It is the `planned` and `not_covered` tasks, plus every Q13 line (each maps to no task), plus a Q11 shape that maps to no module. It is the input zapa reads before the call, and, summed over prospects, shows which module to build next. It is a list of names with the prospect's words, never a build order.
- INT-13 **What the non-task answers map to** is data in a second file, `docs/intake/answer-map.json` (PROPOSED), the way `task-map.json` is: a Q11 shape or a Q12 item to the module or rule it touches. No code knows a trade. OPEN: the exact keys, settled at I2.
- INT-14 **The staleness check.** `task-map.json` says booking is `planned W6` and several tasks `planned W7`, but `module-bookings` and `module-maintenance` exist. The map is read against what is built **before** the form goes live (I1), and corrected first (docs first), or the summary would tell zapa a built thing is missing.
- INT-15 **The summary goes with the business into the research step**: `pnpm research` and `pnpm tailor` take the name and website from Q1 (the website is the page the research step reads; the old "link to your best listing" is not asked, because Q2 now asks which apps they use, in their own words); the top of the sorted list decides which questions to ask first on the 30-minute call. Nothing starts without zapa running it (DSK-57).

## Milestones

| Milestone | What | Exit criteria |
| --- | --- | --- |
| I1 (spec) | This file, read by zapa; wording of the 13 questions fixed; `task-map.json` brought up to date with what is built (INT-14) | zapa has said yes or changed each question; the map matches the build; the PROPOSED items are logged in planning.md |
| I2 (cyborg) | `pnpm intake` reads the tap form's message; the fit summary and the needs-building list (INT-10..13); `answer-map.json` | a message filled in by a person reads to a correct summary: each ticked task under the right heading, the list sorted by time then repetition, the Q13 line on the needs-building list; `pnpm check` green; no trade word in source (`no-trade.test.ts`) |
| I3 (pleb.world) | The form page: one question per screen, big taps, progress, Send by WhatsApp or Copy as the long form does | **zapa fills it in on a phone in 5 minutes or less**, typing only in Q1, Q2, Q5 (own tasks), Q10 and Q13; 13 screens; the answers in the browser until Send. Deploy only on zapa's yes (pushing the plebworld master deploys the site) |
| I4 (link) | The cyborg page on pleb.world links to the form | the link works; the page says what the form is for in one line. Deploy on zapa's yes |

## OPEN (decide during build)

- Where Send goes: zapa's WhatsApp, as the long form does, or somewhere else.
- Whether a prospect who finishes may continue into the long questionnaire (the call script) if they want to.
- The wording of the time bands (Q6) and of Q8's answers.
- Whether Q11's "something else" and Q12's "something else" take a typed line (it would be a fourth and fifth typing place, against INT-2).
- Whether the cyborg page and the form say who zapa is, and a price. The form is not an offer (as the long form says).

## PROPOSED by me, waiting for zapa's yes

- The 13 questions and their wording above, including Q8 (how fast a customer is answered), the per-task time and repetition questions, and Q11 (how customers buy), which are mine.
- The split: pleb.world owns the form, cyborg owns the reading (data maps in `docs/intake/`).
- `answer-map.json` as a new data file (INT-13).
- This feat is a spec on its own; it supersedes DSK-84's "five answers" with the 13 screens, but keeps DSK-85..88 (research) as they are.
