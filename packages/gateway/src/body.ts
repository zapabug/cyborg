import type { RequestShape } from '@cyborg/core';

/** HR-3, GWY-3: none of these may be in a request body. */
export const FORBIDDEN_BODY_KEYS = ['tools', 'tool_choice', 'functions', 'function_call'] as const;

export function assertNoToolKeys(body: Record<string, unknown>, where: string): void {
  for (const key of FORBIDDEN_BODY_KEYS) {
    if (key in body) throw new Error(`${where} contains "${key}"; the model must never be offered tools (HR-3, GWY-3)`);
  }
}

/** GWY-19: the `response_format` value for each request shape. */
export function responseFormat(shape: RequestShape, schema: Record<string, unknown>): Record<string, unknown> {
  switch (shape) {
    case 'json_schema_wrapped':
      return { type: 'json_schema', json_schema: { name: 'cyborg_output', strict: true, schema } };
    case 'json_schema_direct':
      return { type: 'json_schema', schema };
    case 'json_object_schema':
      return { type: 'json_object', schema };
    case 'json_object':
      return { type: 'json_object' };
  }
}

/** GWY-20: the fixed system instruction that carries the target schema. */
export function schemaInstruction(schema: Record<string, unknown>): string {
  return `Reply with one JSON object that matches this JSON Schema, and nothing else.\n${JSON.stringify(schema)}`;
}

export interface BodyOptions {
  model: string;
  system: string;
  user: string;
  format: Record<string, unknown> | null;
  temperature?: number;
  /** Provider and reasoning options, merged at the top level unchanged (GWY-5, GWY-6). */
  extraBody?: Record<string, unknown>;
  logprobs?: boolean;
}

export function buildBody(options: BodyOptions): Record<string, unknown> {
  if (options.extraBody) assertNoToolKeys(options.extraBody, 'extra provider options');
  const body: Record<string, unknown> = {
    ...(options.extraBody ?? {}),
    model: options.model,
    messages: [
      { role: 'system', content: options.system },
      { role: 'user', content: options.user },
    ],
  };
  if (options.format) body['response_format'] = options.format;
  if (options.temperature !== undefined) body['temperature'] = options.temperature;
  if (options.logprobs) {
    body['logprobs'] = true;
    body['top_logprobs'] = 1;
  }
  assertNoToolKeys(body, 'the request body');
  return body;
}
