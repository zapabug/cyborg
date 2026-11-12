import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { CapabilityResult } from '@cyborg/core';
import { ScriptedModel } from '@cyborg/core/testing';
import { checkCompanyConfig, describeWording, estimateModelCalls, fileFactSource, scaffoldCustomer, defaultCustomerFolder, FIXED_TEXTS, loadCompanyConfig, toastFor, renderSimulation, runSimulation, validateScript, createCompany, seedProfile, type CompanyModelFile } from '../src/index.ts';

const AT = '2026-11-02T09:00:00.000Z';
const capability: CapabilityResult = { baseUrl: 'http://127.0.0.1:1/v1', model: 'm', level: 'strict_schema', requestShape: 'json_schema_wrapped', logprobs: false, testedAt: AT, attempts: [] };

const baseConfig = (over: Record<string, unknown> = {}) => ({
  language: 'en', // the product default is Portuguese (ADM-77); most checks below read English
  id: 'sim-desk',
  name: 'Simulated desk',
  store: { path: 'store.sqlite', vaultPath: 'vault.sqlite' },
  inference: { baseUrl: 'http://127.0.0.1:1/v1', model: 'm' },
  limits: { maxModelCallsPer24h: 50 },
  chat: { authorisedSenders: ['owner-ref'], originChannel: 'origin', roles: { 'chat-1': 'reply', 'ops-1': 'ops' } },
  modules: {
    sales: {
      enquiryFields: [{ name: 'tour', description: 'which tour or activity the customer asks about' }, { name: 'date', description: 'the day they want' }],
    },
    enabledHandlers: { sales: ['sales.enquiry.intake', 'sales.enquiry.reply_draft', 'sales.handoff.card'] },
  },
  ...over,
});

function inTemp<T>(config: unknown, work: (file: string, dir: string) => Promise<T> | T): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'cyborg-company-'));
  const file = join(dir, 'company.config.json');
  writeFileSync(file, JSON.stringify(config));
  return Promise.resolve(work(file, dir)).finally(() => rmSync(dir, { recursive: true }));
}

// CMP-1..6
test('CMP-1, CMP-2: a config file loads with defaults, resolves paths against its own folder, and refuses a key written into it', async () => {
  await inTemp(baseConfig(), (file, dir) => {
    const loaded = loadCompanyConfig(file);
    assert.equal(loaded.config.mode, 'shadow', 'shadow is the default');
    assert.equal(loaded.config.chat.commandPrefix, '.');
    assert.equal(loaded.paths.store, join(dir, 'store.sqlite'));
  });
  await inTemp(baseConfig({ inference: { baseUrl: 'https://x.example/v1', model: 'm', apiKeyEnv: 'sk-or-v1-abcdefghijklmnop' } }), (file) => {
    assert.throws(() => loadCompanyConfig(file), /looks like an API key/);
  });
  await inTemp(baseConfig({ inference: { baseUrl: 'https://x.example/v1', model: 'm', apiKeyEnv: 'my key' } }), (file) => {
    assert.throws(() => loadCompanyConfig(file), /the NAME of an environment variable/);
  });
});

test('CMP-4, CMP-5: a live install needs a call cap and someone who can give commands; shadow only warns', async () => {
  await inTemp(baseConfig({ mode: 'live', limits: {}, chat: { roles: {} } }), (file) => {
    const { errors } = checkCompanyConfig(loadCompanyConfig(file).config, {});
    assert.deepEqual(errors.map((e) => e.split(':')[0]), ['limits.maxModelCallsPer24h', 'chat.authorisedSenders']);
  });
  await inTemp(baseConfig({ limits: {}, chat: { roles: {} } }), (file) => {
    const check = checkCompanyConfig(loadCompanyConfig(file).config, {});
    assert.deepEqual(check.errors, []);
    assert.ok(check.warnings.some((w) => w.startsWith('limits.maxModelCallsPer24h')));
    assert.ok(check.warnings.some((w) => w.startsWith('chat.originChannel')));
  });
});

test('CMP-3, CMP-6: a different model per handler is allowed; prices missing for a used model is a warning, not an error', async () => {
  await inTemp(baseConfig({ inference: { baseUrl: 'http://127.0.0.1:1/v1', model: 'chat-model', handlers: { 'sales.handoff.card': { model: 'thinking-model' } } }, prices: { 'chat-model': { inputPerMillion: 1, outputPerMillion: 2, currency: 'EUR' } } }), (file) => {
    const check = checkCompanyConfig(loadCompanyConfig(file).config, {});
    assert.deepEqual(check.errors, []);
    assert.ok(check.warnings.some((w) => w.includes('"thinking-model"')));
  });
});

// CMP-15..22
const COMPANY: CompanyModelFile = {
  profile: {
    'business.name': 'Simulated desk',
    'tone.style': 'friendly and short',
    'offer.items': [{ name: 'East Tour', price: 35, unit: 'per person', capacity: 8 }],
    'offer.availability': { days: [1, 3, 5], closedDates: [] },
    'rules.commitments': ['never confirm a booking'],
    'faq.entries': [{ q: 'Is it good for kids?', a: 'Yes, from 6 years old.' }],
  },
};
const INTAKE = JSON.stringify({ items: [{ field: 'tour', value: 'East Tour', sourcePhrase: 'east tour' }] });
const DRAFT = JSON.stringify({ draft: 'A colleague will follow up.' });
const CARD = JSON.stringify({
  wants: [{ note: 'the price of the east tour', sourcePhrase: 'how much is the east tour' }],
  collected: [{ field: 'tour', value: 'East Tour', sourcePhrase: 'east tour' }],
  needs: [], botSaid: [], open: ['Which day, and is there room for more people?'],
});

const DAY = {
  start: AT,
  steps: [
    { do: 'customer', chat: 'chat-1', text: 'how much is the east tour' },
    { do: 'admin', text: '.ooo back 09:00 Monday' },
    { do: 'handoff', chat: 'chat-1' },
    { do: 'sheet' },
    { do: 'advance', minutes: 30 },
    { do: 'staff', chat: 'chat-1', text: 'The east tour is 35 per person; Thursday has room.' },
    { do: 'sheet' },
  ],
};

test('CMP-16, CMP-17: a script is validated and the model calls it will make are counted before anything runs', async () => {
  assert.deepEqual(validateScript({ steps: [] }).script, null);
  assert.match(validateScript({ steps: [{ do: 'customer', chat: 'c', text: '<fill in: a real question>' }] }).errors.join(), /fill in/);
  assert.match(validateScript({ steps: [{ do: 'wave', chat: 'c' }] }).errors.join(), /do/);
  const { script } = validateScript(DAY);
  await inTemp(baseConfig(), (file) => {
    const company = createCompany({ ...loadCompanyConfig(file), paths: { store: ':memory:', vault: ':memory:' } }, { ack: { channel: 'a', send: async () => undefined }, review: { channel: 'r', send: async () => undefined } }, { model: new ScriptedModel([]), capabilities: [capability], beforeLoad: (store) => void seedProfile(store, COMPANY, AT) });
    const estimate = estimateModelCalls(script!, company.registry);
    assert.deepEqual(estimate.byStep, [2, 0, 1, 0, 0, 0, 0], 'intake and reply for the customer line, the card for the handoff');
    assert.equal(estimate.calls, 3);
    company.close();
  });
});

