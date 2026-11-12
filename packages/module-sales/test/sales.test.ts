import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { RunOutcome } from '@cyborg/core';
import { findLeaks } from '@cyborg/store-sqlite';
import { officeAnswersSection, renderHandoffCard } from '../src/index.ts';
import { buyerIntakeConfig, message, rig, tourDeskConfig } from './helpers.ts';

// Customer messages below are copied from wazaa's own test chats (~/Projects/cyborg/wazaa/tests/*.test.ts):
//   'how much is the east tour' (store/lessons tests), 'can we go to porto santo in the tour?',
//   'gostava de fazer um passeio', 'i changed my mind i wanna do a tour', 'is it good for kids?'.
const HOW_MUCH = 'how much is the east tour';
const PORTO_SANTO = 'can we go to porto santo in the tour?';
const PASSEIO = 'gostava de fazer um passeio';

const proposalOf = (outcomes: RunOutcome[], index: number) => {
  const o = outcomes[index]!;
  assert.equal(o.outcome, 'proposal', JSON.stringify(o));
  return (o as Extract<RunOutcome, { outcome: 'proposal' }>).proposal;
};
const REPLY = 'sales.enquiry.reply_draft';
const draftOutcome = async (env: ReturnType<typeof rig>, text: string, draft: string) => {
  env.model.calls.length = 0;
  const outcomes = await env.runner.handle(message(text));
  return outcomes.find((o) => o.handlerId === REPLY)!;
};

test('the module loads with its manifest, all five handlers and the wazaa-shaped config', () => {
  const env = rig();
  assert.deepEqual(env.report.refused, []);
  assert.deepEqual(env.report.loaded[0]!.handlerIds, ['sales.enquiry.intake', 'sales.enquiry.reply_draft', 'sales.enquiry.qualify', 'sales.followup.draft', 'sales.handoff.card']);
});

// M6-EC1
test('SAL-1 / M6-EC1: a real chat message becomes a proposal of changes with source phrases that occur in it', async () => {
  const env = rig({ enabledHandlers: ['sales.enquiry.intake'], script: [JSON.stringify({ items: [{ field: 'tour', value: 'East Tour', sourcePhrase: 'east tour' }] })] });
  const sender = 'sender-+351 912 000 111-ident';
  const outcomes = await env.runner.handle(message(HOW_MUCH, 'm1', sender));
  const proposal = proposalOf(outcomes, 0);
  assert.equal(proposal.status, 'proposed');
  assert.deepEqual(proposal.changes, [{ field: 'tour', oldValue: null, newValue: 'East Tour', sourcePhrase: 'east tour' }]);
  assert.deepEqual(proposal.questions, ['date', 'party_size', 'language', 'constraints'].map((f) => `Not stated in the message: ${f}`));
  assert.match(proposal.subject, /^vault:[0-9a-f]{12}$/, 'identity arrives as a vault code (SAL-1)');
  assert.equal(env.vault.get(proposal.subject)?.value, sender);
  assert.deepEqual(findLeaks(env.store, [sender]), []);
  assert.ok(env.model.calls[0]!.prompt.includes(`Message:\n${HOW_MUCH}`));
  assert.ok(!env.model.calls[0]!.prompt.includes(sender));
});

test('SAL-1: a source phrase that is not in the message makes the output invalid (HDL-6)', async () => {
  const wrong = JSON.stringify({ items: [{ field: 'tour', value: 'West Tour', sourcePhrase: 'west tour' }] });
  const env = rig({ enabledHandlers: ['sales.enquiry.intake'], script: [wrong, wrong] });
  const proposal = proposalOf(await env.runner.handle(message(HOW_MUCH)), 0);
  assert.equal(proposal.status, 'invalid_output');
  assert.match(proposal.reason ?? '', /sourcePhrase/);
});

