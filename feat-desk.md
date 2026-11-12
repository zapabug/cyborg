# feat-desk: the receptionist, the company's principles, earned autonomy, and the customer card

Written 2026-11-09 from zapa's messages in one session. **PROPOSED** as a whole, complete enough to build from 2026-11-09 (zapa: "let's finish the spec and start the build"). It is built on one branch, `feat/desk`, one milestone at a time, starting with DK0 (AGENTS.md, Branches); each milestone is merged to `main` when `pnpm check` is green. What is built is recorded in `build.md`. IDs `DSK-*`. Builds on docs/07 (the sales module), docs/10 ADM-56, 64, 67, 96..99 (handoff card, morning prep, the desk's voice, the track record), docs/06 PRF-24..26 (versions, replay, no single score), feat-audit.md (AUD-10, 11, 13). "must" is a requirement, "may" an option. `PROPOSED` is mine and waits for a yes; `OPEN` is settled when the build reaches it. Wording of the customer-facing text is never invented in code (HR-10): it comes from the business's sheet.

## Why (zapa's words, condensed)

The bot is the **receptionist, the host at a restaurant**. Its standing first task is "there are empty seats: fill them", done by the best principles of an inbound desk. It is not a solicitor: nobody is cold-called, the customer was recommended and wrote to us, so the job is not to lose them. Each business then writes its own **company principles**, a short numbered list of very specific rules it abides by, which guide the bot stage by stage. How much the bot may do by itself is **earned**, per kind of question, from audited results: a kind with a good record is answered by the bot, a kind without one goes to a person. A person does the sensitive and physical steps (payment, personal details, a morning confirmation); cyborg **validates the conclusion in code** and creates a **customer card** that carries the earlier handoff summary.

## What exists and what this adds

| Piece | State today |
| --- | --- |
| Handoff card, morning prep (ADM-56, 64) | built |
| Track record per handler, version and model; candidate flag at 9 of 10 (ADM-96..99) | built; one record per handler |
| Shadow audits, reason tags, versions, replay (PRF-24..26, feat-audit AUD-*) | audits specced, not built |
| The receptionist wording, principles, question types, conclusion note, customer card | this feat |

## The receptionist (the host)

- DSK-1 The reply writer's prompt opens "You are the receptionist for {company}." and the follow-up writer's the same with its own task. This replaces "You write replies for {name}". The company name is the only place the model gets it. The lines that already exist stay: do not introduce yourself unless asked, never say or imply you are a person, the FAQ answers whether it is a bot (ADM-67, 68), never confirm a booking, promise or take payment, never state a price, day or place that is not in the facts. Amends docs/10 ADM-67.
- DSK-2 "Receptionist" is the role the model writes in. It is not a line the customer is told (ADM-68: disclosure stays per business and `none` by default).
- DSK-3 The prompt version is bumped (PRF-24), so a ledger entry shows which wording wrote a draft and the track record starts again (ADM-98).

## The standing task: fill the empty seats (inbound only)

