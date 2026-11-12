// Records sessions for the showcase from a real run: the browser demo's own engine against a real model endpoint, nothing typed in by hand but the customer's
// lines. Usage: node --import tsx packages/browser-demo/scripts/record.ts <base url> <model> <out.json> [api key env name]
import { readFileSync, writeFileSync } from 'node:fs';
import { Demo, type TurnView } from '../src/engine.ts';
import { DEMO_SETTINGS } from '../src/demo-settings.ts';

const [baseUrl, model, out, keyEnv] = process.argv.slice(2);
if (!baseUrl || !model || !out) throw new Error('usage: record.ts <base url> <model> <out.json> [api key env name]');
const company = JSON.parse(readFileSync(new URL('../../../docs/demo/company-model.demo.json', import.meta.url), 'utf8')) as { demo: string; enquiryFields: never[]; profile: Record<string, unknown> };
const demo = new Demo({ profile: company.profile, label: company.demo, enquiryFields: company.enquiryFields }, { baseUrl, model, ...(keyEnv && process.env[keyEnv] ? { apiKey: process.env[keyEnv]! } : {}) }, DEMO_SETTINGS);
console.log('capability:', await demo.prepare());

interface Turn { text: string; view?: TurnView; office?: string; card?: string }
const say = async (chat: string, text: string): Promise<Turn> => { const view = await demo.customer(chat, text); console.log(`> ${text}\n  ${view.draft ?? '(no draft) ' + view.problems.join('; ')}`); return { text, view }; };
const office = (text: string): Turn => ({ text: `office: .${text}`, office: demo.office(text) });

const booking: Turn[] = [await say('rec1', 'Hi, how much is the Coast Walk?'), await say('rec1', 'We are 4 people, on Saturday'), await say('rec1', 'Yes please, send it')];
booking.push(office('bookings'), office('confirm B-000001 confirmed by phone'));
const monday: Turn[] = [await say('rec2', 'Coast Walk for 2 people on Monday'), await say('rec2', 'Thursday then')];
const dog: Turn[] = [await say('rec3', 'Can I bring my dog?')];
dog.push({ text: 'Pass to the office', card: await demo.handoff('rec3') });
const kids: Turn[] = [await say('rec4', 'Can children come on the Coast Walk?'), await say('rec4', 'What should I bring?')];

const recorded = {
  recordedAt: new Date().toISOString(), model: model + (baseUrl.includes('127.0.0.1') ? ' (local)' : ''),
  sessions: [
    { id: 'booking', title: 'A booking, start to finish', blurb: 'No price until the group size is known. The total is computed by the code. A request is made only on the customer\'s own yes, and a person confirms it.', turns: booking },
    { id: 'monday', title: 'A day the tour does not run', blurb: 'The code checks running days and offers the nearest open ones; the model only phrases them.', turns: monday },
    { id: 'dog', title: 'Something the bot does not know', blurb: 'The business listed pets as a topic the bot does not know. The model is told, and the code holds it to that: no draft, a card for the office.', turns: dog },
    { id: 'faq', title: 'Answers from the facts', blurb: 'Questions the business\'s own facts cover. Every fact is marked unconfirmed until the client confirms it.', turns: kids },
  ],
};
writeFileSync(out, `${JSON.stringify(recorded, null, 2)}\n`);
console.log('wrote', out);
