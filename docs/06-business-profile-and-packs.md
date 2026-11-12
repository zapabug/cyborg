# 06 Business profile, knowledge packs, onboarding and shadow mode

Requirement IDs: `PRF-n`. Status tags: `PROPOSED`, `OPEN`.

Thesis (zapa, 2026-10-31): the product is the business's real information,
verified, plus its rules enforced in code. wazaa beat generic assistants in
the first test because it was given the proper business info and ran inside a framework
around the business. This doc defines how that information enters the system.

## Business profile (private, per business)

A profile is a set of facts. Each fact has:

| Part | Content |
| --- | --- |
| `key` | a dotted path (`catalog.tour.west.days`, `rules.pickup.cutoff`) |
| `value` | typed per a profile schema the modules declare |
| `class` | `public` or `deal` only; `identity`/`secret` never live in the profile |
| `source` | `client_statement`, `store_sync`, `document`, `observation`, `shadow_run` |
| `sourceRef` | where it came from (a URL, a file, a message id) |
| `status` | `unconfirmed`, `confirmed`, `contradicted`, `stale` |
| `confirmedBy`, `confirmedAt` | a person (vault code) and a time |
| `reviewBy` | date after which the fact becomes `stale` |

- PRF-1 Every fact must carry its source and status. A fact without a source must
  be rejected.
- PRF-2 A fact's status moves only: `unconfirmed → confirmed | contradicted`,
  `confirmed → contradicted | stale`, `contradicted | stale → confirmed` (after a
  person re-confirms). Each move writes an audit event. (`unconfirmed →
  contradicted` was added at M4: PRF-9 and PRF-17 require a failed check or a
  `wrong fact` marking to contradict a fact that was never confirmed, as in the
  Demo Tours "Days" case. PROPOSED.)
- PRF-3 Modules declare the profile keys they require (docs/07). The onboarding
  report lists, per module, which required keys are missing, `unconfirmed`,
  `contradicted` or `stale`. It must not compute a "readiness score".
- PRF-4 Only the keys a handler declares in `profileKeys` may be injected into its
  prompt.
- PRF-5 Which statuses may reach a prompt in a **shadow run** versus **live use**
  is: shadow accepts `unconfirmed` and `confirmed` facts and marks each
  `unconfirmed` fact in the ledger; live accepts only `confirmed` facts. A
  `contradicted` or `stale` fact must never reach a prompt. (PROPOSED; zapa asked
  for a parallel shadow phase instead of choosing a fixed rule, 2026-10-31.)
- PRF-6 The model may state a business fact only from a supplied fact (HR-7).
  Rules such as prices, dates and capacity must be checked in code by the
  handler's `checks` against the profile, whatever the model wrote.

## Ground-truth checks

A fact is not confirmed by a second reader of the same source. The Demo Tours store's
"Days" field lists the days a tour does **not** run; two independent readers made
the same wrong assumption and a wrong report went out (snippet
`jumpseller-days-field-closed-not-running.md`).