- DSK-4 The receptionist has one standing goal: when someone writes, steer them to a slot that is really free. It is a host's way of working, in this order: answer fast; ask only the one thing still needed (how many, when); offer one specific open slot from the facts; leave one clear next step. It does not push, press or invent urgency, and it never holds or confirms a table (that is a commitment, HR-1).
- DSK-5 The free slots come from facts and records the code holds (the sheet's days and hours, capacity, the calendar when feat-calendar exists), never from the model. A slot the code cannot show as free is not offered. Until a source of free slots exists, the receptionist offers the opening days and hours only.
- DSK-6 **Shadow is inbound only (zapa, 2026-11-09).** The bot does not start a conversation in shadow. Writing first to people who wrote before or who are on a waitlist is a different task for a later stage: it needs the business's consent rules, is a draft a person approves each time (HR-1), and is OPEN, not part of the first build. "We are not solicitors: we are the place that was recommended."

## Company principles

- DSK-7 A business may write **principles**: a numbered list (about six lines) of specific rules it abides by, in its own words, for example "1. Always offer a time; never ask when suits you." They are a section of the business sheet (docs/12), read like the other sections, kept as facts with a status (PRF-2), confirmed by the business before use.
- DSK-8 Each principle has an **id** (P1..Pn, in the order written) and a **stage**: `greet`, `qualify`, `offer`, `close`, `handoff`. A line may name its stage (`[offer] ...`); a line without one applies at every stage. The model is given only the principles of the stage the chat is in; the stage is set by code from the chat's state, never by the model (HR-3).
- DSK-9 Two kinds of principle, kept apart:
  - **guidance**: given to the model in the prompt (tone, order of questions, what to offer first).
  - **checkable**: also enforced in code on the draft, in the same place as the existing checks (ADM-112), by a rule from a **fixed list the framework offers** (for example `ends-with-one-next-step`, `no-price-outside-the-sheet`, `no-time-not-in-the-facts`, `no-pressure-words`). A business picks a rule for a line by name; it cannot write code. A checkable principle that fails blocks the draft like any failed check and names the principle id in the explanation.
- DSK-10 A principle changes the prompt, so a change bumps the handler version (PRF-24, PRF-24b: built, the version carries a hash of the principles text) and is replayed over earlier entries before it is accepted (PRF-25: the replay exists for improvements; running it automatically before a principle edit is accepted is NOT built, OPEN: what "accepted" means for an edit made in the sheet).
- DSK-11 **Later, not first:** insider talk and acronyms. The business may add a **glossary** (term, plain meaning) that the back end uses to read its own principles. The first build takes plain lines only. OPEN.
- DSK-12 A principle never overrides a hard rule or a fact: where a principle and the facts disagree, the facts win, as lessons already do (prompt: "where a lesson and the facts above disagree, the facts win").

## Question types and earned autonomy

- DSK-13 Every inbound message gets a **question type** from code, by deterministic rules built from the business's own sheet, never from the model (HR-3). **The types come from the business, not from the framework or from me (zapa, 2026-11-09: "based on the business type, or what solutions are you looking for as a business").** There are two layers:
  1. **Topics, per business.** They come from the questionnaire (what the business sells and which tasks it ticked as the ones it wants solved, docs/13) and from its sheet: its services, its FAQ questions, its opening-hours and booking answers. A restaurant's topics might be reservations, menu and dietary, hours, location, groups and events. A tour operator's would differ. Each topic has matching words taken from the sheet's own entries, and a message that matches none is `other`. The audit may propose a new topic from a cluster of staff replies the bot had no answer for (DSK-52, step 3); a person accepts it.
  2. **Risk classes, fixed by the framework.** Every topic belongs to one class, which decides the bar and what automation can ever be allowed (DSK-16, 46): `information` (hours, location, menu), `money` (price, availability: a figure the customer may rely on), `action` (lock a slot, notify), `person` (complaint, anything needing the office). The class is chosen from the topic's content when the sheet is read and shown to the business to confirm. A business cannot lower a class and an LLM cannot, only a person at setup (DSK-40).
  The track record (DSK-14) is kept per topic, with its class's bar.
- DSK-14 The track record (ADM-96) is kept per **(handler, version, model, question type)**, not per handler only. The counts and the "right 9 of the last 10" display apply to each type. Still never one score for everything (PRF-26): the audit tab lists each type with its own record and "still collecting a record" until enough replies are judged.
- DSK-15 The split of an inbound question follows the record, per type: a type **without** an earned record goes to a person, with the bot drafting as today; a type **with** a candidate record may be switched to auto by a person, per type, and the switch is logged (HR-1; ADM-99: the flag is evidence for a person and switches nothing on).
- DSK-16 **Different bars.** A type that can cost money or make a promise (`price`, `availability`, `booking request`) needs more judged replies before it is a candidate than a type that cannot (`hours`). The numbers (how many replies judged, how many right) are config per type, never in code (HR-10). PROPOSED defaults are zapa's: 9 of 10 for the types that cannot cost money; the bar for the others is OPEN (zapa to name it). Not to be confused with the customer's own record (DSK-24). `booking request` and `complaint` are never auto in the first build: a person answers them.
- DSK-17 A reply in a type that is auto and is later marked wrong by the business **suspends that type** (PRF-36, ADM-99), returns it to a person, and files the failure for the audit (below). A new handler version or another model starts a new record (ADM-98).

## Learning from a failure (this extends feat-audit, it does not replace it)

- DSK-18 A failed reply is marked with a reason tag (ADM-91, AUD-10) **and** carries its question type and the principle ids that applied. The audit groups failures by type and tag, so "price: wrong fact" and "hours: wrong tone" are different findings.
- DSK-19 From a group of failures the audit may **propose** a fix, and a person accepts it (HR-1, AUD-21): a missing fact, a lesson, a new checkable principle, a prompt change, or no change. The proposal is a candidate (PRF-5), replayed over the failed cases and over the earlier right ones (PRF-25, AUD-11) so the person sees what it would have saved and what it would have broken. Nothing rewrites a prompt by itself: an automatic rewrite would void the record it was earned on.
- DSK-20 A tag points at a kind of fix, PROPOSED as a hint only, never as an action: `wrong fact` or `missed the question` points at a missing fact or a wrong question type; `promised something` points at a new checkable principle; `wrong tone` or `too long` points at the tone line or a guidance principle.

## The sensitive step, the conclusion and the customer card

- DSK-21 At a sensitive or physical step (payment, personal or secret details, a confirmation that needs a person on the spot, a morning task) the bot **never takes the step**. It hands off with the handoff card (ADM-56) and keeps gathering what it can (ADM-64). For a business with a good record the morning list is shorter and simpler because the details are already collected. The bot never receives or stores payment or secret details (HR-1, HR-2, PRV-6).
- DSK-22 The person who did the step reports a **conclusion**: a short structured note with fixed fields, not free text. PROPOSED fields: what was agreed, the date and time, how many, the price, whether a deposit or payment was taken (yes or no, and the method), who confirmed it. **`done` is a user step (zapa, 2026-11-09)**: the person enters it with `.done` and the fixed fields in the admin group. A dashboard form writing the same record is OPEN.
- DSK-23 Cyborg **validates the conclusion in code**, against the sheet and the facts, with no model call: the day is open, the party is within capacity, the price matches the services list, the required fields are present. A failed check is returned to the person as a question naming the field, and the conclusion is **not stored as valid** until it passes. The model never judges a conclusion.
- DSK-24 A valid conclusion creates or updates the **customer card**, which is the customer's **profile** and grows with every valid conclusion, so a recurring customer has a record (zapa, 2026-11-09: "last party of 4 had a family booking, did these activities, favourite food, whatever the previous chat or a review by the customer says"). It holds: a first name or the WhatsApp name, what they wanted, what was agreed and when, who confirmed it, the earlier **handoff summary** carried over (ADM-56), "paid: yes, cash, 9 Nov" style facts, and per visit: party size, the kind of booking, what they did, what they liked (favourite food and similar). What the customer said in a chat or wrote in a review may be kept as a short line, only after the scrubber has run on it (PRV-6); the original review stays where it was written. Each line is a fact with a status (PRF-2) and a date. It never holds card numbers, bank or tax numbers, identity numbers or any field of class `identity` or `secret` (HR-2, docs/04). A test plants such values in a conclusion and fails if one reaches a card.
- DSK-25 **No card from an unchecked conclusion (PROPOSED, zapa to confirm).** A conclusion that has not passed validation does not create a card: a wrong card is worse than none.
- DSK-26 The next time the same customer writes, the receptionist is given the card's facts as facts, never the identity (HR-2, HR-7). This is the contact card that `feat-audit.md` lists as OPEN ("contact cards ... are their own feat"); this feat is that feat's first part. The card is kept in the business's own store (HR-9), never in the framework repository (HR-4).
- DSK-27 The card is shown to the person on the dashboard and in the chat card, and its facts have a status like any fact (PRF-2); a person may correct a card, and the correction is audited.

- DSK-28 **`.done` ends with a thank-you (zapa, 2026-11-09).** Entering a valid conclusion also gives the person a **thank-you-for-your-business draft** for that customer, written by the receptionist in the business's tone from the card's facts (never a price, promise or offer that is not in them). It is a draft: the person reads it and sends it, or it is not sent (HR-1). No thank-you is drafted for a conclusion that failed validation.
- DSK-29 **Sensitive chats are deleted by hand (zapa, 2026-11-09).** A person may hide a sensitive chat by deleting it manually; cyborg deletes nothing of the business's on its own. A chat marked sensitive (by a person, or one that tripped the scrubber's handoff, ADM-110) is left out of the card, the audit pairs and the export. OPEN: when a person deletes a chat in WhatsApp, what happens to cyborg's own filtered copies (the chat index, ledger entries, audit pairs). The ledger is append-only (ARC-13), so the answer needs a rule: PROPOSED, a "forget this chat" command that a person runs and that removes the chat index, the card lines that came from it and the audit pairs, and leaves a ledger entry that says a forget happened, with no text.

