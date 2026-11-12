# Idea: let the bot see a calendar, free or busy only

Brief written 2026-11-06 from zapa's discussion. The spec that came out of it is `feat-calendar.md` (branch `feat/calendar`). No code.

## The idea in one line

The bot is given the business's calendar as a short sentence of free and occupied slots, so it can offer a real day ("Tuesday or Thursday are free") without ever seeing who or what is in the calendar.

## Where it came from

A customer says "I need grass cut next week". In shadow the bot only listens and drafts to the review chat; it can ask which day, but it cannot offer one because it has no schedule of its own. The business already has a schedule in its calendar. Show the bot only whether each slot is free or occupied, nothing else.

zapa's rules for it, in his words:
- the bot sees that two slots are empty and the others occupied, nothing more
- cyborg needs no customer info: chat X in, output out, like the letter scrubber (the real names stay in WhatsApp, the key never sits in cyborg)
- a place is not a problem (a town, a postal code, an Airbnb or house address); personal names, phones and emails are filtered, best effort
- a text area where links from any provider can be pasted
- the calendar reader is a per-business plug-in; dependencies are per business, not a prerequisite
- he is building something to deliver and try, and has a first customer waiting who probably uses Proton Calendar (unconfirmed; "google apple proton idk")

## What the work is

1. **A reader** for an iCal (`.ics`) link: repeating events, all-day events, time zones, cancelled and "free" events.
2. **Slot rules** that are the business's own: which days it works, how many jobs a day or which hours, how far ahead, the lead time. None in code.
3. **A live fact** for the bot: one sentence per day with an "as of" time. If the calendar cannot be read or is too old, no sentence and the draft is blocked, never a guess.
4. **A Calendars tab** with a text area for the links, a Check button, and the link kept as a secret on the business's own machine.
5. **Read-only.** The bot never writes to the calendar and never says "booked". The office confirms and enters the booking.

## Does it already exist?

- The framework already has the pieces: a live fact built from an add-on's data with an age limit, a file-based connector, and a dashboard tab contract. This is a plug-in on those, not a change to the core.
- Outside, free and busy is a standard idea in calendars, and booking tools use it. What is different here is that the model never touches the calendar itself: code reduces it to a sentence first. I did not research prior art further.
- Provider facts, checked 2026-11-06 (mostly vendor blogs, so verify with the real link):
  - Proton: a Limited view link shows only busy times (paid plan, per calendar).
  - Google: the secret address always shows details; a busy-only link needs a public calendar set to free/busy.
  - Apple: the public link always shows details; no busy-only option.

## Is it feasible?

Yes. Reading a calendar link is small work. The fiddly parts are repeating events and time zones, and deciding what a slot is for the first real business. How fresh a link is when fetched directly is unknown and must be tested with the customer's own link.

## Open questions (carried into the spec)

- Which calendar the first customer really uses, which one holds the jobs, and what a slot is for them.
- Whether a tentative event counts as busy (proposed: yes).
- A calendar library or a reader written for free and busy only.
- How events fill slots when a slot is only part covered.
- How fresh a direct fetch of each provider's link is.

## Related threads (not in this spec)

- **No customer info in cyborg:** the vault that maps codes back to names goes; the key lives at the edge, in memory only. Places become public data. A change to docs/04, not yet written.
- **The audit session** (`feat-audit.md`): each audited pair records the calendar sentence the bot was given.
- **Contact cards** (a contact's remembered task facts, under a code): their own feat, not specced.
- **Fleet** (`feat-fleet.md`): another per-business plug-in on the same pattern.