test('CMP-18..22: a simulated day runs the gate, the handlers, the toggle, the card, the sheet and a staff answer, and reports each step', async () => {
  await inTemp(baseConfig(), async (file) => {
    const model = new ScriptedModel([INTAKE, DRAFT, CARD]);
    const { script } = validateScript(DAY);
    const report = await runSimulation(loadCompanyConfig(file), script!, { company: COMPANY, deps: { model, capabilities: [capability] } });
    const byN = (n: number) => report.steps[n - 1]!;

    assert.match(byN(1).did, /intake: proposed; reply_draft: proposed/);
    assert.ok(byN(1).sent.some((s) => s.channel === 'sim-review' && s.message.text.startsWith('[shadow sales.enquiry.reply_draft')), 'shadow output goes to the review sink only');
    assert.match(byN(2).did, /command ooo/);
    assert.equal(byN(3).did, 'card built and sent to the ops chat');
    assert.ok(byN(3).sent.some((s) => s.channel === 'sim-ops' && s.message.text.includes('Handoff: chat-1')));
    assert.match(report.sheets[0]!.text, /Waiting on the office: 1/);
    assert.match(report.sheets[0]!.text, /Which day, and is there room for more people\?/);
    assert.match(byN(5).did, /clock moved on 30 min/);
    assert.match(byN(6).did, /staff-1 answered in chat-1 \(recorded against/);
    assert.match(report.sheets[1]!.text, /Nothing is pending\./, 'a person answering settles it');
    assert.equal(report.alerts.length, 0);
    assert.equal(report.usage.totals.calls, 3);
    assert.ok(report.steps.every((s) => s.problems.length === 0), JSON.stringify(report.steps.map((s) => s.problems)));

    const text = renderSimulation(report);
    assert.match(text, /^Simulation: sim-desk \(shadow\) · 7 steps · 0 problems/);
    assert.match(text, /Spec: 1\. 09:00 customer chat-1: how much is the east tour/);
    assert.ok(!text.includes('|'), 'no table');
  });
});

test('CMP-20: a refused or invalid model result shows up as a PROBLEM on its step, and a customer from a chat with no role is ignored by the gate', async () => {
  await inTemp(baseConfig(), async (file) => {
    const { script } = validateScript({ start: AT, steps: [{ do: 'customer', chat: 'chat-1', text: 'how much is the east tour' }, { do: 'customer', chat: 'unknown-chat', text: 'hello' }] });
    const bad = JSON.stringify({ items: [{ field: 'tour', value: 'West Tour', sourcePhrase: 'west tour' }] });
    const report = await runSimulation(loadCompanyConfig(file), script!, { company: COMPANY, deps: { model: new ScriptedModel([bad, bad, DRAFT]), capabilities: [capability] } });
    assert.match(report.steps[0]!.problems.join(), /intake: invalid output: .*sourcePhrase/);
    assert.equal(report.steps[1]!.did, 'gate: ignore (chat role is ignored)');
  });
});

test('GWY-31, CMP-20: a company with a small call cap refuses the calls past it and the report shows the open alert', async () => {
  await inTemp(baseConfig({ limits: { maxModelCallsPer24h: 1 } }), async (file) => {
    const { script } = validateScript({ start: AT, steps: [{ do: 'customer', chat: 'chat-1', text: 'how much is the east tour' }] });
    const report = await runSimulation(loadCompanyConfig(file), script!, { company: COMPANY, deps: { model: new ScriptedModel([INTAKE, DRAFT]), capabilities: [capability] } });
    assert.match(report.steps[0]!.problems.join(), /reply_draft: refused: the limit of 1 model calls in 24 hours is used/);
    assert.deepEqual(report.alerts.map((a) => a.kind), ['call_cap']);
    assert.ok(report.steps[0]!.sent.some((s) => s.channel === 'sim-ops' && s.message.text.startsWith('[NEEDS ATTENTION]')), 'the ops chat is told');
  });
});

// CMP-23..25: how modules work together
const COMPLAINT_TEXT = 'Lovely guide but the pickup was 40 minutes late and nobody told us.';
const COMPLAINTS = JSON.stringify({ complaints: [{ topic: 'late pickup', sourcePhrase: 'the pickup was 40 minutes late' }] });

test('CMP-23: sales, feedback and admin work in one day through events, shared facts and sheet sections, with no module calling another', async () => {
  const both = baseConfig({ modules: { sales: baseConfig().modules.sales, feedback: {}, enabledHandlers: { sales: ['sales.enquiry.intake', 'sales.enquiry.reply_draft', 'sales.handoff.card'] } } });
  await inTemp(both, async (file) => {
    const model = new ScriptedModel([INTAKE, DRAFT, COMPLAINTS, CARD]);
    const { script } = validateScript({
      start: AT,
      steps: [
        { do: 'admin', text: '.ooo back 09:00 Monday' },
        { do: 'customer', chat: 'chat-1', text: 'how much is the east tour' },
        { do: 'review', site: 'site-a', ref: 'r1', text: COMPLAINT_TEXT },
        { do: 'handoff', chat: 'chat-1' },
        { do: 'sheet' },
      ],
    });
    const report = await runSimulation(loadCompanyConfig(file), script!, { company: COMPANY, deps: { model, capabilities: [capability] } });
    assert.ok(report.steps.every((s) => s.problems.length === 0), JSON.stringify(report.steps.map((s) => s.problems)));

    // admin (the toggle) -> sales (the reply prompt carries the presence sentence)
    assert.match(model.calls[1]!.prompt, /Staff: No person is on duty right now\. Staff note: back 09:00 Monday\./);
    // feedback (a review) and sales (a card) both reach the one sheet that admin assembles, in the order the company gave
    const sheet = report.sheets[0]!.text;
    assert.match(sheet, /^Morning: 2026-11-02 · Waiting on the office: 1 · Review complaints: 1 · Waiting for a person: 0\n/);
    assert.ok(sheet.indexOf('Handoff: chat-1') < sheet.indexOf('Complaint: site-a:r1'));
    // admin (the toggle) -> the ops chat: nothing was pushed for the review, and the card went to the ops chat on request
    assert.deepEqual(report.steps[2]!.sent, []);
    assert.equal(report.steps[3]!.sent.length, 1);
  });
});

test('CMP-24: a module never imports another module; only the core and the operations layer know them all', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? (f === 'node_modules' || f === 'dist' ? [] : walk(join(dir, f))) : f.endsWith('.ts') ? [join(dir, f)] : []));
  const offenders: string[] = [];
  // every module package there is, found on disk, so a new one cannot be left out (audit 2026-11-10: the list had 3 of 5)
  const modules = readdirSync(root).filter((d) => d.startsWith('module-'));
  assert.ok(modules.length >= 5, `the module packages were found: ${modules.join(', ')}`);
  for (const pkg of modules) {
    for (const file of walk(join(root, pkg, 'src'))) {
      for (const m of readFileSync(file, 'utf8').matchAll(/from '(@cyborg\/[a-z-]+)'/g)) {
        if (/^@cyborg\/module-/.test(m[1]!)) offenders.push(`${pkg}: ${file.split('/src/')[1]} imports ${m[1]}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('CMP-26: the shipped templates cannot run until they are filled in', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const docs = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', 'docs', 'simulation');
  assert.throws(() => loadCompanyConfig(join(docs, 'company.config.template.json')), /fill in/);
  const day = validateScript(JSON.parse(readFileSync(join(docs, 'day.template.json'), 'utf8')));
  assert.equal(day.script, null);
  assert.match(day.errors.join(), /fill in/);
});

// CMP-27..29: the company's own add-ons feed the model
function withSheet<T>(contents: string | null, mtime: string, work: (path: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'cyborg-addon-'));
  const path = join(dir, 'vehicles.csv');
  if (contents !== null) {
    writeFileSync(path, contents);
    utimesSync(path, new Date(mtime), new Date(mtime));
  }
  return work(path).finally(() => rmSync(dir, { recursive: true }));
}

// A GPS tool's export, as the adapter would receive it. The adapter's derive() keeps the coordinates on the machine.
const GPS_EXPORT = 'vehicle,lat,lon,minutes_late\nV2,32.7001,-16.9002,20\n';
const deriveGps = (contents: string): string | null => {
  const [, row] = contents.trim().split('\n');
  if (!row) return null;
  const [vehicle, , , late] = row.split(',');
  return `Vehicle ${vehicle} is running ${late} minutes behind its schedule.`;
};
const withContext = () => baseConfig({ modules: { sales: { ...baseConfig().modules.sales, contextKeys: ['live.vehicle_status'] }, enabledHandlers: { sales: ['sales.enquiry.intake', 'sales.enquiry.reply_draft'] } } });
const ONE_QUESTION = { start: AT, steps: [{ do: 'customer', chat: 'chat-1', text: 'how much is the east tour' }] };

test('CMP-27, CMP-29: an add-on file becomes a sentence in the reply prompt with the time it was true, and its raw rows never get there', async () => {
  await withSheet(GPS_EXPORT, '2026-11-02T08:50:00.000Z', (path) =>
    inTemp(withContext(), async (file) => {
      const model = new ScriptedModel([INTAKE, DRAFT]);
      const source = fileFactSource({ path, maxAgeMs: 30 * 60_000, derive: deriveGps });
      const { script } = validateScript(ONE_QUESTION);
      const report = await runSimulation(loadCompanyConfig(file), script!, { company: COMPANY, deps: { model, capabilities: [capability], runtimeFacts: { 'live.vehicle_status': source } } });
      assert.deepEqual(report.steps[0]!.problems, []);
      const prompt = model.calls[1]!.prompt;
      assert.match(prompt, /live\.vehicle_status: Vehicle V2 is running 20 minutes behind its schedule\. \(as of 2026-11-02T08:50:00\.000Z\)/);
      assert.ok(!prompt.includes('32.7001') && !prompt.includes('-16.9002'), 'coordinates stay on the machine');
    }),
  );
});

test('CMP-27: data older than the add-on allows blocks the draft instead of answering from it', async () => {
  await withSheet(GPS_EXPORT, '2026-11-02T07:00:00.000Z', (path) =>
    inTemp(withContext(), async (file) => {
      const model = new ScriptedModel([INTAKE, DRAFT]);
      const { script } = validateScript(ONE_QUESTION);
      const report = await runSimulation(loadCompanyConfig(file), script!, { company: COMPANY, deps: { model, capabilities: [capability], runtimeFacts: { 'live.vehicle_status': fileFactSource({ path, maxAgeMs: 30 * 60_000, derive: deriveGps }) } } });
      assert.match(report.steps[0]!.problems.join(), /reply_draft: refused: .*live\.vehicle_status.*stale: the add-on's data is from 2026-11-02T07:00:00\.000Z, older than 30 min/);
      assert.equal(model.calls.length, 1, 'only the intake was asked');
    }),
  );
});

test('CMP-27, CMP-29: no file, or a sentence with personal data in it, blocks the draft with the reason', async () => {
  await withSheet(null, AT, (path) =>
    inTemp(withContext(), async (file) => {
      const { script } = validateScript(ONE_QUESTION);
      const report = await runSimulation(loadCompanyConfig(file), script!, { company: COMPANY, deps: { model: new ScriptedModel([INTAKE]), capabilities: [capability], runtimeFacts: { 'live.vehicle_status': fileFactSource({ path, maxAgeMs: 60_000, derive: deriveGps }) } } });
      assert.match(report.steps[0]!.problems.join(), /the add-on has no data right now/);
    }),
  );
  await withSheet(GPS_EXPORT, '2026-11-02T08:55:00.000Z', (path) =>
    inTemp(withContext(), async (file) => {
      const { script } = validateScript(ONE_QUESTION);
      const leaky = fileFactSource({ path, maxAgeMs: 30 * 60_000, derive: () => 'Driver can be reached on +351 912 000 111.' });
      const report = await runSimulation(loadCompanyConfig(file), script!, { company: COMPANY, deps: { model: new ScriptedModel([INTAKE]), capabilities: [capability], runtimeFacts: { 'live.vehicle_status': leaky } } });
      assert.match(report.steps[0]!.problems.join(), /the add-on failed: the derived sentence contains personal data \(.*\)/);
      const long = fileFactSource({ path, maxAgeMs: 30 * 60_000, derive: () => 'x'.repeat(601) });
      assert.throws(() => long.read(new Date(AT)), /601 characters; the limit is 600/);
    }),
  );
});

test('CMP-28: only live.* keys may be named as context, and a key no add-on supplies stops the draft rather than being skipped', async () => {
  await inTemp(baseConfig({ modules: { sales: { ...baseConfig().modules.sales, contextKeys: ['business.name'] } } }), (file) => {
    assert.throws(() => loadCompanyConfig(file), /a key such as live\.todays_jobs/);
  });
  await inTemp(withContext(), async (file) => {
    const { script } = validateScript(ONE_QUESTION);
    const report = await runSimulation(loadCompanyConfig(file), script!, { company: COMPANY, deps: { model: new ScriptedModel([INTAKE]), capabilities: [capability] } });
    assert.match(report.steps[0]!.problems.join(), /live\.vehicle_status/);
  });
});

test('CMP-27: a runtime fact is marked in the ledger, is not checked by the live gate, and a source for an identity value is refused', async () => {
  const { PackRegistry, ProfileFactProvider } = await import('@cyborg/profile');
  const { SqliteStore } = await import('@cyborg/store-sqlite');
  const store = new SqliteStore(':memory:');
  assert.throws(
    () => new ProfileFactProvider(store, new PackRegistry(), { 'live.x': { class: 'identity', maxAgeMs: null, read: () => null } as never }),
    /must be public or deal/,
  );
  const provider = new ProfileFactProvider(store, new PackRegistry(), { 'live.x': { class: 'deal', maxAgeMs: 60_000, read: (now) => ({ sentence: 'Two seats are left.', asOf: now.toISOString() }) } });
  const resolved = provider.resolve({ profileKeys: ['live.x'], packFacts: [], mode: 'live', now: new Date(AT) });
  assert.ok(resolved.ok);
  assert.deepEqual((resolved as { facts: { profile: unknown[] } }).facts.profile, [{ key: 'live.x', value: `Two seats are left. (as of ${AT})`, class: 'deal', status: 'confirmed', runtime: true, asOf: AT }]);
});

// ADM-60..64 in the operations layer
const WITH_OFFICE = () => baseConfig({
  office: { timezone: 'Atlantic/Madeira', hours: { mon: ['09:00-18:00'], tue: ['09:00-18:00'] }, closedDates: [] },
});

test('ADM-62, ADM-64: out of hours the bot is told nobody is in, still does its job, and puts a card in the ops chat; in hours it does not', async () => {
  await inTemp(WITH_OFFICE(), async (file) => {
    const model = new ScriptedModel([INTAKE, DRAFT, CARD, INTAKE, DRAFT]);
    const { script } = validateScript({
      start: '2026-11-02T19:00:00.000Z', // Monday evening, closed
      steps: [
        { do: 'customer', chat: 'chat-1', text: 'how much is the east tour' },
        { do: 'advance', minutes: 14 * 60 }, // Tuesday 09:00
        { do: 'customer', chat: 'chat-1', text: 'how much is the east tour' },
      ],
    });
    const report = await runSimulation(loadCompanyConfig(file), script!, { company: COMPANY, deps: { model, capabilities: [capability] } });
    assert.ok(report.steps.every((s) => s.problems.length === 0), JSON.stringify(report.steps.map((s) => s.problems)));
    assert.match(model.calls[1]!.prompt, /Staff: No person is on duty right now\. Staff note: back Tuesday 09:00\./);
    assert.match(report.steps[0]!.did, /office closed: card sent to the ops chat/);
    assert.ok(report.steps[0]!.sent.some((s) => s.channel === 'sim-ops' && s.message.text.startsWith('Handoff: chat-1')));
    assert.match(model.calls[4]!.prompt, /Staff: A person is on duty and watching this chat\./);
    assert.ok(!report.steps[2]!.did.includes('card'), 'in hours there is no card');
    assert.equal(model.calls.length, 5);
  });
});

test('ADM-64: cards outside hours can be switched off, and a bad schedule is an error in the config check', async () => {
  await inTemp({ ...WITH_OFFICE(), office: { timezone: 'Atlantic/Madeira', hours: { mon: ['09:00-18:00'] }, closedDates: [], cardsOutsideHours: false } }, async (file) => {
    const model = new ScriptedModel([INTAKE, DRAFT]);
    const { script } = validateScript({ start: '2026-11-02T19:00:00.000Z', steps: [{ do: 'customer', chat: 'chat-1', text: 'how much is the east tour' }] });
    const report = await runSimulation(loadCompanyConfig(file), script!, { company: COMPANY, deps: { model, capabilities: [capability] } });
    assert.ok(!report.steps[0]!.did.includes('card'));
    assert.equal(model.calls.length, 2);
  });
  await inTemp({ ...WITH_OFFICE(), office: { timezone: 'Mars/Olympus', hours: { mon: ['9-17'] }, closedDates: [] } }, (file) => {
    const { errors } = checkCompanyConfig(loadCompanyConfig(file).config, {});
    assert.equal(errors.filter((e) => e.startsWith('office:')).length, 2);
  });
});

test('ADM-64: the ops chat gets one card per chat for a closed period; later messages refresh the stored card for the morning sheet without another message', async () => {
  await inTemp(WITH_OFFICE(), async (file) => {
    const CARD2 = JSON.stringify({ wants: [{ note: 'the price of the east tour, then the date', sourcePhrase: 'how much is the east tour' }], collected: [], needs: [], botSaid: [], open: ['Is Thursday free for 6?'] });
    const model = new ScriptedModel([INTAKE, DRAFT, CARD, INTAKE, DRAFT, CARD2]);
    const { script } = validateScript({
      start: '2026-11-02T19:00:00.000Z',
      steps: [
        { do: 'customer', chat: 'chat-1', text: 'how much is the east tour' },
        { do: 'customer', chat: 'chat-1', text: 'how much is the east tour' },
        { do: 'sheet' },
      ],
    });
    const report = await runSimulation(loadCompanyConfig(file), script!, { company: COMPANY, deps: { model, capabilities: [capability] } });
    const toOps = report.steps.flatMap((s) => s.sent).filter((m) => m.channel === 'sim-ops');
    assert.equal(toOps.length, 1, 'one card message for the closed period');
    assert.match(report.sheets[0]!.text, /Is Thursday free for 6\?/, 'the sheet carries the refreshed card');
    assert.doesNotMatch(report.sheets[0]!.text, /Which day, and is there room for more people\?/);
  });
});

// ADM-71..73: the people running cyborg can edit what the code says on the company's behalf
const PT_WORDING = {
  onDuty: 'Há uma pessoa de serviço a acompanhar esta conversa.',
  outOfOffice: 'Neste momento não há ninguém de serviço. Os pedidos ficam registados e um colega responde quando regressar.',
  outOfOfficeWithNote: 'Neste momento não há ninguém de serviço ({note}). Os pedidos ficam registados e um colega responde quando regressar.',
};

test('ADM-71: the on-duty sentences the bot is given can be rewritten in the company\'s language, and the schedule still fills in the time', async () => {
  const config = { ...WITH_OFFICE(), wording: PT_WORDING };
  await inTemp(config, async (file) => {
    const model = new ScriptedModel([INTAKE, DRAFT, CARD]);
    const { script } = validateScript({ start: '2026-11-02T19:00:00.000Z', steps: [{ do: 'customer', chat: 'chat-1', text: 'how much is the east tour' }] });
    await runSimulation(loadCompanyConfig(file), script!, { company: COMPANY, deps: { model, capabilities: [capability] } });
    assert.match(model.calls[1]!.prompt, /Staff: Neste momento não há ninguém de serviço \(back Tuesday 09:00\)\. Os pedidos ficam registados/);
  });
});

test('ADM-72: a company can add phrases that count as claiming to be a person, in its customers\' language; the built-in ones stay on', async () => {
  const config = baseConfig({ modules: { sales: { ...baseConfig().modules.sales, humanClaimPhrases: ['sou de carne e osso'] }, enabledHandlers: { sales: ['sales.enquiry.reply_draft'] } } });
  for (const claim of ['Claro, sou de carne e osso!', "I'm a real person."]) {
    await inTemp(config, async (file) => {
      const { script } = validateScript({ start: AT, steps: [{ do: 'customer', chat: 'chat-1', text: 'are you a bot?' }] });
      const report = await runSimulation(loadCompanyConfig(file), script!, { company: COMPANY, deps: { model: new ScriptedModel([JSON.stringify({ draft: claim })]), capabilities: [capability] } });
      assert.match(report.steps[0]!.sent.map((s) => s.message.text).join('\n'), /the drafted reply was blocked: claims to be a person/, claim);
    });
  }
});

test('ADM-71, ADM-72: a customer-facing text that claims to be a person, spans two lines or has no place for the note is reported by the config check', async () => {
  const config = {
    ...WITH_OFFICE(),
    wording: { onDuty: "I'm a real person and I'm watching.", outOfOffice: 'Closed.\nBack soon.', outOfOfficeWithNote: 'Closed, see you soon.' },
    modules: { ...WITH_OFFICE().modules, sales: { ...WITH_OFFICE().modules.sales, persona: { intro: 'Sou de carne e osso, {business}.' }, humanClaimPhrases: ['sou de carne e osso'] } },
  };
  await inTemp(config, (file) => {
    const { errors, warnings } = checkCompanyConfig(loadCompanyConfig(file).config, {});
    assert.deepEqual(errors.filter((e) => /wording|persona/.test(e)).map((e) => e.split(':')[0]), ['wording.onDuty', 'wording.outOfOffice', 'modules.sales.persona.intro']);
    assert.ok(warnings.some((w) => w.startsWith('wording.outOfOfficeWithNote: has no {note}')));
  });
});

test('ADM-73: the wording preview lists each text as it will read, flags one that must change, and names what the config cannot yet change', async () => {
  await inTemp({ ...WITH_OFFICE(), wording: PT_WORDING }, (file) => {
    const lines = describeWording(loadCompanyConfig(file).config);
    const text = lines.map((l) => `${l.where}\n${l.text}`).join('\n');
    assert.match(text, /wording\.onDuty.*\nHá uma pessoa de serviço/);
    assert.match(text, /after "\.ooo at the dentist"\nNeste momento não há ninguém de serviço \(at the dentist\)/);
    assert.match(text, /what the bot hears at 03:00 with no toggle \(from the schedule\)\nNeste momento não há ninguém de serviço \(back /);
    assert.match(text, /persona\.disclosure.*\nnothing: no introduction and no notice/);
    assert.ok(!/persona\.intro/.test(text), 'with no disclosure there is no introduction to preview');
    assert.ok(FIXED_TEXTS.length >= 3);
  });
  await inTemp({ ...WITH_OFFICE(), wording: { onDuty: "I'm a real person." } }, (file) => {
    assert.match(describeWording(loadCompanyConfig(file).config).find((l) => l.where.startsWith('wording.onDuty'))!.text, /MUST CHANGE/);
  });
});


// ADM-77..80: the people who run the business are spoken to in Portuguese unless told otherwise
const PT_DAY = {
  start: '2026-11-02T19:00:00.000Z', // Monday evening: the office is closed
  steps: [
    { do: 'admin', text: '.fora ao dentista' },
    { do: 'customer', chat: 'chat-1', text: 'how much is the east tour' },
    { do: 'sheet' },
    { do: 'admin', text: '.idioma en' },
    { do: 'sheet' },
    { do: 'admin', text: '.voltei' },
    { do: 'admin', text: '.feito chat-1' },
  ],
};

test('ADM-77: with no language set the cards, the sheet and the replies to commands are in Portuguese, and the Portuguese command names work', async () => {
  const { language: _en, ...withoutLanguage } = WITH_OFFICE();
  await inTemp(withoutLanguage, async (file) => {
    assert.equal(loadCompanyConfig(file).config.language, 'pt');
    const model = new ScriptedModel([INTAKE, DRAFT, CARD]);
    const { script } = validateScript(PT_DAY);
    const report = await runSimulation(loadCompanyConfig(file), script!, { company: COMPANY, deps: { model, capabilities: [capability] } });
    assert.ok(report.steps.every((s) => s.problems.length === 0), JSON.stringify(report.steps.map((s) => s.problems)));
    assert.match(report.steps[0]!.did, /command ooo: fora do escritório: ao dentista\. Os clientes à espera não serão avisados à equipa até \.back/);
    const toOps = report.steps[1]!.sent.find((s) => s.channel === 'sim-ops')!.message.text;
    assert.match(toOps, /^Passagem: chat-1\n─+\nAssunto: pedido\nEstado: /);
    assert.match(toOps, /Assunto: recolhido\nEstado: tour: East Tour/);
    assert.match(toOps, /Assunto: o escritório deve verificar\nEstado: Which day, and is there room for more people\?/);
    assert.match(report.sheets[0]!.text, /^Manhã: 2026-11-02 · À espera do escritório: 1 · À espera de uma pessoa: 0\n/);
    assert.match(report.sheets[0]!.text, /Passagem: chat-1 \(à espera desde /);
    // The model still gets the on-duty line, in Portuguese too, with the time the office is back named in Portuguese.
    assert.match(model.calls[1]!.prompt, /Nota da equipa: ao dentista\./);
  });
});

test('ADM-77: .idioma en switches the staff language at once, is audited, and the change survives for the next sentence; .lang with no valid code explains', async () => {
  const { language: _en, ...withoutLanguage } = WITH_OFFICE();
  await inTemp(withoutLanguage, async (file) => {
    const model = new ScriptedModel([INTAKE, DRAFT, CARD]);
    const { script } = validateScript({ ...PT_DAY, steps: [...PT_DAY.steps, { do: 'admin', text: '.lang xx' }, { do: 'admin', text: '.lang pt' }] });
    const report = await runSimulation(loadCompanyConfig(file), script!, { company: COMPANY, deps: { model, capabilities: [capability] } });
    assert.match(report.steps[3]!.did, /command lang: staff language: English/);
    assert.match(report.sheets[1]!.text, /^Morning: 2026-11-02 · Waiting on the office: 1 · Waiting for a person: 0\n/);
    assert.match(report.steps[5]!.did, /back in office\./, 'the next reply is in English too');
    assert.match(report.steps[7]!.did, /usage: lang pt\|en/);
    assert.match(report.steps[8]!.did, /idioma da equipa: português/);
  });
});

test('PRV-6, ADM-110: a customer who writes a phone number is still answered: the model sees a placeholder, the chat stays with the bot, and the draft carries a line that the number is in the chat', async () => {
  await inTemp(BOARD_CONFIG(), async (file) => {
    const model = new ScriptedModel([INTAKE, DRAFT]);
    const sent: { channel: string; text: string }[] = [];
    const sink = (channel: string) => ({ channel, send: async (m: { text: string }) => void sent.push({ channel, text: m.text }) });
    const company = createCompany(loadCompanyConfig(file), { ack: sink('ack'), review: sink('review'), ops: sink('ops') }, { model, capabilities: [capability], beforeLoad: (store) => void seedProfile(store, COMPANY, AT) });
    const r = await company.process({ id: 'e-p1', source: 'chat', kind: 'message.received', at: AT, payload: { chat: 'chat-3', isGroup: false, addressed: true, sender: 'chat-3-customer', text: 'how much is the east tour? call me on +351 912 000 111 please' } });
    assert.equal(r.ran, true);
    assert.equal(model.calls.length, 2, 'the model ran: intake and reply');
    assert.ok(model.calls.every((c) => !c.prompt.includes('912') && c.prompt.includes('[PHONE_1]')), 'the model saw the placeholder, never the number');
    assert.equal(company.store.getChatState('chat-3'), 'bot', 'the chat is not handed to a person');
    assert.ok(!sent.some((s) => s.text.includes('912')), 'the number is never in what staff are sent');
    assert.ok(r.ran && r.outcomes.every((o) => !(o.outcome === 'proposal' && o.proposal.reason === 'manual_handling: scrubber hit')));
    const reply = r.ran ? r.outcomes.flatMap((o) => (o.outcome === 'proposal' && o.handlerId.endsWith('reply_draft') ? [o.proposal] : [])) : [];
    assert.match(reply[0]!.findings.map((f) => f.statement).join('|'), /in the chat: a phone number/);
    assert.ok(!JSON.stringify(company.store.listAudit()).includes('912'), 'the audit keeps the rule and the field, never the number');
    assert.ok(company.store.listAudit().some((a) => a.kind === 'scrub_replaced'));
    company.close();
  });
});

test('ADM-78: alerts and pings are in the staff language: Portuguese by default, English when toggled', async () => {
  const { language: _en, ...withoutLanguage } = WITH_OFFICE();
  await inTemp({ ...withoutLanguage, limits: { maxModelCallsPer24h: 1 } }, async (file) => {
    const { script } = validateScript({ start: AT, steps: [{ do: 'customer', chat: 'chat-1', text: 'how much is the east tour' }] });
    const report = await runSimulation(loadCompanyConfig(file), script!, { company: COMPANY, deps: { model: new ScriptedModel([INTAKE, DRAFT]), capabilities: [capability] } });
    const alert = report.steps[0]!.sent.find((s) => s.channel === 'sim-ops')!.message.text;
    assert.equal(alert, '[PRECISA DE ATENÇÃO] Foi atingido o limite de 1 chamadas ao modelo em 24 horas. O bot não está a responder aos clientes até o número baixar ou o limite ser aumentado.');
    assert.equal(report.alerts[0]!.detail, alert.replace('[PRECISA DE ATENÇÃO] ', ''));
  });
});

// ADM-81..86: the board of chats and the toast
function boardCompany(file: string, script: string[]) {
  const sent: { channel: string; text: string }[] = [];
  const sink = (channel: string) => ({ channel, send: async (m: { text: string }) => void sent.push({ channel, text: m.text }) });
  const company = createCompany(loadCompanyConfig(file), { ack: sink('ack'), review: sink('review'), ops: sink('ops') }, { model: new ScriptedModel(script), capabilities: [capability], beforeLoad: (store) => void seedProfile(store, COMPANY, AT), now: () => new Date(AT) });
  const say = (chat: string, text = 'how much is the east tour', extra: Record<string, unknown> = {}) =>
    company.process({ id: `e-${chat}-${text.length}-${Math.random()}`, source: 'chat', kind: 'message.received', at: AT, payload: { chat, isGroup: false, addressed: true, sender: `${chat}-customer`, text, ...extra } });
  return { company, sent, say };
}
const BOARD_CONFIG = () => baseConfig({ chat: { authorisedSenders: ['owner-ref'], originChannel: 'origin', roles: { 'chat-1': 'reply', 'chat-2': 'reply', 'chat-3': 'reply', 'chat-4': 'reply', 'ops-1': 'ops' } } });

test('ADM-82: the board colours chats by how soon a person is needed, red first, and leaves complete chats off', async () => {
  await inTemp(BOARD_CONFIG(), async (file) => {
    const { company, say } = boardCompany(file, [INTAKE, DRAFT, CARD, INTAKE, DRAFT, INTAKE, DRAFT]);
    // chat-1: a customer writes while a person has the chat, so someone is waiting.
    company.takeOver('chat-1', 'staff-1');
    await say('chat-1', 'I would like to speak to someone please', { contactName: 'Maria Silva' });
    // chat-2: a reply is waiting, then the handoff card holds a question for the office.
    await say('chat-2');
    await company.handoff('chat-2', 'customer: how much is the east tour');
    // chat-3: only a reply waiting for approval.
    await say('chat-3');
    // chat-4: answered by a person.
    await say('chat-4');
    company.personReplied('chat-4', 'staff-2');

    const board = company.board();
    assert.deepEqual(board.map((r) => [r.chat, r.colour, r.reasons]), [
      ['chat-1', 'red', ['waiting']],
      ['chat-2', 'yellow', ['office_to_check', 'draft_pending']],
      ['chat-3', 'green', ['draft_pending']],
    ]);
    assert.equal(board[0]!.name, 'Maria Silva', 'the WhatsApp name as shown, read from the vault');
    assert.equal(board[0]!.state, 'handoff');
    assert.equal(board[1]!.summary, 'the price of the east tour', 'the card\'s one-line summary');
    assert.deepEqual(company.board({ includeComplete: true }).map((r) => [r.chat, r.colour]).filter(([c]) => c === 'chat-4'), [['chat-4', 'none']]);
  });
});

test('ADM-83: the toast has the customer\'s first name and a one-line summary in Portuguese, offers take over and leave to the bot, and a click opens the chat', async () => {
  const { language: _en, ...pt } = BOARD_CONFIG();
  await inTemp(pt, async (file) => {
    const { company, say } = boardCompany(file, []);
    company.takeOver('chat-1', 'staff-1');
    await say('chat-1', 'I would like to speak to someone please', { contactName: 'Maria Silva' });
    const toast = company.toast(company.board()[0]!);
    assert.deepEqual(toast, {
      title: 'Maria Silva',
      body: 'Está à espera de uma pessoa',
      colour: 'red',
      open: '#/chat/chat-1',
      actions: [{ id: 'take_over', label: 'Assumir' }, { id: 'leave_to_bot', label: 'Deixar o bot' }],
    });
    assert.equal(company.vault.get(company.store.getContact('chat-1')!)?.value, 'Maria Silva', 'the full name is in the vault, not in the board');
  });
});

test('ADM-83: a company can hide the name and the summary from the toast, because a screen can be seen by anyone near it', async () => {
  await inTemp({ ...BOARD_CONFIG(), toast: { detail: 'reference_only' } }, async (file) => {
    const { company, say } = boardCompany(file, []);
    company.takeOver('chat-1', 'staff-1');
    await say('chat-1', 'I would like to speak to someone please', { contactName: 'Maria Silva' });
    const toast = company.toast(company.board()[0]!);
    assert.equal(toast.title, 'chat-1');
    assert.equal(toast.body, 'Waiting for a person');
    assert.ok(!JSON.stringify(toast).includes('Maria'), 'reference-only: no name');
  });
});

test('ADM-84: take over stops the bot in the chat; handing back returns it and settles the chat, so it leaves the board', async () => {
  await inTemp(BOARD_CONFIG(), async (file) => {
    const { company, say } = boardCompany(file, [INTAKE, DRAFT]);
    await say('chat-3');
    assert.equal(company.board()[0]!.colour, 'green');
    company.takeOver('chat-3', 'staff-1');
    assert.equal(company.store.getChatState('chat-3'), 'handoff');
    assert.equal((await say('chat-3', 'hello again')).ran, false, 'the bot does not answer a chat a person has taken');
    assert.equal(company.board()[0]!.colour, 'red', 'and the customer who writes is now waiting');
    company.handBack('chat-3', 'staff-1');
    assert.equal(company.store.getChatState('chat-3'), 'bot');
    assert.deepEqual(company.board(), []);
    assert.ok(company.store.listAudit().filter((a) => a.kind === 'chat_state').length >= 2);
  });
});

test('ADM-81: the long toast body is cut, and the long summary of a card is cut in the toast but whole on the board', () => {
  const row = { chat: 'c', name: 'Ana', colour: 'yellow', reasons: ['office_to_check'], summary: 'x'.repeat(300), since: AT, state: 'bot', reply: null } as const;
  const toast = toastFor({ ...row, reasons: [...row.reasons] }, {});
  assert.equal(toast.body.length, 120);
  assert.ok(toast.body.endsWith('…'));
});

// ADM-82 (zapa, 2026-11-01): red is action now, yellow the morning handoff and stale chats, green the bot's clean job awaiting acceptance
function clockedCompany(file: string, script: string[]) {
  const clock = { t: new Date(AT) };
  const sink = (channel: string) => ({ channel, send: async () => undefined });
  const company = createCompany(loadCompanyConfig(file), { ack: sink('ack'), review: sink('review'), ops: sink('ops') }, { model: new ScriptedModel(script), capabilities: [capability], beforeLoad: (store) => void seedProfile(store, COMPANY, AT), now: () => clock.t });
  const say = (chat: string, text = 'how much is the east tour') => company.process({ id: `e-${chat}-${Math.random()}`, source: 'chat', kind: 'message.received', at: clock.t.toISOString(), payload: { chat, isGroup: false, addressed: true, sender: `${chat}-customer`, text } });
  return { company, clock, say };
}
const CARD_NO_QUESTION = JSON.stringify({ wants: [{ note: 'the price of the east tour', sourcePhrase: 'how much is the east tour' }], collected: [], needs: [], botSaid: [], open: [] });

test('ADM-82: green is the bot\'s clean job waiting to be accepted; a reply the bot is not sure of is red, not green', async () => {
  await inTemp(BOARD_CONFIG(), async (file) => {
    const sure = clockedCompany(file, [INTAKE, DRAFT]);
    await sure.say('chat-1');
    const [clean] = sure.company.board();
    assert.deepEqual([clean!.colour, clean!.reasons, clean!.summary], ['green', ['draft_pending'], 'The bot answered without a problem: waiting to be accepted']);
  });
  await inTemp(BOARD_CONFIG(), async (file) => {
    const unsure = clockedCompany(file, [INTAKE, JSON.stringify({ draft: 'The East Tour is 35 per person and pick-up is at 08:30.' })]);
    await unsure.say('chat-1');
    const [row] = unsure.company.board();
    assert.deepEqual([row!.colour, row!.reasons], ['red', ['low_confidence', 'draft_pending']], 'a time the profile does not hold drops the reply to the low band (an untraced number); the clean intake beside it still waits to be accepted');
  });
});

test('ADM-82: yellow is the morning handoff: any handoff card nobody has settled, with or without a question for the office', async () => {
  await inTemp(BOARD_CONFIG(), async (file) => {
    const { company, say } = clockedCompany(file, [INTAKE, DRAFT, CARD_NO_QUESTION]);
    await say('chat-1');
    await company.handoff('chat-1', 'customer: how much is the east tour');
    const [row] = company.board();
    assert.deepEqual([row!.colour, row!.reasons], ['yellow', ['handoff', 'draft_pending']]);
    company.personReplied('chat-1', 'staff-1');
    assert.deepEqual(company.board(), [], 'a person answering settles it');
  });
});

test('ADM-82, N-19: a chat nobody answered for longer than board.staleAfterHours is yellow; with no threshold nothing is stale', async () => {
  await inTemp({ ...BOARD_CONFIG(), board: { staleAfterHours: 24 } }, async (file) => {
    const { company, clock, say } = clockedCompany(file, [INTAKE, DRAFT]);
    await say('chat-1');
    assert.equal(company.board()[0]!.colour, 'green');
    clock.t = new Date(clock.t.getTime() + 23 * 3_600_000);
    assert.equal(company.board()[0]!.colour, 'green', 'not yet');
    clock.t = new Date(clock.t.getTime() + 2 * 3_600_000);
    const [row] = company.board();
    assert.deepEqual([row!.colour, row!.reasons], ['yellow', ['stale', 'draft_pending']]);
    assert.equal(company.attention()[0]!.colour, 'yellow');
    company.personReplied('chat-1', 'staff-1');
    assert.deepEqual(company.board(), []);
  });
  await inTemp(BOARD_CONFIG(), async (file) => {
    const { company, clock, say } = clockedCompany(file, [INTAKE, DRAFT]);
    await say('chat-1');
    clock.t = new Date(clock.t.getTime() + 30 * 24 * 3_600_000);
    assert.equal(company.board()[0]!.colour, 'green');
    assert.ok(checkCompanyConfig(loadCompanyConfig(file).config, {}).warnings.some((w) => w.startsWith('board.staleAfterHours')));
  });
});


// ADM-96..99: green is the evidence for what might be automated
const manyChats = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`c-${i}`, 'reply']));
const RECORD_CONFIG = (extra: Record<string, unknown> = {}) => baseConfig({ chat: { authorisedSenders: ['owner-ref'], originChannel: 'origin', roles: { ...manyChats(12), 'ops-1': 'ops' } }, ...extra });
const tenReplies = (n: number) => Array.from({ length: n }, () => [INTAKE, DRAFT]).flat();

test('ADM-96: a kind of reply is flagged when at least 9 of the last 10 a person judged were right; counts, never a score', async () => {
  await inTemp(RECORD_CONFIG(), async (file) => {
    const { company, say } = boardCompany(file, tenReplies(12));
    for (let i = 0; i < 10; i++) await say(`c-${i}`);
    const replies = company.auditQueue().filter((r) => r.handlerId === 'sales.enquiry.reply_draft');
    assert.equal(replies.length, 10);
    assert.deepEqual(company.trackRecords(), [], 'nothing judged yet: no record');
    replies.slice(0, 8).forEach((r) => company.mark(r.id, 'match', 'staff-1'));
    company.mark(replies[8]!.id, 'different_but_fine', 'staff-1');
    assert.deepEqual(company.trackRecords().map((r) => [r.handlerId, r.considered, r.right, r.wrong, r.of, r.candidate]), [['sales.enquiry.reply_draft', 9, 9, 0, 10, false]], 'nine judged is a record in the making, not yet a candidate');
    company.mark(replies[9]!.id, 'worse', 'staff-1');
    const [record] = company.trackRecords();
    assert.deepEqual([record!.considered, record!.right, record!.wrong, record!.candidate], [10, 9, 1, true]);
    assert.ok(!('score' in record!) && !('rate' in record!));
    company.mark(replies[9]!.id, 'wrong_fact', 'staff-1', { factKeys: ['offer.items'] });
    assert.equal(company.trackRecords()[0]!.candidate, true, 'still 9 of 10');
    company.mark(replies[0]!.id, 'worse', 'staff-1');
    assert.deepEqual([company.trackRecords()[0]!.right, company.trackRecords()[0]!.candidate], [8, false], 'a second wrong one takes it below 9 of 10');
  });
});

test('ADM-96: an approved or declined reply counts when it was not marked, and a marked one is counted once, by its marking', async () => {
  await inTemp(RECORD_CONFIG({ automation: { candidate: { minRight: 3, of: 4 } } }), async (file) => {
    const { company, say } = boardCompany(file, tenReplies(5));
    for (let i = 0; i < 5; i++) await say(`c-${i}`);
    const proposalOf = (chat: string) => company.store.getEntry(company.auditQueue().find((r) => r.chat === chat && r.handlerId === 'sales.enquiry.reply_draft')!.id)!.proposalId!;
    company.decide(proposalOf('c-0'), 'approve', 'staff-1');
    company.decide(proposalOf('c-1'), 'approve', 'staff-1');
    company.decide(proposalOf('c-2'), 'decline', 'staff-1', { reason: 'wrong_tone' });
    company.mark(company.auditQueue().find((r) => r.chat === 'c-3' && r.handlerId === 'sales.enquiry.reply_draft')!.id, 'match', 'staff-1');
    company.decide(proposalOf('c-3'), 'decline', 'staff-1'); // marked match AND declined: the marking is what counts
    const [record] = company.trackRecords();
    assert.deepEqual([record!.considered, record!.right, record!.of, record!.candidate], [4, 3, 4, true]);
    company.decide(proposalOf('c-4'), 'approve', 'staff-1');
    assert.deepEqual([company.trackRecords()[0]!.considered, company.trackRecords()[0]!.right], [4, 3], 'only the most recent 4 count');
  });
});

test('ADM-97: a green row shows how often its kind of reply has been right, and the flag, on the board and on the attention item', async () => {
  await inTemp(RECORD_CONFIG(), async (file) => {
    const { company, say } = boardCompany(file, tenReplies(11));
    for (let i = 0; i < 10; i++) await say(`c-${i}`);
    company.auditQueue().filter((r) => r.handlerId === 'sales.enquiry.reply_draft').forEach((r, i) => company.mark(r.id, i === 0 ? 'worse' : 'match', 'staff-1'));
    for (let i = 0; i < 10; i++) company.personReplied(`c-${i}`, 'staff-1'); // those chats are done
    await say('c-10');
    const [row] = company.board();
    assert.deepEqual([row!.chat, row!.colour, row!.record], ['c-10', 'green', { right: 9, considered: 10, of: 10, candidate: true }]);
    assert.deepEqual(company.attention()[0]!.record, { right: 9, considered: 10, of: 10, candidate: true });
    assert.ok(!('record' in company.toast(row!)), 'the toast stays short');
  });
});

test('ADM-98: a new version of the reply handler, or another model, starts a new record', async () => {
  await inTemp(RECORD_CONFIG(), async (file) => {
    const { company, say } = boardCompany(file, tenReplies(4));
    for (let i = 0; i < 3; i++) await say(`c-${i}`);
    company.auditQueue().filter((r) => r.handlerId === 'sales.enquiry.reply_draft').forEach((r) => company.mark(r.id, 'match', 'staff-1'));
    const before = company.trackRecords();
    assert.equal(before.length, 1);
    company.store.addLesson({ handlerId: 'sales.enquiry.reply_draft', text: 'Quote the vehicle price for private tours.', originEntryId: null }, AT);
    await say('c-3');
    const row = company.auditQueue().find((r) => r.chat === 'c-3' && r.handlerId === 'sales.enquiry.reply_draft')!;
    company.mark(row.id, 'match', 'staff-1');
    assert.deepEqual(company.trackRecords().map((r) => [r.handlerVersion.includes('+L'), r.considered]), [[false, 3], [true, 1]]);
  });
});

test('ADM-96: criteria that cannot be met are refused', async () => {
  await inTemp(RECORD_CONFIG({ automation: { candidate: { minRight: 11, of: 10 } } }), (file) => {
    assert.throws(() => loadCompanyConfig(file), /minRight cannot be more than of/);
  });
});

// ARC-15: one repository per customer
test('ARC-15: a customer repository is made from the framework\'s templates, with its own git repository and pnpm project, and its data kept out of git', async () => {
  const { existsSync, readFileSync, mkdtempSync, rmSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve } = await import('node:path');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const into = mkdtempSync(join(tmpdir(), 'cyborg-customers-'));
  try {
    const made = scaffoldCustomer({ id: 'sunny-tours', name: 'Sunny Tours', cyborgRoot: root, into });
    assert.equal(made.dir, join(into, 'sunny-tours'));
    assert.ok(made.committed);
    assert.deepEqual(made.files, ['.gitignore', 'AGENTS.md', 'README.md', 'company.config.json', 'company.json', 'day.json', 'docs/questionnaire.md', 'package.json', 'pnpm-workspace.yaml', 'src/adapter.ts', 'src/run.ts', 'tsconfig.json']);

    const pkg = JSON.parse(readFileSync(join(made.dir, 'package.json'), 'utf8')) as { name: string; dependencies: Record<string, string> };
    assert.equal(pkg.name, '@customer/sunny-tours');
    assert.ok(pkg.dependencies['@cyborg/company']!.startsWith('link:') && pkg.dependencies['@cyborg/company']!.endsWith('packages/company'));
    assert.ok(existsSync(resolve(made.dir, pkg.dependencies['@cyborg/company']!.slice('link:'.length), 'package.json')), 'the link points at the framework');

    const config = readFileSync(join(made.dir, 'company.config.json'), 'utf8');
    assert.match(config, /"id": "sunny-tours"/);
    assert.match(config, /"name": "Sunny Tours"/);
    assert.match(config, /\.\/data\/store\.sqlite/);
    assert.throws(() => loadCompanyConfig(join(made.dir, 'company.config.json')), /fill in/, 'it does not run until filled in');

    const questions = readFileSync(join(made.dir, 'docs/questionnaire.md'), 'utf8');
    assert.match(questions, /### 1\. What do you call the business to customers/);
    assert.match(questions, /### 11b\./);
    assert.ok((questions.match(/^### /gm) ?? []).length >= 14);

    const ignore = readFileSync(join(made.dir, '.gitignore'), 'utf8');
    for (const pattern of ['data/', '*.sqlite', '*.vault', '.env', '*.sqlite.bak-*']) assert.ok(ignore.includes(pattern), pattern);
    assert.equal(execFileSync('git', ['log', '--format=%s'], { cwd: made.dir }).toString().trim(), 'Start the Sunny Tours customer repository from the cyborg scaffold');
    assert.equal(execFileSync('git', ['remote'], { cwd: made.dir }).toString().trim(), '', 'no remote');

    assert.throws(() => scaffoldCustomer({ id: 'sunny-tours', name: 'x', cyborgRoot: root, into }), /already exists; nothing was changed/);
    assert.throws(() => scaffoldCustomer({ id: 'Bad Id', name: 'x', cyborgRoot: root, into }), /not a customer id/);
    assert.throws(() => scaffoldCustomer({ id: 'ok', name: '  ', cyborgRoot: root, into }), /give the company a name/);
  } finally {
    rmSync(into, { recursive: true });
  }
});

test('CMP-20: a reply the code blocked is a PROBLEM in the simulation report, not a pass', async () => {
  await inTemp(baseConfig(), async (file) => {
    const { script } = validateScript({ start: AT, steps: [{ do: 'customer', chat: 'chat-1', text: 'how much is the east tour' }] });
    const promise = JSON.stringify({ draft: 'Your booking is confirmed, see you Thursday.' }); // a commitment: blocked by the sales checks (SAL-5)
    const report = await runSimulation(loadCompanyConfig(file), script!, { company: COMPANY, deps: { model: new ScriptedModel([INTAKE, promise, CARD]), capabilities: [capability] } });
    assert.match(report.steps[0]!.problems.join(), /reply_draft: reply blocked: commitment: matches the commitment pattern/);
  });
});

test('CMP-2: the folder a database lives in is made when it is missing, so a fresh customer repository runs', async () => {
  const { existsSync } = await import('node:fs');
  await inTemp({ ...baseConfig(), store: { path: './data/deeper/store.sqlite', vaultPath: './data/deeper/vault.sqlite' } }, async (file, dir) => {
    const company = createCompany(loadCompanyConfig(file), { ack: { channel: 'a', send: async () => undefined }, review: { channel: 'r', send: async () => undefined } }, { model: new ScriptedModel([]), capabilities: [capability], beforeLoad: (s) => void seedProfile(s, COMPANY, AT) });
    assert.ok(existsSync(join(dir, 'data', 'deeper', 'store.sqlite')) && existsSync(join(dir, 'data', 'deeper', 'vault.sqlite')));
    company.close();
  });
});

// audit 2026-11-03 F-8
test('ADM-82: a customer message whose reply the model failed twice is red on the board, not missing from it', async () => {
  await inTemp(BOARD_CONFIG(), async (file) => {
    const { company, say } = boardCompany(file, [INTAKE, 'not json', 'still not json']);
    await say('chat-1');
    const board = company.board();
    assert.deepEqual(board.map((r) => [r.chat, r.colour]), [['chat-1', 'red']]);
    assert.ok(board[0]!.reasons.includes('blocked'));
    company.personReplied('chat-1', 'staff-1');
    assert.deepEqual(company.board(), [], 'once a person answers, the chat leaves the board');
  });
});

// audit 2026-11-03 PRV-7
test('PRV-7: a chat install whose model is off this machine gets a warning; a local one, or one with no customer chat, does not', async () => {
  const prv7 = (config: unknown) => inTemp(config, (file) => checkCompanyConfig(loadCompanyConfig(file).config, { KEY: 'x' }).warnings.filter((w) => /PRV-7/.test(w)));
  const off = { baseUrl: 'https://api.example/v1', model: 'm', apiKeyEnv: 'KEY' };
  assert.equal((await prv7(baseConfig({ inference: off }))).length, 1);
  assert.equal((await prv7(baseConfig({ inference: off, chat: { authorisedSenders: ['owner-ref'], originChannel: 'origin', roles: { 'ops-1': 'ops' } } }))).length, 0);
  assert.equal((await prv7(baseConfig())).length, 0);
});

// zapa 2026-11-03: businesses sit beside the framework repository, never inside it
test('ARC-15: a new business repository is made beside the framework repository by default', () => {
  assert.equal(defaultCustomerFolder('/home/x/Projects/atlabs/cyborg'), '/home/x/Projects/atlabs');
  assert.equal(defaultCustomerFolder('/home/x/Projects/atlabs/cyborg/'), '/home/x/Projects/atlabs');
});

// ADM-116, N-19, N-14, PRV-10 (audit 2026-11-10): both used to run only in a test or the simulation, never in an install
test('ADM-116: housekeeping hands a silent chat back to the bot after N-14 and drops ledger rows older than N-4, and nothing else', async () => {
  await inTemp(BOARD_CONFIG(), async (file) => {
    const clock = { t: new Date(AT) };
    const company = createCompany(
      loadCompanyConfig(file),
      { ack: { channel: 'a', send: async () => undefined }, review: { channel: 'r', send: async () => undefined } },
      { model: new ScriptedModel([INTAKE, DRAFT]), capabilities: [capability], beforeLoad: (store) => void seedProfile(store, COMPANY, AT), now: () => clock.t },
    );
    // a person has chat-1 and the customer writes: someone is waiting
    company.takeOver('chat-1', 'staff-1');
    await company.process({ id: 'e-1', source: 'chat', kind: 'message.received', at: AT, payload: { chat: 'chat-1', isGroup: false, addressed: true, sender: 'c1', text: 'is anyone there' } });
    const old = company.store.write({ handlerId: 'x.old', handlerVersion: '1', at: '2026-09-01T00:00:00.000Z', endpoint: 'e', model: 'm', requestPayload: { a: 1 }, rawResponse: '{}', error: null, durationMs: 1 });
    const fresh = company.store.write({ handlerId: 'x.fresh', handlerVersion: '1', at: AT, endpoint: 'e', model: 'm', requestPayload: { a: 1 }, rawResponse: '{}', error: null, durationMs: 1 });

    assert.deepEqual(company.housekeeping(), { resumed: [], purged: 1 }, 'the chat has not been silent for 12 h yet; the 70-day-old row goes');
    assert.equal(company.store.read(old), null);
    assert.ok(company.store.read(fresh), 'a row inside 30 days stays');
    assert.equal(company.store.listAudit().filter((a) => a.kind === 'ledger_purged').length, 1);
    assert.deepEqual(company.store.listAudit().find((a) => a.kind === 'ledger_purged')!.detail, { rows: 1, retentionDays: 30 }, 'the audit row holds a count, never text');

    clock.t = new Date(new Date(AT).getTime() + 13 * 3_600_000);
    assert.deepEqual(company.housekeeping().resumed, ['chat-1'], 'after 12 h of customer silence the chat goes back to the bot');
    assert.deepEqual(company.housekeeping(), { resumed: [], purged: 0 }, 'running it again changes nothing');
    assert.equal(company.store.listAudit().filter((a) => a.kind === 'ledger_purged').length, 1, 'no audit row when nothing was dropped');
    company.close();
  });
});
