// WZP-10..19: open the test chat on this machine, with no WhatsApp and no channel.
//   pnpm testchat --config company.config.json [--company-model company.json] [--sheet docs/business-sheet.txt] [--port 4182]
// Someone types as a customer and sees the draft, the facts behind it and the checks; a second box types as the office. The test chat
// has a store and a vault of its own (testchat-*.sqlite beside the install's), reads the same config as the install, is always shadow
// and sends nothing: only the model calls leave this machine. A company model with a `demo` label marks the page as a demo (WZP-16).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ModelControl, applyModelSettings, checkCompanyConfig, loadCompanyConfig, openTestChat, type CompanyModelFile } from '@cyborg/company';
import { modelTab, startDashboard } from '../src/index.ts';

const { values } = parseArgs({ options: { config: { type: 'string' }, 'company-model': { type: 'string' }, sheet: { type: 'string' }, port: { type: 'string' } } });
if (!values.config) {
  console.error('usage: pnpm testchat --config <company.config.json> [--company-model <company.json>] [--port 4182]');
  process.exit(2);
}
const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};
const loaded = (() => {
  try {
    return loadCompanyConfig(values.config);
  } catch (error) {
    return fail((error as Error).message);
  }
})();
// feat-model MD3: the AI service tab is here too. What was saved in it wins over the config's address and model, and carries the key, which is never in the config
// (MDL-6, MDL-7); the settings file sits beside the install's store.
const dataDir = loaded.paths.store === ':memory:' ? null : dirname(resolve(loaded.paths.store));
if (dataDir) applyModelSettings(loaded, dataDir);
const { errors } = checkCompanyConfig(loaded.config);
if (errors.length) fail(errors.map((e) => `ERROR ${e}`).join('\n'));
const company = ((): CompanyModelFile | undefined => {
  const file = values['company-model'];
  if (!file) return undefined;
  const text = readFileSync(file, 'utf8');
  if (text.includes('<fill in')) return fail(`${file}: still has "<fill in" in it; fill in every marked value first`);
  return JSON.parse(text) as CompanyModelFile;
})();

const chat = await openTestChat(loaded, { ...(company ? { company } : {}), demo: company?.demo ?? null }, console.log);
if (chat.company.loaded.refused.length) console.log(`Some modules did not load (run pnpm company capability first):\n${chat.company.loaded.refused.flatMap((r) => r.unmet.map((u) => `  - ${r.moduleId}: ${u.kind} ${u.item}: ${u.detail}`)).join('\n')}`);
const dashboard = await startDashboard(chat.company, {
  port: Number(values.port ?? '4182'),
  testChat: chat,
  name: loaded.config.name,
  ...(dataDir ? { tabs: [modelTab(new ModelControl({ company: chat.company, loaded, dataDir }))] } : {}),
  // feat-tailored: the Business tab keeps the client's words in this file, so they survive a restart and stay the record of what was said.
  ...(values.sheet
    ? {
        businessSheet: {
          read: () => {
            try {
              return readFileSync(resolve(values.sheet!), 'utf8');
            } catch {
              return null;
            }
          },
          write: (text: string) => {
            mkdirSync(dirname(resolve(values.sheet!)), { recursive: true });
            writeFileSync(resolve(values.sheet!), text);
          },
        },
      }
    : {}),
});
console.log(`Test chat: ${dashboard.url}#/t/test\nType as a customer in the browser on this machine. Nothing is sent to anyone. Press Ctrl+C to stop.`);
process.on('SIGINT', () => void dashboard.close().then(() => { chat.close(); process.exit(0); }));
