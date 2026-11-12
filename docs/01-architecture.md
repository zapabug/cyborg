# 01 Architecture

Requirement IDs: `ARC-n`. Status tags: `PROPOSED` (needs zapa's yes), `OPEN`.

## Layers

```
business adapters   wazaa · madrltr · next client     config + connectors + apply() only
modules             sales · accounting · design · ... handlers, schemas, declared dependencies
knowledge packs     e.g. pt-madeira-realestate         dated, source-graded facts (data)
business profile    per client, private                verified facts about one business
core                handler contract · proposal lifecycle · data classes ·
                    prompt ledger · model gateway · store interface
```

- ARC-1 The core must contain no business-specific logic and no module logic.
- ARC-2 A module must contain only handlers, schemas, validators and its manifest.
  It must not import an adapter and must reach the outside world only through the
  connectors its manifest declares.
- ARC-3 An adapter must contain only configuration, connectors (channels, sources)
  and `apply()` implementations. Reusable logic found in an adapter must move to a
  module.
- ARC-4 Knowledge packs must be data only (no executable code).
- ARC-5 The business profile is private to one business and never shipped in the
  repo.

## Workspace layout (PROPOSED)

```
cyborg/
  package.json              pnpm workspace root ("type": "module", packageManager pinned)
  pnpm-workspace.yaml
  tsconfig.base.json        strict; project references
  packages/
    core/                   contract, runner, lifecycle, data classes, ledger, store interface
    store-sqlite/           ProposalStore, ledger store, profile store, vault on node:sqlite
    gateway/                OpenAI-compatible client, capability test
    profile/                business profile, ground-truth checks, onboarding report
    module-sales/           first module (docs/07)
    module-feedback/        review complaints (docs/10 ADM-58)
    module-admin/           admin checks, checklist handlers (docs/10)
    module-bookings/        the booking funnel: read, quote, request, confirm (feat-wazaa-port WZP-48..)
    module-maintenance/     maintenance records and each asset's track record (WZP-60, WZP-62)
    channel-whatsapp/       the WhatsApp channel and `pnpm whatsapp`: link by QR, chat picker, agreement (docs/10 ADM-102..109, feat-wazaa-port WZP-5)
    browser-demo/           the framework's own code bundled for a web page, so a visitor runs the real runner and handlers (the pleb.world demo; no model of its own)
    company/                company operations layer: config, runtime, board, simulation (docs/12)
    dashboard/              the company dashboard served from the office machine (docs/10 ADM-86..95)
  packs/                    knowledge packs (data); empty until a pack is converted
  proof/                    two-consumer proof harness; reads real inputs from run-time paths
  docs/ planning.md build.md Status.md AGENTS.md
```

- ARC-6 Package names use the scope `@cyborg/*` (npm scope availability OPEN).
- ARC-7 Consumers (wazaa, madrltr, clients) live in their own repos and depend on
  the packages. Adopting the core in wazaa is out of v1 (docs/09).

## Data flow

1. A **source** (adapter connector) emits an **event**: a message, a form
   submission, a timer tick, a manual command.
2. The **trigger router** maps the event to handlers by deterministic rules from
   adapter config. The model plays no part (HR-3).
3. **Input assembly** builds the handler input from typed fields; each field
   carries a data class (docs/04).
4. The **prompt builder** accepts only prompt-safe fields plus approved profile
   facts and pack facts, and renders the handler's fixed prompt.
5. The **gateway** sends the request to the configured OpenAI-compatible
   endpoint; the **ledger** stores the exact payload and the raw response.
6. The response is **validated** against the output schema and the handler's code
   checks. Failure → one retry, then an `invalid_output` proposal that cannot be
   applied (docs/03).
7. The result is stored as a **proposal** (status `proposed`) through the
   `ProposalStore`.
8. A **person** approves or declines. On approval the adapter's `apply()` runs;
   the core records old and new values and the result.
9. Every transition is written to the append-only **audit** log.

## Data stored (per business, never shared)

| Store | Content | Where |
| --- | --- | --- |
| proposals + decisions + audit | proposals, decisions, applied changes, transitions | business SQLite db |
| prompt ledger | exact request payload and raw response per model call | business SQLite db |
| business profile | facts with provenance and status; discrepancy items | business SQLite db |
| identity vault | `identity` and `secret` field values, referenced by code | separate SQLite file, owner-only permissions (encryption OPEN, docs/04) |
| endpoint capabilities | result and date of each endpoint's capability test | business SQLite db |
| shadow-run log | draft vs what the human did | business SQLite db |
| flag tickets | staff flags with reason, context transcript (wiped when fixed), bot trace | business SQLite db |

- ARC-8 The db path per business is config. No default path outside the business's
  own directory.
- ARC-14 (zapa, 2026-11-01) **The customer chat desk is its own module** of the framework, not the framework. Its parts: the channel gate and its commands, presence and office hours, the reply delay, the chat index, the handoff card and morning sheet entries for chats, the board and the dashboard's chat view, the customer-facing persona and language rules. Businesses without a customer chat (a fleet manager's inspections, a deal workup) use the rest and leave the desk out. Today the desk's code still lives in `core` and the company layer; it is accepted there, and moves to its own package when a second kind of business needs it separated. Nothing else may depend on it.
- ARC-15 (zapa, 2026-11-01) **A parent repository and one repository per customer.** The framework (this repository) is the parent. Each business has a repository of its own, outside the framework (corrected by zapa 2026-11-03: it was first put inside the framework; on Homebase09 the businesses are in `~/Projects/cyborg/<id>/` and the framework is `~/Projects/atlabs/cyborg`), made by `pnpm new-customer <id> --name "..." --into <folder>`. It holds that customer's `company.config.json`, company model, questionnaire answers, simulation scripts, audit notes and `src/adapter.ts` (the channel, add-on facts, attention sources and any module only that customer needs), and links to the framework's packages by path (`link:`), so a framework fix reaches every customer without copying code. It is its own git repository and its own pnpm project. Because a business repository is never inside the framework's, a customer's data, databases, backups, reports and keys cannot enter the open-source repository; the customer's `.gitignore` keeps them out of its own git too. No remote is set by the scaffold. A customer's code does not edit the framework; a change both need goes into the framework first (ARC-7).
- ARC-9 Each SQLite file (the business store and the vault) records its schema
  version in `PRAGMA user_version`. The schema changes only through numbered
  migrations (1, 2, 3, no gaps) appended to `STORE_MIGRATIONS` / `VAULT_MIGRATIONS`;
  a shipped entry is never edited. Version 1 is the baseline, written with
  `CREATE TABLE IF NOT EXISTS`, so it also adopts a file made before versioning
  (version 0 with tables).
- ARC-10 Before any migration runs on a file that has tables, the store copies the
  whole file with SQLite's `VACUUM INTO` to `<file>.bak-v<from>-<UTC time>`, mode
  0600 (the vault's copy too). A new file is not copied. The copies are never pruned
  by cyborg (OPEN: how many to keep and where the installer moves them).
- ARC-11 A file newer than the code is refused untouched. Upgrade cyborg; never
  open a newer database with older code.
- ARC-12 Each migration and its version bump run in one transaction. A failure rolls
  back that migration, leaves the version where it was and names the copy.
- ARC-13 `pnpm db info <file>` shows a file's version against what the code expects
  without migrating it; `pnpm db backup <file>` takes a copy. Opening a file
  through the store (including `pnpm digest` and `pnpm usage`) migrates it.

## Out of v1

Chat brain, document redactor, attestation events, identity binding,
pseudonymiser, Nostr transport, accounting and design modules, local-model
routing. See docs/09.
