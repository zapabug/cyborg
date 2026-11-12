import { readFileSync, statSync } from 'node:fs';
import { scrub, type RuntimeFactSource } from '@cyborg/core';

/** CMP-27: a fact sentence is short. A longer one is a table dumped into a prompt. */
export const MAX_FACT_SENTENCE = 600;

/**
 * CMP-29: the generic add-on. Anything that can export a file (a job sheet saved as CSV, a GPS tool's export, a script's output)
 * plugs in through this. The adapter writes `derive`, which turns the file into ONE sentence in code, so raw rows, coordinates and
 * names stay on the machine. The sentence is checked: too long or caught by the scrubber (a phone number, an email) and it is
 * refused with the reason, and the handler that needs the fact does not run. A missing file means no data. The file's
 * modification time is when the data was true.
 */
export function fileFactSource(options: {
  path: string;
  class?: 'public' | 'deal';
  maxAgeMs: number;
  derive(contents: string, asOf: Date): string | null;
}): RuntimeFactSource {
  return {
    class: options.class ?? 'deal',
    maxAgeMs: options.maxAgeMs,
    read() {
      let stat;
      try {
        stat = statSync(options.path);
      } catch {
        return null;
      }
      const asOf = stat.mtime;
      const sentence = options.derive(readFileSync(options.path, 'utf8'), asOf);
      if (sentence === null) return null;
      if (sentence.length > MAX_FACT_SENTENCE) throw new Error(`the derived sentence is ${sentence.length} characters; the limit is ${MAX_FACT_SENTENCE}. Summarise it in the adapter`);
      const hits = scrub(sentence);
      if (hits.length > 0) throw new Error(`the derived sentence contains personal data (${[...new Set(hits.map((h) => h.rule))].join(', ')}); derive a sentence without it`);
      return { sentence, asOf: asOf.toISOString() };
    },
  };
}
