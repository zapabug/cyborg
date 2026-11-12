// feat-desk DK1 / DSK-1..3 and docs/10 ADM-67: the writer's instruction is "You are the receptionist for {company}".
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FACTS, message, rig, tourDeskConfig } from './helpers.ts';

const REPLY = 'sales.enquiry.reply_draft';
const FOLLOWUP = 'sales.followup.draft';
const draft = (text: string) => JSON.stringify({ draft: text });

test('DK1-EC1 / DSK-1: the reply prompt opens as the receptionist and keeps every rule it had', async () => {
  const env = rig({ enabledHandlers: [REPLY], script: [draft('A colleague will follow up.')] });
  await env.runner.handle(message('how much is the east tour'));
  const prompt = env.model.calls[0]!.prompt;
  assert.match(prompt, /^You are the receptionist for Demo Tours\. You write the replies\. Tone: /);
  assert.doesNotMatch(prompt, /You write replies for/);
  // the rules that stay (ADM-67, ADM-68): no introduction, never a person, the FAQ answers "are you a bot", nothing confirmed, no unlisted price
  assert.match(prompt, /Do not introduce yourself or say what you are unless asked, and never say or imply that you are a person/);
  assert.match(prompt, /when the FAQ has an answer to that question, give that answer/);
  assert.match(prompt, /Never confirm a booking, promise, guarantee or take payment\. Never state a price, day or number of places that is not in the facts/);
  assert.match(prompt, /Use only these facts/);
});

test('DK1-EC1 / DSK-1: "receptionist" is the role the model writes in, never an instruction to say it, and "assistant" is not used', async () => {
  const env = rig({ enabledHandlers: [REPLY], script: [draft('A colleague will follow up.')] });
  await env.runner.handle(message('hi'));
  const prompt = env.model.calls[0]!.prompt;
  assert.equal(prompt.match(/receptionist/g)?.length, 1, 'the word appears once, in the opening line');
  assert.doesNotMatch(prompt, /assistant/i);
});

test('DK1-EC1 / DSK-1: the follow-up prompt opens as the receptionist too', async () => {
  const env = rig({ enabledHandlers: [FOLLOWUP], script: [draft('Hi again, just checking whether you still want the tour.')] });
  const event = { id: 'f-30', source: 'chat', kind: 'schedule:sales.followup', at: '2026-10-31T10:00:00.000Z', payload: { text: 'gostava de fazer um passeio', sender: 'sender-x', hoursSinceContact: 30 } };
  await env.runner.handle(event);
  const prompt = env.model.calls[0]!.prompt;
  assert.match(prompt, /^You are the receptionist for Demo Tours\. You write the follow-ups\. Tone: /);
  assert.doesNotMatch(prompt, /You write follow-ups for/);
});

test('DK1-EC2 / DSK-3: the handler versions moved on, and the proposal carries the new version', async () => {
  const env = rig({ enabledHandlers: [REPLY, FOLLOWUP], script: [draft('A colleague will follow up.')] });
  assert.notEqual(env.registry.get(REPLY)!.version, '5', 'the reply writer is no longer version 5, 6, 7 or 8');
  assert.equal(env.registry.get(REPLY)!.version, '9');
  assert.notEqual(env.registry.get(FOLLOWUP)!.version, '1');
  const [outcome] = await env.runner.handle(message('how much is the east tour'));
  assert.ok(outcome && outcome.outcome === 'proposal');
  assert.equal(outcome.proposal.handlerVersion, '9');
});

// PRF-24b, feat-desk DSK-10 (audit 2026-11-10): a principle is a rule in the prompt, so its text is part of the version a run records
test('DSK-10 / PRF-24b: editing a principle changes the version in the proposal; the same text gives the same version; a business without principles has none', async () => {
  const versionFor = async (principles: unknown) => {
    const facts = principles === undefined ? undefined : { ...FACTS, 'rules.principles': principles };
    const env = rig({ enabledHandlers: [REPLY], config: { ...tourDeskConfig, ...(principles === undefined ? {} : { principles: true }) }, ...(facts ? { facts } : {}), script: [draft('A colleague will follow up.')] });
    const [outcome] = await env.runner.handle(message('how much is the east tour'));
    assert.equal(outcome!.outcome, 'proposal');
    return (outcome as { proposal: { handlerVersion: string } }).proposal.handlerVersion;
  };
  const a = await versionFor([{ id: 'P1', text: 'Always guide the customer to the next step.' }]);
  const again = await versionFor([{ id: 'P1', text: 'Always guide the customer to the next step.' }]);
  const edited = await versionFor([{ id: 'P1', text: 'Always guide the customer to the next step, kindly.' }]);
  const none = await versionFor(undefined);
  assert.match(a, /^9\+[0-9a-f]{8}\+P[0-9a-f]{8}$/, "the version, the config hash, then the principles hash");
  assert.equal(again, a, 'the same text is the same version');
  assert.notEqual(edited, a, 'a changed principle is a new version');
  assert.equal(none, '9', 'no principles, no suffix');
});