- DSK-41 **Payment details in a chat are replaced, not sealed (zapa, 2026-11-09, corrected twice: "the scrubber makes the AI calls safe").** A customer's card number or bank account goes through the scrubber like any other hit (PRV-6, 6b): the model sees `[CARD_1]` or `[IBAN_1]`, still does the task, and the draft carries a finding so the office knows a payment detail is in the chat and takes it. The first version of this item, a sealed chat where no model is called, was built and reverted; the chat is never stopped by code for this.
  - The raw message stays only in the chat itself; cyborg's own copy is the scrubbed line (PRV-6a), so no card or audit pair holds the number.
  - A person can still mark the chat for deletion by hand (DSK-29, DSK-42).
- DSK-42 **Marked for deletion after payment verification.** A person verifies the payment, and the valid conclusion (DSK-22) records it ("deposit taken: yes, method"). At that moment the chat that held the payment is marked **delete pending**: an item on the board and in the morning sheet telling the person to delete that chat by hand in WhatsApp (DSK-29; cyborg never deletes the business's chats). When the person runs `.forget` on it, cyborg drops its own copies of that chat (chat index, stored lines, audit pairs, card lines that came from it) and writes one ledger entry that a forget happened, with no text. A sealed chat with no verified payment stays on the board as open, never silently expires.

## The two audits (zapa, 2026-11-09)

- DSK-43 **The user's audit: 20 minutes, three answers.** The person who uses the software audits it in one short session (default 20 minutes, config, HR-10): for each reply shown they say **great**, **good** or **really bad**. Nothing else is asked, apart from a one-line reason on "really bad" (ADM-91 tags, scrubbed). The queue is built to fit the time and is not the whole period: first the replies a person changed or declined, then types close to a candidate record (DSK-14), then a random sample. This replaces the seven-tag marking as the everyday audit; the tags stay as the optional reason.
- DSK-44 Great and good count as **right** and really bad as **wrong** in the track record (ADM-96), per question type (DSK-14). Great is kept apart as a signal that the reply could be a model for a lesson (DSK-19).
- DSK-45 The **code audit** (feat-audit.md, DSK-35..40) is a different layer: the team or an LLM audits the handler, principles and checks against past examples. The user's audit says what is good and bad; the code audit finds why and proposes the fix. Both read only the scrubbed record and never a sealed chat.

## The test is a person against the bot (zapa, 2026-11-09)

"It is person against AI: if the AI is right keep going, if it is wrong correct it. Do it over two weeks, and this plus the actual live answers should feed enough data to run my bot." And: "both are intended; for all intents and purposes the bot always thinks it is a real person."

- DSK-74 **The bot is never told it is a test.** A line typed in the test chat takes the same path as a customer's message: the same prompt, the same checks, the same facts. Nothing in the reply writer's input marks a test. (A test chat is shadow, so nothing is sent.)
- DSK-75 **Right or wrong, in the same place.** Under each bot reply in the test thread there are two buttons and nothing else to do. **Right** records the reply as right and the person carries on typing. **Wrong** opens a box in the thread for the correct answer; that answer is saved beside the bot's reply, scrubbed (PRV-6a), the reply is marked wrong, and the person carries on typing. No tab, no passing the chat to oneself.
- DSK-76 **One record.** A person's right or wrong in the test chat and the office's real answers to live customers are the same kind of entry: the bot's reply beside the right answer, marked right or wrong. They **count together** for the track record (DSK-14) and for the "enough data" gate (DSK-63), because both are intended. Each entry keeps where it came from (test chat or a real channel) for provenance, and the audit view shows the split, but the counts are not kept apart. This amends feat-audit AUD-12, which kept test verdicts out of the counts.
- DSK-77 **A line the bot cannot answer** has no reply to mark, so it keeps its own button, **Pass to the office**, which shows the card the office would get (the real handoff). The Questions tab is unchanged.
- DSK-78 The marks used: Right is `match`, Wrong is `worse` (PRF-16). The finer reason tags (ADM-91) and the great, good or really bad session (DSK-43) are separate, later screens.

## Context per chat: the summary card is the chat's memory (zapa, 2026-11-09)

Found in a test: the customer said "we are 6 people", and two messages later the writer asked "how many passengers?". "It is not intended. It should be allowed to build context per chat; this is where the summary card doubles, per chat and per bot interaction: a different chat starts fresh but with the existing data."

- DSK-79 **One record per chat.** Each chat has a **chat card**: what the customer has told us in this chat so far (the enquiry fields the business set, such as interest, when, how many), what is still missing, and what the bot has said. It is built by code from each message's validated extraction (every value has a source phrase that occurs in the customer's message, HDL-6), merged into the chat's record, never by free summary. A later value for a field replaces the earlier one and keeps it in the history.
- DSK-80 **The writer reads it.** The reply writer is given the chat card's collected fields and missing fields with every message in that chat, so it does not re-ask what it was told and asks for the next missing detail. This is what carries the business's goal when that goal is to gather information (DSK-7: a principle at the `qualify` stage). The card is shown to the writer as data, in the same fenced block as the other facts, never as an instruction.
- DSK-81 **The handoff card is the same record.** The card the office gets (ADM-56) is built from the chat card, so what the writer saw and what the office reads cannot disagree. The model only fills the parts code cannot (what the customer wants, what the office must check), as it does now.
- DSK-82 **A different chat starts fresh, with the existing data.** A new chat has an empty chat card. What is carried in from earlier is the customer's profile (DSK-24..26: past visits, preferences), as facts with a status and a date, never the earlier chat's lines. A chat that has been silent for the configured time starts a new card. The record is kept per chat on the business's own machine (HR-9); it holds extracted values and never an identity field (HR-2), and the scrubbed form only (PRV-6a).
- DSK-83 **Forgotten chats keep none of it (DSK-42).** `.forget` drops the chat's card with the rest. (A payment detail does not clear the card: nothing is sealed, DSK-41.)