test('SAL-1: a field outside the configured list, or given twice, is invalid; a message with nothing in it yields no proposal', async () => {
  const unknownField = JSON.stringify({ items: [{ field: 'price', value: '35', sourcePhrase: 'east tour' }] });
  const twice = JSON.stringify({ items: [{ field: 'tour', value: 'a', sourcePhrase: 'east' }, { field: 'tour', value: 'b', sourcePhrase: 'tour' }] });
  const env = rig({ enabledHandlers: ['sales.enquiry.intake'], script: [unknownField, unknownField, twice, twice, JSON.stringify({ items: [] })] });
  assert.equal(proposalOf(await env.runner.handle(message(HOW_MUCH)), 0).status, 'invalid_output');
  assert.equal(proposalOf(await env.runner.handle(message(HOW_MUCH)), 0).status, 'invalid_output');
  const none = (await env.runner.handle(message(PASSEIO)))[0]!;
  assert.deepEqual(none, { handlerId: 'sales.enquiry.intake', outcome: 'none', reason: 'the message answers none of the enquiry fields' });
});

test('PRV-6: a message with a phone number reaches the model with a placeholder, never the number, and the task is still read', async () => {
  const env = rig({ enabledHandlers: ['sales.enquiry.intake'], script: [JSON.stringify({ items: [{ field: 'tour', value: 'East Tour', sourcePhrase: 'the east tour' }] })] });
  const proposal = proposalOf(await env.runner.handle(message('call me on +351 912 345 678 about the east tour')), 0);
  assert.equal(proposal.status, 'proposed');
  assert.notEqual(proposal.reason, 'manual_handling: scrubber hit');
  assert.equal(env.model.calls.length, 1);
  assert.ok(!env.model.calls[0]!.prompt.includes('912 345') && env.model.calls[0]!.prompt.includes('call me on [PHONE_1] about the east tour'));
  assert.deepEqual(proposal.changes.map((c) => c.field), ['tour']);
  assert.match(proposal.findings.map((f) => f.statement).join('|'), /in the chat: a phone number/);
});

test('PRV-6: a draft that repeats a placeholder is flagged so nobody sends "[PHONE_1]" to a customer', async () => {
  const env = rig({ enabledHandlers: [REPLY], script: [JSON.stringify({ draft: 'Thank you, a colleague will call you on [PHONE_1].' })] });
  const proposal = proposalOf(await env.runner.handle(message(`${HOW_MUCH}. Call me on +351 912 345 678`)), 0);
  const findings = proposal.findings.map((f) => f.statement).join('|');
  assert.match(findings, /the reply contains \[PHONE_1\]: those stand for details the customer wrote/);
  assert.match(findings, /in the chat: a phone number/);
});

// M6-EC2
test('SAL-2 / M6-EC2: a draft whose statements match the profile is offered as a draft', async () => {
  const env = rig({ enabledHandlers: [REPLY], script: [JSON.stringify({ draft: 'The East Tour is €35 per person and runs on Monday. A colleague will confirm details.' })] });
  const proposal = proposalOf(await env.runner.handle(message(HOW_MUCH)), 0);
  assert.equal(proposal.status, 'proposed');
  assert.match(proposal.draft ?? '', /€35/);
  assert.deepEqual(proposal.questions, []);
  const prompt = env.model.calls[0]!.prompt;
  assert.match(prompt, /You are the receptionist for Demo Tours\. You write the replies\. Tone: warm, relaxed and easygoing/);
  assert.match(prompt, /"price":35/);
});

test('SAL-2 / M6-EC2: a wrong price, capacity, weekday or date blocks the draft and raises a question instead', async () => {
  const cases: [string, RegExp][] = [
    ['The East Tour is €40 per person.', /price 40 is not a price/],
    ['It costs 38 euros each.', /price 38 is not a price/],
    ['We can take 100 people on that day.', /capacity 100 is more than offer.items allows \(80\)/],
    ['It runs every Tuesday.', /weekday 2 is not in offer.availability.days/],
    ['Domingo works for us.', /weekday 0 is not in/],
    ['Join us on 2026-11-05.', /2026-11-05 falls on weekday 4/],
    ['We are open 2026-12-25.', /closed date \(12-25\)/],
  ];
  for (const [draft, pattern] of cases) {
    const env = rig({ enabledHandlers: [REPLY], script: [JSON.stringify({ draft })] });
    const outcome = await draftOutcome(env, HOW_MUCH, draft);
    const proposal = proposalOf([outcome], 0);
    assert.equal(proposal.status, 'proposed', draft);
    assert.equal(proposal.draft, undefined, `no draft is offered: ${draft}`);
    assert.ok(proposal.findings.some((f) => pattern.test(f.statement)), `${draft}: ${JSON.stringify(proposal.findings)}`);
    assert.equal(proposal.questions.length, 1);
  }
});

