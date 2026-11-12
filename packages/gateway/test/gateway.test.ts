import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { HandlerRegistry, Runner } from '@cyborg/core';
import { echoHandler, textEvent } from '@cyborg/core/testing';
import { SqliteStore } from '@cyborg/store-sqlite';
import { FORBIDDEN_BODY_KEYS, OpenAIGateway, type EndpointConfig, buildBody } from '../src/index.ts';
import { enforcing, jsonObjectOnly, proseOnly, startServer, type FakeServer, type Responder } from './fake-server.ts';

const answer = JSON.stringify({ value: 'beta', phrase: 'beta' });
const servers: FakeServer[] = [];
afterEach(async () => {
  while (servers.length) await servers.pop()!.close();
});

async function rig(responder: Responder, endpoint: Partial<EndpointConfig> = {}, env: NodeJS.ProcessEnv = {}) {
  const server = await startServer(responder);
  servers.push(server);
  const store = new SqliteStore(':memory:');
  const gateway = new OpenAIGateway(
    { endpoint: { baseUrl: server.baseUrl, ...endpoint } },
    { capabilities: store, ledger: store, env, now: () => new Date('2026-10-31T10:00:00.000Z') },
  );
  const registry = new HandlerRegistry({ autoReplyHandlers: [] });
  const runner = (level: 'strict_schema' | 'json_object' = 'strict_schema') => {
    const reg = new HandlerRegistry({ autoReplyHandlers: [] });
    reg.registerHandler(echoHandler({ model: { level, name: 'm1' } }));
    return new Runner({
      businessId: 'b',
      registry: reg,
      store,
      ledger: store,
      model: gateway,
      now: () => new Date('2026-10-31T10:00:00.000Z'),
    });
  };
  void registry;
  return { server, store, gateway, runner };
}

const probeBodies = (server: FakeServer) => server.requests.map((r) => r.body);

// M3-EC1
test('GWY-3: no outgoing body ever contains tools, tool_choice, functions or function_call', async () => {
  const { server, gateway, runner } = await rig(enforcing('wrapped', answer));
  await gateway.runCapabilityTest('m1');
  await runner().handle(textEvent('e1'));
  assert.ok(server.requests.length > 3);
  for (const body of probeBodies(server)) {
    for (const key of FORBIDDEN_BODY_KEYS) assert.ok(!(key in body), `${key} found`);
  }
});

test('GWY-3: provider options cannot smuggle tools into a body', () => {
  for (const key of FORBIDDEN_BODY_KEYS) {
    assert.throws(() => buildBody({ model: 'm', system: 's', user: 'u', format: null, extraBody: { [key]: [] } }), /HR-3/);
  }
});

// M3-EC2 (machine part; the real endpoints are the user part)
test('GWY-4, GWY-9, GWY-19: the capability test finds the accepted request shape for each kind of endpoint', async () => {
  const cases: [string, Responder, string, string | null][] = [
    ['wrapped', enforcing('wrapped', answer), 'strict_schema', 'json_schema_wrapped'],
    ['direct', enforcing('direct', answer), 'strict_schema', 'json_schema_direct'],
    ['object_schema', enforcing('object_schema', answer), 'strict_schema', 'json_object_schema'],
    ['json_object only', jsonObjectOnly(), 'json_object', 'json_object'],
    ['prose only', proseOnly(), 'none', null],
  ];
  for (const [name, responder, level, shape] of cases) {
    const { gateway } = await rig(responder);
    const result = await gateway.runCapabilityTest('m1');
    assert.equal(result.level, level, name);
    assert.equal(result.requestShape, shape, name);
  }
});

test('GWY-9b, HR-6 (audit 2026-11-10): every probe request of the capability test is in the ledger with its exact body, whether answered or refused', async () => {
  const { server, store, gateway } = await rig(enforcing('direct', answer));
  await gateway.runCapabilityTest('m1');
  const rows = store.usageRows('2000-01-01T00:00:00.000Z');
  assert.equal(rows.length, server.requests.length, 'one ledger row for each request that left');
  assert.ok(rows.length > 3);
  assert.ok(rows.every((r) => r.handlerId === 'gateway.capability_probe' && r.model === 'm1'));
  assert.ok(rows.some((r) => r.error !== null), 'a shape the endpoint refused is a row with its error');
  assert.ok(rows.some((r) => r.error === null), 'the shape it accepted is a row without one');
  const first = store.read(store.listLedgerFailures()[0]!.id)!;
  assert.deepEqual(first.requestPayload, server.requests[0]!.body, 'the stored body is the body that was sent');
});

