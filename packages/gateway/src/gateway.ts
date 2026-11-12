import {
  ModelCallError,
  N2_GATEWAY_TIMEOUT_MS,
  type CapabilityLevel,
  type CapabilityResult,
  type CapabilityStore,
  type ModelPort,
  type ModelRequest,
  type ModelResult,
  type PromptLedger,
} from '@cyborg/core';
import { buildBody, responseFormat, schemaInstruction } from './body.ts';
import { runCapabilityTest } from './capability.ts';
import { extraBodyFor, meanLogprob, messageText, postChat, usageOf, type EndpointConfig, type Fetch } from './http.ts';

export interface GatewayConfig {
  endpoint: EndpointConfig;
  /** Model name per handler id; falls back to `defaultModel`, then to the handler's own name (GWY-2). */
  models?: Record<string, string>;
  /** The model any handler without its own entry uses, so a handler of a module added later needs no list edited (audit F-7). */
  defaultModel?: string;
}

/** What model handlers declare when they leave the choice to the company (audit F-6). It is never a real model name. */
const PLACEHOLDER_MODEL = 'default';

export interface GatewayDeps {
  capabilities: CapabilityStore;
  /** GWY-9b, HR-6: where the capability test's probe requests are recorded. The runner records handler calls itself. */
  ledger: PromptLedger;
  fetch?: Fetch;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

/** GWY-24: a rejected key or an empty account is not worth retrying; a plain rate limit is. */
export function classifyFailure(status: number, rawBody: string): 'credential' | 'other' {
  if (status === 401 || status === 402 || status === 403) return 'credential';
  if (status === 429 && /quota|credit|billing|insufficient|limit exceeded|payment/i.test(rawBody)) return 'credential';
  return 'other';
}

const RANK: Record<CapabilityLevel, number> = { none: 0, json_object: 1, strict_schema: 2 };

/** OpenAI-compatible Chat Completions gateway (docs/05). It builds the request itself (GWY-1). */
export class OpenAIGateway implements ModelPort {
  private readonly fetchFn: Fetch;
  private readonly env: NodeJS.ProcessEnv;
  private readonly now: () => Date;

  constructor(
    private readonly config: GatewayConfig,
    private readonly deps: GatewayDeps,
  ) {
    this.fetchFn = deps.fetch ?? fetch;
    this.env = deps.env ?? process.env;
    this.now = deps.now ?? (() => new Date());
  }

  /** MDL-5: the next call uses this address, key name and model; a call already out is not touched. Handlers with a model of their own keep it. */
  reconfigure(next: { baseUrl: string; apiKeyEnv?: string; model: string }): void {
    this.config.endpoint.baseUrl = next.baseUrl;
    if (next.apiKeyEnv === undefined) delete this.config.endpoint.apiKeyEnv;
    else this.config.endpoint.apiKeyEnv = next.apiKeyEnv;
    this.config.defaultModel = next.model;
  }

  private modelFor(handlerId: string, fallback: string): string {
    return this.config.models?.[handlerId] ?? this.config.defaultModel ?? fallback;
  }

  private placeholderMessage(handlerId: string): string {
    return `handler "${handlerId}" has no model: it declares the placeholder name "${PLACEHOLDER_MODEL}" and neither the company file nor the gateway names one (GWY-2)`;
  }

  private get timeoutMs(): number {
    return this.config.endpoint.timeoutMs ?? N2_GATEWAY_TIMEOUT_MS;
  }

  /** GWY-9, GWY-10: runs the capability test for a model and stores the result with its date. */
  async runCapabilityTest(model: string): Promise<CapabilityResult> {
    const result = await runCapabilityTest(this.config.endpoint, model, {
      fetch: this.fetchFn,
      env: this.env,
      now: this.now,
      timeoutMs: this.timeoutMs,
      record: (entry) => { this.deps.ledger.write(entry); },
    });
    // An inconclusive result is returned to the caller but not stored: it must not look like a tested endpoint.
    if (!result.inconclusive) this.deps.capabilities.saveCapability(result);
    return result;
  }

  /** GWY-11, GWY-22: a handler must not run on an endpoint below the level it needs, or an untested one. */
  checkCapability(request: Pick<ModelRequest, 'handlerId' | 'level' | 'modelName'>): { ok: true } | { ok: false; reason: string } {
    const model = this.modelFor(request.handlerId, request.modelName);
    if (model === PLACEHOLDER_MODEL) return { ok: false, reason: this.placeholderMessage(request.handlerId) };
    const result = this.deps.capabilities.latestCapability(this.config.endpoint.baseUrl, model);
    if (!result) {
      return { ok: false, reason: `no capability test result for ${this.config.endpoint.baseUrl} and model "${model}"; run the capability test first` };
    }
    if (RANK[result.level] < RANK[request.level]) {
      return { ok: false, reason: `handler needs ${request.level} but ${this.config.endpoint.baseUrl} with model "${model}" tested as ${result.level}` };
    }
    return { ok: true };
  }

  async call(request: ModelRequest): Promise<ModelResult> {
    const model = this.modelFor(request.handlerId, request.modelName);
    const endpoint = this.config.endpoint;
    if (model === PLACEHOLDER_MODEL) throw new ModelCallError(this.placeholderMessage(request.handlerId), { endpoint: endpoint.baseUrl, model });
    const capability = this.deps.capabilities.latestCapability(endpoint.baseUrl, model);
    if (!capability || capability.requestShape === null) {
      throw new ModelCallError(`no usable capability result for ${endpoint.baseUrl} and model "${model}"`, { endpoint: endpoint.baseUrl, model });
    }
    const schema = request.outputJsonSchema;
    const body = buildBody({
      model,
      system: schemaInstruction(schema),
      user: request.prompt,
      // A json_object handler on a strict endpoint uses the stored shape too; nothing is sent that was not tested.
      format: responseFormat(capability.requestShape, schema),
      ...(endpoint.temperature === undefined ? {} : { temperature: endpoint.temperature }),
      extraBody: extraBodyFor(endpoint, model),
      // GWY-17: asked for only when the capability test showed the endpoint returns them.
      ...(request.wantLogprobs && capability.logprobs ? { logprobs: true } : {}),
    });
    const exchange = await postChat(endpoint, body, { fetch: this.fetchFn, env: this.env, timeoutMs: this.timeoutMs });
    if (exchange.status < 200 || exchange.status >= 300) {
      throw new ModelCallError(`HTTP ${exchange.status}: ${exchange.rawBody.slice(0, 200)}`, {
        endpoint: endpoint.baseUrl,
        model,
        requestPayload: body,
        kind: classifyFailure(exchange.status, exchange.rawBody),
        status: exchange.status,
      });
    }
    const text = messageText(exchange.rawBody);
    return {
      endpoint: endpoint.baseUrl,
      model,
      requestPayload: exchange.requestPayload,
      rawResponse: text ?? '',
      rawHttpBody: exchange.rawBody,
      usage: { ...(usageOf(exchange.rawBody) as object | undefined), latencyMs: Math.round(exchange.latencyMs) },
      ...(request.wantLogprobs && capability.logprobs && meanLogprob(exchange.rawBody) !== undefined ? { meanLogprob: meanLogprob(exchange.rawBody)! } : {}),
    };
  }
}