- PRF-7 A ground-truth check compares a fact with an **independent** source: a
  different source kind or a different origin (live page script vs the field, a
  real service sheet, the business's own behavior in a shadow run).
- PRF-8 A check whose source equals the fact's source must be rejected as a
  check.
- PRF-9 A failed check must set the fact `contradicted` and create a discrepancy
  item. The discrepancy report to the client is a **proposal** that a person
  sends; it must list evidence for each discrepancy and must say when the
  evidence is a single source.
- PRF-10 Facts synced from a store or system must enter as `unconfirmed` and
  record how their meaning was verified (OPEN: the verification step per sync
  connector).

## Knowledge packs (shared, data only)

A pack is a versioned set of facts about a jurisdiction or trade (the first seed
is `~/Projects/research-and-development/madeira-real-estate-tax-and-gray-areas.md`).

- PRF-11 A pack fact has `key`, `value`, `grade` (`checked` = primary source,
  `secondary` = several secondary sources agree, `unverified`), `sourceUrl`,
  `sourceDate` and `asOf`. A pack also lists its open questions.
- PRF-12 By default a handler may use only `checked` pack facts. A handler may opt
  in to `secondary` facts; the proposal must then show each fact's grade.
  `unverified` facts must never feed a prompt; they appear only in the open
  questions list.
- PRF-13 A pack fact older than its `reviewBy` must be treated as `stale` and
  shown as such.
- PRF-14 Converting the Madeira R&D note into a pack is a task after v1 (docs/09).

## Onboarding a client (the first deliverable of every build)

1. Create the business db, vault and config (HR-9).
2. Load the modules the business needs; the loader lists missing profile keys
   (docs/07).
3. Import the client's real information (catalog, prices, rules, FAQ, tone,
   forbidden claims) from their systems and documents; every fact enters as
   `unconfirmed` with its source.
4. Run endpoint capability tests (docs/05) for each configured model.
5. Run ground-truth checks against independent sources.
6. Run the shadow phase (below).
7. A person confirms the facts the live handlers will use; only then may handlers
   be enabled live (HR-8).

## Shadow mode (zapa, 2026-10-31)

Before any handler goes live, the bot runs in parallel with the business:
**listen-only** on the real channel, its output sent only to a **separate review
channel**.

- PRF-15 In shadow mode the adapter must attach a listen-only source and a review
  sink. The runner must never send to the origin channel; a test must assert
  that no outbound message reaches the origin channel during a shadow run.
- PRF-16 For each event, the shadow-run log must store the handler's draft and
  what the business's human actually did (the reply, the booking, the decision),
  when it can be observed, plus a person's marking (`match`, `better`, `worse`,
  `different but fine`, `wrong fact`).
- PRF-17 A `wrong fact` marking must create a discrepancy item against the fact
  that was used and set it `contradicted` until a person re-confirms it.
- PRF-18 Enabling a handler for live use must require a recorded shadow run with
  at least the minimum in N-7, and every profile fact the handler used in that
  run must be `confirmed`, and the deployment checklist for the channel (docs/10,
  ADM-4) must be complete and signed off. Auto-reply handlers (HDL-3) have the
  same gate.
- PRF-19 The shadow-run log records business messages from real customers; it is
  covered by HR-9 and by the retention setting for the ledger (N-4).

## Evaluation loop: compare, then tune (zapa, 2026-10-31)

During the shadow run the bot's draft is compared with what the person actually
answered, so nuances can be fixed through context, prompts and lessons.

- PRF-20 Each shadow-run entry must pair the handler's draft with the human's
  actual reply (or action) for the same event, and a person's marking (PRF-16).
- PRF-21 Every entry marked anything other than `match` must be able to produce an
  **improvement proposal** that names its target: a profile fact (add, correct,
  re-confirm), a **prompt** change (a new handler version), a **lesson** (below),
  or a **check** (a new code rule). A person approves it like any proposal.
