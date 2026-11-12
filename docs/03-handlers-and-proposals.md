# 03 Handlers and proposals

Requirement IDs: `HDL-n`. Status tags: `PROPOSED`, `OPEN`.

## Handler contract

A handler is registered by a module (or an adapter, for a one-off) with these
parts. All of them must be present; the core must refuse to register a handler
with a missing part.

| Part | Content |
| --- | --- |
| `id`, `version` | stable id (`sales.enquiry.intake`) and a version that is written into every proposal |
| `trigger` | the event kinds, schedules or manual commands that select it (config can override) |
| `input` | a zod schema; **every field declares a data class** (docs/04) |
| `profileKeys` | the business-profile keys it reads (docs/06) |
| `packFacts` | the knowledge-pack facts it reads, with the minimum grade it accepts |
| `prompt` | a fixed prompt template with named slots; no free-form concatenation of raw input |
| `output` | a zod schema, emitted as strict JSON Schema for the gateway |
| `checks` | code validators run after schema validation (prices, dates, capacity, source phrases) |
| `model` | the capability level it needs from the endpoint (`strict_schema` or `json_object`) and a default model name (config overrides) |
| `effect` | `proposal` (default) or `auto_reply`; `auto_reply` is allowed only if the adapter enables it for this handler id (HR-1) |
| `limits` | per-user and per-kind limits, from docs/02 numbers or config |

- HDL-1 The core must reject a handler whose input schema has a field without a
  data class.
- HDL-2 The core must reject a handler that declares a `tools`, `tool_choice` or
  function-calling output (HR-3).
- HDL-3 `effect: auto_reply` must be rejected at registration unless the adapter
  config lists the handler id, and must always be rejected for outputs that
  contain a commitment (booking, price promise, signing, filing, payment).
- HDL-4 A handler must produce exactly one proposal per run (or none, with a
  recorded reason).
- HDL-13 A handler may be **model-free** (`kind: deterministic`): it has no prompt
  and makes no gateway call, so it has no ledger model row. Everything else
  applies: declared data classes, deterministic trigger, output as a proposal,
  versioning. Admin checks (docs/10) and the document redactor (docs/09) are of
  this kind.

## Proposal

A proposal contains:

- `id`, `businessId`, `handlerId`, `handlerVersion`, `createdAt`
- `subject`: a reference code to what it concerns (a record id or a vault code,
  never a name, phone, NIF or address)
- `changes[]`: `{ field, oldValue, newValue, sourcePhrase }` (for edit-type
  handlers)
- `draft`: a text draft (for reply-type handlers)
- `findings[]`: `{ statement, evidence }` observations the handler can support
- `questions[]`: things a person or specialist must answer
- `modelCallId`: pointer to the ledger row
- `confidence`: `{ band, signals[] }` for reply-type and classification handlers
  (docs/06, PRF-27); absent for handlers that only extract fields
- `status`: per docs/02

- HDL-5 A proposal must not contain a field named or typed as a verdict of
  genuineness, safety or authenticity (HR-5). Findings state what was observed;
  questions state what is still unknown.
- HDL-6 Each `changes[]` entry extracted from input must carry `sourcePhrase`,
  and the validator must confirm the phrase occurs in the input.
- HDL-7 By default a change may fill an empty field. Changing an existing value
  must be marked as a change in the proposal and shown as such to the approver
  (freehub bot brief).
- HDL-8 Applying must touch only the proposed fields and must re-read the newest
  state first (BEH-4).

## Approval and apply

- HDL-9 The approval surface is the adapter's (a dashboard, a chat command, a
  card); the core defines only the `decide(proposalId, decision, actorRef)`
  operation and the events.
- HDL-10 `apply()` is implemented by the adapter. The core must call it only for
  `approved` proposals and must record its result and the changed values.
- HDL-11 Revert is a person's action; the core must expose it only for `applied`
  proposals and must restore from the recorded old values via the adapter.

## Interfaces the core exposes (names are PROPOSED)

- `registerHandler(handler)`
- `ProposalStore` (create, get, list, transition, appendAudit)
- `Runner.handle(event)` → runs the selected handlers
- `decide`, `apply`, `revert`
- `PromptLedger` (write, read)

Interfaces must be defined by M1; no module may reach into SQLite directly.