## The standard audit protocol (zapa, 2026-11-09)

zapa opens an audit like this: "auditor, we have business X, follow our standard protocol and find gaps and flaws; compare staff replies; build a better Q&A section the bot would have. Live data, real comparisons."

- DSK-51 The **standard protocol** is one versioned text the framework ships and the Start audit button sends first (DSK-35), filled in from the session record (business, handler version, period, AUD-7). It is the same for every business, so audits are comparable. The protocol is a file of its own, written when DK6 starts (a file outside the planned structure, so zapa agrees to it first).
- DSK-52 **The protocol's steps**, in order:
  1. **Compare.** For each pair, set the bot's draft beside what the staff really answered (DSK-48) and say: same, better, worse, or different but fine (PRF-16's markings).
  2. **Group** the differences by question type (DSK-13) and by what changed (a fact, a number, the tone, an answer the bot did not have).
  3. **Gaps:** questions the bot passed to the office, or answered thinly, that staff answered the same way more than once. Each is a candidate Q&A entry.
  4. **Flaws:** drafts that said something staff would not, or broke a principle (DSK-8, 9), with the pair that shows it.
  5. **Report** in the Status layout (AUD-15): what was compared, the gaps, the flaws, the candidates, and no single score (PRF-26).
- DSK-53 **A better Q&A section.** The output includes candidate entries for the business's FAQ (`faq.entries`), each with the **pair ids it came from**. A candidate's answer is built from what the staff really said: a candidate with no source pair is dropped, and a number or time in a candidate that does not appear in its source staff replies fails a check in code (the same check as untraced numbers, ADM-112). The LLM does not invent answers. The number of agreeing staff replies a candidate needs is config (HR-10).
- DSK-54 A candidate Q&A entry is an **unconfirmed fact** (PRF-2). The business confirms it before it is used live; in shadow it may be tried (PRF-5). It is replayed over the earlier pairs before it is accepted (PRF-25).
- DSK-55 **"Live data" means real, not live access.** The comparisons are made from the business's own recorded shadow period, scrubbed (DSK-48), not from invented examples (HR-4) and not from a connection to the running chats (DSK-36a). The first protocol run is on a real shadow period.

## The flow end to end (zapa, 2026-11-09)

"The introduction is the questionnaire that builds a company profile; with the online available data we build the business profile; we run shadow; from shadow we learn how the business uses our service and how we can improve." This is docs/13's steps 1 to 5 with one new step in front.

