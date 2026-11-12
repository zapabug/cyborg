import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MorningSection } from '@cyborg/core';
import { renderMorningSheet } from '../src/index.ts';
import { CUSTOMER_CHAT, clock, gateRig } from './helpers.ts';

const section = (heading: string, blocks: string[]): MorningSection => ({ heading, blocks: () => blocks });
const now = () => new Date('2026-11-01T09:00:00.000Z');

test('ADM-57, ADM-59: the sheet is the head with the counts, then each section\'s blocks split by rules, in the order given', () => {
  const { store } = gateRig();
  const sheet = renderMorningSheet({
    sections: [section('Waiting on the office', ['Handoff: a\nSpec: wants\nState: x']), section('Review complaints', ['Complaint: s:1\nSpec: complaints\nState: y'])],
    control: store,
    now,
  });
  assert.equal(
    sheet,
    'Morning: 2026-11-01 · Waiting on the office: 1 · Review complaints: 1 · Waiting for a person: 0\n' +
      '────────────────────────────────────────\n' +
      'Handoff: a\nSpec: wants\nState: x\n────────────────────────────────────────\nComplaint: s:1\nSpec: complaints\nState: y',
  );
});

test('ADM-57: customers still waiting for a person come last, and a chat an earlier section already shows is not listed twice', () => {
  const { store } = gateRig();
  store.openWaiting(CUSTOMER_CHAT, clock.now.toISOString());
  store.openWaiting('chat-2', clock.now.toISOString());
  const sheet = renderMorningSheet({ sections: [section('Waiting on the office', [`Handoff: ${CUSTOMER_CHAT}\nSpec: wants\nState: x`])], control: store, now });
  assert.match(sheet, /Waiting on the office: 1 · Waiting for a person: 1\n/);
  assert.match(sheet, /Spec: chat-2 \(waiting for a person\)\nState: since 2026-10-31T10:00:00.000Z/);
  assert.equal(sheet.split(CUSTOMER_CHAT).length - 1, 1);
});

test('ADM-57: with nothing open the sheet says so', () => {
  const { store } = gateRig();
  assert.match(renderMorningSheet({ sections: [section('Review complaints', [])], control: store, now }), /^Morning: 2026-11-01 · Review complaints: 0 · Waiting for a person: 0\n─+\nNothing is pending\.$/);
});