- PRF-22 A **lesson** is a short, approved context rule attached to one handler or
  the whole business (for example "when a guest asks about a private tour, quote
  the vehicle price"). It must be versioned, listed with its origin entry, and
  injected into prompts as part of the handler's fixed template slots. Lessons
  are the cyborg form of wazaa's `LIÇÃO` mechanism (wazaa docs/17).
- PRF-23 Comparison must not send customer identity to a model. Differences
  between draft and human reply are found by code (extracted prices, dates,
  quantities, named facts) and by a person's marking. A model may assist only on
  text that passed the scrubber (PRV-6), and that call is a normal handler call
  with a ledger row.
- PRF-24 Changing a handler's prompt, lessons or checks must bump the handler
  version (HDL: version written into every proposal).
- PRF-24b **A rule held in a profile fact bumps the version when its text changes** (audit 2026-11-10). A model handler may name profile keys whose value is part of the rules its prompt carries (`versionFacts`; the sales writer names `rules.principles`, feat-desk DSK-10). The version the run records is then the handler's version plus `+P` and the first eight characters of a hash of those facts' values as the run saw them, so an edited principle is a new version in every proposal, in the shadow log and in the counts per version (PRF-26), and a run with none of those facts has no suffix. Other facts (prices, hours) do not bump the version: a fact is data, a principle is a rule.
- PRF-25 After an approved improvement the harness must be able to **replay** the
  stored shadow events through the new version and report, per entry, whether the
  draft changed and whether its marking would change, so a fix for one nuance can
  be seen not to break another. Replay uses the stored real inputs only (HR-4).
- PRF-26 The evaluation view must show, per handler version, counts of each
  marking. It must not collapse them into a single "accuracy" score.

## Confidence and the monthly calibration review (zapa, 2026-10-31)

Depending on how capable the backend model is, each reply carries an evaluation
of how likely it is to be the right one. Once a month a sample is captured and
reviewed by the business's own staff, to see whether the confidence and the reply
match what the people expect, or whether more tuning is needed. The outcome is
passed to the business owner from time to time.

Items below are zapa's (monthly cadence, capture, personnel review, passing the
outcome to the owner) except those tagged `PROPOSED`.

- PRF-27 Every proposal from a reply-type or classification handler must carry a
  confidence record: a `band` (`low`, `medium`, `high`; PROPOSED) and the
  `signals` that produced it. The band is ordinal; the core must not present it
  as a percentage.
- PRF-28 Signals are chosen per handler (PROPOSED set): (a) code checks: pass or
  fail per check; (b) grounding: every business fact stated in the draft traces
  to a supplied profile or pack fact; (c) self-assessment: a field in the output
  schema (band plus one line of reason), recorded but weak; (d) token
  log-probabilities, only if the endpoint's capability test shows they are
  returned (GWY-17); (e) a verifier pass: a second handler call, with its own
  prompt (and optionally a different model), that checks the draft against the
  supplied facts and sees only prompt-safe input.
- PRF-29 The band must be derived by a fixed, versioned rule from the signals
  (PROPOSED): a failed check or an untraced statement caps the band at `low`; the
  self-assessment may lower the band but never raise it. Self-reported confidence
  is known to be poorly calibrated, and weaker on small models; the monthly
  review measures this for each backend instead of assuming it.
- PRF-30 A confidence band is meaningful only for one (handler version, model,
  endpoint). A change to any of them must mark the existing calibration `stale`
  and make a review due.
- PRF-31 Calibration review cadence is monthly (N-9). The sample is captured from
  the month's shadow or live entries (N-10). Business staff mark each entry with
  the PRF-16 markings and mark whether the band was `about right`, `too high` or
  `too low`.
- PRF-32 The sample must be reproducible (seeded) and stratified (PROPOSED): all
  auto-reply entries are eligible, `low`-band entries and entries marked wrong are
  oversampled, and a random draw of `high` entries is included. The exact method
  is config (OPEN).
- PRF-33 The review runs inside the business's own system with its own staff, who
  see the customer text. Nothing from the review leaves the business except
  coded aggregates (HR-9).
- PRF-34 The calibration report is per (handler version, model, endpoint). For
  each band it shows counts of each marking and of each confidence verdict, the
  entries marked `wrong fact`, and the improvement proposals raised (PRF-21). It
  must not collapse into one score (PRF-26).
- PRF-35 Which band makes a reply eligible for auto-reply is config set only after
  a calibration review and stored with that report. It is never a value invented in
  code (HR-10). The default is no eligibility (HDL-3).
- PRF-36 If a review finds a `high`-band entry marked wrong, auto-reply for that
  handler must be suspended until a person has reviewed the finding and re-enabled
  it (PROPOSED). The core must never adjust thresholds by itself.
