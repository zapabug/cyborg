# AGENTS.md: cyborg

Cyborg is an open-source TypeScript framework for business bots: typed handlers
that make narrow model calls inside deterministic code, always ending in a
proposal a person approves. Businesses (wazaa, madrltr, future clients) are
adapters that compose reusable modules on the core.

Work process: follow `~/Projects/AGENTS.md` (the model:
`Status.md` → `AGENTS.md` → `build.md` → `docs/` → `planning.md`). This file wins
for this repo. **Docs are the source of truth; if docs and code disagree, the code
is wrong.** Never invent mechanics; new behavior and numbers go in `docs/` first.

Status: spec written 2026-10-31 by `/vibe-spec`; M1 to M8 built the same day by `/vibe-dev run`, and the feats after them (wazaa port, desk, model) since; all awaiting zapa's test. Current state is `Status.md`, detail is `build.md`. Items tagged `PROPOSED`
were filled in by the spec author and wait for zapa's yes (listed in
`planning.md`). Items tagged `OPEN` are settled when the build reaches them.

## Toolchain (locked)

| Item | Value | Note |
| --- | --- | --- |
| Language | TypeScript 7.0.2, `strict` | exact version from the npm registry, 2026-10-31; compatibility confirmed at M1 (M1-EC1) |
| Runtime | Node.js 26.12.0 (tested) | minimum Node version OPEN: wazaa runs on >=22.5 |
| Module format | ESM (`"type": "module"`) | decided by zapa, 2026-10-31 |
| Package manager | pnpm 12.16.1 (`packageManager` field), workspaces | decided by zapa, 2026-10-31 |
| TS runner | tsx 4.23.15 | dev and test only |
| Test runner | `node:test` via tsx | as wazaa |
| Schemas | zod 4.6.7 (single source for types and JSON Schema) | PROPOSED |
| Types for Node | @types/node 26.6.6 | |
| Store | `node:sqlite` (built in), behind `ProposalStore` | decided by zapa, 2026-10-31 |
| WhatsApp client | whatsapp-web.js ^1.34.7, qrcode-terminal ^0.12.0, @types/qrcode-terminal ^0.12.2 (dev) | `@cyborg/channel-whatsapp` only; zapa approved 2026-11-02, see `planning.md`. Its puppeteer is built with the build step declined (`pnpm-workspace.yaml`): the channel uses the machine's own browser |
| Licence | AGPL-3.0-only (SPDX `AGPL-3.0-only`) | AGPL decided by zapa, 2026-10-31; "only" confirmed by zapa, 2026-11-12 |

Allowed dependencies: exactly the table above (the WhatsApp client rows are the one place a channel package brings its own). Any other dependency needs zapa's
approval and a line in `planning.md`. Not allowed: agent runtimes or orchestration
frameworks (LangGraph, Mastra, Hermes-style runtimes); a model SDK that hides the
raw request (the gateway builds the request itself, see docs/05).

No linter is locked yet (OPEN: Biome or none). `strict` typecheck plus tests is
the v1 gate.

## Hard rules (must never break)

- **HR-1 No unapproved effects.** A handler's output is a proposal. Nothing signs,
  files, pays, commits to a customer (booking, price promise) or edits a record
  without a person's approval. Signing is never automated. Replies to third
  parties are drafts by default; a business adapter may enable **auto-reply** for a
  named handler only, never for commitments, and the decision is logged
  (zapa, 2026-10-31).
- **HR-2 Identity never reaches a prompt.** Fields of class `identity` or `secret`
  cannot be passed to the prompt builder: enforced in the type system, at runtime
  and by a leak test (docs/04).
- **HR-3 The model never selects what runs.** Handlers are chosen by deterministic
  trigger rules. The gateway never sends `tools`, `tool_choice` or function
  definitions.
- **HR-4 No mock data.** Tests and proofs use real inputs. A scripted stand-in for
  the model is allowed to drive the model's side of a test (zapa, 2026-10-31);
  business, customer and document inputs are never invented. Real customer data
  is not committed to this repo.
- **HR-5 No verdicts of genuineness.** The core has no output type that says
  "safe", "authentic" or "verified genuine". Findings and questions only.
- **HR-6 Every model call is recorded.** The exact request payload and the raw
  response go to the prompt ledger (docs/04).
