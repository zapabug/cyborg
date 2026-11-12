import { z } from 'zod';
import {
  N16_CAPABILITY_TRIALS,
  type CapabilityAttempt,
  type CapabilityLevel,
  type CapabilityResult,
  type LedgerEntry,
  type RequestShape,
} from '@cyborg/core';
import { buildBody, responseFormat, schemaInstruction } from './body.ts';
import { extraBodyFor, hasLogprobs, messageText, postChat, type EndpointConfig, type Fetch, type HttpExchange } from './http.ts';

/** GWY-18: one fixed schema; inputs whose natural answer does not fit it. */
export const PROBE_SCHEMA = z.object({ label: z.enum(['alpha', 'beta', 'gamma']), count: z.number().int() });
export const PROBE_INPUTS: readonly string[] = [
  'Say hello to the user in one friendly sentence.',
  'What is the capital of Portugal? Answer in a full sentence.',
  'Reply with the single word: unknown.',
];

const SHAPES: readonly RequestShape[] = ['json_schema_wrapped', 'json_schema_direct', 'json_object_schema'];

export interface CapabilityDeps {
  fetch: Fetch;
  env: NodeJS.ProcessEnv;
  now: () => Date;
  timeoutMs: number;
  /** GWY-9b, HR-6: every probe request is written to the prompt ledger, answered or failed. */
  record: (entry: LedgerEntry) => void;
}

export const PROBE_HANDLER_ID = 'gateway.capability_probe';

/** One probe request, recorded in the ledger whether it was answered, refused or failed (HR-6, PRV-8). */
async function postProbe(endpoint: EndpointConfig, model: string, body: Record<string, unknown>, deps: CapabilityDeps): Promise<HttpExchange> {
  const started = performance.now();
  const base = { handlerId: PROBE_HANDLER_ID, handlerVersion: '1', endpoint: endpoint.baseUrl, model };
  try {
    const exchange = await postChat(endpoint, body, deps);
    deps.record({
      ...base, at: deps.now().toISOString(), requestPayload: exchange.requestPayload, rawResponse: exchange.rawBody,
      error: exchange.status >= 200 && exchange.status < 300 ? null : `HTTP ${exchange.status}`, durationMs: exchange.latencyMs,
    });
    return exchange;
  } catch (error) {
    deps.record({ ...base, at: deps.now().toISOString(), requestPayload: body, rawResponse: null, error: (error as Error).message, durationMs: performance.now() - started });
    throw error;
  }
}

async function tryShape(
  endpoint: EndpointConfig,
  model: string,
  shape: RequestShape,
  deps: CapabilityDeps,
): Promise<CapabilityAttempt> {
  const schema = z.toJSONSchema(PROBE_SCHEMA) as Record<string, unknown>;
  const attempt: CapabilityAttempt = { shape, httpStatus: null, trials: 0, validJson: 0, conforming: 0 };
  for (const input of PROBE_INPUTS.slice(0, N16_CAPABILITY_TRIALS)) {
    const body = buildBody({
      model,
      system: schemaInstruction(schema),
      user: input,
      format: responseFormat(shape, schema),
      ...(endpoint.temperature === undefined ? {} : { temperature: endpoint.temperature }),
      extraBody: extraBodyFor(endpoint, model),
    });
    attempt.trials++;
    let exchange;
    try {
      exchange = await postProbe(endpoint, model, body, deps);
    } catch (error) {
      attempt.error = (error as Error).message;
      return attempt; // a transport failure ends this shape; it is not evidence about the shape
    }
    attempt.httpStatus = exchange.status;
    if (exchange.status < 200 || exchange.status >= 300) {
      attempt.error = `HTTP ${exchange.status}`;
      return attempt; // shape not accepted (GWY-19)
    }
    const text = messageText(exchange.rawBody);
    if (text === null) continue;
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      continue;
    }
    attempt.validJson++;
    if (PROBE_SCHEMA.safeParse(json).success) attempt.conforming++;
  }
  return attempt;
}

