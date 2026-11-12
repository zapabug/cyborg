import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Reads the customer messages out of wazaa's own test chats (MOD-7a): the `text: '...'` strings in its
 * `tests/*.test.ts`. Staff commands (a leading dot, or an all-capital command) and blanks are skipped.
 * The directory is read at run time and nothing is copied into this repository (HR-4, MOD-8).
 */
export function extractWazaaChats(testsDir: string): string[] {
  const chats = new Set<string>();
  for (const file of readdirSync(testsDir).filter((f) => f.endsWith('.test.ts'))) {
    for (const m of readFileSync(join(testsDir, file), 'utf8').matchAll(/\btext:\s*'((?:[^'\\]|\\.)*)'/g)) {
      const text = m[1]!.replace(/\\'/g, "'").trim();
      if (!text || text.startsWith('.') || /^[A-Z0-9][A-Z0-9 \-:]*$/.test(text)) continue;
      chats.add(text);
    }
  }
  return [...chats];
}

/** WZP-82: wazaa's scripted customer lines as a simulation script (docs/12): each line is its own chat, so no line leans on another's state. Validate with `validateScript`. */
export function scriptFromChats(chats: readonly string[], start: string): { start: string; steps: { do: 'customer'; chat: string; text: string }[] } {
  return { start, steps: chats.map((text, i) => ({ do: 'customer' as const, chat: `w${i + 1}`, text })) };
}
