import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Demo, type DemoCompany } from '../src/engine.ts';
import { DEMO_SETTINGS } from '../src/demo-settings.ts';

// feat WZP-10..19: the framework's own runner, handlers, gateway and booking step over the in-memory stores, with a scripted `fetch` standing in for the
// model (HR-4: the model's side only). Today is Thursday 2026-11-05.

const model = JSON.parse(readFileSync(new URL('../../../docs/demo/company-model.demo.json', import.meta.url), 'utf8')) as { demo: string; enquiryFields: DemoCompany['enquiryFields']; profile: Record<string, unknown> };
const company: DemoCompany = { profile: model.profile, label: model.demo, enquiryFields: model.enquiryFields };
const NOW = () => new Date('2026-11-05T09:00:00.000Z');

/** An OpenAI-style endpoint: the capability test gets a good answer, the read and the reply get what the script says, keyed on what the prompt asks. */
function endpoint(script: { read: string[]; reply: string[] }) {
  const prompts: string[] = [];
  const fetchStub: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
    const prompt = body.messages.map((m) => m.content).join('\n');
    prompts.push(prompt);
    const content = /Read the customer message below about a tour booking/.test(prompt) ? script.read.shift() : /You write the replies/.test(prompt) ? script.reply.shift() : JSON.stringify({ value: 'beta', phrase: 'beta' });
    if (content === undefined) return new Response(JSON.stringify({ error: { message: 'no more scripted answers' } }), { status: 500 });
    return new Response(JSON.stringify({ choices: [{ message: { content } }], model: 'scripted', usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetchStub, prompts };
}
const read = (...items: [string, string, string][]) => JSON.stringify({ items: items.map(([field, value, sourcePhrase]) => ({ field, value, sourcePhrase })) });
const draft = (text: string) => JSON.stringify({ draft: text });

test('the browser demo runs a whole booking through the framework\'s own code: read, quote, reply, request, confirm', async () => {
  const { fetchStub, prompts } = endpoint({
    read: [read(['service', 'coast walk', 'coast walk']), read(['party_size', '4', '4 people'], ['date', 'saturday', 'saturday']), read()],
    reply: [draft('Great choice! How many people, and which day?'), draft('For 4 people on Saturday 2026-11-07 it is 160 EUR in total (40 EUR per person). Shall I send the request to our team?'), draft('Done: your request B-000001 was sent to our team, who will confirm it.')],
  });
  const demo = new Demo(company, { baseUrl: 'https://example.test/v1', model: 'scripted', apiKey: 'k' }, DEMO_SETTINGS, { now: NOW, fetch: fetchStub });
  assert.match(await demo.prepare(), /json_object|strict_schema/);

  const t1 = await demo.customer('a', 'how much is the coast walk');
  assert.deepEqual(t1.problems, []);
  assert.match(t1.computed, /ask the customer how many people \(give no price until you know\)/);
  assert.ok(t1.facts.some((f) => f.key === 'offer.items' && f.unconfirmed), 'the facts it was given, all unconfirmed');
  assert.match(t1.prompt ?? '', /You are the receptionist for Demo Tours\. You write the replies/);

  const t2 = await demo.customer('a', 'we are 4 people on saturday');
  assert.match(t2.computed, /Total for the group: 160 EUR \(40 EUR per person × 4\)/);
  assert.match(t2.draft ?? '', /160 EUR in total/, 'the computed total passes the checks that block any other amount');
  assert.deepEqual(demo.bookings(), []);

  const t3 = await demo.customer('a', 'yes please');
  assert.equal(t3.request, 'B-000001');
  assert.equal(demo.bookings()[0]!.status, 'proposed');
  assert.match(demo.office('bookings'), /B-000001 · Coast Walk × 4, 2026-11-07, 160 EUR · proposed/);
  assert.match(demo.office('confirm B-000001 by phone'), /B-000001 confirmed\. Nothing was sent to the customer/);
  assert.equal(demo.bookings()[0]!.status, 'approved');
  assert.ok(prompts.some((p) => /Total for the group: 160 EUR/.test(p)), 'the model was given the code\'s figures');
});

test('a topic the business does not know is passed to the office whatever the model wrote, and a failing model is a plain message', async () => {
  const { fetchStub } = endpoint({ read: [read()], reply: [draft('Of course you can bring your dog!')] });
  const demo = new Demo(company, { baseUrl: 'https://example.test/v1', model: 'scripted', apiKey: 'k' }, DEMO_SETTINGS, { now: NOW, fetch: fetchStub });
  await demo.prepare();
  const turn = await demo.customer('b', 'Can I bring my dog?');
  assert.equal(turn.needsOffice, true);
  assert.equal(turn.draft, null);
  assert.match(turn.problems.join(), /the customer asks about pets and dogs/);
  const failing = new Demo(company, { baseUrl: 'https://example.test/v1', model: 'scripted', apiKey: 'k' }, DEMO_SETTINGS, { now: NOW, fetch: (async () => new Response(JSON.stringify({ error: { message: 'rate limit' } }), { status: 429 })) as typeof fetch });
  await assert.rejects(failing.prepare());
});

test('a lesson a person adds is in the next reply\'s prompt, and a retired one is not', async () => {
  const { fetchStub, prompts } = endpoint({ read: [read(), read()], reply: [draft('Sure.'), draft('Sure.')] });
  const demo = new Demo(company, { baseUrl: 'https://example.test/v1', model: 'scripted', apiKey: 'k' }, DEMO_SETTINGS, { now: NOW, fetch: fetchStub });
  await demo.prepare();
  demo.addLesson('When you give a price, say pick-up is included.');
  await demo.customer('c', 'hello');
  assert.match(prompts.filter((p) => /You write the replies/.test(p)).at(-1)!, /say pick-up is included/);
  demo.retireLesson(demo.lessons.listLessons()[0]!.id);
  await demo.customer('c', 'hello again');
  assert.ok(!/say pick-up is included/.test(prompts.filter((p) => /You write the replies/.test(p)).at(-1)!));
  assert.throws(() => demo.addLesson('no'), /short sentence/);
});
