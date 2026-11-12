// Builds the browser demo: the framework's own code (the runner, the handlers, the gateway, the booking step) bundled with the page's code into one file.
//   node packages/browser-demo/scripts/build.mjs <out folder>     (writes <out>/assets/app.js)
//   ... --does                                                     (writes <out>/assets/does.js: the scrubber and the toast, run on what the visitor types)
// esbuild is the one tsx already brings; no dependency is added for it.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');
// esbuild is a dependency of tsx: resolve tsx from the workspace root, then esbuild from where tsx lives (no scan of pnpm's folder layout).
let esbuild;
try {
  esbuild = createRequire(createRequire(join(root, 'package.json')).resolve('tsx'))('esbuild');
} catch {
  throw new Error('esbuild was not found beside tsx; run pnpm install first');
}
const args = process.argv.slice(2);
const recordedOnly = args.includes('--recorded-only');
const doesPage = args.includes('--does');
const sessionsIn = args.includes('--sessions') ? resolve(args[args.indexOf('--sessions') + 1]) : null;
const sessionsArg = args.includes('--sessions') ? args[args.indexOf('--sessions') + 1] : null;
const out = resolve(args.find((x) => !x.startsWith('--') && x !== sessionsArg) ?? join(here, '..', 'dist-site'));
mkdirSync(join(out, 'assets'), { recursive: true });

const result = await esbuild.build({
  entryPoints: [join(here, '..', 'src', doesPage ? 'does.ts' : recordedOnly ? 'recorded-app.ts' : 'app.ts')],
  outfile: join(out, 'assets', doesPage ? 'does.js' : 'app.js'),
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, legalComments: 'none', metafile: true,
  plugins: [{
    name: 'node-crypto-shim',
    setup(build) {
      build.onResolve({ filter: /^node:crypto$/ }, () => ({ path: join(here, 'sha256.js') }));
    },
  }],
});
const bytes = Object.values(result.metafile.outputs)[0].bytes;
if (recordedOnly) {
  // The published recording carries what the system produced, not the prompts: no prompt text, no handler id, nothing that is the framework's own wording.
  if (!sessionsIn) throw new Error('--recorded-only needs --sessions <the recorded sessions.json>');
  const { readFileSync, writeFileSync } = await import('node:fs');
  const recorded = JSON.parse(readFileSync(sessionsIn, 'utf8'));
  for (const session of recorded.sessions) for (const turn of session.turns) if (turn.view) delete turn.view.prompt;
  writeFileSync(join(out, 'assets', 'sessions.json'), `${JSON.stringify(recorded, null, 2)}\n`);
  console.log(`wrote ${join(out, 'assets', 'sessions.json')} without the prompts`);
}
console.log(`wrote ${join(out, 'assets', doesPage ? 'does.js' : 'app.js')} (${Math.round(bytes / 1024)} KB)`);
