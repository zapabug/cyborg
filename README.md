# cyborg

An open-source (AGPL-3.0-only) TypeScript framework that sits between a business and an AI model. It is the base that **wazaa**, a WhatsApp assistant for small businesses, runs on. On its own it is a shell: it does nothing for a business until a bot is built and installed on top of it.

What the shell does:

- **Keeps customer details away from the model.** Every field has a class. Names, phone numbers, emails and addresses are swapped for a code before a prompt is built. Free text, such as a customer's message, goes through a scrubber that swaps card numbers, IBANs, ID numbers, phone numbers, emails and long digit runs for placeholders like `[PHONE_1]` before the model sees it. The task still goes ahead, and the original stays on the business's own machine.
- **Treats every model output as a proposal.** Typed handlers make narrow model calls inside deterministic code. A person approves what matters, and code checks the facts in a reply against what the business confirmed.
- **Runs in shadow first.** Drafts go to a separate chat, beside what staff actually answered, and nothing reaches a customer until the owner decides.
- **Records every step.** The record of each call holds codes, never the values, so the log cannot leak what it never held. Anyone can read the code and the record and audit the work.
- **Works with any OpenAI-compatible endpoint.** Each company pays for its own inference, with its own key, read only from an environment variable.

## What it cannot promise

The effort is to cut the easy leaks, not to guarantee there are none. A name typed inside a message has no pattern, so the scrubber cannot find it. Until a pseudonymiser exists, such a name can reach the model, and the framework warns when a chat is pointed at a model off the machine. Treat it as a strong layer of protection, not a vault.

The business-facing surface is WhatsApp itself, the channel the business already uses. It is not a separate program on someone's computer gathering staff data.

## Where things are

| Path | What |
| --- | --- |
| `docs/` | The spec, 00 to 15. Start with `00-mission.md`, then `docs/04-data-classes-and-privacy.md`, then `docs/12-company-config-and-simulation.md` to run it |
| `AGENTS.md` | Toolchain, hard rules, verify commands |
| `feat-*.md` | Specs for feature areas (desk, intake, fleet, calendar, audit, model, tailored customer repositories) |
| `packages/core` | Handler contract, runner, proposals, gate, scrubber, alerts, usage, shared types |
| `packages/store-sqlite` | SQLite stores, vault, migrations |
| `packages/gateway` | OpenAI-compatible model client and capability test |
| `packages/profile` | Business profile, ground-truth checks, import |
| `packages/module-*` | Modules: sales, admin, feedback, bookings, maintenance (modules never import each other) |
| `packages/channel-whatsapp` | The WhatsApp channel |
| `packages/company` | Per-company config, operations layer, simulation, test chat |
| `packages/dashboard` | The company dashboard: a localhost web server and page |
| `packages/browser-demo` | The framework's own code bundled for a web page |
| `proof/` | Two-consumer proof and the dry run |

A business's own bot lives in a repository of its own, outside this one, made with `pnpm new-customer --into <folder>`. A customer's facts, chats, keys and data never enter this repository.

## Run it

Node 26, pnpm 12.

```
pnpm install
pnpm check                    # typecheck and every test
pnpm dryrun --help            # a drafted company model against a real model (docs/11)
pnpm company check <file>     # a company's config file (docs/12)
pnpm simulate --help          # a simulated day for one company (docs/12)
pnpm dashboard --config <file> # the company dashboard on this machine
```

## About the examples

All the businesses in the tests and docs are made up. Where the docs refer to the first test business, they use the stand-in name "Demo Tours". The docs keep the build history, so some notes refer to planning files and a private status board that are not part of this repository.

## Licence

GNU Affero General Public License v3.0 only (`AGPL-3.0-only`). You can use, study, change and share it freely. If you run a changed version as a service, the licence requires you to offer its source to the people who use that service. See `LICENSE`.
