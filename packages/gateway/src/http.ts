import { ModelCallError } from '@cyborg/core';
import { buildBody } from './body.ts';

export interface EndpointConfig {
  /** Includes the version path, for example `http://127.0.0.1:8081/v1`. Never assumed (GWY-2). */
  baseUrl: string;
  /** Name of the environment variable that holds the key; the key itself is never in config (GWY-2). */
  apiKeyEnv?: string;
  /** Omitted from the request unless set. */
  temperature?: number;
  /** Request timeout; defaults to N-2 (docs/02). */
  timeoutMs?: number;
  /** Provider options such as OpenRouter's `provider`, passed through unchanged (GWY-5). */
  providerOptions?: Record<string, unknown>;
  /** Reasoning-mode options per model name, passed through unchanged (GWY-6). */
  reasoning?: Record<string, Record<string, unknown>>;
}

export interface HttpExchange {
  requestPayload: Record<string, unknown>;
  status: number;
  rawBody: string;
  latencyMs: number;
}

export type Fetch = typeof fetch;

/** One POST to `<baseUrl>/chat/completions`. Throws `ModelCallError` carrying the payload on timeout or transport error. */
export async function postChat(
  endpoint: EndpointConfig,
  body: Record<string, unknown>,
  deps: { fetch: Fetch; env: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<HttpExchange> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const key = endpoint.apiKeyEnv ? deps.env[endpoint.apiKeyEnv] : undefined;
  if (key) headers['authorization'] = `Bearer ${key}`;
  const started = performance.now();
  try {
    const response = await deps.fetch(`${endpoint.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(deps.timeoutMs),
    });
    const rawBody = await response.text();
    return { requestPayload: body, status: response.status, rawBody, latencyMs: performance.now() - started };
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new ModelCallError(timedOut ? `request timed out after ${deps.timeoutMs} ms` : `request failed: ${String(error)}`, {
      endpoint: endpoint.baseUrl,
      requestPayload: body,
    });
  }
}

/** GWY-5, GWY-6: provider options plus this model's reasoning options, passed through unchanged. */
export function extraBodyFor(endpoint: EndpointConfig, model: string): Record<string, unknown> {
  return { ...(endpoint.providerOptions ?? {}), ...(endpoint.reasoning?.[model] ?? {}) };
}

export { buildBody };

/** The assistant message text of a Chat Completions response, or null if the body has none. */
export function messageText(rawBody: string): string | null {
  try {
    const content = (JSON.parse(rawBody) as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : null;
  } catch {
    return null;
  }
}

export function usageOf(rawBody: string): unknown {
  try {
    return (JSON.parse(rawBody) as { usage?: unknown }).usage;
  } catch {
    return undefined;
  }
}

export function hasLogprobs(rawBody: string): boolean {
  try {
    const lp = (JSON.parse(rawBody) as { choices?: { logprobs?: { content?: unknown } | null }[] }).choices?.[0]?.logprobs;
    return Array.isArray(lp?.content) && lp.content.length > 0;
  } catch {
    return false;
  }
}

/** GWY-17: the mean token log-probability of the answer, or undefined if the response has none. */
export function meanLogprob(rawBody: string): number | undefined {
  try {
    const content = (JSON.parse(rawBody) as { choices?: { logprobs?: { content?: { logprob?: unknown }[] } | null }[] }).choices?.[0]?.logprobs?.content;
    const values = (content ?? []).map((t) => t.logprob).filter((v): v is number => typeof v === 'number');
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : undefined;
  } catch {
    return undefined;
  }
}
