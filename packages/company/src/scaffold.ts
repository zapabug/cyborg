import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

// docs/01 ARC-15: one repository per customer, beside the framework repository in the same group folder (zapa, 2026-11-03), never inside it.

export interface ScaffoldOptions {
  /** A lower-case id: it names the folder, the package and the company. */
  id: string;
  /** The company's name as its customers know it. */
  name: string;
  /** The folder the cyborg framework repository is in. */
  cyborgRoot: string;
  /** Where the customers' folders go. Default: the folder that holds the framework repository (`defaultCustomerFolder`). */
  into?: string;
  /** Run `git init` and make the first commit. Default true. */
  git?: boolean;
  /**
   * WZP-16: a demo base. The facts are the made-up ones in `docs/demo/company-model.demo.json`, marked `demo` in the profile and in the
   * test chat's header; the config needs only the model endpoint filled in. It is the one place made-up facts exist.
   */
  demo?: boolean;
}

export interface ScaffoldResult {
  dir: string;
  files: string[];
  committed: boolean;
}

const ID = /^[a-z][a-z0-9-]*$/;

/** The library default: the folder that holds the framework repository. The CLI does not use it; it asks for the folder (--into or CYBORG_BUSINESSES). */
export const defaultCustomerFolder = (cyborgRoot: string): string => dirname(resolve(cyborgRoot));

/** The questions of docs/13 as an answer sheet, so the 30-minute meeting has somewhere to write. */
function questionnaire(cyborgRoot: string, name: string): string {
  const doc = readFileSync(join(cyborgRoot, 'docs', '13-delivery-process.md'), 'utf8');
  const section = doc.slice(doc.indexOf('## Questionnaire draft'));
  const rows = section.split('\n').filter((l) => /^\| \d+[a-z]? \|/.test(l)).map((l) => l.split('|').map((c) => c.trim()).filter(Boolean));
  const body = rows
    .map(([n, ask, lands, needed]) => `### ${n}. ${ask}\n\nLands in: ${lands}. Needed to start: ${needed}.\n\nAnswer:\n\n`)
    .join('');
  return `# ${name}: questionnaire answers\n\nFrom the 30-minute meeting. Ask for documents (price list, FAQ page, terms) instead of having them said aloud. Questions come from the framework's docs/13.\n\n${body}`;
}

/** WZP-16: the template with everything a demo can answer itself filled in; only the model endpoint is the machine's own and stays marked. */
function demoConfig(template: string, id: string, name: string, enquiryFields: unknown): string {
  const c = JSON.parse(template) as Record<string, any>;
  c['id'] = id;
  c['name'] = name;
  c['store'] = { path: './data/store.sqlite', vaultPath: './data/vault.sqlite' };
  delete c['inference'].handlers;
  delete c['inference'].apiKeyEnv;
  for (const key of ['limits', 'prices', 'office', 'wording']) delete c[key];
  c['chat'] = { authorisedSenders: [], originChannel: 'origin-chat', roles: {} };
  c['language'] = 'en';
  // The demo business writes to its customers in English; the model is told the topics the business says it does not know, and the code holds it to that.
  c['modules'].sales = {
    enquiryFields,
    conversationContext: true,
    defaultLanguage: 'en',
    officeTopics: [
      { label: 'pets and dogs', words: ['dog', 'dogs', 'pet', 'pets', 'puppy'] },
      { label: 'wheelchairs and reduced mobility', words: ['wheelchair', 'wheelchairs', 'mobility', 'disabled', 'disability'] },
      { label: 'food allergies and special diets', words: ['allergy', 'allergies', 'allergic', 'vegan', 'vegetarian', 'gluten', 'halal', 'kosher'] },
    ],
  };
  // The booking funnel, with the previous bot's starting numbers (a 14-day look-ahead, last minute is today or tomorrow, up to 200 people): the business's own to change.
  c['modules'].bookings = {
    confirmWords: ['yes', 'yeah', 'ok', 'okay', 'sure', 'please do', 'go ahead', 'sim', 'claro', 'pode ser'],
    cancelWords: ['no', 'nope', 'cancel', 'never mind', 'forget it', 'não', 'nao', 'cancelar'],
    lastMinuteDays: 1,
    lastMinuteNote: 'It is last minute: any service can be tried, but it needs manager approval and might not be possible. The team will reply as fast as it can.',
    alternativeDaysAhead: 14,
    maxGroup: 200,
    currency: 'EUR',
  };
  return `${JSON.stringify(c, null, 2)}\n`;
}