test('SAL-2: the adapter can add its own draft checks', async () => {
  const extra = { ...tourDeskConfig, extraDraftChecks: [(draft: string) => (draft.includes('Porto Santo') ? ['Porto Santo is not part of any tour'] : [])] };
  const env = rig({ enabledHandlers: [REPLY], config: extra, script: [JSON.stringify({ draft: 'Yes, we go to Porto Santo.' })] });
  const proposal = proposalOf(await env.runner.handle(message(PORTO_SANTO)), 0);
  assert.equal(proposal.draft, undefined);
  assert.match(proposal.findings[0]!.statement, /Porto Santo is not part of any tour/);
});

test('SAL-2: a reply is refused while its facts are not confirmed in live mode, and allowed in shadow', async () => {
  const live = rig({ enabledHandlers: [REPLY], mode: 'live' });
  // unconfirm by replacing a value: the replaced fact returns to `unconfirmed` (PRF-55)
  live.store.putFact({ key: 'tone.style', value: 'formal', class: 'public', source: 'client_statement', sourceRef: 'test:fixture' }, 'seed', '2026-10-31T11:00:00.000Z');
  assert.equal((await live.runner.handle(message(HOW_MUCH)))[0]!.outcome, 'refused');
  assert.equal(live.model.calls.length, 0);

  const shadow = rig({ enabledHandlers: [REPLY], mode: 'shadow', script: [JSON.stringify({ draft: 'A colleague will reply.' })] });
  shadow.store.putFact({ key: 'tone.style', value: 'formal', class: 'public', source: 'client_statement', sourceRef: 'test:fixture' }, 'seed', '2026-10-31T11:00:00.000Z');
  assert.equal((await shadow.runner.handle(message(HOW_MUCH)))[0]!.outcome, 'proposal');
});

// M6-EC3
test('SAL-5 / M6-EC3: a draft that confirms, promises, guarantees or takes payment is blocked', async () => {
  const drafts = [
    'Your booking is confirmed for Monday.',
    "Great, you're all booked!",
    "We've reserved two places for you.",
    'We guarantee a spot.',
    'Payment received, thank you.',
    'A tua reserva confirmada para segunda.',
    'Ficou reservado para si.',
    'Estamos a ver. Garantimos o lugar.',
  ];
  for (const draft of drafts) {
    const env = rig({ enabledHandlers: [REPLY], script: [JSON.stringify({ draft })] });
    const proposal = proposalOf(await env.runner.handle(message(HOW_MUCH)), 0);
    assert.equal(proposal.draft, undefined, draft);
    assert.ok(proposal.findings.some((f) => /commitment/.test(f.statement)), draft);
  }
});

test('SAL-5: the business can add its own commitment phrases', async () => {
  const config = { ...tourDeskConfig, commitmentPhrases: ['best price'] };
  const env = rig({ enabledHandlers: [REPLY], config, script: [JSON.stringify({ draft: 'We always give you the Best Price.' })] });
  const proposal = proposalOf(await env.runner.handle(message(HOW_MUCH)), 0);
  assert.equal(proposal.draft, undefined);
  assert.match(proposal.findings[0]!.statement, /commitment phrase "best price"/);
});

test('HDL-3 / M6-EC3: auto-reply is off unless the adapter enables a named handler, in both places', () => {
  const off = rig();
  for (const h of off.registry.all()) {
    assert.equal(h.effect, 'proposal', h.id);
    assert.equal(h.commitment, false, h.id);
  }
  // The module config asks for auto-reply but the registry (adapter) did not opt in: refused.
  const refused = rig({ config: { ...tourDeskConfig, autoReply: [REPLY] } });
  assert.equal(refused.report.loaded.length, 0);
  assert.ok(refused.report.refused[0]!.unmet.some((u) => /auto_reply is not enabled/.test(u.detail)));
  // Both enable it: only that handler is auto_reply.
  const on = rig({ config: { ...tourDeskConfig, autoReply: [REPLY] }, autoReplyOptIn: [REPLY] });
  assert.deepEqual(on.registry.all().filter((h) => h.effect === 'auto_reply').map((h) => h.id), [REPLY]);
});

