# feat-calendar: a calendar the bot can read (free or busy only), with a place to paste the link

Written 2026-11-06 from zapa. Branch `feat/calendar` (worktree `../cyborg-calendar`). IDs `CAL-*`. Builds on docs/12 CMP-27..29 (add-on facts, `RuntimeFactSource`, `fileFactSource`), docs/14 DSH-1..7 (a tab is contributed by an integration) and docs/04 (data classes). "must" is a requirement, "may" an option. `PROPOSED` is mine and waits for a yes; `OPEN` is settled when the build reaches it.

## Why

To offer a day ("Tuesday or Thursday are free") the bot must know which slots are free. It has no schedule of its own (docs/03). The business already has one, in whatever calendar it uses. zapa's first customer is waiting and probably uses Proton Calendar (unconfirmed). The bot must see only **free or occupied**, never who or what: no title, no name, no place.

The calendar is a per-business plug-in (zapa, 2026-11-06): the framework stays bare, and any provider that can give an iCal (`.ics`) link works through the same text area.

## What it is

An integration package `@cyborg/calendar-source` that (1) reads one or more calendar links, (2) turns them into a short sentence per day from the business's own slot rules, as a live fact with the time it was true, and (3) contributes a **Calendars** tab with a text area to paste the links.

## The text area (the Calendars tab)

- CAL-1 The Calendars tab has a text area: **one link per line**, optionally a label first (`Jobs | https://...`). Any link a calendar provider gives as iCal or ICS works; `webcal://` is read as `https://`. No provider is named in the code or the tab (MOD-6).
- CAL-2 A **Check** button reads each link once and says in plain words what it found: how many events in the next days (config), and the sentence the bot would be given. It names a problem a non-technical person can act on: the address is not a calendar file; it asks for a login; it has expired or moved; it could not be reached; **it shows event titles** (a full-detail link: "ask for a busy-only view"). A link that shows titles is still accepted, but its titles never leave the process (CAL-9).
- CAL-3 **The link is a secret.** Some providers put a decryption key in it. It is stored only in the business's own data folder, in a file readable by the owner only (as the vault is, docs/04), never in git, never in a config template, never in the intake form or any chat message. The intake form has no field for it. After saving, the tab shows only the host and the last four characters; removing a link deletes it. It is class `secret`: it can never reach a prompt (HR-2).
- CAL-4 Several links may be given. A slot is occupied when **any** link says so (so a provider that shares one calendar per link works with a business that keeps jobs in two).

## Reading it

- CAL-5 The reader fetches **only the exact address the business typed**, on a timer, with a timeout and a size limit. It makes no other outbound request. The interval, timeout and size limit are config (HR-10); PROPOSED starting values go in the scaffold with their reason.
- CAL-6 It understands what a calendar file has: repeating events, all-day events, time zones, cancelled events, and events marked as free (not busy). OPEN (decide during build): whether a tentative event counts as busy (proposed: yes). OPEN: a small ICS library as a dependency of this package only, or a reader written for exactly what free and busy needs (proposed: a library; dependencies are per business and not a prerequisite, zapa 2026-11-06).
- CAL-7 If a link cannot be read, or its data is older than `maxAgeMs` (config), the fact is **missing, not guessed**: the handler that needs it is blocked with the reason (CMP-27) and the tab shows a red line "cannot read the calendar since <time>". The office is told through the usual alert.

## What the bot is given

- CAL-8 A **slot** is the business's own idea (CAL-10). The sentence is built in code, for example "Tuesday: 2 of 3 slots free; Wednesday: full; Thursday: 1 free (as of 10:42)". It is a `RuntimeFactSource` fact, class `public`, with the time the data was true, shown to the writer with "(as of <time>)" (CMP-27).
- CAL-9 **Nothing but the sentence leaves the reader.** No event title, attendee, location, description or link text is stored, shown to a model, written to the audit or put in a log. Only counts of free and occupied slots per day. The sentence passes the scrubber (docs/04).
- CAL-10 **Slot rules are config**, per business: which days it works, and per day either a number of job slots or a list of start times with a length; how far ahead it looks; the lead time before the first offered day. How an event fills slots (an all-day event fills the day; a timed event fills the slots it overlaps) is PROPOSED. No rule, number or default is in the code (HR-10). The business's answers come from the intake (docs/13).
- CAL-11 **Read-only.** The bot never writes to the calendar, never accepts or sends an invite, and holds no calendar login. A draft that offers a day says it was free **as of** a time and never says booked, confirmed or reserved (HR-1). A customer's yes is a booking request that the office confirms and enters in its calendar itself (feat WZP-50..56).
- CAL-12 The audit pair (feat-audit.md AUD-5) records the sentence the bot was given, so a wrong offer is judged against what was really free.

