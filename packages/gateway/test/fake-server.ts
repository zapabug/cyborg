// The server's side of a gateway test: a real HTTP server on a loopback port that behaves like a
// chosen kind of OpenAI-compatible endpoint. Scripting the server is allowed (HR-4); no model runs.
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface Captured {
  path: string;
  headers: IncomingMessage['headers'];
  body: Record<string, unknown>;
}

export interface Reply {
  status?: number;
  /** Content of the assistant message. */
  content?: string;
  usage?: Record<string, unknown>;
  logprobs?: boolean;
  delayMs?: number;
  rawBody?: string;
}

export type Responder = (body: Record<string, unknown>, nth: number) => Reply;

export interface FakeServer {
  baseUrl: string;
  requests: Captured[];
  close(): Promise<void>;
}

export async function startServer(responder: Responder): Promise<FakeServer> {
  const requests: Captured[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>;
      requests.push({ path: req.url ?? '', headers: req.headers, body });
      const reply = responder(body, requests.length);
      const send = () => {
        res.statusCode = reply.status ?? 200;
        res.setHeader('content-type', 'application/json');
        if (reply.rawBody !== undefined) return void res.end(reply.rawBody);
        if (reply.status && reply.status >= 400) return void res.end(JSON.stringify({ error: { message: 'rejected' } }));
        res.end(
          JSON.stringify({
            id: 'cmpl-test',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: reply.content ?? '' },
                ...(reply.logprobs ? { logprobs: { content: [{ token: '{', logprob: -0.1, top_logprobs: [] }] } } : {}),
              },
            ],
            ...(reply.usage ? { usage: reply.usage } : {}),
          }),
        );
      };
      if (reply.delayMs) setTimeout(send, reply.delayMs);
      else send();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

const isProbe = (body: Record<string, unknown>) =>
  JSON.stringify(body['messages']).includes('label');
export const PROBE_CONFORMING = JSON.stringify({ label: 'alpha', count: 1 });

type Format = { type?: string; json_schema?: unknown; schema?: unknown } | undefined;
const format = (body: Record<string, unknown>) => body['response_format'] as Format;

/** An endpoint that enforces the schema only when it is sent in `shape`; other schema shapes get HTTP 400. */
export function enforcing(shape: 'wrapped' | 'direct' | 'object_schema', answer: string, extra: Partial<Reply> = {}): Responder {
  return (body) => {
    const f = format(body);
    const isWrapped = f?.type === 'json_schema' && f.json_schema !== undefined;
    const isDirect = f?.type === 'json_schema' && f.json_schema === undefined && f.schema !== undefined;
    const isObjectSchema = f?.type === 'json_object' && f.schema !== undefined;
    const accepted = (shape === 'wrapped' && isWrapped) || (shape === 'direct' && isDirect) || (shape === 'object_schema' && isObjectSchema);
    if (accepted) return { content: isProbe(body) ? PROBE_CONFORMING : answer, ...extra };
    if (isWrapped || isDirect || isObjectSchema) return { status: 400 };
    return { content: 'plain text, no JSON here', ...extra };
  };
}

/** An endpoint that only knows `{type: "json_object"}`: valid JSON, schema never enforced. */
export function jsonObjectOnly(): Responder {
  return (body) => {
    const f = format(body);
    if (f?.type === 'json_object' && f.schema === undefined) return { content: JSON.stringify({ something: 'else' }) };
    if (f?.type) return { status: 400 };
    return { content: 'plain text' };
  };
}

/** An endpoint that ignores response_format and answers in prose. */
export function proseOnly(): Responder {
  return () => ({ content: 'Hello! The capital of Portugal is Lisbon.' });
}