test('SAL-5: even with auto-reply on, a commitment never becomes a draft to send', async () => {
  // The live registry here is a stand-in for a handler that already passed the live gate (tested in shadow.test.ts).
  const env = rig({ config: { ...tourDeskConfig, autoReply: [REPLY] }, autoReplyOptIn: [REPLY], enabledHandlers: [REPLY], live: { isEnabled: () => true }, script: [JSON.stringify({ draft: 'Your booking is confirmed.' })] });
  const proposal = proposalOf(await env.runner.handle(message(HOW_MUCH)), 0);
  assert.equal(proposal.draft, undefined);
});

test('SAL-3: qualify gives findings and questions, never a decline', async () => {
  const good = JSON.stringify({
    assessments: [
      { criterion: 'knows_what_they_want', status: 'met', evidence: 'east tour' },
      { criterion: 'has_a_date', status: 'unknown', evidence: '' },
    ],
    missing: ['date'],
    nextQuestion: 'Which day would you like?',
  });
  const env = rig({ enabledHandlers: ['sales.enquiry.qualify'], script: [good] });
  const proposal = proposalOf(await env.runner.handle(message(HOW_MUCH)), 0);
  assert.deepEqual(proposal.findings, [
    { statement: 'criterion "knows_what_they_want": met', evidence: 'east tour' },
    { statement: 'criterion "has_a_date": unknown', evidence: 'not stated in the message' },
  ]);
  assert.deepEqual(proposal.questions, ['Missing: date', 'Which day would you like?']);
  assert.deepEqual(proposal.changes, []);
  // The output schema cannot express a decline.
  const handler = env.registry.get('sales.enquiry.qualify')!;
  assert.equal((handler as { output: { safeParse(v: unknown): { success: boolean } } }).output.safeParse({ assessments: [{ criterion: 'x', status: 'decline', evidence: '' }], missing: [], nextQuestion: null }).success, false);
});

test('SAL-3: evidence must occur in the message and every criterion must be assessed', async () => {
  const badEvidence = JSON.stringify({ assessments: [{ criterion: 'knows_what_they_want', status: 'met', evidence: 'west tour' }, { criterion: 'has_a_date', status: 'unknown', evidence: '' }], missing: [], nextQuestion: null });
  const incomplete = JSON.stringify({ assessments: [{ criterion: 'knows_what_they_want', status: 'unknown', evidence: '' }], missing: [], nextQuestion: null });
  const env = rig({ enabledHandlers: ['sales.enquiry.qualify'], script: [badEvidence, badEvidence, incomplete, incomplete] });
  const a = proposalOf(await env.runner.handle(message(HOW_MUCH)), 0);
  assert.equal(a.status, 'invalid_output');
  assert.match(a.reason ?? '', /evidence for "knows_what_they_want" does not occur/);
  const b = proposalOf(await env.runner.handle(message(HOW_MUCH)), 0);
  assert.match(b.reason ?? '', /criterion "has_a_date" was not assessed/);
});

test('SAL-4: a follow-up is drafted only past the profile-defined interval; the interval is not in the code', async () => {
  const draft = JSON.stringify({ draft: 'Hi again, just checking whether you still want the tour.' });
  const followup = (hours: number) => ({ id: `f-${hours}`, source: 'chat', kind: 'schedule:sales.followup', at: '2026-10-31T10:00:00.000Z', payload: { text: PASSEIO, sender: 'sender-x', hoursSinceContact: hours } });
  const env = rig({ enabledHandlers: ['sales.followup.draft'], script: [draft, draft] });
  const early = (await env.runner.handle(followup(3)))[0]!;
  assert.deepEqual(early, { handlerId: 'sales.followup.draft', outcome: 'none', reason: 'follow-up not due: 3 h since contact, interval is 24 h' });
  const due = proposalOf(await env.runner.handle(followup(30)), 0);
  assert.match(due.draft ?? '', /just checking/);
  assert.ok(env.model.calls[1]!.prompt.includes('no answer for 30 hours'));
  const source = readdirSync(new URL('../src', import.meta.url)).map((f) => readFileSync(join(new URL('../src', import.meta.url).pathname, f), 'utf8')).join('\n');
  assert.ok(!/\b24\b/.test(source), 'no interval number in the module source');
});

