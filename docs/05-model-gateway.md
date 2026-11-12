# 05 Model gateway

Requirement IDs: `GWY-n`. Status tags: `PROPOSED`, `OPEN`.

The gateway talks to any OpenAI-compatible Chat Completions endpoint: a local
llama.cpp, Ollama, LM Studio, vLLM, OpenRouter or a cloud service. Switching a
client from cloud to local is a base-URL and model change, plus passing the
capability test. wazaa's `src/llm/provider.ts` is the reference pattern.

## Requirements

- GWY-1 The gateway must build the HTTP request itself (no SDK that hides it) so
  the ledger records the exact payload.
- GWY-2 The base URL, API key (from env), model name per handler and extra
  provider options are config. No port or host is ever assumed.
- GWY-3 The gateway must never send `tools`, `tool_choice`, `functions` or
  `function_call` (HR-3). A test must inspect the outgoing body.
- GWY-4 Structured output is requested with `response_format` of type
  `json_schema` built from the handler's output schema. The accepted request
  shape differs between servers (schema wrapped under `json_schema` vs read
  directly): the capability test must discover which shape the endpoint accepts
  and the gateway must use it.
- GWY-5 Provider options may be passed through unchanged from config, for example
  OpenRouter's `provider: { data_collection: "deny", require_parameters: true }`.
- GWY-6 Reasoning mode is per-model config (some models make it mandatory); the
  gateway must pass it through and not interpret it.
- GWY-7 The response must be validated in code against the output schema even
  when the server constrains decoding: constrained decoding forces structure,
  not values, and unsupported schema keywords may be silently ignored (R&D notes,
  llama.cpp issue discussion).
- GWY-8 The gateway must log usage per call (tokens, latency, endpoint, model),
  in the ledger row.

## Endpoint capability test

- GWY-9 For each configured endpoint and model the gateway must run a capability
  test that sends a fixed schema with a known input and classifies the endpoint
  as `strict_schema` (response parsed and conforming), `json_object` (valid JSON
  but schema not enforced) or `none`.
- GWY-9b Each request of the capability test (every shape tried, the plain JSON
  mode and the log-probability request) is recorded in the prompt ledger like any
  model call (docs/04 PRV-8, HR-6), under handler id `gateway.capability_probe`,
  with its exact body, the raw response or the error. These rows count toward
  the call cap (GWY-31) and the usage report, because they cost the same.
- GWY-10 The result is stored with the date and the endpoint's base URL and
  model, and shown in the profile/onboarding report.
- GWY-11 A handler needing `strict_schema` must refuse to run on a lesser
  endpoint, with a clear audit event; it must not fall back silently.
- GWY-12 The capability test must be re-run when the base URL, model or server
  version changes (OPEN: how the server version is detected).

- GWY-17 The capability test must also record whether the endpoint returns token
  log-probabilities. The log-probability confidence signal (PRF-28d) may be used
  only when it does (PROPOSED; support varies by server and I have not verified
  which servers return them).

## Capability test details (build decisions, M3; PROPOSED)

- GWY-18 The fixed test uses one output schema (`label`: enum of three values,
  `count`: integer) and N-16 (3) fixed inputs whose natural answer does not fit
  the schema (a greeting, a factual question, one free word). An endpoint that
  enforces the schema returns conforming JSON for every input; one that does not
  is caught by the first prose or off-schema answer. A request shape is
  `strict_schema` only if all N-16 answers parse and conform.
- GWY-19 Request shapes are tried in this order and the first that conforms is
  stored: `json_schema_wrapped` (`response_format: {type: "json_schema",
  json_schema: {name, strict: true, schema}}`), `json_schema_direct`
  (`{type: "json_schema", schema}`), `json_object_schema` (`{type: "json_object",
  schema}`). If none conforms but the plain `{type: "json_object"}` request
  returns valid JSON for all inputs, the level is `json_object`; otherwise
  `none`. An HTTP 4xx for a shape means "not accepted" and the next is tried.
