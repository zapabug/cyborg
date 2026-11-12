// The WhatsApp shadow run for a business (docs/10 ADM-102..109). Run it from the business's own repository: `pnpm whatsapp`.
// It reads the chats named in whatsapp.json, drafts beside what the account's own person answers, and sends drafts only to the review chat. Its own store and
// vault live under the channel file's dataDir, apart from the simulation's. With no whatsapp.json it starts link-only (ADM-103): any account can link from the QR
// code, nothing is watched or sent until a person chooses chats in the dashboard's Configurar tab (WZP-30..39); the choice is written to whatsapp.json by the
// adapter, never by hand. No number, name or chat is in this file or in the framework: they are learned at link time.
//   env: WA_CHANNEL_FILE (default <business>/whatsapp.json), DASHBOARD_PORT (default 4180). The business folder is the current folder, or --root <folder>.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ModelControl, applyModelSettings, checkCompanyConfig, createCompany, loadCompanyConfig, openTestChat, runReminders, seedProfile, testCapabilities, withBookings, withDeskCommands, withMaintenance, type CompanyModelFile } from '@cyborg/company';
import { N19_HOUSEKEEPING_INTERVAL_MS } from '@cyborg/core';
import { configureTab, modelTab, startDashboard } from '@cyborg/dashboard';
import { Agreement, readTerms } from '../src/agreement.ts';
import { WhatsAppChannel, linkOnlyFile, loadChannelFile, loadSalt, plan } from '../src/channel.ts';

const { values } = parseArgs({ options: { root: { type: 'string' } } });
const root = resolve(values.root ?? process.cwd());
const channelPath = process.env['WA_CHANNEL_FILE'] ?? resolve(root, 'whatsapp.json');
const linkOnly = !existsSync(channelPath);
const channelFile = linkOnly ? linkOnlyFile(root) : loadChannelFile(channelPath);
const salt = loadSalt(channelFile.dataDir);
const thePlan = plan(channelFile, salt);

const loaded = loadCompanyConfig(resolve(root, 'company.config.json'));
if (loaded.config.mode !== 'shadow') throw new Error('company.config.json: mode must be "shadow" for the WhatsApp channel (HR-8)');
loaded.config.chat.roles = linkOnly ? {} : thePlan.roles;
loaded.config.chat.authorisedSenders = thePlan.authorisedSenders;
loaded.paths.store = resolve(channelFile.dataDir, 'store.sqlite');
loaded.paths.vault = resolve(channelFile.dataDir, 'vault.sqlite');
// MDL-7: what was saved in the dashboard's AI service tab wins over the config's address and model (and carries the key, which is never in the config).
applyModelSettings(loaded, channelFile.dataDir);
// CMP-4..6, PRV-7: the config check's words are said at every start, so a model off this machine or a missing key is never a surprise. Shadow mode sends nothing to a
// customer, so a problem is shown and the run goes on; `pnpm company check` is the gate for going live.
const configCheck = checkCompanyConfig(loaded.config);
for (const line of configCheck.errors) console.log(`[config] PROBLEM: ${line}`);
for (const line of configCheck.warnings) console.log(`[config] note: ${line}`);

// MOD-8: a model module loads only once the endpoint's capability is on record in this store. Testing it on every start takes a few calls and means one
// command is enough; when the model is not reachable the dashboard still opens, the drafts stay off, and it says so.
try {
  console.log('Testing the model endpoint (a few real calls)...');
  console.log((await testCapabilities(loaded)).map((r) => `  ${r.model}: ${r.level}`).join('\n'));
} catch (error) {
  console.log(`The model is not reachable, so no draft is made until it is: ${(error as Error).message}`);
}

// The drafted company model (company.json): its facts enter this install's store as unconfirmed statements the first time, and never replace one that is there.
const modelFile = resolve(root, 'company.json');
const companyModel = existsSync(modelFile) ? (JSON.parse(readFileSync(modelFile, 'utf8')) as CompanyModelFile) : undefined;