// M6-EC4 (machine part)
test('M6-EC4: the module source has no business-specific special case', () => {
  const dir = new URL('../src', import.meta.url).pathname;
  const source = readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
  for (const word of [/wazaa/i, /madrltr/i, /demo tours/i, /madeira/i, /\btours?\b/i, /\bproperty\b/i, /\bbuyer\b/i, /\bmortgage\b/i]) {
    assert.ok(!word.test(source), `module source mentions ${word}`);
  }
});

test('M6-EC4: the same module code takes a different config for a different business', async () => {
  const tour = rig({ enabledHandlers: ['sales.enquiry.intake'], script: [] });
  const buyer = rig({ config: buyerIntakeConfig, enabledHandlers: ['sales.enquiry.intake'], script: [JSON.stringify({ items: [{ field: 'budget', value: '400k', sourcePhrase: 'up to 400k' }] })] });
  const tourHandler = tour.registry.get('sales.enquiry.intake')!;
  const buyerHandler = buyer.registry.get('sales.enquiry.intake')!;
  assert.notEqual(tourHandler.version, buyerHandler.version, 'PRF-24: a different prompt is a different version');
  assert.match(tourHandler.version, /^1\+[0-9a-f]{8}$/);
  const outcome = await buyer.runner.handle(message('I am looking for a flat, up to 400k'));
  assert.deepEqual(proposalOf(outcome, 0).changes.map((c) => c.field), ['budget']);
  assert.match(buyer.model.calls[0]!.prompt, /- property_type: the kind of property wanted/);
  assert.ok(!buyer.model.calls[0]!.prompt.includes('party_size'));
});

// ADM-56
const TRANSCRIPT = [
  'customer: i changed my mind i wanna do a tour',
  'bot: Happy to help. Which tour and which day?',
  'customer: can we go to porto santo in the tour?',
  'bot: A colleague will follow up.',
  'customer: is it good for kids?',
].join('\n');
const handoff = (transcript = TRANSCRIPT, id = 'h1') => ({
  id, source: 'chat', kind: 'handoff.requested', at: '2026-10-31T10:00:00.000Z', payload: { chat: 'chat-ref-1', transcript },
});
const CARD = JSON.stringify({
  wants: [{ note: 'a tour, after changing their mind', sourcePhrase: 'i wanna do a tour' }],
  collected: [{ field: 'constraints', value: 'travelling with kids', sourcePhrase: 'is it good for kids?' }],
  needs: [{ note: 'asked whether Porto Santo is part of the tour', sourcePhrase: 'can we go to porto santo in the tour?' }],
  botSaid: [{ statement: 'a colleague will follow up', sourcePhrase: 'A colleague will follow up.' }],
  open: ['Which tour and which day?'],
});

test('ADM-56: a handoff card carries what the customer wants, needs and was told, each with the words it came from', async () => {
  const env = rig({ enabledHandlers: ['sales.handoff.card'], script: [CARD] });
  const proposal = proposalOf(await env.runner.handle(handoff()), 0);
  assert.equal(proposal.status, 'proposed');
  assert.deepEqual(proposal.changes.map((c) => [c.field, c.newValue]), [['constraints', 'travelling with kids']]);
  assert.deepEqual(proposal.questions, ['Which tour and which day?']);
  assert.deepEqual(proposal.findings.map((f) => f.statement.split(':')[0]), ['wants', 'needs', 'the bot said']);
  assert.match(proposal.subject, /^vault:[0-9a-f]{12}$/, 'the chat reference arrives as a vault code');
  const card = renderHandoffCard(proposal, { chat: 'chat-ref-1', waitingSince: '10:00' });
  assert.match(card, /^Handoff: chat-ref-1 \(waiting since 10:00\)\n─+\nSpec: wants\nState: a tour, after changing their mind\n─+\nSpec: collected\nState: constraints: travelling with kids\n/);
  assert.match(card, /Spec: office to check\nState: Which tour and which day\?$/);
  assert.ok(!card.includes('i wanna do a tour'), 'the staff have the chat, so the quotes stay in the proposal, not on the card');
  assert.match(renderHandoffCard(proposal, { chat: 'chat-ref-1', evidence: true }), /a tour, after changing their mind \("i wanna do a tour"\)/);
  const sparse = renderHandoffCard({ changes: [], findings: [{ statement: 'wants: a price', evidence: 'how much' }], questions: [] }, { chat: 'c' });
  assert.equal(sparse, 'Handoff: c\n────────────────────────────────────────\nSpec: wants\nState: a price', 'a block with nothing in it is left out');
  assert.ok(!card.includes('|'), 'no table');
  assert.ok(env.model.calls[0]!.prompt.includes(`Chat:\n${TRANSCRIPT}`));
});