## Provider notes (documentation, not code)

- CAL-13 A page in the docs lists how to get the link from the common providers (the settings path, what the link shows, what it refreshes), as facts checked at the time with their date. Known on 2026-11-06 (zapa does not yet know which provider the first customer uses: "google apple proton idk"):
  - **Proton Calendar:** a paid plan and the web app; the link is made per calendar under Share with anyone; **Limited view** shows only when the owner is busy, **Full view** shows details and its address contains the key; no combined busy link across calendars; no CalDAV; external subscribers refresh every 8 to 16 hours.
  - **Google Calendar:** the **secret address in iCal format** always shows full event details and cannot be limited. A busy-only link exists only through public sharing ("Make available to public", "See only free/busy (hide details)", then the **public address in iCal format**); that makes the calendar public, and a public feed can take hours to update. Sharing settings cannot be changed from the phone app.
  - **Apple iCloud Calendar:** the public calendar link (`webcal://`, read as `https://`) always shows full event details; there is no busy-only option. A workaround is a separate calendar that holds only the job entries.
  - **How fresh a direct fetch of a link is** must be tested with the customer's own link before any "as of" time is promised (OPEN).
- CAL-14 Because a detailed link (Google secret address, Apple public link, Proton full view) gives whoever holds it every event's details, the tab explains this at paste time and prefers a busy-only link where the provider has one (CAL-2). The details never leave the reader (CAL-9); the risk is the link itself leaking, which is why it is kept as a secret (CAL-3).

## Hard rules for this feature

- CAL-20 No customer or event detail is ever read into the framework (CAL-9). A test fails on a calendar whose titles contain a name, a phone number and an address.
- CAL-21 No mock data (HR-4). Tests use generated calendars whose answer is arithmetic (this many events, this many slots free) and, for the proof, a real exported calendar file the customer supplies, read from a run-time path and never committed. A demo business may use a calendar that says it is made up.
- CAL-22 The link is never committed, never in a template and never printed in full (CAL-3). A test fails if a saved link appears in the tab's page, its API, the log or the audit.

## Milestones

| # | Title | Exit criteria |
| --- | --- | --- |
| CL1 | The reader, the slot rules and the live fact (no screen) | CAL-4..11, 20, 21 |
| CL2 | The Calendars tab: text area, Check, hidden storage | CAL-1..3, 22 |
| CL3 | The first real customer's link, tried in shadow | CAL-13 freshness test, user check |

PROPOSED: the order and titles. Exit criteria for CL2 and CL3 are written when CL1 is confirmed (OPEN).

### CL1 exit criteria

- CL1-EC1 From generated calendars, the sentence is exact for: no events, a free day, a full day, an all-day event, a repeating weekly event, an event across midnight, a cancelled event, an event marked free, two links combined. Machine check (table test).
- CL1-EC2 A link that fails, times out, or returns something that is not a calendar gives a missing fact and a blocked handler with the reason, never a stale or guessed sentence (CAL-7). Machine check.
- CL1-EC3 A calendar full of titles with a name, phone number and address produces a sentence with none of them, and nothing about them is stored (CAL-9, CAL-20). Machine check.
- CL1-EC4 No slot rule, interval or limit is a literal in the source (HR-10). Machine check (source scan).
- CL1-EC5 The package imports no other module (MOD-17, CMP-24). Machine check.

## Open (decide during build)

- OPEN a tentative event counts as busy (CAL-6).
- OPEN the ICS dependency or a purpose-written reader (CAL-6).
- OPEN freshness of a direct fetch, for each provider (CAL-13).
- OPEN how events fill slots when a slot is part-covered (CAL-10).
- OPEN the first customer's slot rules, from the intake.