test('GWY-9b: a probe that fails in transport leaves a row with the error', async () => {
  const store = new SqliteStore(':memory:');
  const gateway = new OpenAIGateway({ endpoint: { baseUrl: 'http://127.0.0.1:1/v1' } }, { capabilities: store, ledger: store });
  const result = await gateway.runCapabilityTest('m1');
  assert.equal(result.inconclusive, true);
  const failures = store.listLedgerFailures();
  assert.ok(failures.length >= 1);
  assert.ok(failures.every((f) => f.handlerId === 'gateway.capability_probe' && /request failed/.test(f.error)));
});

test('GWY-10: the result is stored with date, base URL and model, and the attempts are kept', async () => {
  const { server, store, gateway } = await rig(enforcing('direct', answer));
  const result = await gateway.runCapabilityTest('m1');
  assert.deepEqual(store.latestCapability(server.baseUrl, 'm1'), result);
  assert.equal(result.testedAt, '2026-10-31T10:00:00.000Z');
  assert.equal(result.baseUrl, server.baseUrl);
  assert.deepEqual(result.attempts.map((a) => [a.shape, a.httpStatus]), [
    ['json_schema_wrapped', 400],
    ['json_schema_direct', 200],
  ]);
  assert.equal(result.attempts[1]!.conforming, 3);
  assert.equal(store.latestCapability(server.baseUrl, 'other-model'), null);
});

test('GWY-17: the capability test records whether log-probabilities are returned', async () => {
  const withLp = await rig(enforcing('wrapped', answer, { logprobs: true }));
  assert.equal((await withLp.gateway.runCapabilityTest('m1')).logprobs, true);
  const without = await rig(enforcing('wrapped', answer));
  assert.equal((await without.gateway.runCapabilityTest('m1')).logprobs, false);
});

test('GWY-7: an endpoint that obeys the shape but not the values is not mistaken for strict', async () => {
  const wrongValues: Responder = () => ({ content: JSON.stringify({ label: 'omega', count: 1.5 }) });
  const { gateway } = await rig(wrongValues);
  assert.equal((await gateway.runCapabilityTest('m1')).level, 'json_object');
});

// M3-EC3
test('GWY-11, GWY-22: a strict_schema handler is refused on a lesser or untested endpoint, audited, event left unhandled', async () => {
  const { server, store, gateway, runner } = await rig(jsonObjectOnly());
  const r = runner('strict_schema');

  const untested = await r.handle(textEvent('e1'));
  assert.equal(untested[0]!.outcome, 'refused');
  assert.match((untested[0] as { reason: string }).reason, /run the capability test first/);

  await gateway.runCapabilityTest('m1');
  const requestsAfterTest = server.requests.length;
  const lesser = await r.handle(textEvent('e1'));
  assert.equal(lesser[0]!.outcome, 'refused');
  assert.match((lesser[0] as { reason: string }).reason, /needs strict_schema but .* tested as json_object/);
  assert.equal(server.requests.length, requestsAfterTest, 'no model request was made');

  const audit = store.listAudit().filter((a) => a.kind === 'capability_refused');
  assert.equal(audit.length, 2);
  assert.equal(store.list().length, 0);
  assert.equal(store.hasRun({ source: 'test-source', eventId: 'e1', handlerId: 'test.echo' }), false);
});

test('GWY-22: a json_object handler may run on a strict endpoint; a refused event runs once the endpoint is good', async () => {
  const { gateway, runner, store } = await rig(enforcing('wrapped', answer));
  await gateway.runCapabilityTest('m1');
  const outcomes = await runner('json_object').handle(textEvent('e1'));
  assert.equal(outcomes[0]!.outcome, 'proposal');
  assert.equal(store.list()[0]!.status, 'proposed');
});

