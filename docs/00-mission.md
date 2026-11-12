# Cyborg: Idea brief

Written 2026-10-31 from a /vibe-therapist session with zapa, started from madrltr
(Madeira real estate) and widened once zapa said he is "in the framework business
now". Cyborg is the reusable standard behind his business bots: wazaa (the WhatsApp assistant, first built as a test for a
Madeira tour operator), the freehub bot (FREE Madeira, brief only) and
madrltr (new). Open source; zapa builds bots for paying clients on it.

## The idea (one paragraph)

Cyborg is an open-source TypeScript framework for bots that do narrow model jobs
inside deterministic code and never act on their own. Events trigger typed
handlers; each handler has a fixed prompt, a strict JSON schema and validation,
and its output is always a **proposal** that a person approves before anything
changes, with an audit trail. Privacy is built into the data model, not promised:
input fields carry a data class, identity fields never reach a prompt, and each
business's adapter chooses which privacy mechanisms apply (encrypted browser
forms, local document redaction, a rules scrubber, a pseudonymiser, local
models). Between the core and a business sits a **module layer**: reusable
business functions (sales, accounting, design, and more), each a package of
handlers, schemas, data classes and its own declared dependencies. A business
(wazaa, madrltr, a future client) is an adapter that composes modules on the
core; it is not where reusable logic lives.

```
business adapters   wazaa · madrltr · next client      (config + glue only)
modules             sales · accounting · design · ...  (handlers, schemas, deps)
knowledge packs     e.g. pt-madeira real estate         (graded, dated data)
core                contract · lifecycle · data classes · gateway · audit
```

## The thesis (zapa, 2026-10-31, from the first test business)

