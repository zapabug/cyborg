// ADM-86: open the company dashboard on this machine.
//   pnpm dashboard --config company.config.json [--port 4180]
// It shows what is in the company's database (a simulation's, or a live install's). It reads the chats, the cards and the alerts and
// lets a person take over, hand back and mark done. It does not send to any channel: with no channel adapter attached, "take over"
// stops the bot in the chat and the person answers in WhatsApp as usual.
import { parseArgs } from 'node:util';
import { checkCompanyConfig, createCompany, loadCompanyConfig } from '@cyborg/company';
import { startDashboard } from '../src/index.ts';

const { values } = parseArgs({ options: { config: { type: 'string' }, port: { type: 'string' } } });
if (!values.config) {
  console.error('usage: pnpm dashboard --config <company.config.json> [--port 4180]');
  process.exit(2);
}
const loaded = (() => {
  try {
    return loadCompanyConfig(values.config);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
})();
const { errors } = checkCompanyConfig(loaded.config);
if (errors.length) {
  console.error(errors.map((e) => `ERROR ${e}`).join('\n'));
  process.exit(1);
}
const nowhere = (channel: string) => ({ channel, send: async () => undefined });
const company = createCompany(loaded, { ack: nowhere('dashboard-ack'), review: nowhere('dashboard-review') }, {});
if (company.loaded.refused.length) console.log(`Some modules did not load (run pnpm company capability first):\n${company.loaded.refused.flatMap((r) => r.unmet.map((u) => `  - ${r.moduleId}: ${u.kind} ${u.item}: ${u.detail}`)).join('\n')}`);
const dashboard = await startDashboard(company, { port: Number(values.port ?? '4180'), name: loaded.config.name });
console.log(`Cyborg dashboard: ${dashboard.url}\nOpen it in the browser on this machine and allow notifications. Press Ctrl+C to stop.`);
process.on('SIGINT', () => void dashboard.close().then(() => { company.close(); process.exit(0); }));