test('GWY-23: a different model or base URL has no result and is refused until tested', async () => {
  const { gateway } = await rig(enforcing('wrapped', answer));
  await gateway.runCapabilityTest('m1');
  assert.deepEqual(gateway.checkCapability({ handlerId: 'h', level: 'strict_schema', modelName: 'm1' }), { ok: true });
  const other = gateway.checkCapability({ handlerId: 'h', level: 'strict_schema', modelName: 'm2' });
  assert.equal(other.ok, false);
  const perHandler = new OpenAIGateway(
    { endpoint: { baseUrl: 'http://127.0.0.1:1/v1' }, models: { h: 'm1' } },
    { capabilities: { saveCapability() {}, latestCapability: () => null }, ledger: new SqliteStore(':memory:') },
  );
  assert.equal(perHandler.checkCapability({ handlerId: 'h', level: 'json_object', modelName: 'm1' }).ok, false);
});

// M3-EC4
test('GWY-13, BEH-13: a timed-out request is retried N-1 times, then invalid_output', async () => {
  const { server, store, gateway, runner } = await rig(
    (body, nth) => (nth <= 3 ? enforcing('wrapped', answer)(body, nth) : { content: answer, delayMs: 400 }),
    { timeoutMs: 80 },
  );
  await gateway.runCapabilityTest('m1');
  const before = server.requests.length;
  const [outcome] = await runner('json_object').handle(textEvent('e1'));
  assert.equal(server.requests.length - before, 2, 'one attempt and one retry');
  const proposal = (outcome as { proposal: { status: string; reason: string; modelCallId: string } }).proposal;
  assert.equal(proposal.status, 'invalid_output');
  assert.match(proposal.reason, /timed out/);
  assert.match(store.read(proposal.modelCallId)!.error ?? '', /timed out after 80 ms/);
});

test('GWY-13: an HTTP error and unparseable output count as validation failures', async () => {
  const statuses: Responder = (body, nth) => {
    if (nth <= 4) return enforcing('wrapped', answer)(body, nth);
    return nth === 5 ? { status: 500 } : { content: 'not json at all' };
  };
  const { gateway, runner } = await rig(statuses);
  await gateway.runCapabilityTest('m1');
  const [outcome] = await runner('json_object').handle(textEvent('e1'));
  const proposal = (outcome as { proposal: { status: string; reason: string } }).proposal;
  assert.equal(proposal.status, 'invalid_output');
  assert.match(proposal.reason, /attempt 1: model call failed: HTTP 500/);
  assert.match(proposal.reason, /attempt 2: response is not JSON/);
});

test('GWY-7: structure is forced but values are still checked in code', async () => {
  const { gateway, runner } = await rig(enforcing('wrapped', JSON.stringify({ value: '', phrase: 'beta' })));
  await gateway.runCapabilityTest('m1');
  const [outcome] = await runner().handle(textEvent('e1'));
  const proposal = (outcome as { proposal: { status: string; reason: string } }).proposal;
  assert.equal(proposal.status, 'invalid_output');
  assert.match(proposal.reason, /value is empty/);
});

// M3-EC5
test('GWY-8, GWY-21: the ledger row holds the exact request, the raw HTTP body, usage, latency, endpoint and model', async () => {
  const usage = { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 };
  const { server, store, gateway, runner } = await rig(enforcing('wrapped', answer, { usage }));
  await gateway.runCapabilityTest('m1');
  const [outcome] = await runner().handle(textEvent('e1'));
  const proposal = (outcome as { proposal: { status: string; modelCallId: string } }).proposal;
  assert.equal(proposal.status, 'proposed');
  const row = store.read(proposal.modelCallId)!;
  assert.deepEqual(row.requestPayload, server.requests.at(-1)!.body, 'the ledger holds exactly what was sent');
  assert.match(row.rawResponse ?? '', /"choices"/);
  assert.equal(JSON.parse(row.rawResponse!).usage.total_tokens, 19);
  assert.equal((row.usage as { prompt_tokens: number }).prompt_tokens, 12);
  assert.equal(typeof (row.usage as { latencyMs: number }).latencyMs, 'number');
  assert.equal(row.endpoint, server.baseUrl);
  assert.equal(row.model, 'm1');
});