- **HR-7 Business facts come from the profile.** A handler may state a business
  fact only if it was supplied from the business profile or a knowledge pack,
  with its status (docs/06).
- **HR-8 No live use before a shadow run.** A handler that talks to real customers
  or real records is enabled live only after a recorded shadow run (listen-only on
  the real channel, output to a separate review channel) and a completed
  deployment checklist for the channel (docs/10). This rule exists
  because a rushed confirmation of a wrong fact (the Demo Tours "Days" field)
  was caught in testing (zapa, 2026-10-31; corrected 2026-11-12: nothing
  reached a customer, it was all tests, and the guard rails built from those
  tests are what cyborg runs on). Cyborg's path is shadow: staff-audit chats
  get the drafts, test chats give more audits, it listens to incoming chats
  and replies to a separate chat, staff answers are compared with the bot's,
  and a two-week audit with zapa compares both.
- **HR-9 Businesses are isolated.** Each business has its own database, profile,
  vault and keys. Nothing is shared across businesses except code and knowledge
  packs. Client keys are never Jester's or `~/synch/dumclaw`'s.
- **HR-10 Numbers live in the docs.** Limits, timeouts and retry counts come from
  `docs/02-behavior-model.md` and config, never invented in code.

## Verify (exact commands; created by M1)

```
pnpm install --frozen-lockfile
pnpm typecheck        # tsc -b across the workspace, strict
pnpm test             # node --import tsx --test across packages
pnpm check            # typecheck + test; the gate before every commit
```

Other commands: `pnpm capability` (endpoint capability test), `pnpm import-profile` (JSON tree to profile facts), `pnpm check-fact` (ground-truth check), `pnpm proof` (two-consumer proof), `pnpm dryrun` (drafted company model plus your tasks, docs/11), `pnpm digest` (read-only failure and decision record for upgrade reviews), `pnpm usage` (calls, tokens and cost from the ledger, docs/05 GWY-29), `pnpm db info|backup <file>` (schema version and a copy, docs/01 ARC-13), `pnpm company check|wording|capability <config>` (a company's config file, docs/12), `pnpm simulate` (a simulated day for one company, docs/12), `pnpm dashboard --config <file>` (the company dashboard on this machine, docs/10 ADM-86), `pnpm new-customer <id> --name "..."` (a customer's own repository in `customers/`, docs/01 ARC-15). `pnpm research --name "..." --url <public page> --out <folder> --endpoint ... --model ...` (a draft business sheet from a business's public pages, with the source of every line; zapa's machine only, feat-desk DSK-84..88). Real inputs for the leak test come from `CYBORG_LEAK_INPUT` (docs/04, PRV-13).

Milestone-specific checks (leak test, endpoint capability test, shadow-mode
test) are defined in `docs/08-mvp.md` and run as part of `pnpm test` unless
marked as a user check.

## Environment quirks

- dumclaw's web UI listens on `:8080` loopback on this box, and wazaa's
  `scripts/run-local.sh` assumes a local llama.cpp on `:8080`. Cyborg never
  assumes a port: the model base URL is always config.
- Real customer inputs for tests are read from paths given at run time (env
  var), never copied into the repo.
- This is a git repo; `main` is the line everything goes through (see Workflow rules: Branches).
- Reference code to reuse patterns from (read, do not import): `~/synch/wazaa` (the original wazaa bot; `~/Projects/wazaa/` is where the customer installs live, not the reference).

## Workflow rules

- **Branches: one feat at a time, in a line (zapa, 2026-11-08).** Start a feat on one branch
  (`feat/<name>`), keep all of that feat's commits together on it, merge it to `main` when it
  is done and `pnpm check` is green, delete the branch, then start the next feat. No parallel
  feat branches and no extra worktrees or sibling folders for them. A spec for a feat that is
  not being built yet goes to `main` as a doc marked PROPOSED (or stays an idea), not on a
  branch of its own. Other sessions follow the same rule: one branch open at a time.
- Push only to a remote zapa has named; none is set up yet, so nothing is pushed until he says where.
- Commit per milestone (code, then `build.md` + `Status.md`); never batch.
- A milestone gets its final `[x]` only after zapa confirms it.
- Choices the spec did not cover go under "Undiscussed decisions" in
  `planning.md` until zapa confirms them.
- Ask before creating files outside the structure in `docs/01-architecture.md`.