test('ADM-56: a line whose words are not in the chat, or a number the chat does not hold, makes the card invalid', async () => {
  const invented = JSON.stringify({ ...JSON.parse(CARD), needs: [{ note: 'is allergic to nuts', sourcePhrase: 'allergic to nuts' }] });
  const env = rig({ enabledHandlers: ['sales.handoff.card'], script: [invented, invented] });
  const bad = proposalOf(await env.runner.handle(handoff()), 0);
  assert.equal(bad.status, 'invalid_output');
  assert.match(bad.reason ?? '', /does not occur in the chat/);
  const number = JSON.stringify({ ...JSON.parse(CARD), botSaid: [{ statement: 'a colleague will answer within 2 hours', sourcePhrase: 'A colleague will follow up.' }] });
  const env2 = rig({ enabledHandlers: ['sales.handoff.card'], script: [number, number] });
  const bad2 = proposalOf(await env2.runner.handle(handoff()), 0);
  assert.equal(bad2.status, 'invalid_output');
  assert.match(bad2.reason ?? '', /the number 2 .* is not in the chat/);
});

test('ADM-56: an empty card is no proposal, and a chat holding a phone number still gets its card, built from the text with a placeholder (PRV-6)', async () => {
  const empty = JSON.stringify({ wants: [], collected: [], needs: [], botSaid: [], open: [] });
  const env = rig({ enabledHandlers: ['sales.handoff.card'], script: [empty] });
  assert.equal((await env.runner.handle(handoff()))[0]!.outcome, 'none');
  const env2 = rig({ enabledHandlers: ['sales.handoff.card'], script: [CARD] });
  const withPhone = proposalOf(await env2.runner.handle(handoff(`${TRANSCRIPT}\ncustomer: call me on +351 912 000 111`, 'h2')), 0);
  assert.equal(env2.model.calls.length, 1, 'the model ran');
  assert.ok(!env2.model.calls[0]!.prompt.includes('912 000') && env2.model.calls[0]!.prompt.includes('[PHONE_1]'));
  assert.match(withPhone.findings.map((f) => f.statement).join('|'), /in the chat: a phone number/);
  const { renderHandoffCard } = await import('../src/card.ts');
  assert.match(renderHandoffCard(withPhone, { chat: 'chat-1' }), /in the chat\nState: a phone number|in the chat\n.*: a phone number/);
});

// ADM-57
test('ADM-57: the office-answers section lists chats with an open question until any person replies or says .done', async () => {
  const env = rig({ enabledHandlers: ['sales.handoff.card'], script: [CARD, CARD] });
  const section = officeAnswersSection({ proposals: env.store, vault: env.vault, control: env.store });
  assert.equal(section.heading, 'Waiting on the office');
  assert.deepEqual(section.blocks(), []);

  const chatCode = env.vault.put('identity', 'chat-ref-1');
  const proposal = proposalOf(await env.runner.handle(handoff()), 0);
  assert.equal(proposal.subject, chatCode);
  const [block] = section.blocks();
  assert.match(block!, /^Handoff: chat-ref-1 \(waiting since 2026-10-31T10:00:00.000Z\)/);
  assert.match(block!, /Spec: office to check\nState: Which tour and which day\?/);

  // Any person answering settles it; the role does not matter.
  env.store.recordSettled('chat-ref-1', 'staff-member-2', 'person_replied', '2026-10-31T11:00:00.000Z');
  assert.deepEqual(section.blocks(), []);

  // `.done` settles it too, with the same effect.
  const other = rig({ enabledHandlers: ['sales.handoff.card'], script: [CARD] });
  other.vault.put('identity', 'chat-ref-1');
  await other.runner.handle(handoff());
  const otherSection = officeAnswersSection({ proposals: other.store, vault: other.vault, control: other.store });
  assert.equal(otherSection.blocks().length, 1);
  other.store.recordSettled('chat-ref-1', 'owner', 'done', '2026-10-31T12:00:00.000Z');
  assert.deepEqual(otherSection.blocks(), []);
});