- PRF-37 The monthly report to the owner is a draft proposal the supplier reviews
  and sends; sending is a person's action (HR-1). It states what was reviewed,
  what matched, what changed, what tuning is proposed and what the owner must
  decide. Passing through the supplier, it carries codes and counts, not customer
  text (PRF-33).
- PRF-38 When a new model or endpoint is configured, the shadow phase must repeat
  before auto-reply is re-enabled. How much of it is OPEN (reduced scope is
  PROPOSED).

### Staff flags against what the model and the code thought (zapa, 2026-10-31)

The most useful case is a reply that staff flag as not great while the model and
the code judged it good (a `false confidence` entry). It shows which signal let a
bad reply through.

- PRF-39 Staff must be able to flag any reply at any time, not only in the monthly
  review, from the surface they already use (a command in the ops chat, a button
  in the desk). A flag records the proposal id, a reason tag and an optional note.
  Reason tags (PROPOSED): `wrong_fact`, `promised_something`, `missed_question`,
  `wrong_tone`, `too_long`, `unclear`, `other`. The note is `freetext` and stays in
  the business's system (PRV-6, PRF-33).
- PRF-40 Each flagged entry must be placed in a two-way view: staff verdict
  (`flagged` / `not flagged`) against the confidence band (`low` / `medium` /
  `high`). The report shows the counts in each cell. It must not merge them into
  one score (PRF-26).
- PRF-41 Every `false confidence` entry (flagged, with band `medium` or `high` or
  with all code checks passing) must be reviewed in full in the next monthly
  review, in addition to the sample (PRF-32). Entries in the opposite cell (not
  flagged, band `low`) are sampled and reported as over-caution.
- PRF-42 For each `false confidence` entry the review must record which signal
  failed to catch it: the checks that passed, the grounding result, the
  self-assessment and the verifier result (PRF-28), each with its value on that
  entry. The report counts, per signal, how often it passed on flagged replies.
  This is a count per signal, not a ranking score.
- PRF-43 Each `false confidence` entry must be able to produce an improvement
  proposal naming its target (PRF-21), with a required link to the signal that
  missed it: a new or tightened check, a corrected or added profile fact, a
  lesson, or a prompt change.
- PRF-44 A new check or lesson created from a flagged entry must be replayed
  (PRF-25) against that entry and against stored entries marked `match`, and the
  result shown to the approver: would it have lowered or blocked the flagged
  reply, and does it change any `match` entry. A person decides.
- PRF-45 A staff flag on an auto-replied entry with reason `wrong_fact` or
  `promised_something` must suspend auto-reply for that handler immediately,
  pending review (PROPOSED; extends PRF-36). Other reasons are queued for the
  monthly review.
- PRF-46 Flags, reasons and the two-way counts are per (handler version, model,
  endpoint) like the rest of the calibration (PRF-30).

### Flag tickets and the supplier heads-up (zapa, 2026-10-31)

wazaa's `.bug` command is the reference (wazaa docs/04 and docs/07,
`src/nostr/devreport.ts`): a staff flag files a ticket, and the developer gets an
outbound-only, best-effort, end-to-end-encrypted heads-up. After 10 flags the
supplier goes and looks at what is failing, proactively.

- PRF-47 A flag must file a ticket in the business's system holding the context
  for that reply: the last messages of the conversation (wazaa keeps the last
  10) and the bot trace (the handler's structured reading, check results,
  grounding result, confidence band and signals, ledger call id). The ticket
  keeps the transcript until it is closed; closing it as fixed must replace the
  transcript with a "cleared <date>" marker and keep the note and trace
  (wazaa precedent; PROPOSED for cyborg).
