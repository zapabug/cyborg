// MOD-18, TLR-1 (audit 2026-11-10, zapa 2026-11-11): cyborg is the framework and the modules for any business, so no trade word is in any package's source.
// A trade lives only in a business's own data (its sheet and config). The one exception is the demo page's own made-up business (browser-demo), logged in planning.md.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

export const TRADE_WORDS = /\b(tours?|dolphins?|whales?|wildlife|savoy|funchal|madeira)\b/i;
const PACKAGES = new URL('../../packages/', import.meta.url).pathname;
const EXEMPT = new Set(['browser-demo']);

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === 'node_modules' || f === 'dist' ? [] : walk(p);
    return f.endsWith('.ts') ? [p] : [];
  });

test('MOD-18, TLR-1: no trade word in the source or the bin of any package', () => {
  const hits: string[] = [];
  for (const pkg of readdirSync(PACKAGES).filter((d) => !EXEMPT.has(d))) {
    for (const folder of ['src', 'bin']) {
      let files: string[] = [];
      try {
        files = walk(join(PACKAGES, pkg, folder));
      } catch {
        continue; // the package has no such folder
      }
      for (const file of files) {
        readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
          const m = TRADE_WORDS.exec(line);
          if (m) hits.push(`${file.slice(PACKAGES.length)}:${i + 1} "${m[0]}"`);
        });
      }
    }
  }
  assert.deepEqual(hits, []);
});

test('MOD-18: the scan sees a trade word and ignores look-alikes', () => {
  assert.ok(TRADE_WORDS.test('which tour do you want'));
  assert.ok(TRADE_WORDS.test('Dolphins and whales'));
  assert.ok(!TRADE_WORDS.test('a contour line, a detour, a tourist'));
});