/** GWY-9, GWY-17, GWY-19: classify an endpoint and model. The caller stores the result (GWY-10). */
export async function runCapabilityTest(endpoint: EndpointConfig, model: string, deps: CapabilityDeps): Promise<CapabilityResult> {
  const attempts: CapabilityAttempt[] = [];
  let level: CapabilityLevel = 'none';
  let requestShape: RequestShape | null = null;
  const expected = Math.min(N16_CAPABILITY_TRIALS, PROBE_INPUTS.length);

  for (const shape of SHAPES) {
    const attempt = await tryShape(endpoint, model, shape, deps);
    attempts.push(attempt);
    if (attempt.trials === expected && attempt.conforming === expected) {
      level = 'strict_schema';
      requestShape = shape;
      break;
    }
  }

  if (level === 'none') {
    // json_object: valid JSON every time from the plain mode, schema not enforced.
    const plain = await tryJsonObject(endpoint, model, deps);
    attempts.push(plain);
    if (plain.trials === expected && plain.validJson === expected) {
      level = 'json_object';
      requestShape = 'json_object';
    }
  }

  const logprobs = await tryLogprobs(endpoint, model, requestShape, deps);
  // A rejected key (401, 402, 403), a rate limit (429), a server error (5xx) or a transport failure is not evidence about the endpoint (GWY-9, GWY-24).
  const transient = attempts.some((a) => a.httpStatus === 401 || a.httpStatus === 402 || a.httpStatus === 403 || a.httpStatus === 429 || (a.httpStatus !== null && a.httpStatus >= 500) || (a.httpStatus === null && a.error !== undefined));
  return { baseUrl: endpoint.baseUrl, model, level, requestShape, logprobs, testedAt: deps.now().toISOString(), attempts, ...(level === 'none' && transient ? { inconclusive: true } : {}) };
}

async function tryJsonObject(endpoint: EndpointConfig, model: string, deps: CapabilityDeps): Promise<CapabilityAttempt> {
  const schema = z.toJSONSchema(PROBE_SCHEMA) as Record<string, unknown>;
  const attempt: CapabilityAttempt = { shape: 'json_object', httpStatus: null, trials: 0, validJson: 0, conforming: 0 };
  for (const input of PROBE_INPUTS.slice(0, N16_CAPABILITY_TRIALS)) {
    const body = buildBody({
      model,
      system: schemaInstruction(schema),
      user: input,
      format: responseFormat('json_object', schema),
      ...(endpoint.temperature === undefined ? {} : { temperature: endpoint.temperature }),
      extraBody: extraBodyFor(endpoint, model),
    });
    attempt.trials++;
    let exchange;
    try {
      exchange = await postProbe(endpoint, model, body, deps);
    } catch (error) {
      attempt.error = (error as Error).message;
      return attempt;
    }
    attempt.httpStatus = exchange.status;
    if (exchange.status < 200 || exchange.status >= 300) {
      attempt.error = `HTTP ${exchange.status}`;
      return attempt;
    }
    const text = messageText(exchange.rawBody);
    try {
      if (text !== null) {
        const json = JSON.parse(text);
        attempt.validJson++;
        if (PROBE_SCHEMA.safeParse(json).success) attempt.conforming++;
      }
    } catch {
      // not JSON: counted as a trial without valid JSON
    }
  }
  return attempt;
}

/** GWY-17: one extra request asking for log-probabilities; true only if the answer carries them. */
async function tryLogprobs(
  endpoint: EndpointConfig,
  model: string,
  shape: RequestShape | null,
  deps: CapabilityDeps,
): Promise<boolean> {
  const schema = z.toJSONSchema(PROBE_SCHEMA) as Record<string, unknown>;
  const body = buildBody({
    model,
    system: schemaInstruction(schema),
    user: PROBE_INPUTS[2]!,
    format: shape ? responseFormat(shape, schema) : null,
    logprobs: true,
    extraBody: extraBodyFor(endpoint, model),
  });
  try {
    const exchange = await postProbe(endpoint, model, body, deps);
    return exchange.status >= 200 && exchange.status < 300 && hasLogprobs(exchange.rawBody);
  } catch {
    return false;
  }
}
