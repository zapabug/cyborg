# 07 Modules and the sales module

Requirement IDs: `MOD-n` (module layer) and `SAL-n` (sales module). Status tags:
`PROPOSED`, `OPEN`.

## Module contract

A module is a package with a manifest (zod-validated):

| Part | Content |
| --- | --- |
| `id`, `version`, `coreRange` | module id, its version, the core versions it works with |
| `handlers[]` | the handlers it registers (docs/03) |
| `profileKeys[]` | profile keys its handlers require, with types |
| `packs[]` | knowledge packs it needs, with the minimum grade |
| `capabilities[]` | endpoint capability level required (docs/05) |
| `privacy` | the data classes its handlers use; the mechanisms it needs (scrubber, vault) |
| `dependencies[]` | external dependencies: `{ kind: service | local_tool | model | connector, name, how it is checked }` |

- MOD-1 The loader must refuse to load a module whose `coreRange` excludes the
  running core, and must list every unmet requirement (profile keys, packs,
  capabilities, dependencies) instead of stopping at the first.
- MOD-2 A module must register handlers only through `registerHandler` (HDL-1..4
  apply) and must not import an adapter, a store implementation or the network.
  It receives a `ctx` with only the services its manifest declares.
- MOD-3 Handler ids must be namespaced by module id; two modules in one business
  must not collide.
- MOD-4 A module must not bypass the proposal lifecycle, the data classes or the
  prompt ledger.
- MOD-5 Unloading a module must not delete its stored proposals or audit rows.
- MOD-6 Adapter config selects which modules are on, which handlers within them
  are on, the model per handler, the trigger rules and the connectors.

## Build decisions for the module layer (M5; all PROPOSED)

- MOD-10 The manifest also lists its handlers by id (namespaced, MOD-3), each
  profile key with a type (`string`, `number`, `boolean`, `json`), each pack as
  `{ id, minGrade }`, each required capability as a level, `privacy` as
  `{ classes, mechanisms }`, and `dependencies` as `{ kind, name, how }`.
  `validateManifest` returns every error, not the first.
- MOD-10a A profile key may be marked `optional`: the loader does not count it as
  unmet, and a handler that reads it is refused at run time while the fact is
  missing (PRF-57). The sales module marks `sales.criteria` and
  `sales.followup_after_hours` optional (found while building the dry run).
- MOD-11 `coreRange` is a space-separated list of comparators (`>=`, `>`, `<=`,
  `<`, `=`, or `^`) over `x.y.z`, all of which must hold. There is no semver
  dependency (AGENTS.md).
- MOD-12 Unmet means: a profile key with no fact at all (status is not checked
  here; the runner and the live gate do that); a pack that is not loaded or has no
  fact at the grade; no tested endpoint at the capability level; a dependency whose
  adapter-supplied check fails or is absent; a declared connector the adapter did
  not supply. A module with any unmet item is refused whole; none of its handlers
  are registered.
- MOD-13 After requirements pass, the loader checks the module against itself: its
  manifest handler ids equal the handlers it creates, every handler id starts with
  `<module id>.`, handler profile keys are in the manifest, handler data classes are
  in `privacy.classes`, and a model handler's level is covered by `capabilities`.
- MOD-14 `ctx.connector(name)` returns only connectors the manifest declared
  (`kind: connector`); any other name throws. A source scan
  (`scanModuleSources`) flags a module whose source imports an adapter, a store
  implementation, `node:sqlite`, `node:http(s)`, `node:net`, `node:child_process`,
  or calls `fetch`; the repository test runs it over every `packages/module-*`.
- MOD-15 Adapter config may list `enabledHandlers` per module (MOD-6); only those
  are registered.
- MOD-16 `unloadModule` removes the module's handlers from the registry and
  touches no stored data (MOD-5).

## Sales module (first module)

Both a wazaa-shaped need (a customer enquiry becomes a booking proposal) and a
madrltr-shaped need (a buyer intake becomes a qualified lead) are sales intake,
so this module proves the layer. The module must serve both with the same code,
different config.

Handlers:

- SAL-1 `sales.enquiry.intake`: from an enquiry (message or form), extract a
  structured enquiry: what is wanted, when, how many, language, constraints.
  Output is a proposal of `changes[]` with source phrases. Identity fields come
  in as vault codes only.
- SAL-2 `sales.enquiry.reply_draft`: draft a reply grounded in the business
  profile and permitted pack facts. Output is a `draft`. Any statement of a
  price, date or capacity must pass the adapter-supplied `checks` against the
  profile; a statement that fails the check blocks the proposal and creates a
  `question` for a person.
- SAL-3 `sales.enquiry.qualify`: classify an enquiry against profile-defined
  criteria (fit, missing information, next question). Output is `findings` and
  `questions`, never an automatic decline.
- SAL-4 `sales.followup.draft`: draft a follow-up for an enquiry that has no
  response past a profile-defined interval (interval is config, not a spec
  number: OPEN).
- SAL-5 No sales handler may produce a commitment (booking confirmation, price
  promise, contract). Such actions are separate proposals a person approves
  (HR-1, HDL-3).

Profile keys the sales module requires (typed by the module): `business.name`,
`offer.items` (what is sold, with prices and unit basis), `offer.availability`
(days or periods), `rules.commitments` (what the bot may never promise),
`tone.style`, `faq.entries`; for SAL-3 `sales.criteria`, for SAL-4
`sales.followup_after_hours` (added at M6, PROPOSED). A business without them cannot enable the module
live (PRF-3, PRF-18).

Dependencies: a channel connector from the adapter (WhatsApp chat, form
submissions, email), a contact store from the adapter. wazaa's `src/whatsapp`
and `src/store/jumpseller.ts` are the reference connectors.

## Two-consumer proof

- MOD-7 The proof harness (`proof/`) must run the same sales module configuration
  shape against (a) real wazaa-style customer messages from `~/Projects/cyborg/wazaa`
  test chats and (b) a real buyer intake supplied by zapa from one of his live
  deals. It must record every place where module code needed a special case for
  either; the goal is zero.
- MOD-18 **No trade word in framework or module source** (TLR-1; audit 2026-11-10, zapa 2026-11-11: "cyborg is the modular framework and additional modules for any business"). A module serves any business: the thing a business sells or books is a **service** (or the business's own word, taken from its sheet), never a trade term. A test scans every package's `src` and `bin` and fails on the words in `TRADE_WORDS` (`proof/test/no-trade.test.ts`: tour, dolphin, whale, wildlife, savoy, funchal, madeira). The one exception is `browser-demo`, the demo page's own made-up business (logged in planning.md, awaiting zapa). Wider vocabulary (vehicle, pick-up, hotel desk, passenger, the `fleet.assets` key) is not in the list yet: OPEN.
- MOD-8 Real inputs are read from run-time paths and are never committed (HR-4).
  Until zapa supplies a real buyer intake, M6-EC4 and M7-EC6 stay open.
- MOD-9 The admin module (docs/10) is a module like any other and is required
  for any channel that goes live; the sales module does not depend on it, but the
  live gate (PRF-18) does.

## Modules working together (zapa, 2026-11-01)

- MOD-17 Modules combine only through events, shared profile facts, runtime facts,
  morning-sheet sections, and the notifier and alert list. A module package must
  not import another module package (tested, docs/12 CMP-23, CMP-24). What each
  new module needs before it is added is listed in docs/12 CMP-25.

## Later modules (dependencies listed, not built)

| Module | Depends on | First risk |
| --- | --- | --- |
| accounting | jurisdiction rules (invoicing, tax), the client's accountant and export format, a document reader | rules vary by country; proposal-only, never filing |
| fleet (zapa, 2026-11-01; spec feat-fleet.md, 2026-11-06, a package of its own beside the maintenance watch) | the company's vehicle records and inspection dates (a spreadsheet, a fleet tool or a telematics export) through a connector; the inspection authority's booking channel | deadlines come from the company's own records and the authority's published interval, never inferred by the module; due-date alerts are deterministic (a `schedule` trigger), the model only words a message; proposal-only, it books nothing |
| design | local rendering and CAD tools (ComfyUI, Blender/Bonsai), floor-plan vectoriser, cadastre services | heavy dependencies; never authors signed projects |