- PRF-48 When the number of **open** flags for a handler version reaches N-12
  (10, zapa's example), the core must emit one **heads-up** to the supplier
  channel. It is a notification, not a report to the owner (PRF-37). It carries:
  business id, handler id and version, model and endpoint, the count of open
  flags by reason tag, the flag-by-band counts (PRF-40) for those flags, and the
  ticket refs with their traces. It must not carry the transcript, any
  `identity` or `secret` value, or a scrubber-failing note.
- PRF-49 Staff notes (`freetext`) are included in a heads-up only if the business
  has enabled it for notes; each note must pass the scrubber (PRV-6), and a note
  that fails is withheld with the line "note withheld" (PROPOSED; wazaa sends the
  note as written).
- PRF-50 The supplier channel is **outbound only** and **best effort**: the core
  must never read, parse or obey anything arriving over it, a failed send is
  logged and never retried in a way that stops the bot, and no remote-control path
  exists (wazaa docs/07). The channel is behind a `DevReportSink` interface
  (PROPOSED name); the wazaa NIP-17 implementation is the reference and its Nostr
  transport is deferred (docs/09).
- PRF-51 After a heads-up the counter for that handler version must not alert
  again until it has grown by another N-12 open flags (PROPOSED; OPEN whether
  closing flags resets it earlier).
- PRF-52 The heads-up says where the supplier should look, using ticket refs. How
  the supplier gets into the business's system to look (on-site, a remote session
  the business starts) is OPEN and is the business's decision; the core provides
  no back door.
- PRF-53 Flags that fed a heads-up still feed the monthly review (PRF-41); the
  heads-up only brings the attention forward.

## Build decisions for the profile (M4; all PROPOSED)

- PRF-54 A `confirmed` fact whose `reviewBy` date has passed is `stale` when read.
  A sweep persists the move (`confirmed → stale`) and writes the audit event; until
  it runs, every read already treats the fact as `stale` (PRF-5 holds).
- PRF-55 Replacing a fact's value is a new fact: the status returns to
  `unconfirmed`, the source is recorded again and an audit event
  (`fact_replaced`) keeps the old value. It is not a status move.
- PRF-56 A handler's prompt takes profile facts through `prompt.factSlots`
  (slot -> profile key) and pack facts through `prompt.packSlots` (slot -> pack key).
  Every key must be in the handler's `profileKeys` or `packFacts` (PRF-4). A fact
  of class `public` or `deal` is prompt-safe by construction.
- PRF-57 If a declared fact is missing, `contradicted`, `stale`, or (live) not
  `confirmed`, or a declared pack fact is below the handler's minimum grade, stale,
  or `unverified`, the handler is **refused**: an audit event (`profile_refused`)
  lists each blocked key and why, the outcome is `refused`, and the event is not
  marked handled. The runner mode (`shadow` or `live`) is config; the default is
  `live`.
- PRF-58 The ledger row lists every fact supplied to the call (key, status or
  grade); in shadow mode each `unconfirmed` fact is marked. A pack fact of grade
  `secondary` that was supplied adds a finding to the proposal naming its grade.
- PRF-59 A ground-truth source is independent of a fact if its kind differs from
  the fact's source kind or its origin reference differs. A passing check is
  recorded as evidence and does not confirm the fact; only a person confirms
  (PRF-2). A failing check contradicts the fact and opens a discrepancy item
  (PRF-9). A check may supply a comparison; the day-set comparison reports when the
  observed days are the complement of the fact's days (the Demo Tours inversion).
- PRF-60 The discrepancy report (PRF-9) is a normal proposal made by
  `proposeDiscrepancyReport`, listing each open discrepancy with its evidence and
  the line "single source" when only one source supports the claim.
- PRF-61 Import turns a parsed tree (JSON-compatible) into facts with dotted keys.
  An array of objects that all have a unique string `id` is keyed by that id; any
  other array of objects is keyed by index; both get a `<key>.$order` fact listing
  the segment order, so the tree rebuilds exactly (key order of objects aside).
  Arrays of scalars and empty containers are single facts. Comments in the source
  file are not data and are not imported.