const prefix = loaded.config.chat.commandPrefix;
const channel = new WhatsAppChannel({ file: channelFile, plan: thePlan, salt, commandPrefix: prefix, channelPath, agreement: new Agreement(channelFile.dataDir, readTerms(root)) });
// WZP-48: the office's commands (save, bug, idea, status, questions, answer, learn ...) beside the gate's own.
const commands = withDeskCommands(createCompany(loaded, channel.adapters, { beforeLoad: (store) => void (companyModel && seedProfile(store, companyModel, new Date().toISOString())) }), {
  commandPrefix: prefix,
  authorisedSenders: thePlan.authorisedSenders,
  ack: channel.adapters.ack,
  ...(loaded.config.modules.bookings ? { bookings: { config: loaded.config.modules.bookings, ...(loaded.config.office?.timezone ? { timezone: loaded.config.office.timezone } : {}) } } : {}),
});
// WZP-50..55 and WZP-60: the booking step for customer chats and the maintenance watch for team chats, as the config switches them on.
const withFunnel = loaded.config.modules.bookings ? withBookings(commands, { config: loaded.config.modules.bookings, commandPrefix: prefix, ...(loaded.config.office?.timezone ? { timezone: loaded.config.office.timezone } : {}) }) : commands;
const company = loaded.config.modules.maintenance ? withMaintenance(withFunnel, { config: loaded.config.modules.maintenance }) : withFunnel;

// WZP-10, WZP-18: a test chat beside the install, from the same config and the same company model, on a store of its own. It needs the model, so when the model
// is not reachable the install still starts, without the Test tab.
const testChat = await (async () => {
  try {
    return await openTestChat(loaded, { ...(companyModel ? { company: companyModel } : {}) }, console.log);
  } catch (error) {
    console.log(`The Test tab is off: ${(error as Error).message}`);
    return undefined;
  }
})();

// WZP-34: the client's intake tasks (intake/intake.json, written by `pnpm tailor --intake` or `pnpm intake --out intake`) are what the picker offers each kind of chat.
const intakeTasks = (() => {
  const file = resolve(root, 'intake', 'intake.json');
  if (!existsSync(file)) return [];
  const draft = (JSON.parse(readFileSync(file, 'utf8')) as { draft: { tasks: { title: string; roles: ('reply' | 'monitor' | 'ops')[] }[] } }).draft;
  return draft.tasks.filter((t) => t.roles.length > 0).map((t) => ({ title: t.title, roles: t.roles }));
})();

// The Business tab keeps the client's words here, beside the facts they became.
const sheetFile = resolve(root, 'docs', 'business-sheet.txt');
const businessSheet = {
  read: () => (existsSync(sheetFile) ? readFileSync(sheetFile, 'utf8') : null),
  write: (text: string) => {
    mkdirSync(resolve(root, 'docs'), { recursive: true });
    writeFileSync(sheetFile, text);
  },
};

// ADM-116, N-19: the timed work of a running install, at start and then every N-19: silent handed-off chats go back to the bot (N-14) and old ledger rows are dropped (N-4).
const housekeep = (): void => {
  try {
    const done = company.housekeeping();
    if (done.resumed.length || done.purged) console.log(`[housekeeping] handed back to the bot: ${done.resumed.length}; ledger rows dropped: ${done.purged}`);
  } catch (e: unknown) {
    console.log(`[housekeeping] failed: ${String(e).slice(0, 160)}`);
  }
};
housekeep();
const housekeepingTimer = setInterval(housekeep, N19_HOUSEKEEPING_INTERVAL_MS);

// WZP-63: the evening-before reminders, as drafts for a person to send, checked every N-19 when the config switches them on.
const reminderTimer = loaded.config.modules.bookings?.reminders
  ? setInterval(() => {
      const bookings = loaded.config.modules.bookings!;
      void runReminders(company, { config: bookings, ...(loaded.config.office?.timezone ? { timezone: loaded.config.office.timezone } : {}) })
        .then((r) => {
          if (r.drafted.length || r.blocked.length) console.log(`[reminders] drafted ${r.drafted.join(', ') || 'none'}; blocked ${r.blocked.map((b) => `${b.ref} (${b.why})`).join(', ') || 'none'}`);
        })
        .catch((e: unknown) => console.log(`[reminders] failed: ${String(e).slice(0, 160)}`));
    }, N19_HOUSEKEEPING_INTERVAL_MS)
  : null;

const dashboard = await startDashboard(company, {
  port: Number(process.env['DASHBOARD_PORT'] ?? 4180),
  link: () => channel.linkView(),
  name: loaded.config.name,
  tabs: [configureTab(channel.directory(), { tasks: intakeTasks }), modelTab(new ModelControl({ company, ...(testChat ? { others: [testChat.company] } : {}), loaded, dataDir: channelFile.dataDir }))],
  businessSheet,
  ...(testChat ? { testChat } : {}),
});
console.log(`${loaded.config.name}: dashboard at ${dashboard.url} (WhatsApp shadow run${linkOnly ? ', link-only: no whatsapp.json, nothing is watched' : ''})`);

process.on('SIGINT', () => void (clearInterval(housekeepingTimer), reminderTimer && clearInterval(reminderTimer), channel.stop()).then(() => dashboard.close()).then(() => { testChat?.close(); company.close(); process.exit(0); }));
await channel.start(company);
