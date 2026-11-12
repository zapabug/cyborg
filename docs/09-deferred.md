# 09 Deferred areas

Deep-dive and future areas that are **not** in v1. They are written down so the
v1 design leaves room for them; none is a requirement until it gets its own spec.

## Document redactor (handler type with no model)

Template-matched, deterministic, local: extract labelled fields from a text-layer
PDF, or mask and flatten a scan; fail closed when the template does not match; a
person confirms the fields. Keep registry access codes, ID numbers, signatures
and bank details in the vault. Open questions: do real certidão and caderneta
PDFs carry an issuer signature or only a text layer (check real files).
Template drift and photographed scans are the hard cases.

## Attestations and identity binding

A person signs (npub) a hash plus what was checked and by which method. A
signature proves who vouched for which file, never that the issuer made it. Owner
matching rests on a one-time identity check by a named verifier, then
deterministic comparison in code. A NIF alone proves nothing (it is shared
freely in Portugal). Candidate event standards (from `research-and-development/
cvmi-marketplace-deep-dive.md`, not re-verified): NIP-32 labels, NIP-85 trusted
assertions; NIP-90 is marked `unrecommended` upstream. Key custody candidates:
keys.justworks, the derived-identity pattern. Transport (Nostr or other) behind
the `ProposalStore` interface.

## Pseudonymiser and chat adapters

Reversible pseudonymisation for channels the business does not control (WhatsApp
chat), as in wazaa's two-layer design. Riskiest part: names inside free text.
Smallest test: run real chats through a rules plus local-model redactor and count
misses. Until it exists, chat adapters need a local model or draft-only handling
(PRV-7).

## Browser intake forms (shipped as an app)

Customers fill forms in their own browser; identity fields are encrypted to the
business's key before upload, so the bot never sees them. A login gate on a static
site does not protect bundled data. Key custody (client alone, or supplier too)
is OPEN.

## Chat brain

wazaa's conversation brain (`src/agent/brain.ts`, `orchestrator.ts`) as an
optional module for live customer chat. Not core.

## Adopting the core in wazaa

Port wazaa onto the core after M7, from `~/Projects/cyborg/wazaa` (the kept codebase).
Do not refactor live wazaa before the core is proven. Known issue to carry over
or fix first: wazaa's `parseDaysFromFields` still treats the Demo Tours "Days"
field as running days (the corrected reading is "closed days"), and its
`report.md` repeats the retracted claim (see planning.md).

## Accounting and design modules

See docs/07. Accounting: jurisdiction rules, accountant export formats. Design:
local rendering and CAD tools (Bonsai/IfcOpenShell, cadastre WFS for Madeira,
floor-plan vectorisers such as MLSTRUCT-FP, ComfyUI), never authoring signed
projects, concept visuals labelled as concepts.

## Knowledge pack: Madeira real estate

Convert `research-and-development/madeira-real-estate-tax-and-gray-areas.md`
into a pack: each fact with grade, source and date, plus its open-questions
list. The DL 108/2026 (RJUE) change and the 1 Oct 2026 urban-title rule are not
covered by that note and need research first.

## Local-model routing per device

Use dumclaw's runtime-policy findings (device-scaled context and slots, keep-warm
as delayed unload). Connect through the OpenAI-compatible endpoint only; no code
dependency on dumclaw.
