# 10 Admin module and deployment checklist

Requirement IDs: `ADM-n`. Status tags: `PROPOSED`, `OPEN`.

Why (zapa, 2026-10-31): the shadow phase (L6, docs/06) needs an admin module with
a checklist of the common "manners" a chat bot must have before it goes live, for
example no thinking in chat, replying only to itself or when addressed, and other
common things. The FREE Madeira team ran Hermes in their chat and zapa had to teach
it these manners by hand (use a scratch pad, no thinking in chat, speak only when
addressed, and more); wazaa's "rule zero" is "don't think in chat" with a
scratchpad (`wazaa/src/agent/scratchpad.ts`). In cyborg they are built in,
configured per channel, and **verified on real traffic in the shadow run** before
anything is enabled live.

Reading used here (confirm): "think in chat" means *no* thinking in chat, and "only
reply to @itself" means that during the shadow run the bot answers only to its own
review chat (wazaa's "Message yourself" pattern), and after go-live it speaks only
when addressed.

## What the admin module is

A module (docs/07) with its own manifest, profile keys and handlers. It holds:

- the **deployment checklist** for each channel of a business,
- the **chat roles** per channel,
- the **manners rules** that the runner enforces,
- the **kill switches**,
- **model-free verification handlers** that check the shadow log against the
  checklist and raise findings.

The admin *surface* (a dashboard page, chat commands) belongs to the adapter. The
module defines the checklist model and the checks, not the UI.

## Checklist model

- ADM-1 A checklist is per business, per channel. Each item has `id`, the rule,
  the way it is verified (`machine`, `person` or both), and a status:
  `unchecked`, `passed_machine`, `passed_person`, `failed`, `waived`.
- ADM-2 Every status change must write an audit event with who, when and the
  evidence reference (shadow-log entries, a test run, a person's note).
- ADM-3 A waiver must record who waived, why and the review-by date. Items marked
  **unwaivable** below can never be waived (PROPOSED).
- ADM-4 Enabling a handler live (PRF-18, HR-8) requires that every item for that
  channel is `passed_machine`, `passed_person` or `waived`, and that a named
  person has signed off the checklist; the supplier's own sign-off is recorded
  separately.
- ADM-5 A change to the channel's roles, the model, the endpoint or the handler
  version marks the affected items `unchecked` again (PROPOSED), consistent with
  PRF-30 and PRF-38.

## The items

Each item states the rule and how the shadow run checks it. "Replay" means the
check runs over stored real events (HR-4).

- ADM-6 **No thinking in chat (unwaivable).** Internal reasoning, routing steps,
  trace and reasoning-mode output are written to the local scratchpad, never
  posted to any channel. Model reasoning output must be disabled or stripped
  (GWY-6). Check: scan every shadow output for reasoning markers (think tags,
  step-by-step self-narration patterns); a hit fails the item. A person samples
  outputs. The scratchpad write itself is tested.
- ADM-7 **Speak only when addressed (unwaivable).** In a group the bot must reply
  only when addressed: an @mention of the bot, a reply to one of its messages, or
  a command prefix. In a 1:1 customer chat it replies only if that chat has the
  reply role. Check: replay real group traffic; the number of outputs generated
  for unaddressed events must be zero.
- ADM-8 **Reply target (unwaivable).** In shadow, outputs go only to the review
  channel; no message reaches the origin channel (PRF-15). After go-live, an
  output goes only to the channel its role allows. Acknowledgements of owner or
  staff commands go to the owner's own "Message yourself" chat or the ops chat,
  never to the customer (wazaa docs/04).
- ADM-9 **Chat roles.** Each chat has exactly one role: `reply`, `ops`, `monitor`
  (silent, no model output) or `ignored`. An unknown chat is `ignored`. Role
  changes are audited and apply immediately (wazaa docs/05). Check: replay shows
  no output in an `ignored` or `monitor` chat.
- ADM-10 **Loop guard.** The bot must never respond to its own messages, to other
  bots or to system messages, and one trigger must yield one output. Check: a
  test with a bot-authored message and a duplicated event produces no output and
  one output respectively. Bursts of customer messages are handled by the reply
  delay N-13 (BEH-16) and a late message supersedes an open proposal (BEH-18).
  (wazaa had a booking made twice in one chat, docs/09.)
- ADM-11 **Commands only from authorised senders.** Owner and staff commands use a
  fixed prefix and are recognised only from authorised senders; the same text
  from a customer has no effect. Where the channel allows it, the command message
  is removed and the acknowledgement goes to self (wazaa docs/04). Check: replay
  and a test with a customer-authored command.
- ADM-12 **Kill switches.** Per-chat stop, pause and start, and a global stop-all
  and start-all, exist and are tested: after stop-all no handler output is sent
  or even created for any chat, while incoming messages are still stored. A
  person triggers it once during the shadow run and confirms (wazaa docs/04).
- ADM-13 **No commitments before approval (unwaivable).** No output tells a
  customer that something is booked, confirmed or promised before a person
  approved it (HR-1). Check: pattern scan of every shadow output plus the
  sales checks (SAL-5).
- ADM-14 **Handoff and escalation.** When a customer asks for a person, or the
  profile cannot answer, the bot hands off to staff and goes quiet instead of
  guessing. Auto-resume after customer silence uses N-14 (12 h default, set by the
  business admin; wazaa's value). While a chat is in handoff, pause or stop and a
  customer writes, the admin must be pinged (ADM-23). Check: replay of real
  handoff cases.
- ADM-15 **No internals leaked.** Outputs must not contain system prompts, ledger
  ids, profile keys, model names or ticket internals. Check: pattern scan.
- ADM-16 **Language and tone.** Replies come in the customer's language and the
  profile's tone. Check: person (staff) samples; not machine-verifiable.
- ADM-17 **Retention and privacy terms.** Message retention, scratchpad retention
  and ledger retention (N-4) are set, and the business's privacy terms mention the
  bot and the supplier heads-up (PRF-48). Check: person.
- ADM-18 **Media policy (zapa, 2026-10-31).** Voice notes go through a local
  speech-to-text model only (whisper class; never a cloud service) and the
  transcript is handed to the bot as ordinary customer text. Images, documents,
  files, video and anything else that is not text or voice are not read, not
  described and not acted on by the bot; they are forwarded to the admins and the
  chat counts as waiting for a person (ADM-23). zapa: people trust WhatsApp and
  similar chats with images, so that is not the bot's job to judge. Detail in
  ADM-28..33. Check: replay of real voice and image events.
- ADM-19 **Quiet hours and business hours (OPEN).** Whether replies are limited to
  hours is per channel config. Default: no limit.
- ADM-20 **Shadow evidence.** The recorded shadow run meets N-7 and contains the
  traffic types the checks need (a group, a 1:1 chat, a handoff, a command). A
  check that cannot be run for lack of such traffic stays `unchecked`.

## Verification handlers

- ADM-21 The module registers model-free handlers (HDL-13) that run the machine
  checks over the shadow log and output one proposal each: findings (what was
  seen, with entry references) and questions (what a person must decide). They
  must not mark an item passed on their own; a pass is the *absence* of findings
  on enough real traffic (ADM-20) and is recorded as `passed_machine` with its
  evidence.
- ADM-22 A finding from these handlers feeds the flag system (PRF-39) with reason
  `manners`, so repeated breaches raise the supplier heads-up (PRF-48).

## Admin ping when a customer is waiting (zapa, 2026-10-31)

- ADM-23 When a customer writes in a chat whose bot is in handoff, pause or stop,
  the admin must be pinged that a customer is waiting for a person, through the
  adapter's `AdminNotifier` (PROPOSED name), for example a **toast** on the
  business's machine, or a card in the ops chat as wazaa does today ("needs a
  person").
- ADM-24 The ping must go once per waiting period, not once per message: further
  messages from the same customer update the waiting time and do not raise a new
  toast. A reminder while the customer is still waiting uses N-15 (OPEN).
- ADM-25 The ping must carry the chat reference and how long the customer has
  waited, and must not show the customer's message text on screen (PROPOSED:
  a toast is visible to anyone near the machine).
- ADM-26 The waiting period ends when a person replies, the chat is restarted or
  the auto-resume (N-14) returns it to the bot. Each ping and its end are audit
  events.
- ADM-27 The notifier is a connector: desktop toast, ops-chat card or both is the
  adapter's choice. A failed ping is logged and never stops the bot. Decided
  (zapa, 2026-10-31, L17): cyborg runs on the company's office machine and its only
  front end is a web app served from that machine, so no native app and no
  per-OS toast are in scope; ADM-45 to ADM-48 say how an alert reaches people.

## Media (zapa, 2026-10-31)

- ADM-28 A voice message must be transcribed by a local speech-to-text engine
  behind a `SpeechToText` interface (PROPOSED name) before any handler sees it.
  A cloud transcription service must not be used. The engine and model are OPEN
  (decide during build).
- ADM-29 The transcript enters the handler as `freetext` (PRV-5): it passes the
  scrubber or is treated as `identity`. It carries `source: voice` in the event
  and in the proposal, so staff see in the review that it was transcribed.
- ADM-30 If transcription fails or returns nothing, the bot must not guess: the
  chat is handed off and the admin is pinged (ADM-23). The failure is an audit
  event. PROPOSED: a voice transcript is never above the `medium` confidence band
  (PRF-27), because transcription errors are not visible to the signals.
- ADM-31 The audio itself is deleted after transcription; only the transcript and
  the event reference are kept (PROPOSED, privacy; retention of the audio is
  therefore not a setting).
- ADM-32 An image, document, file, video, sticker, location or contact must
  create no model call and no handler output. The adapter forwards the original
  to the admins through the ops chat or the `AdminNotifier` (ADM-27) and the core
  stores only the event reference and the media type, not the media bytes
  (PROPOSED). The forward is audited.
- ADM-33 In shadow (PRF-15) the forward goes only to the review channel (ADM-8).
  Whether the bot sends the customer a fixed acknowledgement ("a colleague will
  look at this") is OPEN; default: it sends nothing. A message carrying both text
  and an image is treated as text for the bot and the image is forwarded.

## Build decisions for M7b (all PROPOSED)

- ADM-34 **Event shape.** The adapter normalises every inbound event so the gate
  can apply the manners: `payload.chat` (an opaque chat reference, never a phone
  number or JID; the adapter maps those to vault codes), `isGroup`, `addressed`
  (an @mention, a reply to the bot, or a command prefix), `fromBot`, `fromSelf`,
  `system`, `sender` (an opaque reference), `text`, and `media` (`{type}`) when a
  message carries one.
- ADM-35 **The gate** (`ChannelGate`) decides for each event, in this order:
  system, own or bot messages and duplicate event ids are ignored (ADM-10); a chat
  with no role, or `ignored`, is ignored (ADM-9); a global stop stores the message
  and creates nothing, except commands from authorised senders (ADM-12); a command
  prefix from an authorised sender is a command, from anyone else it is ordinary
  text and has no effect (ADM-11); a `monitor` chat is stored and silent; an
  `ops` chat accepts commands only; in a group the bot acts only if `addressed`
  (ADM-7); media is handled by ADM-28..33; a chat in `handoff`, `paused` or
  `stopped` starts or extends a waiting period and runs nothing (ADM-14, ADM-23);
  otherwise the event is for the bot. Every decision is an audit row with its
  traffic type (`group`, `direct`, `command`, `handoff`, `media`, `ignored`), which
  is the evidence ADM-20 counts.
- ADM-36 **Commands** use a configured prefix and are `stop`, `pause`, `start`,
  `stopall`, `startall`, `restart`, `role <chat> <role>`. The acknowledgement goes
  to the self or ops chat through the acknowledgement sink, never to the
  customer's chat (ADM-8, ADM-11).
- ADM-37 **Waiting periods.** A customer message in a chat that is not in the `bot`
  state opens a waiting period and sends one `AdminNotifier` call carrying the chat
  reference and the time waited, never the text (ADM-25). Later messages only
  update the period (ADM-24). A person's reply, a restart or the auto-resume (N-14,
  customer silence, set by the admin per business) ends it; each ping and each end
  is an audit row. A notifier that throws is logged and the bot goes on (ADM-27).
  No reminder is sent until N-15 has a value.
- ADM-38 **Reply delay** (`ReplyScheduler`): customer messages for one chat are
  held; N-13 after the last one (each new message restarts the wait) they become
  one event whose text joins the messages with a newline and whose id is the last
  message's id. A maximum total wait is OPEN and unset. Commands and ops events
  pass straight through. A new customer message while an earlier proposal for the
  chat is still `proposed` supersedes it (BEH-18).
- ADM-39 **Checklist rows.** For an item verified by `both`, the status stays
  `unchecked` until the machine part and the person part are both recorded, then
  becomes `passed_person`. A supplier sign-off is stored apart from the business's
  sign-off. The gate reads `complete` (every item passed or waived) and the named
  business sign-off.
- ADM-40 **Reasoning.** `<think>` blocks are removed from a model response before
  it is parsed, and what was removed goes to the scratchpad, never to a channel.
  The scratchpad is an append-only local JSON-lines file (`FileScratchpad`).
  ADM-6's machine check scans every shadow output for reasoning markers.
- ADM-41 **Media.** An event with `media.type = audio` goes through the
  `SpeechToText` interface; its transcript replaces `text` and the event is marked
  `source: voice`. Any other media type is forwarded to the admins through the
  forward sink, opens a waiting period and runs no handler. See ADM-28..33.
- ADM-42 **What a change invalidates** (ADM-5): a change to the roles puts ADM-7,
  8, 9, 10, 11, 12, 14 and 18 back to `unchecked`; a change to the model, the
  endpoint or a handler version does the same for ADM-6, 13, 14, 15, 16 and 20.
  Both clear the business and supplier sign-offs.
- ADM-43 A handler with `effect: auto_reply` cannot run in `live` mode when the
  runner has no live registry (HR-8); this closes the M7 gap where the registry
  was optional.
- ADM-44 (zapa, 2026-10-31) **Inference key alert.** When the inference key is
  rejected or the credit is gone (GWY-24), the admin is alerted once through
  `AdminNotifier.alert`, with a fixed sentence: the cause and that the bot is not
  answering customers until it is fixed. It carries no key, no provider response
  body and no message text. A failing notifier is logged and changes nothing. The
  customers whose messages were refused are still waiting; the adapter should treat
  them like a handed-off chat (ADM-23), which is not wired in the core.

## Alert delivery (zapa, 2026-10-31, L17)

- ADM-45 Every admin alert (ADM-23 a waiting customer, ADM-44 a rejected key) must
  be written to the store as an `AdminAlert` (kind, chat reference or empty, a fixed
  sentence, raised, seen and cleared times) by `StoreNotifier`. The dashboard's
  "needs attention" panel reads `AlertStore.listOpenAlerts`. The sentence carries no
  message text, no key and no provider response (ADM-25, ADM-44).
- ADM-46 `OpsChatNotifier` must send a card to an admin chat: `[NEEDS A PERSON]`
  for a waiting customer, `[NEEDS ATTENTION]` for an alert. It must refuse the
  origin channel and any chat whose role is `reply` (ADM-8); the role is read at
  send time.
- ADM-47 `fanOutNotifier` must try every notifier and fail only when every notifier
  that supports the call failed, so one path being down does not hide the alert.
  The store allows one open alert per (kind, chat): raising it again while it is
  open changes nothing, so a restart or a repeated cause does not stack alerts.
- ADM-48 When the cause ends (a person replies, `.start` or `.restart`, the N-14
  auto-resume, `Runner.resetInferenceProblem`) the notifier's `resolved` is called
  and the alert is cleared. A person marking an alert seen is recorded once with
  who and when (`markAlertSeen`). A failing `resolved` is an audit row.
- ADM-110 (zapa, 2026-11-03; changed 2026-11-08, see PRV-6) **Personal data in a customer's message.** A hit is now replaced by a placeholder and the bot goes on; the card or
  draft carries a line that contact details are in the chat. What follows applies only when the scrubber still stops the model call for a customer message (PRV-6), the chat is handed
  to a person the same way as a voice note that cannot be transcribed (ADM-28): its
  state becomes `handoff` with the reason `scrubber hit` and a waiting period
  opens, so staff get the `[NEEDS A PERSON]` ping (ADM-23..25; held back out of
  office, ADM-53) and the dashboard alert (ADM-45). The ping carries the chat
  reference only, never the matched text (ADM-25, PRV-2). The bot leaves the chat
  until it is settled like any handoff: a person replies, `.start` or `.restart`,
  or the N-14 auto-resume (ADM-26, ADM-48). The manual-handling proposal (PRV-6)
  is still made and still shows the chat as blocked on the board.
- ADM-49 OPEN (decide when the dashboard is built): the dashboard is served on
  `localhost` only from the same process, a tab on the office machine shows the
  banner, plays a sound and may raise the browser's own notification. The core
  has no HTTP server yet; the store-backed alert list is what it will read.

## Presence: out of office (zapa, 2026-10-31)

- ADM-50 A chat admin must be able to flip a presence toggle with two commands from
  an authorised sender (ADM-11): `.ooo [note]` and `.back`. Each change is an audit
  row (`presence`, from, to, who, note). Out of office does not stop the bot: it
  still takes requests and works out dates from the availability facts, and nothing
  it says is a confirmation (HR-6, SAL-5).
- ADM-51 The note is free text of up to 40 letters, digits and `: . , / + ( ) -`,
  shown as typed, never parsed. The toggle does not expire by itself: the admin
  says `.back`. (A timed expiry needs a clock rule nobody has set.)
- ADM-52 The bot is given one sentence per message, built in code from the toggle
  (`presenceSentence`) as the runtime fact `presence.status`, class public, status
  confirmed. It is not a profile fact: it is never stored there, the live gate
  skips it, and `wrong_fact` cannot target it. The reply handler says it only when
  the customer asks when a person will answer. A time quoted from the note is
  traceable to the fact, so the number check passes it; any other time fails it.
- ADM-53 While out of office, a waiting customer is still stored and raised as an
  alert for the dashboard, but `notify` carries `quiet: true` and `OpsChatNotifier`
  sends nothing. `.back` acknowledges with the chats still waiting. The reminder
  ladder and a direct message to named staff are not built yet.
- ADM-54 OPEN (zapa, 2026-10-31): the exact wording of "needs confirmation by the
  hotels and partners, handled as soon as possible, likely the next day", and which
  requests get it, are not decided in code or by lessons alone. They are found in a
  **discovery shadow phase** (ADM-55, PROPOSED), where the agent works to a brief,
  asks the admin and records the real flow; a builder then writes the handlers,
  config and facts from that record.
- ADM-55 PROPOSED, not built (zapa, 2026-10-31; corrected the same day): second-pass
  shadow analysis. Pass 1 is the existing bot draft against the human's action.
  Pass 2 reads the same exchange afterwards and writes down what the bot would need
  to come across like a real person, such as a restaurant hostess. It proposes
  nothing, installs nothing and changes no fact, prompt, lesson or check; the
  builder (zapa or an agent) reads it later. The bare-minimum hostess (greets, takes
  name and party size) is the existing intake and reply draft. The pass looks above
  that level for (a) staff support: what the bot could have prepared or tidied so a
  person's next move is quicker, and (b) reading the room: which open chats are
  about to need a person and the cues the humans acted on. Output: notes per exchange by
  dimension, each with the words from the human's reply as evidence, and a dossier that groups
  them with counts and no score. It needs a handler effect `note` (stored against
  the shadow entry, never applied); the model call, checks, ledger and version
  rules stay the same, and the human's reply is scrubbed and sealed as any
  customer-side text. A brief marking tasks X (the bot must do it) or Y (ask the
  admin) and questions to the admin in the review channel are a later option.

## Office hours and who is assumed at the office (zapa, 2026-11-01)

- ADM-60 The office schedule is a setting of the company: a time zone, hours per weekday (several intervals allowed, for a lunch break), and closed dates (`YYYY-MM-DD` once, `MM-DD` every year: holidays and closures). It tells the bot whether to assume a person is at the office. It is **not a gate**: the bot works at every hour, and the framework runs whenever the machine it is on runs.
- ADM-61 With a schedule, `.ooo` and `.back` hold only until the schedule next changes: an `.ooo` at 11:00 ends when the office would close; a `.back` on a closed evening ends at the next opening. A forgotten toggle cannot outlive the day. Without a schedule a toggle holds until the other command (ADM-51).
- ADM-62 Who is assumed: an unexpired toggle wins; otherwise the schedule decides; with neither, a person is always assumed. The bot is given one sentence from this (`presence.status`, ADM-52), such as "No person is on duty right now. Staff note: back Monday 09:00.", with the time in the office's own zone and daylight saving followed.
- ADM-63 A person may answer at any hour, in a chat or in the ops chat, and what they say is recorded and settles the chat as before (ADM-57). Nothing about the hours stops the bot from doing its job.
- ADM-64 When nobody is assumed at the office, the bot does its job and also gathers what it can: after each customer message it builds a handoff card (ADM-56) from the last N-17 lines of that chat, kept in memory only, and sends it to the ops chat. The ops chat gets the first card of a closed period for each chat; later messages refresh the stored card (the morning sheet shows the latest) without another message, so the chat does not fill up overnight. It can be switched off (`office.cardsOutsideHours`). A refresh per message is more model calls than one per burst; once the reply delay (N-13) is wired it should be one per burst. Pings to staff stay held back (ADM-53).
- ADM-65 OPEN: the machine. The bot only works while the machine it runs on is on. For the out-of-hours work to mean anything the office PC (or a small always-on machine) must stay on and awake overnight; messages that arrive while it is off are the channel adapter's to catch up on. Ask this at the questionnaire.

## Customer-facing behaviour (zapa, 2026-11-01)

- ADM-66 What a customer sees depends on the mode and on the company's confidence evidence. In shadow nothing is sent (PRF-15). In live, a draft needs a person's approval unless the handler is allowed to auto-reply, which needs an eligible confidence band from a staff-reviewed calibration (PRF-33, PRF-34) and is off by default (HR-1).
- ADM-67 The bot speaks as the business's own desk (zapa, 2026-11-08): short, direct, natural, no stiff boilerplate, and when it cannot answer or the office must decide it says what a person would ("I'll pass this to the office and they'll come back to you"), not an error. Its instruction is "You are the receptionist for {company}" (zapa, 2026-11-09, feat-desk DSK-1..3): the company name is given to the model there and nowhere else, and "receptionist" is the role it writes in, not something it tells a customer. It does not call itself an assistant and does not introduce itself. It **never says or implies it is a person**; if a customer asks whether it is a person or a bot, the business's own FAQ answer to that question is used when it has one (a business may point to a page about how the system works and how it handles data, zapa 2026-11-08); otherwise it answers truthfully in one short plain sentence (the business's automatic reply system, and a colleague can take over). This is enforced in code: a draft that claims to be a person is blocked like a commitment, in English and Portuguese. (Reason: a natural voice, not impersonation. The customer is not told unless they ask. Some businesses may still need to tell customers up front, for example under the EU's chatbot transparency rule, Article 50(1), from 2 August 2026: that is the business's adviser's call, and ADM-68 has the switch.)
- ADM-68 What a customer is told is per business (`modules.sales.persona.disclosure`): `none` (the default) adds nothing: no introduction, no notice; `first_message` opens the first message of a chat with a one-line introduction that the reply is automatic, with an optional first name; `testing` adds that and a test notice to every draft ("a colleague reviews it"). The built-in texts say "automatic reply", never "assistant". The texts are added by code, so a model cannot leave them out, and can be rewritten in the customers' language (`intro`, `testNotice`). If the adapter does not say whether a chat is new, it is treated as new.
- ADM-69 OPEN: other default messages a business wants customers to get (an out-of-hours notice, a handoff line, a failure line) as fixed text per business, and the case where a customer sincerely asks and the draft is held for approval.

## The board and the toast (zapa, 2026-11-01)

zapa: the toast shows the customer's first name and a summary, with a yes or no; clicking it loads the chat so a person can take over. The admin has a dashboard view of every customer chat, coloured when something needs a person: red needs attention now, yellow needs follow-up, green needs an answer or is ongoing, no card is complete. The toast should show over other apps, outside the web app, as ChatGPT's site can.

- ADM-81 The company layer keeps a chat index: which chat each event came from (`event_chats`) and the customer's display name as a vault code (`chat_contacts`, identity class). It is store schema version 2, the first real migration (ARC-9): a copy of an existing file is taken first, and it is tested on a version-1 file. The core still keeps no chat history. The name comes from the adapter's `contactName`; it never goes to a model and is read back only to show staff.
- ADM-82 `buildChatBoard` colours each chat from stored state (zapa, 2026-11-01), red over yellow over green, anything settled by a person's reply or `.done` after it was made no longer counting: **red, needs action now**: a customer is waiting for a person, the bot could not answer safely (a scrubber stop or a blocked draft), or the bot is not sure of its own reply (the low band, ADM-75 and PRF-28); **yellow, the morning handoff and stale chats**: a handoff card nobody has settled, with or without a question for the office, and a chat nobody has answered for longer than `board.staleAfterHours` (N-19, no default: with it unset nothing is flagged stale, and `pnpm company check` says so); **green, the bot did its job**: its reply passed every check, in the high or medium band, and only waits for a person to accept it; **none**: nothing waits, the chat is complete and is left off unless asked for. Each row has the customer's first name, every reason that applies, a one-line summary (the card's, else the reason's fixed sentence), when the oldest need began, and the chat state. A low-band reply being red rather than yellow is my choice (OPEN): in shadow nothing is sent, so the colour then means "the bot's draft is not good enough to accept".
- ADM-83 (changed 2026-11-08, zapa: the customers write in WhatsApp on the office PC, so the toast carries the name WhatsApp shows) The toast for a row carries the customer's WhatsApp name as the title (as WhatsApp shows it, cut at 40 characters; it is kept in the vault and goes only to the office screen, never to a model) and the one-line summary as the body (cut at 120 characters), in the staff language. A screen can be seen by anyone near it, so `toast.detail` may be set to `reference_only` (chat reference and the reason, no name and no summary). This amends ADM-25 for companies that choose the default.
- ADM-84 A click on the toast opens the chat on the dashboard (`#/chat/<chat>`). The toast offers two actions: **take over** (the bot stops answering that chat; `takeOver`) and **leave it to the bot**. `handBack` returns the chat to the bot and settles it, ending its waiting period and clearing its alert. Whether the buttons show on the toast itself depends on the browser (ADM-85); the same two buttons are always on the chat view.
- ADM-85 Over other apps: the dashboard asks the browser for permission to show notifications, once, as a site such as ChatGPT's does. A notification then shows through the operating system (Windows, macOS, Linux) over other apps while the browser is running, even if the dashboard tab is in the background or minimised. `localhost` counts as a secure context, so no certificate is needed. To verify on the office machine's browser, because these are the browsers' rules, not ours: buttons on a notification need a service worker (Chrome and Edge support them, Firefox does not); keeping a notification on screen until clicked (`requireInteraction`) is honoured on Chrome for Windows and Linux but not on macOS; Do Not Disturb or Focus modes suppress it; with the browser closed nothing shows, because a closed-tab push needs a push service and an address reachable from the internet, which a localhost-only dashboard does not have. So the browser must be left running on the office machine, the dashboard tab open or the dashboard installed as an app. Fall-backs on the tab itself: the title and the icon badge show the red count, and a sound plays once the person has clicked anywhere on the page (browsers refuse sound before that).
- ADM-86 The dashboard (`@cyborg/dashboard`, `pnpm dashboard --config <file>`) is a small web server for the office machine and a page, both built. The page has: the counts of red, yellow and green and the red count in the tab title; the open alerts as a red banner (a rejected key, the call cap) with a Seen button; the board, each row coloured, with the first name, the summary and the time; the chat view for a selected row (the handoff card, the replies waiting for a person, the conversation, and the buttons Take over, Hand back to the bot and Done); the morning sheet as a second tab; a language button (`pt` / `en`, the same `.lang` toggle); the button that asks the browser for notification permission; and live updates by a stream that sends the board whenever it changes. Every sentence the page itself shows is in Portuguese or English by the same toggle. It shows what is in the company's database: it does not send to a channel, so after a take-over the person answers in WhatsApp as usual and the bot has stopped answering that chat.
- ADM-87 Safe by construction for the office machine: it listens on `127.0.0.1` only; a request whose Host is not that address is refused (DNS rebinding); every API call and every change needs the per-start token the page was served with (no other site can read it), and a browser Origin that is not this page is refused; nothing is cached; the page loads no script, style or font from outside and its policy allows only itself; text from customers is put on the page as text, never as markup. The operator name on a change comes from a one-time prompt in the browser and is written to the audit as `dashboard:<name>`.
- ADM-88 The notification code is in the page: on a new red row it shows a notification with the toast (first name, one-line summary, the two buttons through a service worker where the browser supports them, kept on screen until clicked where the browser honours that), plays a short sound once the person has clicked on the page, and sets the tab title. A click opens the chat view. A row is announced once for the time it began (`chat|since`), remembered across page reloads. A toast's "leave it to the bot" hands back a chat a person holds and only dismisses one the bot already has, so it never hides a reply or an office question.
- ADM-89 The chat view's conversation comes from the channel adapter (`history(chat, limit)`), because the core keeps no history. Without one it shows the lines this process saw since it started. Chats whose events were handled before the chat index existed (schema version 2) are not on the board.
- ADM-111 (zapa, 2026-11-03: "QR in the browser", as wazaa had) **Linking a channel from the dashboard.** `startDashboard` takes an optional `link()` from the channel adapter returning `{ channel, state, qr?, account?, hint? }` or null: `state` is `starting`, `waiting` (a code to scan), `linking`, `linked` or `error`; `qr` is the code as rows of `0`/`1` modules, drawn by the page itself (nothing loaded from outside, ADM-87); `account` is the linked account as the adapter shows it; `hint` is an extra line per staff language. It is part of `/api/state`, so the stream refreshes it on its own. While it is not null the page shows a panel at the top: the code and how to scan it, then linking, then linked. The adapter returns null once linked with a channel file, so the panel goes away. The framework draws modules and knows no channel (ADM-102). The terminal code stays as a fallback.
- ADM-90 OPEN: yellow and green toasts (proposed: red at once, yellow once at opening time with the morning sheet, green never); who may take over (today anyone who can open the page on the office machine); approving or declining a waiting reply from the page (the marking and approval commands are not built); starting the dashboard together with the always-on service and keeping the browser open on the office machine; a real run in the office browser to confirm notifications, buttons and sound behave as in ADM-85.

## The dashboard and the toast are a host that modules plug into (zapa, 2026-11-01)

zapa: the toast and the dashboard plug in to different modules, and that is intended.

- ADM-92 An `AttentionSource` is what a module contributes: `items()` returns what needs a person now, each an `AttentionItem` with a colour (red, yellow, green), a title (a customer's first name, a vehicle, a site), a one-line summary, a neutral `reference` and a fixed `reasonText` that leave out anything personal, when it began, the module's own reason codes, and its action buttons. `act(itemKey, actionId, by)` runs a button; `detail(itemKey)` gives the generic item view its text. `collectAttention` puts every source's items together, red first and the oldest first within a colour. The dashboard, the live stream, the notification and the service worker use only this: they know no module. A click on an item opens its own view (the chat view for a chat) or the generic item view.
- ADM-93 The toast for any item (`toastForItem`) has the title and the summary, cut at 120 characters, or with `toast.detail: reference_only` only the reference and the fixed reason, for every plug-in alike. The notification's buttons are the item's actions and act through its source, so a button on a toast needs no knowledge of what it acts on.
- ADM-94 Plug-ins today: the chat desk (a chat board row is an item with Take over and Leave it to the bot), the feedback module (an undecided review complaint, yellow, with Handled and Not a complaint), and any a company's adapter adds in `attentionSources` (a fleet module's inspections due, written the way an adapter would, is the test's proof that nothing in the dashboard is chat-shaped). The company runtime builds the desk's and feedback's sources by itself when those modules are on.
- ADM-95 OPEN: a source's own colour rules (a fleet source decides what is red by days to the inspection and the company's own interval); which sources toast (proposed: red at once, yellow once at opening time, green never); a source that is slow or throws (today one failing source breaks the list; it should be skipped and shown as a source error).

## Per-item running days (found on Demo Tours' catalog, 2026-11-01)

- ADM-100 An `offer.items` entry may carry its own `days` (weekday numbers, 0 = Sunday; `[]` means any day) and `keywords` (other words customers use for it). The reply check for a named day or date is then per item: with items named in the draft (by name or whole-word keyword) only their days count, with none named any item's days count, and an item with no `days` falls back to `offer.availability.days` as before. Reason: Demo Tours' tours run on different days (one on Tuesday, Friday and Sunday, another on Monday, Wednesday, Thursday and Saturday), and a single business-wide list would let "that tour runs on Thursday" pass for the wrong tour. In Demo Tours' first simulation this blocked a draft that put the wrong day on a tour.
- ADM-112 (zapa, 2026-11-08) **Saying a day is closed is a correct answer, not a claim that it is open.** The weekday and date check (SAL-2, ADM-100) looks at the clause a day is named in. A day that is *not* a running day passes when its clause says it is closed or not available (closed, not open, doesn't run, except, fechado, não …); the same day in a clause that does not say so is still blocked, so "yes, we're open Sunday" cannot pass. The reverse is checked too: a clause that says a running day is closed ("closed on Monday" when Monday is a running day) is blocked. Plural forms ("Sundays", "domingos") are days like the singular. Found when the recorded demo showed the model's correct "No, we're closed on Sunday. Open Monday to Saturday" held back as an error, because it named Sunday. A date is read the same way; a draft that names a closed date as closed passes. A clause ends at . ! ? ; : , a line break, a dash, or "but"/"mas"/"however". A claim about every day ("every day", "daily", "including weekends", "todos os dias") is blocked when the business lists fewer than seven days, unless the clause is negated.
- ADM-113 (zapa's test chat, 2026-11-09) **Three more things a draft may not do, found in a real test.** (1) A **flat price is never written as a starting price**: a price that no item lists with `priceFrom` is blocked when the draft puts a "from" word directly before it ("Short cut: from 20 EUR" when the short cut is a flat 20 EUR); the reverse rule (ADM-100, a starting price needs "from") stays. (2) A draft **never says the bot did something it did not do**: "I've sent a request to the team", "your request has been sent", "já enviei o pedido" are blocked, because nothing is sent in shadow and a request is the business's to raise (HR-1). (3) A draft **never promises the bot's own follow-up**: "I'll check back with them", "I'll get back to you", "I'll let you know" are blocked; the team coming back to the customer is said as the team's ("the office will come back to you"), as the prompt already asks. The reply prompt also says a placeholder such as `[PHONE_1]` stands for a detail the customer wrote that the writer cannot see: it never repeats or comments on it, and the team has it (PRV-6; found when a draft answered "call me on [PHONE_1]" with "we can't share your number here, but just call us back").
- ADM-114 (zapa's test run on a test business, 2026-11-09) **Four small fixes found running a real business sheet.** (1) The sheet reader reads "up to 15 passengers" (also people, guests, persons, pax, seats, places, spots, participants; Portuguese "até 15 pessoas/passageiros/lugares") on a service line as that item's `capacity`, so a true statement of the limit is not blocked as an invention ("the draft states a capacity (15) but offer.items has none"); the note keeps the words. (2) The reply writer is given **day names, never day numbers**: the availability and each item's running days are written "Monday to Saturday" in the prompt (the code's 0 to 6 stays in the facts and in the checks), because a draft told "Confirm the days (1-6)". (3) The built-in commitment patterns add "lock it in", "lock you in", "book you in", "got you booked" and "I'll hold the date for you". (4) A person can **change a mark** in the test thread: Change under a marked reply clears the mark (and the answer that a Wrong saved), audits it, and the reply can be marked again.
- ADM-115 (feat-desk DSK-42, 2026-11-09) **`.forget`: dropping this install's own copies of one chat.** A person (an authorised sender) sends `.forget <chat>`; it says what it would drop (how many saved exchanges, the chat card, the customer's name) and that nothing is deleted in WhatsApp (the person deletes the chat there by hand), and does it only when the same command is sent again with `yes`. It drops: the saved shadow entries of that chat (the customer's scrubbed message, the bot's reply and the staff reply), the chat card and any other per-chat module state, the link between the chat and its events (the chat index), the customer's name from the vault (unless another chat uses the same name), the chat's own state, and what the runtime holds in memory for it. It does **not** touch proposals, bookings or decisions a person made (they are the business's records), the prompt ledger (it holds scrubbed requests and ages out under N-4), or any other chat. It writes one audit row, `chat_forgotten`, with the counts and no text. Never automatic (HR-1).
- ADM-101 OPEN, from the same simulation: the checks cover numbers, prices, days and capacity, not other claims. A local 8B model stated things the profile does not say or contradicts: that pick-up is not included (the FAQ says pick-up is offered), named restaurants, that a tour passes a place it does not, that there are no promotions. All of those replies were in the high band. A check on named places and a way to supply the tours' stops and local tips as facts are the next candidates; until then the band says little about such claims and only the audit (the markings) tells the truth.

## Green is the evidence for automation (zapa, 2026-11-01)

zapa: green tells the shadow that this has been right 9 out of 10 times and can potentially be automated.

- ADM-96 `trackRecords` counts, per (handler, version, model), how often a reply a person judged was right. One verdict per reply: a shadow marking (match, better and different-but-fine are right; worse and wrong fact are wrong), or, where there is no marking, the approval (right) or decline (wrong) of its proposal; a reply with both is counted once, by its marking; a reply nobody judged is not counted. Only the most recent `of` count. A kind is flagged **candidate** when `of` replies have been judged and at least `minRight` were right: `automation.candidate`, zapa's example 9 of 10 by default (N-20). The record is counts ("right 9 of the last 10"), never a single score (PRF-26).
- ADM-97 A green row, and its attention item, carry the record of the kind of reply it is (`record`: right, considered, of, candidate), shown on the dashboard as "right 9 of the last 10" with the candidate flag; the audit tab lists every kind's record, with "still collecting a record" until `of` replies are judged. The toast stays short and does not carry it.
- ADM-98 A new handler version (a changed prompt or an approved lesson, which tags the version), or another model, starts a new record, as a changed version or model makes a calibration stale (PRF-30).
- ADM-99 The flag is evidence for a person and switches nothing on. Auto-reply stays off by default (HR-1) and an eligible band is set only from a staff-reviewed calibration report (PRF-34, PRF-35, HR-10); a high-band reply later marked wrong still suspends it (PRF-36). A run of 10 is a small sample: the number is zapa's and the flag does not say the kind is safe to automate. OPEN: whether to also require the 10 to span days and chats, a minimum band, and showing the confidence band alongside the record.

## Approving, declining and marking (zapa, 2026-11-01)

- ADM-116 **Housekeeping runs by itself.** A running install calls `Company.housekeeping()` at start and every N-19 (audit 2026-11-10). It does two things and nothing else: it returns to the bot every handed-off chat whose customer has been silent for the admin's interval (ADM-26, N-14), which already writes its own audit rows, and it drops the prompt ledger rows older than N-4 (PRV-10). It never touches proposals, decisions, bookings or the audit. A failure of either is logged on the console and the other still runs.
- ADM-91 The shadow audits (every 3 days or weekly, N-18) and the day-to-day approvals are done on the dashboard, and by `Company.decide`, `auditQueue`, `mark` and `auditCounts`. **Approve or decline** a reply waiting for a person, with a reason tag (wrong fact, promised something, missed the question, wrong tone, too long, unclear, other) and a short note that the scrubber checks (PRV-6) and that is kept with the choice for the next upgrade review (PRF-80); the operator's name is the actor. **Audit** tab: each shadow entry shows what the customer wrote, what the bot drafted and what the human did, with the confidence band; the person marks it match, better, worse, different but fine, or wrong fact (with several facts used, they pick which one; it is then contradicted and a discrepancy opens, PRF-65); unmarked entries come first; the counts per handler version are shown with no single score (PRF-26). An approval records the choice: nothing is sent from the dashboard, because there is no channel adapter yet (a live install's approval should apply through the adapter's sender).

## Language (zapa, 2026-11-01)

zapa: cyborg is Portuguese by default with a language toggle; replies follow the customer's language, so a tourist who opens with "bom dia" and goes on in English is answered in English; every toast and card is in Portuguese or the toggled language, because the businesses he approaches are local.

- ADM-74 `detectLanguage` guesses Portuguese, English, Spanish, French, German or Italian from word lists in code, with no dependency. It says unknown for fewer than two matching words or when the best is not twice the next, and a greeting in one language does not decide a message in another (greeting words shared or mixed in are not in the lists). It is a safety net beside the model, not a replacement.
- ADM-75 The reply prompt tells the model to reply in the language of the customer's message, to judge a mixed message by its question and not its greeting, and names the company's default language (`modules.sales.defaultLanguage`, Portuguese unless set) for the case it cannot tell. A `language` signal then compares the customer's language with the draft's: a clear mismatch puts the reply in the low band, a match is recorded, and an unclear case adds no signal.
- ADM-76 The introduction and the test notice the code adds are in the language the customer will read (the draft's, else the customer's, else the default). Built-in text exists for Portuguese and English ("Olá, sou {name}, assistente virtual de {business}." / "Hi, I'm {name}, the automated assistant of {business}."); another language gets the English text unless the company gives its own (`persona.intro` and `persona.testNotice` take one text for all languages or a text per language code, for example German).
- ADM-77 Staff-facing language: `language` in the company config (`pt` or `en`, Portuguese by default) and the `.lang pt|en` command (Portuguese `.idioma`), stored and audited, taking effect on the next sentence. The command names have Portuguese aliases: `.parar .pausar .iniciar .reiniciar .parartudo .iniciartudo .funcao .fora .voltei .feito .idioma`.
- ADM-78 In the staff language: the ops-chat prefixes (`[PRECISA DE UMA PESSOA]`, `[PRECISA DE ATENÇÃO]`), the waiting-customer line, the alert sentences for a rejected key and the call cap, every reply to a command, the handoff card (blocks "pedido, recolhido, ter em conta, o bot já disse, o escritório deve verificar" with "Assunto:" and "Estado:" for zapa's Spec and State), the morning sheet's head, headings and "Nada pendente.", and the on-duty sentences given to the bot (with the weekday of the next opening in Portuguese). A company's own `wording` (ADM-71) still replaces the on-duty sentences.
- ADM-79 At the library level the staff language defaults to English (so a plain adapter's texts match its tests); the company config, which is how an install is made, defaults to Portuguese. An adapter built without the operations layer passes its own language source.
- ADM-80 OPEN: not yet in the staff language: the explanations of a blocked draft and the shadow-review lines, the dashboard (not built), and the tools' own messages (`pnpm company`, `pnpm simulate`). The customer-facing languages other than Portuguese and English have no built-in introduction.

## Wording the company can edit (zapa, 2026-11-01)

zapa: the texts the code adds on the company's behalf, and the block on claiming to be a person, must be easy for the people running cyborg to edit.

- ADM-71 `wording` in the company config rewrites the three on-duty sentences the bot is given (`onDuty`, `outOfOffice`, `outOfOfficeWithNote`; `{note}` is the staff note or the time the office is back), in the company's language. A line left out keeps the built-in English one. Each is one line of at most 300 characters. The introduction and the test notice are rewritten in `modules.sales.persona` (ADM-68).
- ADM-72 `modules.sales.humanClaimPhrases` adds phrases (case-insensitive) that count as the bot claiming to be a person, in the customers' language, next to the built-in English and Portuguese patterns. The built-in patterns cannot be switched off from the config: a customer-facing text that says or implies the bot is a person is refused wherever it is written (ADM-67).
- ADM-73 `pnpm company check` reports an error for any editable text that claims the bot is a person or spans two lines, and a warning for a note line with no `{note}`. `pnpm company wording <file>` prints every text as it will read (the three sentences, what the bot hears from the schedule and after `.ooo`, the introduction, the test notice, the added phrases), flags one that must change, and lists the texts the config cannot change yet: the ops-chat prefixes and alert sentences, the command acknowledgements, the handler prompts (changed with approved lessons, which are versioned and replayed) and the card and sheet headings. Making those editable is OPEN.

## Handoff card and morning prep (zapa, 2026-10-31)

- ADM-70 (zapa, 2026-11-01) The staff already have the conversation in the chat. The card is a summary that saves them reading time, so it is built to be quicker than the chat: one short line of what the customer wants, the fields collected, what to keep in mind, what the bot already told them, and what the office must check. A block with nothing in it is left out. The customer's own words behind each line stay in the proposal and are shown only on request (`evidence`). "Office to check" holds what someone at the office must decide, not a copy of the customer's questions. A card pays off on long chats: in a real run on a local 8B model a 3-line, 25-word chat produced a 57-word card, which is longer than the chat. OPEN: skip the card for short chats (a line or word threshold nobody has set), and measure reading time saved (words in the chat against words in the card are counted; minutes need the company's own reading speed).

- ADM-56 Handoff card. When a person takes over a chat, the adapter assembles the
  recent lines (`customer:`, `bot:`, `staff:`) and raises `handoff.requested` with
  `chat` and `transcript`. `sales.handoff.card` (model, strict schema) returns what
  the customer wants, values for the configured enquiry fields, needs (preferences,
  limits, worries), what the bot told the customer, and what is still open. Every
  line must carry words that occur in the chat, and any number in it must be in the
  chat, or the output is invalid. `renderHandoffCard` builds the card in code in
  zapa's Status layout (`Spec:` and `State:` blocks split by rules, no table).
  `OpsChatNotifier.card` posts it to an admin chat only (ADM-8); it may carry
  message text there because that chat is private to the admins (the waiting ping
  stays free of text, ADM-25). It is a proposal, so a person's approve or decline
  with a reason is recorded and reaches the upgrade digest. A chat with a phone
  number or email in it is stopped by the scrubber (PRV-6) and gets the manual
  handling proposal instead of a card. The gate does not raise the event yet.
- ADM-57 Morning sheet (zapa, 2026-10-31). The first task a person does on arriving
  at the desk, in the Status layout, in this order: (1) pending answers from the
  office: chats whose latest handoff card has an open question that only the office
  can answer (for example whether there is room for more people on a day), shown as
  the card; (2) complaints gathered from review sites (NOT BUILT, see below); (3)
  customers still waiting for a person (ADM-53). Built in code from stored cards
  (`pendingChats`, `renderMorningSheet` in module-sales); the real chat reference
  comes back from the vault for the admins' display only. A chat is pending while
  its latest card has an open question and nobody has settled it since. Settled
  means any person answered in that chat (`ChannelGate.personReplied(chat, by)`) or
  an authorised sender sent `.done <chat>`; the role of the person does not matter,
  only that it is a person and not a customer or the bot (zapa). Each settling is
  an audit row. The schedule that sends the sheet at opening, its opening time and
  whether it goes to the ops chat or only the dashboard are OPEN.
- ADM-58 Review complaints, built in `module-feedback` (zapa, 2026-10-31: the framework serves any business, so
  review sites are an adapter matter). Framework side: a `review.received` event
  (site name, review text, rating if the site gives one); a handler that extracts the
  complaint topics from the public review text with the reviewer's words as
  evidence; a way for a person to paste a review in; a morning-sheet section for open
  complaints (a complaint is open while its proposal is undecided); the bot never
  posts a public reply. Adapter side: how reviews arrive. wazaa's example sites are
  Google, Tripadvisor and GetYourGuide; secondhand research found Google's API needs
  approved access, Tripadvisor offers owner email notices, and GetYourGuide's
  supplier reviews sit in its portal; all to be verified by that adapter, and
  scraping against a site's terms is out.
- ADM-59 Layering (built): `MorningSection` (core) is what a module contributes;
  `renderMorningSheet` and `waitingSection` live in module-admin and take the
  sections in the order given; `officeAnswersSection` is the sales module's,
  `complaintsSection` the feedback module's. `pasteReview`-style intake is
  `reviewEvent`, whose id is a hash of site, reference and text so a review pasted
  twice runs once. A complaint stays on the sheet while its proposal is undecided;
  approving means seen and handled, declining means not a complaint.

## The WhatsApp channel adapter (zapa, 2026-11-02)

The first real channel. It is the customer-side adapter CMP-10 and ADM-34 describe, written for Demo Tours and first run on zapa's own test number. Its transport is the pattern of wazaa's `whatsapp/client.ts` (read, copied into the customer's repository, not imported: AGENTS.md "reference code", HR-9). Only the transport comes across; the thinking is the gate and the handlers.

- ADM-102 **Where it lives.** (zapa, 2026-11-03, replacing the first rule that kept it in the customer's repository: "most of my local businesses use WhatsApp, so I need to leverage it and make it better than Meta AI.") WhatsApp is a **framework integration**: the package `@cyborg/channel-whatsapp`, which any company turns on, with its own dashboard tabs (docs/14 DSH-2). Demo Tours' `src/whatsapp.ts` moves there with its tests; a customer repository keeps only its channel file and its `adapter.ts` wiring. `whatsapp-web.js` (zapa approved, 2026-11-02) and `qrcode-terminal` (in use since the adapter was written, not yet approved; audit 2026-11-03) are dependencies of that one package only: the core, the company layer and the other modules stay free of WhatsApp. The goal it is measured against is Meta's own business AI on the same chats (docs/14 "What does not map cleanly" 4), in the shadow audits, not assumed.
- ADM-103 **Linking.** The adapter links as a WhatsApp Web device: a QR code printed in the terminal and, if `pairNumber` is set, a pairing code instead. The session folder lives in the customer's `data/` (never in git). It uses the system Chromium (`executablePath`) so no browser download is needed. Wazaa's self-healing ladder is kept as it is: authenticated but not ready after 120 s restarts the client up to 3 times per run on the last good WhatsApp Web build, then once every 10 minutes, and each step is written to the log. The channel file names the account (`ownNumber`); if the linked account is another one, the adapter stops and watches nothing. With no channel file the adapter starts **link-only** (zapa, 2026-11-03: "open it for any number"): any account can be linked from the QR code, no chat is watched, nothing is sent, and once linked it prints the account's digits to put in `ownNumber`; the run is then restarted with a channel file, and the session is reused without a new QR code. The dashboard port is `DASHBOARD_PORT` (default 4180). The linked device reads every chat on the account; the role table (ADM-105) decides which ones the bot looks at.
- ADM-104 **Chat references.** The core never sees a number or a JID (ADM-34, PRV-2). A chat reference is `wa-` and the first 12 hex characters of an HMAC-SHA256 of the JID with a random per-install salt stored in `data/wa-salt` (owner-only). The adapter keeps the reference-to-JID table in memory and rebuilds it from the chat list at start; the customer's display name goes in `payload.contactName` (ADM-81: kept in the vault, shown to staff only).
- ADM-105 **Which chats are watched.** A channel file `whatsapp.json` in the customer repository (gitignored: it holds numbers) lists JIDs or digits for `replyChats` (roles `reply`), `monitorChats` (`monitor`), `opsChat` (`ops`), `reviewChat` (`"self"`, the account's own "message yourself" chat, or a JID), `authorisedSenders`, optional `replyDelayMs`, `pairNumber`. Before the company is created the entry script merges the roles (reply chats `reply`, monitor chats `monitor`, the review and ops chats `ops`) and the authorised senders (as references; `"self"` is `ownNumber`) into the loaded config, so the company applies them once as `config` (ADM-9). The shadow run uses its own store and vault under the channel file's `dataDir`, apart from any simulation's. The entry script refuses to start unless the mode is `shadow`, and the channel file refuses a customer chat that is also the review or ops chat. Any chat not listed has no role and is ignored: its text is not stored, not logged and never reaches a handler; the log shows only a count. A group is watched only if listed, and the bot acts in it only when addressed (ADM-7). The `whatsapp.json` of a customer that is live is part of that channel's deployment checklist (ADM-1).
- ADM-106 **Inbound.** A customer message becomes `{ id: <scrubbed message id>, source: 'whatsapp', kind: 'message.received', at, payload: { chat, isGroup, addressed, sender, text, contactName? } }` for `company.process()`. A WhatsApp message id carries the customer's number (`false_<digits>@c.us_<hash>`, and in a group the sender's too), so the core never gets it as it is (ADM-104, PRV-2; zapa, 2026-11-03, the Letter Scrubber approach): every address in the id (`…@c.us`, `@lid`, `@g.us`, `@s.whatsapp.net`, `@broadcast`, `@newsletter`) is swapped for the reference that address gets under ADM-104, so the same chat or sender always gives the same reference, and the rest of the id (the from-me flag and WhatsApp's own message hash) is kept. If anything number-like is still left in the kept parts (an `@`, or 7 or more digits in a row; the references themselves are hex and not checked), the whole id becomes `wa-m-` and the first 24 hex characters of the same HMAC instead. The raw id stays in the adapter's memory only, and nothing outside the adapter needs it back. Status broadcasts and the account's own sends are dropped. A message with media but no text carries `media: { type }` and is handled by ADM-28..33; this adapter does not download media, so a voice note reaches the gate without a transcript and the chat goes to a person (ADM-28). Customer bursts are held by core's `ReplyScheduler` (ADM-38, N-13, or `replyDelayMs` when the channel file sets one) and run as one event; commands and the ops chat are never held (BEH-17).
- ADM-107 **The person answers; the bot learns it.** A message the account itself sends (`message_create`, `fromMe`) in a watched `reply` chat that the adapter did not send is a person answering: it calls `company.personReplied(chat, 'person', { eventId, source: 'whatsapp', text })` of the customer message it answers. The adapter's own sends are recognised by message id and by body for 120 s (wazaa's rule: WhatsApp reports the same send under a second id form). A command prefix from an authorised sender in any chat is a command (ADM-36) and its acknowledgement goes to `reviewChat` or `opsChat`, never to the customer.
- ADM-108 **Outbound.** In shadow mode the adapter has two sinks and no more: `ack` and `review` (and `ops` for cards and alerts), each delivering to its chat from ADM-105. There is no code path from a handler to a customer chat; a send to a JID that is a `reply` chat is refused by the adapter and logged as a violation (PRF-15 as a second fence). Live sending is a later change that needs HR-8 first. `history(chat, limit)` for the dashboard reads the last lines of that chat from the linked device, mapped to `customer`, `staff` (account) and `bot`.
- ADM-109 OPEN: a new customer message while a draft for the chat is still open does not yet supersede it (BEH-18; the adapter's scheduler is not given the store's supersede); whether to refuse to start when the linked account has more than a set number of chats outside the table; what to do about a customer's reply that WhatsApp reports under an `@lid` id the table has never seen (wazaa solved the send side only); a typing indicator and send delay for live mode.

## Out of scope for v1

Per-customer opt-outs, multi-language checklist text, and any automatic
re-verification schedule (ADM-5 only marks items unchecked).