test('GWY-20: the request carries a system instruction with the schema and the handler prompt as the user message', async () => {
  const { server, gateway, runner } = await rig(enforcing('wrapped', answer));
  await gateway.runCapabilityTest('m1');
  await runner().handle(textEvent('e1'));
  const body = server.requests.at(-1)!.body as { messages: { role: string; content: string }[]; response_format: { json_schema: { strict: boolean; schema: { properties: object } } } };
  assert.equal(body.messages[0]!.role, 'system');
  assert.match(body.messages[0]!.content, /JSON Schema/);
  assert.deepEqual(body.messages[1], { role: 'user', content: 'Extract from: alpha beta gamma' });
  assert.equal(body.response_format.json_schema.strict, true);
  assert.deepEqual(Object.keys(body.response_format.json_schema.schema.properties).sort(), ['phrase', 'value']);
  assert.ok(!('temperature' in body), 'temperature is sent only when configured');
});

test('GWY-2, GWY-5, GWY-6: key from env, provider and reasoning options pass through unchanged, temperature only if set', async () => {
  const providerOptions = { provider: { data_collection: 'deny', require_parameters: true } };
  const { server, gateway, runner } = await rig(
    enforcing('wrapped', answer),
    { apiKeyEnv: 'TEST_KEY', providerOptions, reasoning: { m1: { reasoning_effort: 'low' } }, temperature: 0 },
    { TEST_KEY: 'sk-test-123' },
  );
  await gateway.runCapabilityTest('m1');
  await runner().handle(textEvent('e1'));
  const last = server.requests.at(-1)!;
  assert.equal(last.headers['authorization'], 'Bearer sk-test-123');
  assert.deepEqual(last.body['provider'], providerOptions.provider);
  assert.equal(last.body['reasoning_effort'], 'low');
  assert.equal(last.body['temperature'], 0);
  assert.ok(!JSON.stringify(last.body).includes('sk-test-123'), 'the key is a header only');
});

test('GWY-2: without a key variable no authorization header is sent', async () => {
  const { server, gateway } = await rig(enforcing('wrapped', answer));
  await gateway.runCapabilityTest('m1');
  assert.equal(server.requests[0]!.headers['authorization'], undefined);
});

// M8-EC2
test('GWY-17 / M8-EC2: log-probabilities are requested and returned only when the capability test showed the endpoint has them', async () => {
  const request = { handlerId: 'h', handlerVersion: '1', level: 'json_object' as const, modelName: 'm1', prompt: 'p', outputJsonSchema: { type: 'object' }, wantLogprobs: true };

  const withLp = await rig(enforcing('wrapped', answer, { logprobs: true }));
  await withLp.gateway.runCapabilityTest('m1');
  const result = await withLp.gateway.call(request);
  assert.equal(withLp.server.requests.at(-1)!.body['logprobs'], true);
  assert.ok(Math.abs(result.meanLogprob! - -0.1) < 1e-9);

  const without = await rig(enforcing('wrapped', answer));
  await without.gateway.runCapabilityTest('m1');
  const plain = await without.gateway.call(request);
  assert.ok(!('logprobs' in without.server.requests.at(-1)!.body), 'not requested from an endpoint that does not return them');
  assert.equal(plain.meanLogprob, undefined);

  const notAsked = await withLp.gateway.call({ ...request, wantLogprobs: false });
  assert.equal(notAsked.meanLogprob, undefined);
});

test('GWY-9: a rate limit or server error is inconclusive and is not stored; a real refusal is a stored `none`', async () => {
  for (const status of [401, 402, 403, 429, 500, 503]) {
    const { server, store, gateway } = await rig(() => ({ status }));
    const result = await gateway.runCapabilityTest('m1');
    assert.equal(result.level, 'none');
    assert.equal(result.inconclusive, true, String(status));
    assert.equal(store.latestCapability(server.baseUrl, 'm1'), null, 'nothing stored');
    assert.equal(gateway.checkCapability({ handlerId: 'h', level: 'json_object', modelName: 'm1' }).ok, false);
  }
  const refusing = await rig((body) => ((body['response_format'] as { type?: string } | undefined)?.type ? { status: 400 } : { content: 'prose' }));
  const result = await refusing.gateway.runCapabilityTest('m1');
  assert.equal(result.level, 'none');
  assert.equal(result.inconclusive, undefined);
  assert.equal(refusing.store.latestCapability(refusing.server.baseUrl, 'm1')?.level, 'none', 'a clear 400 is a real answer and is stored');
});