// CMP-32
const firstMessage = (text: string, first?: boolean) => ({ ...message(text, `m-${text.length}-${String(first)}`), payload: { text, sender: 'sender-1', ...(first === undefined ? {} : { first }) } });
const replyOnly = (config: unknown, draft: string) => rig({ config, enabledHandlers: ['sales.enquiry.reply_draft'], script: [JSON.stringify({ draft })] });
const draftOf = async (env: ReturnType<typeof rig>, event: ReturnType<typeof firstMessage>) => proposalOf(await env.runner.handle(event), 0).draft;

test('CMP-32: by default a customer gets no introduction and no notice: the draft is the reply and nothing else', async () => {
  const first = await draftOf(replyOnly(tourDeskConfig, 'A colleague will follow up.'), firstMessage('how much is the east tour', true));
  assert.equal(first, 'A colleague will follow up.');
  const unknown = await draftOf(replyOnly(tourDeskConfig, 'A colleague will follow up.'), firstMessage('how much is the east tour'));
  assert.equal(unknown, 'A colleague will follow up.');
});

test('CMP-32: a business that chooses first_message gets a one-line "automatic reply" introduction on the first message of a chat, added by code; later messages do not', async () => {
  const withName = { ...tourDeskConfig, persona: { name: 'Sofia', disclosure: 'first_message' } };
  const first = await draftOf(replyOnly(withName, 'A colleague will follow up.'), firstMessage('how much is the east tour', true));
  assert.match(first!, /^Hi, I'm Sofia, the automatic reply of .+\.\n\nA colleague will follow up\.$/);
  const later = await draftOf(replyOnly(withName, 'A colleague will follow up.'), firstMessage('is it good for kids?', false));
  assert.equal(later, 'A colleague will follow up.');
  const unnamed = await draftOf(replyOnly({ ...tourDeskConfig, persona: { disclosure: 'first_message' } }, 'A colleague will follow up.'), firstMessage('how much is the east tour', true));
  assert.match(unnamed!, /^Hi, this is the automatic reply of /);
  const unsaid = await draftOf(replyOnly({ ...tourDeskConfig, persona: { disclosure: 'first_message' } }, 'A colleague will follow up.'), firstMessage('how much is the east tour'));
  assert.match(unsaid!, /^Hi, this is the automatic reply of /, 'an adapter that does not say whether a chat is new gets the line');
});

test('CMP-32: testing mode adds the notice to every draft, and both texts can be written in the customers\' language', async () => {
  const testing = { ...tourDeskConfig, persona: { disclosure: 'testing' } };
  assert.match((await draftOf(replyOnly(testing, 'A colleague will follow up.'), firstMessage('how much is the east tour', false)))!, /^A colleague will follow up\.\n\n\(Test mode: this is an automatic reply, and a colleague reviews it\.\)$/);
  const pt = { ...tourDeskConfig, persona: { name: 'Sofia', disclosure: 'testing', intro: 'Olá! Sou a {name}, assistente automática de {business}.', testNotice: '(Em teste: um colega revê as respostas.)' } };
  const out = await draftOf(replyOnly(pt, 'Um colega vai responder.'), firstMessage('x', true));
  assert.match(out!, /^Olá! Sou a Sofia, assistente automática de .+\.\n\nUm colega vai responder\.\n\n\(Em teste: um colega revê as respostas\.\)$/);
});

test('CMP-32: a draft that claims to be a person is blocked in code, in English and Portuguese, and the usual handoff wording passes', async () => {
  for (const claim of ["I'm a real person, don't worry.", "No, I'm not a bot!", 'Sou uma pessoa, claro.', 'Não sou um robô.']) {
    const proposal = proposalOf(await replyOnly(tourDeskConfig, claim).runner.handle(firstMessage('are you a bot?', false)), 0);
    assert.equal(proposal.draft ?? null, null, claim);
    assert.match(proposal.findings.map((f) => f.statement).join(), /claims to be a person/, claim);
  }
  const ok = await draftOf(replyOnly(tourDeskConfig, "Good question. I'll pass this to the office and they'll come back to you."), firstMessage('x', false));
  assert.equal(ok, "Good question. I'll pass this to the office and they'll come back to you.");
});

test('CMP-32: the reply prompt asks for a natural voice and an honest answer to "are you a bot", and says to hand off like a person would', async () => {
  const env = replyOnly(tourDeskConfig, 'A colleague will follow up.');
  await env.runner.handle(firstMessage('are you a bot?', false));
  const prompt = env.model.calls[0]!.prompt;
  assert.match(prompt, /never say or imply that you are a person/);
  assert.match(prompt, /Do not introduce yourself or say what you are unless asked/);
  assert.match(prompt, /when the FAQ has an answer to that question, give that answer; otherwise answer truthfully in one short plain sentence: this is the business's automatic reply system/);
  assert.ok(!/assistant/i.test(prompt), 'the model is never told it is an assistant');
  assert.match(prompt, /pass it to the office and they will come back to the customer/);
});


// ADM-74..76
test('ADM-75: a reply in another language than the customer\'s goes to the low band; a clear match is recorded; an unclear case adds no signal', async () => {
  const english = 'Bom dia, do you have a tour tomorrow? We are two people and would like to book';
  const wrong = await replyOnly(tourDeskConfig, 'Bom dia! Temos passeios amanhã e o preço é de 35 por pessoa. Quantas pessoas são?').runner.handle(firstMessage(english, false));
  const bad = proposalOf(wrong, 0);
  assert.equal(bad.confidence!.band, 'low');
  assert.match(bad.confidence!.signals.find((s) => s.kind === 'language')!.detail ?? '', /the customer wrote en, the draft is in pt/);
  const right = proposalOf(await replyOnly(tourDeskConfig, 'Yes, we run a tour tomorrow and the price is 35 per person. How many people are you?').runner.handle(firstMessage(english, false)), 0);
  assert.deepEqual(right.confidence!.signals.find((s) => s.kind === 'language')!.passed, true);
  const unclear = proposalOf(await replyOnly(tourDeskConfig, 'A colleague will follow up.').runner.handle(firstMessage('ok', false)), 0);
  assert.equal(unclear.confidence!.signals.some((s) => s.kind === 'language'), false);
});

test('ADM-76: the introduction follows the language of the reply: Portuguese for a Portuguese message, English for a tourist, the default when unclear', async () => {
  const intro = { ...tourDeskConfig, persona: { disclosure: 'first_message' } };
  const pt = await draftOf(replyOnly(intro, 'Bom dia! Temos passeios amanhã. Quantas pessoas são?'), firstMessage('Gostava de saber quanto custa o passeio de amanhã', true));
  assert.match(pt!, /^Olá, esta é a resposta automática de .+\.\n\nBom dia!/);
  const en = await draftOf(replyOnly(intro, 'Hello! We run a tour tomorrow. How many people are you?'), firstMessage('Bom dia, do you have a tour tomorrow? We are two people and would like to book', true));
  assert.match(en!, /^Hi, this is the automatic reply of .+\./);
  const unclear = await draftOf(replyOnly(intro, 'Ok.'), firstMessage('ok', true));
  assert.match(unclear!, /^Olá, esta é a resposta automática de /, 'Portuguese is the default');
  const named = await draftOf(replyOnly({ ...intro, persona: { name: 'Sofia', disclosure: 'first_message' } }, 'Obrigada, até já.'), firstMessage('Gostava de saber quanto custa o passeio de amanhã', true));
  assert.match(named!, /^Olá, sou Sofia, a resposta automática de /);
  const custom = await draftOf(replyOnly({ ...intro, defaultLanguage: 'en', persona: { disclosure: 'first_message', intro: { de: 'Hallo, ich bin der virtuelle Assistent von {business}.' } } }, 'Guten Tag! Wir haben morgen eine Tour. Wie viele Personen sind Sie?'), firstMessage('Guten Tag, wie viel kostet die Tour morgen? Wir sind drei Personen', true));
  assert.match(custom!, /^Hallo, ich bin der virtuelle Assistent von /);
});

test('ADM-74: the reply prompt says to follow the customer\'s language, to judge a mixed message by its question, and names the default', async () => {
  const env = replyOnly({ ...tourDeskConfig, defaultLanguage: 'pt' }, 'Ok.');
  await env.runner.handle(firstMessage('Bom dia, do you have a tour tomorrow?', false));
  assert.match(env.model.calls[0]!.prompt, /Reply in the language of the customer's message, whatever it is\. If a message mixes languages, for example a greeting in one and the question in another, reply in the language of the question, not the greeting\. If you cannot tell, reply in Portuguese\./);
});
