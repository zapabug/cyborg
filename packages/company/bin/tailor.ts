// feat-tailored T2: build a customer repository from the business sheet the client wrote. No model call, nothing sent anywhere.
//   pnpm tailor <id> --name "Company name" --into <folder> [--sheet <business message | ->] [--intake <questionnaire message> --form <intake form-data.js>] --language en|pt --endpoint <url/v1> --model <name> [--key-env NAME] [--no-git]
// Every fact enters unconfirmed. The report says what was read, what was not, and what to ask the client next.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadIntakeForm, loadTaskMap, tailorCustomer } from '../src/index.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { name: { type: 'string' }, into: { type: 'string' }, sheet: { type: 'string' }, intake: { type: 'string' }, form: { type: 'string' }, 'task-map': { type: 'string' }, language: { type: 'string' }, endpoint: { type: 'string' }, model: { type: 'string' }, 'key-env': { type: 'string' }, 'no-git': { type: 'boolean' } },
});
const [id] = positionals;
const into = values.into ?? process.env['CYBORG_BUSINESSES'];
if (!id || !values.name || !into || (!values.sheet && !values.intake) || (values.intake && !values.form) || !values.endpoint || !values.model || (values.language !== 'en' && values.language !== 'pt')) {
  console.error('usage: pnpm tailor <id> --name "Company name" --into <folder> [--sheet <file | ->] [--intake <file> --form <form-data.js>] --language en|pt --endpoint <url ending /v1> --model <name> [--key-env NAME] [--no-git]\n  (the folder can also come from CYBORG_BUSINESSES)');
  process.exit(2);
}
try {
  const cyborgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const sheet = values.sheet ? readFileSync(values.sheet === '-' ? 0 : resolve(values.sheet), 'utf8') : '';
  const intake = values.intake ? { message: readFileSync(resolve(values.intake), 'utf8'), form: loadIntakeForm(resolve(values.form!)), taskMap: loadTaskMap(resolve(values['task-map'] ?? `${cyborgRoot}/docs/intake/task-map.json`)) } : undefined;
  const r = tailorCustomer({ id, name: values.name, cyborgRoot, into, sheet, ...(intake ? { intake } : {}), language: values.language, endpoint: values.endpoint, model: values.model, ...(values['key-env'] ? { apiKeyEnv: values['key-env'] } : {}), git: !values['no-git'] });
  console.log(`${r.report}\nCreated ${r.dir}${r.committed ? ' (git repository, first commit made, no remote)' : ''}\nNext: cd ${r.dir} && pnpm install && pnpm testchat   (type as a customer; nothing is sent)`);
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
