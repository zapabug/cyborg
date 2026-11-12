import { appendFileSync, chmodSync, closeSync, openSync } from 'node:fs';
import type { Scratchpad } from '@cyborg/core';

/** ADM-40: an append-only local JSON-lines file for internal reasoning and routing trace. Owner-only; nothing here is posted. */
export class FileScratchpad implements Scratchpad {
  constructor(private readonly path: string) {
    closeSync(openSync(path, 'a', 0o600));
    chmodSync(path, 0o600);
  }

  write(entry: { at: string; kind: string; ref?: string; text: string }): void {
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`);
  }
}