- PRF-62 The core does not parse YAML. A YAML parser is a dependency that needs
  zapa's approval (OPEN, candidate: `yaml`); until then the importer reads a parsed
  tree, and `pnpm import-profile` reads JSON.

## Build decisions for shadow mode and the live gate (M7; all PROPOSED)

- PRF-63 Shadow mode is a `ShadowController` around a runner in `shadow` mode. The
  adapter hands it a listen-only event feed, an origin channel id and a review
  sink. Every outbound message goes through `controller.deliver(sink, message)`;
  a sink whose channel is the origin channel is refused with a `shadow_violation`
  audit event, and the message is not sent (PRF-15).
- PRF-64 A shadow entry stores: the event (source, id), handler id and effective
  version, the proposal id, the draft (or the proposal body for handlers without
  a draft), the handler **input after sealing** (identity values as vault codes,
  never raw), the facts used, what the business's human then did (reply text or
  action, and when), and the marking with who and when. The adapter reports the
  human's action with `recordHuman(source, eventId, ...)`.
- PRF-65 A `wrong fact` marking names the fact (default: the only profile fact the
  entry used; otherwise the marker must name it). The fact moves to
  `contradicted` if PRF-2 allows it from its status, and a discrepancy item is
  opened with the shadow run as evidence (single source).
- PRF-66 An improvement proposal is a normal proposal of handler
  `shadow.improvement`, made from an entry whose marking is not `match`, with one
  target: `fact` (a change to a profile fact), `prompt` (a finding asking for a
  new handler version), `lesson` or `check` (a finding describing the new code
  rule). A person approves it.
- PRF-67 A lesson is stored with an id, the handler it applies to (or the whole
  business), its text, the entry it came from, a version and a status (`active`,
  `retired`). Its text must pass the scrubber when it is proposed. A handler
  receives active lessons through `prompt.lessonsSlot`. The effective handler
  version written into proposals, ledger rows and shadow entries carries the
  newest applied lesson version (`<version>+L<n>`), so a lesson changes the
  version (PRF-24).
- PRF-68 Replay runs the stored sealed input of each entry through the current
  handler (current prompt, lessons and checks) without creating a proposal. The
  report gives, per entry: old draft, new draft, whether it changed, the old
  marking, and `markingAtRisk` (a `match` whose draft changed) so one fix can be
  seen not to break another. A model call in a replay is recorded in the ledger.
- PRF-69 The evaluation view is the count of each marking (and `unmarked`) per
  handler version. It has no accuracy, score or percentage.
- PRF-70 The live gate (`checkLiveGate`, `enableLive`) needs: shadow entries for
  the handler that meet the minimum (entries and days, the adapter's N-7 value;
  with no value configured the gate fails and says N-7 is not set); every profile
  fact those entries used is `confirmed` now; and the deployment checklist result
  (docs/10) from the adapter, which fails closed until M7b provides it. Enabling
  records who, when and the evidence. A runner given a live registry in `live`
  mode refuses handlers that are not enabled.

## Build decisions for confidence, calibration, flags and the heads-up (M8; all PROPOSED)

- PRF-71 **Band rule `band-rule-1`.** The band starts at `high` and only goes down:
  a failed check or an untraced statement (grounding) sets `low`; a self-assessment
  of `low` sets `low` and of `medium` caps at `medium` (it never raises); a
  transcript from a voice message caps at `medium` (ADM-30); a log-probability below
  a floor caps at `medium`, but only if a floor has been configured from a review
  (HR-10), otherwise the log-probability is recorded and not used. Every proposal
  stores the rule id, the band and the signals with their values.
- PRF-72 A handler opts in with `confidence`: optional `selfAssessment(output)`,
  `grounding(output, input, facts)` and `logprobFloor`. Handlers without it
  (extraction handlers) carry no confidence record. The verifier signal (PRF-28e)
  is named but not built.