export function scaffoldCustomer(options: ScaffoldOptions): ScaffoldResult {
  const { id, name } = options;
  if (!ID.test(id)) throw new Error(`"${id}" is not a customer id: use lower-case letters, digits and hyphens, starting with a letter`);
  if (name.trim() === '') throw new Error('give the company a name');
  const cyborgRoot = resolve(options.cyborgRoot);
  const dir = resolve(options.into ?? defaultCustomerFolder(cyborgRoot), id);
  if (existsSync(dir)) throw new Error(`${dir} already exists; nothing was changed`);

  const link = (pkg: string) => `link:${relative(dir, join(cyborgRoot, 'packages', pkg)).replaceAll('\\', '/')}`;
  const template = (path: string) => readFileSync(join(cyborgRoot, 'docs', path), 'utf8');
  const demoModel = options.demo ? template('demo/company-model.demo.json') : null;
  const configTemplate = template('simulation/company.config.template.json');
  const config = demoModel
    ? demoConfig(configTemplate, id, name, (JSON.parse(demoModel) as { enquiryFields: unknown }).enquiryFields)
    : configTemplate.replace('<fill in: a lower-case id for this company, e.g. my-desk>', id).replace("<fill in: the company's name>", name);

  const files: Record<string, string> = {
    'package.json': `${JSON.stringify(
      {
        name: `@customer/${id}`,
        version: '0.0.0',
        private: true,
        type: 'module',
        scripts: {
          check: 'pnpm exec tsc --noEmit -p . && pnpm run company:check',
          'company:check': 'tsx node_modules/@cyborg/company/bin/company.ts check company.config.json',
          wording: 'tsx node_modules/@cyborg/company/bin/company.ts wording company.config.json',
          capability: 'tsx node_modules/@cyborg/company/bin/company.ts capability company.config.json',
          simulate: 'tsx node_modules/@cyborg/company/bin/simulate.ts --config company.config.json --script day.json --company-model company.json',
          estimate: 'tsx node_modules/@cyborg/company/bin/simulate.ts --config company.config.json --script day.json --company-model company.json --estimate',
          testchat: 'tsx node_modules/@cyborg/dashboard/bin/testchat.ts --config company.config.json --company-model company.json --sheet docs/business-sheet.txt',
          start: 'tsx src/run.ts',
          whatsapp: 'tsx node_modules/@cyborg/channel-whatsapp/bin/whatsapp.ts',
          usage: 'tsx node_modules/@cyborg/store-sqlite/bin/usage.ts --db data/store.sqlite',
          digest: 'tsx node_modules/@cyborg/store-sqlite/bin/digest.ts --db data/store.sqlite',
          db: 'tsx node_modules/@cyborg/store-sqlite/bin/db.ts',
        },
        dependencies: {
          '@cyborg/channel-whatsapp': link('channel-whatsapp'),
          '@cyborg/company': link('company'),
          '@cyborg/core': link('core'),
          '@cyborg/dashboard': link('dashboard'),
          '@cyborg/store-sqlite': link('store-sqlite'),
        },
        devDependencies: { '@types/node': '26.6.6', tsx: '4.23.15', typescript: '7.0.2' },
      },
      null,
      2,
    )}\n`,
    // The customer's folder is its own pnpm project, not a package of the framework's workspace above it.
    'pnpm-workspace.yaml': 'packages: []\nallowBuilds:\n  esbuild: true\n',
    'tsconfig.json': `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2023', lib: ['ES2023'], module: 'nodenext', moduleResolution: 'nodenext', types: ['node'], strict: true,
          noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, noFallthroughCasesInSwitch: true, forceConsistentCasingInFileNames: true,
          skipLibCheck: true, noEmit: true, allowImportingTsExtensions: true, verbatimModuleSyntax: true,
        },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    )}\n`,
    '.gitignore': 'node_modules/\ndata/\n*.sqlite\n*.sqlite-wal\n*.sqlite-shm\n*.sqlite.bak-*\n*.vault\n.env\nreports/\nwhatsapp.json\n.wwebjs_cache/\n.wwebjs_auth/\n',
    'company.config.json': config.replace('./sim-store.sqlite', './data/store.sqlite').replace('./sim-vault.sqlite', './data/vault.sqlite'),
    'company.json': demoModel ?? template('dryrun/company-model.template.json'),
    'day.json': template('simulation/day.template.json'),
    'docs/questionnaire.md': questionnaire(cyborgRoot, name),
    ...(options.demo ? { 'SHOW.md': template('demo/show.md') } : {}),
    'src/adapter.ts': `import type { CompanyAdapters } from '@cyborg/company';

// ${name}: the code that is only this customer's. It is the whole reason this folder is a repository of its own.
//
// What goes here, as the customer needs it (nothing below is built until you write it):
//   - the channel: how a customer's message becomes an event for company.process(), and how a reply or a card is sent
//     (CompanyAdapters.ack / review / ops, and history() for the dashboard's chat view);
//   - add-on facts: fileFactSource() or a RuntimeFactSource for the customer's job sheet, GPS feed or calendar (docs/12 CMP-27..29);
//   - attention sources the customer's own modules contribute to the dashboard (docs/10 ADM-92);
//   - this customer's own modules, if no framework module does what they need (check with the framework first).
//
// Until a channel exists, run.ts uses sinks that send nowhere, so the dashboard shows what is in the database and nothing leaves the machine.

export const noChannel = (channel: string) => ({ channel, send: async () => undefined });

export function adapters(): CompanyAdapters {
  return { ack: noChannel('ack'), review: noChannel('review') };
}
`,
    'src/run.ts': `import { createCompany, loadCompanyConfig } from '@cyborg/company';
import { startDashboard } from '@cyborg/dashboard';
import { adapters } from './adapter.ts';

// Opens ${name}'s company and its dashboard on this machine. Replace adapters() when the channel is built.
const company = createCompany(loadCompanyConfig(new URL('../company.config.json', import.meta.url).pathname), adapters(), {});
const dashboard = await startDashboard(company, { port: 4180 });
console.log(\`${name}: dashboard at \${dashboard.url}\`);
process.on('SIGINT', () => void dashboard.close().then(() => { company.close(); process.exit(0); }));
`,
    'AGENTS.md': `# ${name} (a cyborg customer repository)

- This repository holds **only ${name}'s** configuration, profile, adapter code, simulation scripts and audit notes. The framework is the \`cyborg\` repository above this folder, linked in \`package.json\`; change the framework there, never by copying it here.
- ${name}'s data (databases, backups, reports, keys) never goes into the framework's repository and never into git here: see \`.gitignore\`. The inference key is only ever an environment variable named in \`company.config.json\`.
- The process (docs/13 in the framework): questionnaire, company model, simulate, two weeks of shadow with audits, the live gate.
- Commands: \`pnpm run check\`, \`pnpm run simulate\`, \`pnpm run estimate\`, \`pnpm run wording\`, \`pnpm run testchat\` (type as a customer, nothing is sent), \`pnpm start\` (dashboard), \`pnpm whatsapp\` (link WhatsApp from the dashboard's QR code and run in shadow; nothing is sent to a customer).
`,
    'README.md': demoModel
      ? `# ${name} (demo base)

A cyborg demo: **every fact in \`company.json\` is made up** and marked \`demo\` (the test chat's header says so). Nothing here is a real business.

1. In \`company.config.json\` fill in the two \`<fill in\` values: the model endpoint and the model name (and add \`inference.apiKeyEnv\` if the endpoint needs a key).
2. \`pnpm install\`, then \`pnpm run testchat\` and open the address it prints. Type as a customer; a second box types as the office. Nothing is sent to anyone.
3. To try it on a real business, copy this folder, put the business's own facts in \`company.json\` (they enter as unconfirmed statements) and remove the \`demo\` line.

The framework's docs are in \`${relative(dir, join(cyborgRoot, 'docs')).replaceAll('\\', '/')}\`.
`
      : `# ${name}

A cyborg customer repository. Start with \`docs/questionnaire.md\` at the 30-minute meeting, then:

1. Fill in \`company.config.json\` (look for \`<fill in\`) and \`company.json\` (the company model). Neither runs until they are filled in.
2. \`pnpm install\`, then \`pnpm run check\`.
3. Write \`day.json\` from real chats, then \`pnpm run estimate\` and \`pnpm run simulate\` (set the key in the environment variable the config names).
4. \`pnpm testchat\` opens a test chat: type as a customer, nothing is sent. \`pnpm start\` opens the dashboard on this machine.
5. Build \`src/adapter.ts\` for ${name}'s channel and add-ons; run the two-week shadow and the audits (framework docs/13).

The framework's docs are in \`${relative(dir, join(cyborgRoot, 'docs')).replaceAll('\\', '/')}\`.
`,
  };

  mkdirSync(dir, { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    const target = join(dir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
  let committed = false;
  if (options.git !== false) {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
    git('init', '-q', '-b', 'main');
    git('add', '-A');
    git('commit', '-q', '-m', `Start the ${name} customer repository from the cyborg scaffold`);
    committed = true;
  }
  return { dir, files: Object.keys(files).sort(), committed };
}