- GWY-20 The gateway sends two messages: a system message with a fixed
  instruction and the handler's JSON Schema (so `json_object` endpoints know the
  target), and the handler's prompt as the user message. `temperature` is sent
  only if the endpoint config sets it; extra provider options and reasoning
  options are merged at the top level of the body unchanged and are rejected if
  they contain `tools`, `tool_choice`, `functions` or `function_call`.
- GWY-21 The ledger row stores the raw HTTP response body (not only the message
  text) and the `usage` object, with latency, endpoint and model.
- GWY-22 A model handler whose level the endpoint's stored result does not meet
  (or that has no stored result for that base URL and model) is refused before
  any input is assembled. The refusal writes an audit event
  (`capability_refused`) and is returned as outcome `refused`; the event is not
  marked as handled, so it can run after the endpoint is tested. A
  `json_object` handler may run on a `strict_schema` endpoint.
- GWY-23 The test result is stored per (base URL, model) in the business
  database. A new base URL or model has no result, so GWY-22 refuses until it is
  tested (this is how GWY-12 is met for those two changes; detecting a server
  version change stays OPEN).

## Rejected key or empty credit (zapa, 2026-10-31; details PROPOSED)

Each company holds its own inference key and pays its own provider (planning L16), so
a rejected key or an empty account is the first thing that will break at a client.

- GWY-24 A response is a **credential failure** when the status is 401, 402 or 403,
  or 429 with a body that says quota, credit, billing or a limit was exceeded. A
  plain 429 and 5xx stay ordinary failures with the normal retry (BEH-13). A
  credential failure is never retried.
- GWY-25 On a credential failure the runner returns outcome `refused` and does not
  mark the event handled, so the customer's message can run once the key works. No
  `invalid_output` proposal is made. The runner stops calling the endpoint: every
  model handler is refused without a request (`inference_blocked` audit row) until a
  person calls `resetInferenceProblem`. There is no timer.
- GWY-26 The first credential failure writes `inference_key_problem` and sends one
  admin alert (ADM-44). Later refusals during the block do not alert again.
- GWY-27 In the capability test, 401, 402, 403, 429 and 5xx are inconclusive (GWY-9):
  nothing is stored, so a dead key cannot be recorded as an endpoint that lacks
  structured output.

## Usage and the call cap (zapa, L16)

- GWY-28 A model call is a prompt-ledger row with an endpoint; a failed attempt
  counts, because the provider counts it. A deterministic handler writes none.
- GWY-29 `pnpm usage --db <file> [--days 7] [--prices file] [--cap N] [--json]` reports
  calls, failures and prompt and completion tokens by day, model and handler, in the
  Status layout. Calls whose response carried no token counts are counted and named,
  so the token totals are a floor.
- GWY-30 Cost is shown only from prices the installer gives (per million tokens, one
  currency). A model with no price is named and left out; with no prices there is no
  cost line. cyborg ships no price table, because prices change.
- GWY-31 `RunnerDeps.callCap = { maxPer24h }` (with a usage counter) refuses a model
  handler once the ledger shows that many calls in the last 24 hours (a rolling
  window, so no time zone is needed). The event is kept unhandled, each refusal is a
  `call_cap_blocked` audit row, one admin alert of kind `call_cap` is sent, and it
  clears (`call_cap_cleared`) when the count drops. The cap is checked before a
  handler's call, so validation retries can pass it by at most N-1 calls. No default:
  an installer must set one. OPEN: what the cap should be per company, an early
  warning before the cap, and what happens to the customers whose messages wait.

## Failure handling

- GWY-13 A request that times out (N-2), errors or returns unparseable output
  counts as a validation failure under BEH-13 (one retry, then `invalid_output`).
- GWY-14 No automatic switching between endpoints or models. A business that
  wants a fallback configures it explicitly per handler (OPEN, no fallback in v1).

## Local models

- GWY-15 Small local models often skip or mangle tool calls (R&D: 0/37 for
  Gemma 3, 3/7 and 4/15 for models with native templates). Cyborg avoids the
  failure class because a handler is one schema-constrained generation with no
  tools. This is a design reason, not a promise that every small model can fill
  every schema: the capability test and the shadow run (docs/06) are the checks.
- GWY-16 Idle unload and keep-warm of a local model belong to the model server's
  own settings (N-8). Cyborg does not manage model residency in v1.