- PRF-73 A calibration is keyed by (handler id, effective handler version, model,
  endpoint). When a proposal arrives with a different key, the previous record
  becomes `stale` and a review is due; a change of model or endpoint also suspends
  auto-reply (PRF-38). A review is also due when the last one is older than one
  month (N-9).
- PRF-74 The sample (`buildSample`) needs a seed and explicit draw sizes from
  config (N-10 is OPEN, so there is no default). It always includes entries of
  auto-reply handlers, `low`-band entries, entries marked `wrong fact` or `worse`
  and every `false confidence` entry, plus a seeded random draw of `high` and of
  `medium` entries. The same seed on the same entries gives the same sample.
- PRF-75 Staff mark each sampled entry's band as `about_right`, `too_high` or
  `too_low`. The report per (version, model, endpoint) shows, per band, counts of
  each marking and each verdict, the `wrong fact` entry ids and the improvement
  proposals raised. Its supplier export contains ids and counts only.
- PRF-76 Auto-reply eligibility is a stored band with the report reference it came
  from; there is none by default. An entry marked `wrong fact` or `worse` in the
  `high` band, or a `wrong_fact` / `promised_something` flag on an auto-replied
  entry, suspends auto-reply for the handler until a person re-enables it. Nothing
  changes the eligible band automatically.
- PRF-77 A flag is stored with the proposal, the effective version, the model, the
  endpoint, the band at the time, a reason tag, the note and who flagged it. It
  files a ticket with the last N-17 conversation messages (supplied by the adapter,
  which holds the conversation) and the bot trace. Closing a ticket as fixed
  replaces the messages with `cleared <date>` and keeps the note and the trace.
- PRF-78 A `false confidence` entry is a flagged one whose band is `medium` or
  `high`, or whose code checks all passed. The review report lists each in full
  with the value of every signal, and counts per signal how often it passed on
  flagged replies. An improvement proposal made from such an entry must name the
  signal that missed it. Before approval the approver sees the effect on the
  flagged entry and on every entry marked `match`: a lesson by replay, a check by
  running it on the stored outputs.
- PRF-79 The heads-up fires once when open flags for a handler version reach N-12
  and again only after N-12 more are open. It goes through a `DevReportSink` that
  can only send. Its payload holds counts, flag-by-band counts and ticket refs with
  traces; notes are included only if the business enabled that and each passes the
  scrubber, otherwise "note withheld". It never holds a transcript or an identity
  value. A failed send is logged and never stops the bot.

## Build decisions for the upgrade record (zapa, 2026-10-31; PROPOSED details)

Why (zapa): HR-8 is enforced for auto-reply handlers only, which is acceptable as
long as the system still records when the model failed and every approval or
refusal, so that at upgrade time another model can read the record and propose
fixes.

- PRF-80 `decide` takes an optional reason tag (the flag tags, PRF-39) and an
  optional note. The note is free text and must pass the scrubber (PRV-6); one that
  does not is refused and nothing changes. Both are written to the audit row of the
  decision.
- PRF-81 `buildUpgradeDigest` (and `pnpm digest --db <file> [--since <time>]`)
  gathers, per handler version: proposals by status, invalid-output reasons, failed
  model calls from the ledger, declined proposals with their reasons and notes,
  approvals with reasons, apply failures, scrubber stops, and staff flags with
  ticket refs; and, apart, every refusal that never became a proposal (capability,
  profile, live gate, shadow violation, failed transcription, failed ping or
  heads-up, auto-reply suspension).
- PRF-82 The digest holds ids, reasons, notes and counts. It never holds a draft, a
  customer message, a ticket transcript or an identity value. Every free string in it
  is flattened, cut to 600 characters and withheld if the scrubber finds personal
  data in it.
- PRF-83 The digest only reads. A model or a person reading it may propose a fix; the
  fix is a normal proposal that a person approves (HR-1). Nothing here calls a model.