// audit 2026-11-03 F-6, F-7
test('GWY-2: a handler without its own entry uses the default model, and the placeholder name "default" is never sent to an endpoint', async () => {
  const asked: string[] = [];
  const capabilities = { saveCapability() {}, latestCapability: (_url: string, model: string) => (asked.push(model), null) };
  const check = (gateway: OpenAIGateway, handlerId: string) => gateway.checkCapability({ handlerId, level: 'json_object', modelName: 'default' });
  const withDefault = new OpenAIGateway({ endpoint: { baseUrl: 'http://127.0.0.1:1/v1' }, defaultModel: 'm-default', models: { 'a.one': 'm-one' } }, { capabilities, ledger: new SqliteStore(':memory:') });
  check(withDefault, 'a.one');
  check(withDefault, 'b.module-added-later');
  assert.deepEqual(asked, ['m-one', 'm-default']);

  const bare = new OpenAIGateway({ endpoint: { baseUrl: 'http://127.0.0.1:1/v1' } }, { capabilities, ledger: new SqliteStore(':memory:') });
  const refused = check(bare, 'c.nobody');
  assert.equal(refused.ok, false);
  assert.match((refused as { reason: string }).reason, /placeholder name "default"/);
  await assert.rejects(() => bare.call({ handlerId: 'c.nobody', modelName: 'default', level: 'json_object', system: 's', user: 'u' } as never), /placeholder name "default"/);
  assert.equal(asked.length, 2, 'the placeholder never reached the capability lookup');
});

test('MDL-5: reconfigure points the next call at a new address, key name and model, and drops the key name when none is given', async () => {
  const a = await startServer(enforcing('wrapped', JSON.stringify({ value: 'x', phrase: 'x' })));
  const b = await startServer(enforcing('wrapped', JSON.stringify({ value: 'x', phrase: 'x' })));
  try {
    const store = new SqliteStore(':memory:');
    const gateway = new OpenAIGateway({ endpoint: { baseUrl: a.baseUrl, apiKeyEnv: 'KEY_A' }, defaultModel: 'one' }, { capabilities: store, ledger: store, env: { KEY_A: 'key-for-a', KEY_B: 'key-for-b' } });
    await gateway.runCapabilityTest('one');
    assert.ok(a.requests.length > 0 && b.requests.length === 0);
    assert.equal(a.requests[0]!.headers['authorization'], 'Bearer key-for-a');
    gateway.reconfigure({ baseUrl: b.baseUrl, apiKeyEnv: 'KEY_B', model: 'two' });
    const before = a.requests.length;
    const result = await gateway.runCapabilityTest('two');
    assert.equal(a.requests.length, before, 'nothing more goes to the old address');
    assert.ok(b.requests.length > 0);
    assert.equal(b.requests[0]!.headers['authorization'], 'Bearer key-for-b');
    assert.equal(result.baseUrl, b.baseUrl);
    gateway.reconfigure({ baseUrl: b.baseUrl, model: 'two' });
    const n = b.requests.length;
    await gateway.runCapabilityTest('two');
    assert.equal(b.requests[n]!.headers['authorization'], undefined, 'no key name, no key sent');
  } finally {
    await a.close();
    await b.close();
  }
});

test('HR-6 (audit 2026-11-10): a request to a model leaves the gateway only through the two recorded paths (a handler call, which the runner records, and a probe, which postProbe records)', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const dir = new URL('../src/', import.meta.url);
  const users = readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'http.ts' && /\bpostChat\(/.test(readFileSync(new URL(f, dir), 'utf8')));
  assert.deepEqual(users.sort(), ['capability.ts', 'gateway.ts']);
  const capability = readFileSync(new URL('capability.ts', dir), 'utf8');
  assert.equal(capability.match(/\bpostChat\(/g)!.length, 1, 'capability.ts calls postChat once, inside postProbe');
});
