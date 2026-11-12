# 04 Data classes and privacy

Requirement IDs: `PRV-n`. Status tags: `PROPOSED`, `OPEN`.

Privacy comes from structure at the source: typed fields tagged with a data
class, so identity never needs to be detected inside free text. Each business
adapter chooses which mechanisms apply to its channels.

## Classes

| Class | Meaning | May reach a prompt? |
| --- | --- | --- |
| `public` | public or business-published information (listing, tour description, a rule) | yes |
| `deal` | non-identifying details of a case (intended use, budget, group size, dates, place code) | yes |
| `freetext` | a field a person typed freely (notes, chat message) | only after the scrubber passes (PRV-6) |
| `identity` | names, phone numbers, emails, addresses, NIF by default, hotel and room | **no** |
| `secret` | registry access codes, ID document numbers or scans, signatures, bank details, keys | **never, and cannot be reclassified** |

- PRV-1 Every field in a handler's input schema must declare one class; an
  undeclared field is a registration error (HDL-1).
- PRV-2 `identity` and `secret` values must be stored only in the identity vault.
  Proposals, the ledger and the audit log must refer to them by code.
- PRV-3 The prompt builder must accept only values typed as prompt-safe
  (`public`, `deal`, or scrubbed `freetext`). Passing any other value must fail
  typechecking (type-level brand) and must throw at runtime (HR-2).
- PRV-4 An adapter may downgrade a named field type from `identity` to `deal`
  (for example NIF in a Portuguese adapter) only with a recorded decision: who,
  when, reason, review-by date. `secret` fields must never be downgraded. A lawyer
  confirmation is required per client before relying on a downgrade (OPEN, noted
  in the decision record).
- PRV-5 Free text is `identity` unless the handler declares it `freetext` with
  the scrubber enabled.
- PRV-6 The scrubber (rules for phone, email, IBAN, NIF pattern, ID number
  pattern, long digit runs) runs on every `freetext` field before a prompt is
  built, and **replaces** every hit with a placeholder (`[EMAIL_1]`, `[PHONE_1]`,
  `[IBAN_1]`, `[ID_1]`, `[NUMBER_1]`, numbered per kind within one call) and then
  scrubs the result again. The model call goes ahead with the placeholders, so the
  task is still done (zapa, 2026-11-08: "the bot gets the task, not the data").
  The original text stays in the chat on this machine and is never put in a
  prompt, a proposal, the ledger or the audit log (PRV-2); the audit records the
  rule, the field and the count, never the matched text. A placeholder in a draft
  is flagged ("check the chat"), never filled back in by code. If a hit is still
  there after replacing (it cannot be by construction, but the check stays), the
  call stops and a person handles the message as before (fail closed). Lesson and
  note text that carries a hit is still refused, not replaced. A message that is
  only data and has no task simply yields no proposal. Replaces the 2026-11-03
  rule that any hit stopped the call (and ADM-110's handoff, which now applies
  only to that fail-closed case).
- PRV-6c **Everything derived from a customer's words is `freetext`** (audit 2026-11-10). The sales writer's conversation block (the chat card and the code-computed facts put in front of the message) is derived from what the customer wrote, so it is `freetext` like the message itself and goes through the scrubber; a field is `public` only when no customer or staff text can be in it. Text a staff member types (a saved note, a LEARN answer) is scrubbed before it is kept (feat-wazaa-port WZP-44b, WZP-45b).
- PRV-6b **Payment details are replaced like any other hit; the chat is not sealed** (zapa, 2026-11-09, said twice: the scrubber is what makes the model call safe). Two of the scrubber's rules are about money: `iban` (a bank account) and `card` (a payment card number: 13 to 19 digits, in groups or not, that pass the card check digit, the Luhn test). A card number becomes `[CARD_n]`, a bank account `[IBAN_n]`, and the model call goes ahead with the placeholder (PRV-6). The model knows a placeholder stands for something hidden and does not repeat it; the draft carries a finding for staff ("in the chat: a payment card number, the bot did not see it") so the office sees it and takes it from there. The original stays only in the chat; cyborg's own copy is the scrubbed line (PRV-6a). Nothing stops the model and nothing is handed over by code (this replaces the first version of PRV-6b, built and reverted 2026-11-09, which stopped every model call in the chat). Marking such a chat for deletion after a person verified the payment, and `.forget`, are feat-desk DSK-42 (DK4). The card rule reads digits only; a card's expiry date and security code are not read as separate rules.
- PRV-6a **Scrub at save** (zapa, 2026-11-09; feat-desk.md DSK-48..50). What
  cyborg itself keeps of an exchange, the shadow entry that every audit, export
  and dashboard view reads, holds the customer's message and the staff reply
  **after** the scrubber has replaced their hits with placeholders (same rules,
  same placeholders as PRV-6), never the original; the original stays only in the
  chat. The bot's own output is saved as written. The replacement happens when
  the entry is written, so no later reader has to remember to scrub. The audit
  records the rule and the field, never the text (`scrub_replaced`). Entries
  written before this rule keep what they hold until they are dropped (no
  migration).