- DSK-56 **Profile from two sources.** The business profile is built from (a) the questionnaire (docs/13, 30 minutes) and (b) **public data about the business found online**, collected before the call so the call confirms instead of starting empty. Every value from either source is a fact with a status (PRF-2): from the questionnaire `unconfirmed` until read back and accepted; from public data `unconfirmed` with its **source address and the date it was read** kept beside it.
- DSK-57 **Rules for public data.** Only pages open to anyone (the business's own website, price list, FAQ and terms pages, its public listings). It is collected by a setup tool zapa runs on his own machine, **not by the bot, not on the client's machine and never from a customer's chat**; no customer data goes out with the request. What it finds is **data, never instructions**: text from a web page is never put into a prompt as a command, and a candidate fact that came from a page is checked by code against the page's own text before it is shown (the number or time must appear in the source, as DSK-53). Where public data and the questionnaire disagree, the fact is marked `contradicted` (PRF-2) and settled on the call, never silently chosen.
- DSK-58 **The call confirms fact by fact.** Nothing from public data is used live until the business has read it back and said it is right (PRF-5, HR-8: the Demo Tours "Days" error). Public reviews and listings are **input to candidate Q&A and principles** (what customers ask and praise), not a source of prices, days or rules. Whether a third-party review text may be stored is OPEN (check each site's terms before any is kept).
- DSK-59 **Learning from the shadow.** The shadow run and the audit protocol (DSK-51..55) tell zapa how the business uses the service: which question types come in, how often staff change or decline a draft, which types earn a record, what the staff answer that the bot did not have. Each audit finding is tagged **business** (a fact, a principle, a Q&A entry, a setting: fixed in that business's profile) or **framework** (a module, a check, a prompt: goes to zapa's backlog and is never added for one company, MOD-6). Usage numbers come from measured counts only (docs/13: the savings report), never from guesses.
- DSK-60 docs/13 is amended when this is built: a new step before the questionnaire, "collect public data", and a changed first row of its table. This spec does not change docs/13 yet.

## The questionnaire is the first barrier, the call scopes it (zapa, 2026-11-09)

For zapa's installations: the questionnaire is the first barrier. Then a call: "do you need this or this? Based on the research we did for your company, these tasks are probably what we can help with most, and these others need more setup and additional modules."

- DSK-66 **The questionnaire qualifies.** The tasks a prospect ticks are read against `docs/intake/task-map.json`, which already says per task whether a handler `exists`, is `planned` (with its milestone), is `never_automatic` (HR-1) or is `not_covered`. The result is a **fit summary** for zapa, in plain words and counts: tasks we can do now, tasks that need setup, tasks that need a module not yet built, tasks that stay a person's. It is a summary for zapa to decide on, not a score and not a verdict (PRF-26 spirit; HR-5). The cut-off for "worth a call" is zapa's judgement, not a number in code (HR-10).
- DSK-67 **The call is prepared from the research.** Before the call zapa has the public-data profile (DSK-56) beside the fit summary. The call's job is to confirm and choose: for each ticked task, "do you need this or this", ordered by where the prospect's own business shows the most customer questions and the least time to answer them (read from the research, never invented).
- DSK-68 **The outcome is a scoped plan with three bands**, each task in exactly one:
  1. **Start here:** a handler exists, so the setup is the sheet, the principles and the topics (DSK-7, 13) and goes straight to shadow.
  2. **More setup:** it exists but needs the business's own data first (a calendar, a booking record, a price computation), with what is missing named.
  3. **Additional modules:** no handler yet; it is a new module or core change (docs/13 step 2, MOD-6), scoped and priced separately and not promised in the first install.
  The tasks that are `never_automatic` are listed as a person's and are not offered as a module.
- DSK-70 **Booking is part of the base install, not an extra module (zapa, 2026-11-09: "that should be handled as core; it depends on the business, a nail salon connected to a calendar handling one chat at once should handle the basic business needs").** The base install is: answers from the sheet, price, availability from the business's calendar (free or busy only, feat-calendar.md), **lock a slot as a proposal a person approves** (WZP-52, DSK-46), notify, handoff to a person, and the customer card after the step is done. "Taking a booking or an order" therefore moves in the task map from `planned` to the base once W6 is built; until then a prospect who ticks it is told it is part of the base and what is still being built, not sold as an additional module. This is a product statement: in the code the booking funnel stays a module (WZP-50, MOD-6), included in every install.
- DSK-73 **Booking is the last step and zapa switches it on (zapa, 2026-11-09: "enabled by me on the last visit").** Lock a slot is built into every install but is **off** until zapa enables it on his last visit, after shadow and drafts have run and the business has done its audit. Enabling it is a logged switch (who, when), per business, and it stays a proposal a person approves (HR-1); the switch does not make the bot book by itself.
- DSK-71 **What the base needs from a business depends on the business.** A nail salon needs one calendar and its services and prices; a restaurant needs capacity per sitting; a tour operator needs running days and places. The base asks for the one source of free slots that fits (DSK-5) at setup, which is the "more setup" band for that task (DSK-68): connect the calendar, or confirm the capacity figures.
- DSK-72 **One chat at a time is enough for the base.** The basic needs of a small business are met by the bot working one conversation at a time on one channel; nothing for parallel conversations is specced or built. A busier business that needs more is a later scope, not a base promise.
- DSK-69 The ticked tasks and the plan **are the source of the business's topics** (DSK-13): a business that ticks "taking a booking" gets booking topics and the `action` class; one that does not, does not. The first install's shadow covers only the Start-here band.

## First contact is five questions; research does the rest (zapa, 2026-11-09)

"This questionnaire is too complex and I will never get customers this way. I need the company name and website, where I can get the most info online, what needs you most, what tasks take longest and are repetitive, what you would like automated. From this initial I can research the business, create the start of the bot, and build another one-to-one questionnaire or a call."

- DSK-84 **The first contact is five answers**: (1) the company name, (2) the website, (3) where else there is information about it online (a listing, TripAdvisor, Facebook or Instagram), (4) what takes the most time or is repeated most, (5) what they would like automated first. Nothing else is asked of a prospect. This replaces the long questionnaire as the first barrier and amends DSK-66: the fit summary is read from answers (4) and (5); the 16-task questionnaire becomes the **call script**, asked only about the gaps the research leaves, in the prospect's own words.
- DSK-85 **`pnpm research`** is a setup tool zapa runs on his own machine (DSK-57), never the bot and never on the client's machine. Given the company name and the public pages (the website and the other pages the prospect named), it fetches them and writes a **draft business sheet** with the source of every line. Limits (HR-10, stated here): at most 6 pages, each at most 400 KB and 15 s, `http` or `https` only, text pages only, and a page is followed only when it is on the same site as a page zapa gave and its address names prices, services, FAQ, contact, hours or about (and nothing else: no trade words). A redirect is followed by hand, at most 3 times and only within the same site (the host, ignoring `www.` and http/https); a redirect to another site is refused and listed. The 15 s covers the body too, and a page whose announced size is over 400 KB is not read (audit 2026-11-10). The request carries a generic client name and no address of anyone's.
- DSK-86 **What it finds is data, never instructions.** The page text goes to the model fenced and labelled as an untrusted web page, and the model is asked only to copy: where, hours, services with prices, and questions with answers, each with the exact words from the page it came from (`sourcePhrase`). Code then drops every candidate whose source phrase is not in the fetched text, and every one whose numbers or times are not in its own source phrase. The dropped ones are listed with the reason, not hidden.
- DSK-87 **The draft is the client's to confirm, line by line** (DSK-58). It is written in the business sheet's own format, each line preceded by a `# source: <address>` comment, with the date it was read. It goes through `pnpm tailor --sheet` like a sheet the client wrote, so the first bot exists before the call, every fact unconfirmed. What the pages did not give (services, hours, tone, never) is listed as what to ask on the call. Reviews are not read (DSK-58); tone and the never list are never taken from a website, because they are the business's own to say.
- DSK-88 The tool writes to a folder zapa names: `sheet.draft.txt`, `research-report.md` (what was read, from where, what was dropped and why, what to ask next) and `sources/` (the text of each page as fetched, with its address and time), so a line can always be traced back. Nothing is sent anywhere but the page requests and the model calls.

## Shadow on a need-to-know basis, and the step to drafts (zapa, 2026-11-09)

"Once shadow is built on a need-to-know basis, after two weeks we should have enough data for cyborg to run drafts."

- DSK-61 **Need to know.** The shadow listens only to the chats the business chose (the chat picker, roles) and keeps only what the audit and the learning need: the scrubbed customer message, the bot's draft with the facts it used, the scrubbed staff reply, the question type, the version and the time (DSK-48). It keeps no name, no media and no chat it was not given. A field no audit step reads is not stored.
- DSK-62 **Retention (zapa, 2026-11-09): until three audits have passed, or the company's own data storage.** A shadow entry is kept in cyborg's store until **three audits** have covered it (the number is config, default 3, HR-10); after that cyborg drops it, **unless** the business has chosen to keep its record in **its own data storage** (the company's storage, on its machine, outside cyborg's store), in which case the entry is exported there in the same scrubbed form (DSK-48) and then dropped from cyborg's store. The business can drop an entry sooner (`.forget`, DSK-42). Which of the two applies is the business's choice, recorded in its config. OPEN: what "the company's data storage" is on a macOS install (a folder, the business's own system) and its export format.
- DSK-63 **Two weeks to drafts.** The step from shadow to **drafts** (a person approves each reply before it goes to a customer; effect: nothing sent without the approve button) uses the live gate (PRF-18, HR-8, docs/13 step 5) and needs: the 14-day shadow run (N-7), a minimum number of real messages (**set per business** in its config, zapa 2026-11-09, never one number for all businesses), the facts in use confirmed by the business, the deployment checklist signed (docs/10), and **one user audit** of 20 minutes done (DSK-43). Fourteen days alone is not enough: a business with few messages stays in shadow until the minimum is met.
- DSK-64 **Enough data is per question type, not for the whole bot.** At the gate each type (DSK-13) is shown with how many pairs it has. A type with too few pairs stays **human-answered** (the bot drafts in the review chat only, as in shadow) while the types with enough move to drafts. Drafts need less evidence than auto: drafts is a person approving, auto is the bot sending (DSK-15, 16). The numbers per type are config (HR-10).
- DSK-65 The three modes keep their meaning: **shadow** (nothing sent), **drafts** (a person approves each reply), **auto** (sent by the bot, per type, switched on by a person after a record). Moving a type up never skips the one below.

## What costs money: the action chain (zapa, 2026-11-09: "price, availability, lock a slot, basically book, tell the price, notify")

- DSK-46 Four things carry money or a promise, and they are the types that need the longer record before any of them is automated (DSK-16):
  1. **availability**: telling the customer a slot is free (from facts the code holds, DSK-5).
  2. **price**: telling the price (from the services list only).
  3. **lock a slot**: holding a slot for the customer, i.e. the booking. It is a commitment, so in the first build it is a **proposal a person approves** (HR-1), with an expiry, and it can be released.
  4. **notify**: telling the person or the staff group that something needs them (toast, admin group). It carries no promise to the customer.
- DSK-47 PROPOSED order for any of these to be automated, after a record and an explicit switch (DSK-15): notify first, then availability and price answers, then lock a slot last, and never a payment or a confirmation without a person (HR-1, DSK-30). zapa to confirm the order.

## What is saved, and in what form (zapa, 2026-11-09: "user input scrubbed saved, bot output saved, staff reply scrubbed saved")

- DSK-48 Cyborg's own record of an exchange (the shadow entry, PRF-16, which every audit and export reads) holds three things, in this form:
  1. **The customer's message: scrubbed, then saved.** Numbers and emails are placeholders (PRV-6); the original stays only in the chat itself.
  2. **The bot's output: saved as written** (the draft, its checks and the facts used). It was written from scrubbed input and is checked in code, so it holds no sensitive details to remove (DSK-39's reasoning: it is not sensitive).
  3. **The staff reply: scrubbed, then saved**, with the same rules as (1).
- DSK-49 **Scrub at save is a requirement, not an assumption.** A planted phone number, email and bank number in a customer message and in a staff reply must not appear in the stored entry. A test fails if they do. The scrub runs when the entry is written, so no later reader (audit, export, LLM auditor, dashboard) depends on remembering to scrub.
- DSK-50 A chat a person has run `.forget` on keeps no entry (DSK-42); a payment detail in a chat is saved as its placeholder like any hit (DSK-41).

## The audit can be run by any LLM (zapa, 2026-11-09)

- DSK-35 The audit session (feat-audit.md) is done by zapa's team for now, and **the Start audit button may plug in any LLM** to perform it: an address, a model and a key chosen for the audit, separate from the one that writes replies (MDL-*), or the same. A good LLM may do the audit eventually. Amends feat-audit AUD-14 (which proposed only the business's own model for the replay).
- DSK-36a **The audit LLM has no access to anything live (zapa, 2026-11-09).** It has no WhatsApp session, no chat list, no store, no key and no tool. It is given one static export (AUD-14) and returns text: the handler's prompt, principles and checks at a version, and the past examples (pairs) it ran on. It audits **the code and wording against past examples**, and what it returns is a set of candidates (DSK-38). It cannot send, read or change anything on the business's machine; applying a candidate is done by the framework under DSK-38..39, not by the LLM.
- DSK-36 **LLM audits run on the scrubbed record (zapa, 2026-11-09).** An LLM auditor sees **only the filtered pairs** (AUD-4, AUD-20): the customer's message and the office's answer after the scrubber has replaced phones, emails, tax, ID and bank numbers with placeholders (PRV-6), in the form stored at the time, never re-read from the live chat. The business's real chats never go to it (HR-9). **Known gap:** names in free text are not caught by the scrubber (PRV-7) until the pseudonymiser in the unwritten data-policy spec exists, so an audit export may still contain a name a customer typed. AUD-4's "no name" is true for fields the code knows are names and not for free text. This is stated to the owner before an audit address that is not on this machine is saved. PRV-7 applies: when the audit's address is not on this machine, the button says in one sentence what leaves the machine.
- DSK-37 A mark made by an LLM is recorded as such (`by: llm`, with the model) and counted **apart** from a person's marks. Whether LLM marks may count toward a candidate (DSK-14) is a config switch, **off by default** (PROPOSED), so an LLM does not vouch for its own work until the owner decides it may.
- DSK-38 What an LLM auditor proposes (a lesson, a guidance principle, a prompt wording, a check) is a candidate. By default a person accepts it (DSK-19, AUD-21). **The owner may switch automatic acceptance on, per kind of change (zapa, 2026-11-09: not recommended, but good LLMs will make these guardrails obsolete, so the guardrails are settings, not walls).** The replay (AUD-11) runs on the business's endpoint.
- DSK-39 **Automatic acceptance has a machine gate instead of a person**, and nothing is accepted without all of it: (a) the replay shows the change fixes the cases it was made for and **breaks none** of the stored right entries (PRF-25); (b) the change is **versioned** (PRF-24), so the track record starts again for that version (ADM-98); (c) it is **logged** with the model that proposed it and the replay result; (d) it can be **rolled back in one step** to the previous version; (e) a failure in the type it touched **suspends** that type (DSK-17) and pauses automatic acceptance until a person looks. The switches, and the number of replayed entries the gate needs, are config, never code (HR-10), and every change of a switch is audited with who made it.
- DSK-40 **What stays a person's call however good the model is.** Not because the model is not good enough, but because of who knows the truth and what a wrong step costs:
  - **The business's facts** (services, prices, days, hours, the rules it never breaks): only the business knows them, and a confirmed wrong fact is what HR-8 exists for. An LLM may propose a fact or flag one as stale; the business confirms it (PRF-2).
  - **Loosening a check or a hard rule.** An automatic change may add a stricter check or leave checks as they are; removing or loosening one needs a person.
  - **The five lines in code that no setting reaches:** identity never reaches a prompt (HR-2), nothing is committed or paid by the bot (HR-1), the model never selects what runs (HR-3), every model call is recorded (HR-6), businesses stay isolated (HR-9).
  - Whether to lift any of these for good is zapa's decision, written into `docs/` first, not a setting a model can edit.

## Hard rules for this feature

- DSK-30 Nothing here lets the bot commit, take payment or confirm a booking (HR-1). Auto applies only to a type a person switched on, never to commitments, and every switch is logged.
- DSK-31 The model never chooses the question type, the stage, which principles apply, or whether a conclusion is valid (HR-3). Code does.
- DSK-32 Every number (record length, bars per type, thresholds) is config (HR-10).
- DSK-33 No mock data: the first record, card and conclusion come from a real shadow run or the business's real answers (HR-4). Tests use real inputs; the scripted model stand-in may drive the model's side only.
- DSK-34 A principle, a card or a conclusion is a fact with a status; shadow accepts unconfirmed facts, live refuses them (PRF-5, HR-8).

## Milestones (PROPOSED order and titles)

| # | Title | Exit criteria |
| --- | --- | --- |
| DK0 | Scrub at save: customer message and staff reply scrubbed when the shadow entry is written, with the planted-value test | DSK-48..50 (first, because every audit reads this record) |
| DK1 | The receptionist wording, version bump, panel shows what the writer was given | DSK-1..3 |
| DK2 | Principles: sheet section, stages, guidance and checkable rules | DSK-7..10, 12, 31 |
| DK3 | Question types and the per-type record | DSK-13..17, 32 |
| DK4 | The conclusion note, its validation and the customer card | DSK-21..27, 30 |
| DK5 | Failures grouped by type and tag, with proposed fixes | DSK-18..20 (needs feat-audit AU3, AU4) |
| DK7 | Public data collection into unconfirmed facts with sources, and the call's read-back; the five-question first contact (the tool: DSK-85..88) | DSK-56..58, 60, 84..88 (a setup tool, separate from the bot) |
| DK2b | The chat card: the per-chat record, fed to the writer (built: DSK-79, 80, 82) and to the handoff card (DSK-81, not yet), forgotten chats (DSK-83, with DK4) | DSK-79..83 (found in a test run on a test business) |
| DK-base | Before DK3/DK4 can be used with lock a slot: W6 (state, funnel, Reservas, feat-wazaa-port) and feat-calendar (free or busy), in that order | DSK-70..72; their own exit criteria stay in those specs |
| DK6 | The standard audit protocol and Q&A candidates from real staff replies | DSK-51..55 (needs DK0 and feat-audit AU2) |

Exit criteria for DK2..DK5 are written when the one before is confirmed (OPEN).

### DK1 exit criteria

- DK1-EC1 The reply and follow-up prompts open with the receptionist line and keep every rule listed in DSK-1. Machine check on the built prompt.
- DK1-EC2 The handler version differs from version 5's, and a ledger entry shows it. Machine check.
- DK1-EC3 A real run with the local model on the three questions of the demo (hours, price, where the office is) still passes every draft check and never says it is a person or a receptionist unprompted. Machine check; user check by zapa.
- DK1-EC4 The page's "what the writer was given" panel shows each fact's content (services and prices, days it runs, the business's answers, tone, rules it must keep) with one note that the business approved every item, and no Name chip. User check by zapa.

## Defaults taken to finish the spec (2026-11-09; change any of them by telling me)

zapa did not answer these directly. Each is the PROPOSED default and is what gets built unless he says otherwise.

- `.forget` exists (DSK-42): a person's command that drops cyborg's own copies of a chat; cyborg never deletes the business's chats.
- A conclusion that fails validation creates **no card** (DSK-25).
- Lock a slot is a **proposal a person approves**, never a hold the bot places alone (DSK-46, 73).
- The bar for the `money` class is a config number per business, set at setup; no default is invented (DSK-16).
- Public sources for the first build: **the business's own website and its price and FAQ pages only**; no reviews, no social pages (DSK-58).
- The order of automation is notify, then information, then money answers, then lock a slot last (DSK-47).
- Auto-accept of audit changes is **off** and LLM marks do not count toward a record (DSK-37, 38).

## Open (decide during build)

- OPEN DSK-6 first-contact messages to past customers or a waitlist, after shadow (consent, per-send approval).
- OPEN DSK-11 the glossary for insider talk and acronyms.
- OPEN DSK-13 how the matching words for a topic are taken from the sheet, and which business types get a starter list of topics at setup (PROPOSED: none fixed; the questionnaire builds them).
- OPEN DSK-16 the bar (judged replies) for types that can cost money.
- OPEN DSK-22 a dashboard form beside `.done`.
- OPEN DSK-25 an unchecked conclusion: no card (PROPOSED) or a card marked unchecked.
- OPEN DSK-56..58 which public sources count (website, price and FAQ pages, a maps listing, social pages, reviews) and whether review text may be stored.
- OPEN DSK-62 what the company's own data storage is on an install and the export format.
- OPEN DSK-63 how zapa picks a business's minimum number of messages (it is set per business; docs/13 step 3 leaves the rule OPEN).
- OPEN DSK-43 the session length (default 20 minutes) and how the queue is picked.
- OPEN DSK-47 the order in which notify, answers and lock a slot may be automated.
- OPEN DSK-37 whether an LLM's marks may count toward a candidate (off by default).
- OPEN DSK-38..40 which kinds of change may be accepted automatically, the replay size the gate needs, and whether the lines in DSK-40 stay fixed.
- OPEN where the free slots come from (DSK-5): the sheet only, or feat-calendar.