wazaa impressed the first test business because it was fed the **proper business info**
and run inside a framework built around the business, which made it much better
than a generic assistant (Hermes, Meta's business agent). The wazaa docs back the
shape: Meta's agent is knowledge-only, with Meta's guardrails, no code checks, no
ops loop and data held by Meta; wazaa takes prices and days from the store sync,
checks prices, dates and capacity in code, submits only proposals the office
confirms, and learns from office answers. This is one client's reaction and has
not been benchmarked against the generic tools. So the product is not the model:
it is **getting a business's real information into a structured, verified profile
and enforcing the business's rules around the model**. Every client build starts
with that onboarding.

## Who it's for / the core feeling

- **zapa**, building and selling bots to clients: "a new client is an adapter and
  a handler set, not a new codebase".
- **The client's staff** (office, agent, operator): "the work is already drafted;
  I check and approve".
- **The client's customers**: nothing leaks that shouldn't, and nothing is done in
  their name without a person.

**Failure even if it "works"**: a handler quietly acts without approval; an
identity value reaches a prompt; the core only fits one business; it becomes an
agent runtime that has to be fenced; approving costs more time than doing the
work by hand.

## Decisions so far (zapa)

- **Framework around the model, not an agent runtime.** Deterministic code owns
  the workflow. No tool-choosing agent, no Hermes-style runtime.
- **Proposal-only.** Nothing signs, files, sends to a customer or moves money
  without a person. Signing is never automated.
- **Core plus adapter.** The core is generic; each business is an adapter and
  handler config. Per-user needs are config, not code.
- **Open source, zapa-owned, in its own repo** (this one), not inside the
  employer's freehub repo. Licence AGPL-3.0 (zapa, 2026-10-31).
- **Shadow phase before live (zapa, 2026-10-31):** run in parallel with the
  business, listen-only, replying only to a separate review channel. Compare the
  bot's draft with what the person actually answered, and fix nuances through
  facts, prompts, lessons and checks.
- **Replies are drafts by default**; a business adapter may opt a named handler
  in to auto-reply, never for commitments (zapa, 2026-10-31).
- **Build the base and the modules first (zapa, 2026-10-31).** madrltr is its own
  project and wazaa already exists; both become consumers. The next wazaa or
  madrltr-style build starts from the core plus modules, not from scratch.
- **Module = a package with a manifest**: handlers, input/output schemas, the data
  class of every field, the core services it needs, its external dependencies
  (services, local tools, models) and any jurisdiction or knowledge pack it
  requires. A module cannot bypass the proposal lifecycle or the data-class
  rules; it can only register handlers on the core.
- **Business profile is first-class and private per client**: catalog, prices,
  rules, days, places, FAQ, tone and forbidden claims, each fact carrying its
  source, who confirmed it and when. Facts are cross-checked against ground truth
  (wazaa checks the store against real service sheets) and discrepancies go back
  to the client as a report. The model may state a business fact only if it came
  from the profile; rules (prices, dates, capacity) are enforced in code.
- **Knowledge packs are data, not code**: dated, source-graded facts for a
  jurisdiction or trade (the first seed is zapa's Madeira real estate R&D note).
  Modules read them; adapters choose which to load.
- **Stack**: TypeScript (strict), ESM, pnpm workspaces, `node:sqlite` behind a
  store interface (zapa, 2026-10-31). Exact versions in `AGENTS.md`.
- **Not built on dumclaw.** Different language and job, still in flux. dumclaw is
  a source of ideas and findings; a client install may point its model setting at
  a local llama.cpp or dumclaw's router through an OpenAI-compatible endpoint.
  Keys and identities for client deployments are separate from Jester's and from
  `~/synch/dumclaw`.
- **Privacy by structure**: typed input fields tagged `public` / `deal` /
  `identity`; identity fields encrypted at the source and never interpolated into
  prompts. Each adapter declares the mechanisms it uses. A handler cannot run
  unless the adapter's configuration covers its data needs. A pseudonymiser is
  only needed for channels the client does not control (wazaa's WhatsApp chat).
- **Data classes are per-adapter settings.** Default NIF = `identity`; an adapter
  may downgrade it with a recorded decision. Always out of the model path:
  registry access codes, ID document numbers and scans, signatures, bank details.
- **Documents**: a deterministic, model-free redactor handler type. Match the
  template by anchors, extract labelled fields from the text layer (or mask and
  flatten scans), fail closed when the template does not match, human confirms
  the fields.
- **Attestations**: a person signs (npub) a hash plus what was checked and by
  which method. A signature proves who vouched for which file, never that the
  issuer made it. Identity binding (npub to identity) is done once by a verifier;
  the owner match is deterministic code. The model never creates an attestation.
- **Model gateway**: OpenAI-compatible, a model per handler, no retention,
  strict structured output, local model for testing.
- **Sources are graded and dated** in any fact base built on the core.

## Tasks involved

| Task | State | Feasibility | Notes |
| --- | --- | --- | --- |
| Handler contract (trigger, prompt, schema, validation, proposal, data class) | fuzzy | work | Express one handler from each of wazaa, freehub bot and madrltr in it to prove the core is real. |
| Proposal lifecycle and audit trail (proposed, approved/declined, applied, old/new values) | fuzzy | work | Patterns exist in wazaa (CONFIRM/DECLINE) and the freehub brief. |
| Field data-class tagging; identity cannot reach a prompt | fuzzy | work | Enforce in the type system and with a leak test on real inputs. |
| Model gateway (per-handler model, structured output, limits) | known | easy | wazaa `src/llm/provider.ts`; freehub brief uses OpenRouter. |
| Learning loop (approved corrections become facts) | known | work | wazaa LEARN/lessons; freehub per-user profile. |
| Document reader plus model-free redactor handler | fuzzy | work | Needs real documents with a client's consent. Photographed scans are hard. |
| Attestation events and identity binding | fuzzy | work | Transport (Nostr or other) OPEN. |
| Status and bug reports carrying codes only | known | easy | wazaa Nostr dev reports. |
| Adapter packaging and client install (local app) | fuzzy | work | wazaa runs as a local page on the client's Mac. |
| Conversation brain for chat channels | known | work | wazaa `brain.ts`; an optional module, not core. |
| Local-model route per device | fuzzy | hard | Use dumclaw's runtime-policy findings. |
| Module contract (manifest, dependency declaration, load/unload, version) | fuzzy | work | Decide what a module may touch. Core must refuse a module whose dependencies or data classes the adapter does not cover. |
| Sales module (lead/enquiry intake, qualification, follow-up drafts, quote, pipeline) | fuzzy | work | Both wazaa (customer enquiries to booking proposals) and madrltr (buyer intake) need it, so it is the best first module. Channel connectors are its dependencies. |
| Accounting module (invoice and expense drafts, categorisation, period summaries) | unknown | work | Jurisdiction-bound (Portuguese invoicing and tax rules); depends on the client's accountant and export formats, which wazaa lists as OPEN. Proposal-only, never filing. |
| Design module (client brief, concept visuals, plan checks) | unknown | hard | Heaviest dependencies (local rendering and CAD tools, floor-plan vectoriser). Last in the order. Never authors signed projects. |
| Business profile and client onboarding (intake of real business info, source and confirmation per fact, ground-truth cross-checks, discrepancy report) | fuzzy | work | The actual differentiator. Traps are subtle: wazaa's store "Days" field lists CLOSED days, and two independent readers misread it the same way (`snippets/jumpseller-days-field-closed-not-running.md`). A fact needs a check against ground truth, not a second reader. |
| Knowledge packs (dated, graded facts) | known | easy | Format follows the R&D note's checked / secondary / unverified marks. |
| Licence choice | unknown | easy | Permissive vs AGPL; undecided. |

## Prior art

- **wazaa** (`~/Projects/cyborg/wazaa`): the proof the patterns work: proposed bookings
  with operator CONFIRM/DECLINE, two data layers, sheet reader with human OK,
  learning loop, code-only bug reports. It uses a generic OpenAI-compatible
  client (local llama.cpp for testing, a cloud model in production), not dumclaw.
- **freehub bot brief** (`~/Projects/madfree/freehub-bot-idea-brief.md`): triggers,
  handlers with strict schemas, validation with the source phrase kept beside
  each value, per-npub limits, core plus adapter. Its plan puts the core inside
  the freehub repo; cyborg lives in zapa's own repo instead (ownership question
  for zapa).
- **dumclaw** (`~/Projects/dumclaw-nostr`): "code gathers, the model concludes",
  workflows the model cannot call, confirm-before-change, runtime resource policy
  for local models. Python, MIT, in flux. Learn from, do not depend on.
- **Agent frameworks with approval steps** (LangGraph, Mastra, Vercel AI SDK):
  designed for agents that choose tools; one comparison says LangGraph and Mastra
  persist and resume a paused run while the AI SDK hands state back
  ([Developers Digest](https://www.developersdigest.tech/blog/human-in-the-loop-patterns-for-agents),
  single third-party source). Borrow ideas, not the runtime.
- **Nostr event standards** (from `~/Projects/research-and-development/cvmi-marketplace-deep-dive.md`,
  2026-09-04, not re-verified): NIP-90 Data Vending Machines is now marked
  `unrecommended` by the NIPs repo, so it is not the transport to copy.
  ContextVM (MCP-over-Nostr, kind 25910) is the current successor. Attestation
  and audit events fit NIP-32 (labeling, kind 1985) and NIP-85 (trusted
  assertions, kind 30382) without a new kind.
- **zapa's R&D notes on small local models** (`research-and-development/`,
  `snippets/`): tool-calling by small local models is unreliable (Gemma 3 never
  emits real tool calls, 0/37 in dumclaw's logs; models with native templates still
  skipped offered tools in 3/7 and 4/15 live runs). This supports cyborg's design:
  a handler is one schema-constrained generation chosen by a deterministic
  trigger, never a model choosing tools. Lessons carried over: log the exact
  payload sent for every call (a "prompt ledger") because the failing layer is
  invisible from the transcript; llama.cpp grammar-constrained decoding forces
  structure but not values, so validate in code; a static-site login gate does
  not protect data bundled in the page (`snippets/nsite-login-gate-...`), so
  browser forms must encrypt to the recipient key before upload.
- **Madeira real estate fact base seed**:
  `research-and-development/madeira-real-estate-tax-and-gray-areas.md`
  (2026-09-30) is already source-graded (checked / several secondary sources /
  unverified) and ends with an open-questions list; it is the starting fact base
  for madrltr.
- No small reusable core combining typed handlers, strict schemas, data-class
  enforcement and proposal-only approval turned up in a thin search; not a
  certainty.

## Feasibility verdict

**Go-smaller.** Extract the core from instances that exist; do not design it in
the abstract. Express a handler from each business in one contract on paper
first. Leave live wazaa alone until the core is proven.

**Riskiest assumption**: that the three businesses really share one core. wazaa is
a live customer chat; the freehub bot and madrltr are event-to-proposal handlers.
**Smallest test**: write the contract and lifecycle as types, then implement the
freehub merchant fill-in, wazaa's pickup step and madrltr's deal workup against
them; if all three fit without special cases, the core is real. Second test: real
inputs through the prompt builder with zero identity values reaching a prompt.

## Smallest first version

1. The handler contract and proposal lifecycle as types plus a runner, with the
   audit trail.
2. Data-class tagging with the prompt-builder leak test.
3. The model gateway (OpenAI-compatible, per-handler model, local or cloud).
4. The module contract, proven by **one module used by two businesses**: the
   sales module serving a wazaa-shaped enquiry and a madrltr-shaped buyer intake.
   If one module cannot serve both without special cases, the module layer is
   wrong.

Accounting and design modules, madrltr and the next client build follow only
after the core and the sales module hold. No chat brain, no redactor, no
attestations and no local-model routing in v1.

## Discuss later

- What zapa charges clients; the supplier model from wazaa (client owns data and
  pays its own model subscription). Licence is settled (AGPL-3.0).

> Spec written 2026-10-31: see `AGENTS.md`, `docs/01` to `docs/09`, `planning.md`.
> Where this brief and the spec differ, the spec wins.
- Ownership: reusing ideas or code from work done on the freehub repo.
- Event transport (Nostr or other) for proposals and attestations; NIP-90 fit.
- Key custody for browser-encrypted forms: client alone, or the supplier too.
- Where modules live: one monorepo with packages, or a repo per module.
- Module order beyond sales (accounting vs design), and which of zapa's clients
  needs accounting first.
- Module versioning and compatibility with the core; who may publish modules.
- Whether madrltr and wazaa live in this repo or depend on it (consumers either way).
- Data processing agreement for client builds (client controller, zapa supplier);
  a lawyer's call.
- Downgrading the NIF data class: needs a lawyer's confirmation per client.
- Document redactor: whether certidão and caderneta PDFs carry the issuer's
  signature or only a text layer (check real files).
- Chat adapters: pseudonymiser, and refactoring wazaa onto the core.
- A CAD/rendering module (Bonsai/IfcOpenShell, cadastre WFS, floor-plan vectoriser,
  ComfyUI) after madrltr works.
- Name availability for "cyborg" on npm and GitHub.