- PRV-7 Names inside free text are not detectable by the scrubber. For channels
  the business does not control (a chat), the handler must be `freetext` with an
  adapter-enabled pseudonymiser; the pseudonymiser is out of v1 (docs/09). Until
  it exists, a chat adapter must use a local model or accept draft-only
  handling (OPEN, see planning.md).

## Prompt ledger

- PRV-8 Every model call must write one ledger row before the response is used:
  call id, handler id and version, endpoint, model, the exact request body sent,
  the raw response, timing and token usage.
  "Every model call" includes the capability test's probe requests (GWY-9) and a
  setup tool's calls (`pnpm research`, DSK-84): each writes a row, under handler
  ids `gateway.capability_probe` and `research.extract`, to the install's ledger
  (audit 2026-11-10; HR-6). A call that fails also leaves a row, with its error.
- PRV-9 The ledger must never contain an `identity` or `secret` value; the leak
  test checks this (M2-EC5).
- PRV-10 Ledger retention follows N-4 (PROPOSED 30 days, OPEN per client). A running install applies it itself: at start and every N-19, `Company.housekeeping()` drops the ledger rows older than N-4 and writes one audit row, `ledger_purged`, with the count and the cut-off, never text (audit 2026-11-10: it was a helper only a test called). The days are the framework default until a per-client setting is decided (OPEN).

## Identity vault

- PRV-11 The vault is a separate SQLite file with owner-only permissions. Entries
  are `{ code, class, value, createdAt }`.
- PRV-12 Encryption at rest and key custody for the vault are OPEN (client alone,
  or the supplier too). PROPOSED default: a passphrase or OS-keychain key held by
  the client, in place before the first real client is onboarded. A static-site
  login gate does not protect data in a bundle (snippet
  `nsite-login-gate-does-not-protect-bundled-data.md`), so any browser form app
  must encrypt to the recipient key before upload (docs/09).

## Leak test (the enforcement)

- PRV-13 The leak test takes real identity values (supplied at run time from a
  path in an env var, never committed) and real inputs containing them, runs the
  handlers with the scripted model, and asserts zero occurrences of those values
  in any ledger payload, proposal or audit row. It must run in `pnpm test` when
  the env var is set, and the M2 user check requires zapa to run it with real
  inputs. The env var is `CYBORG_LEAK_INPUT`, a path to a JSON file outside the repo:
  `{ "identityValues": [...], "events": [ { "id", "payload": { "name", "contact",
  "note", "topic" } } ] }`. Events run through a probe handler (`name` and
  `contact` are `identity`, `note` is `freetext`, `topic` is `deal`). A hit is
  reported as table, row and value index, never the value. A name typed inside
  `note` is a hit by design (PRV-7).
- PRV-14 Before a handler sees its input, every `identity` and `secret` field is
  replaced by its vault code (the handler, its checks and `toProposal` only ever
  see codes). A handler with such a field and no vault configured must not run.
  (build decision, M2; PROPOSED)
- PRV-15 A scrubber hit records the rule id, the field and character positions,
  never the matched text. (build decision, M2; PROPOSED)

## What the core does not claim

- A redacted or coded record is still personal data under GDPR. The core reduces
  exposure; it is not a legal compliance statement. A data processing agreement
  between the supplier and each client is a lawyer's task (planning.md, open
  questions).
