// ADM-6, ADM-40: no thinking in chat. Reasoning goes to a local scratchpad, never to a channel.

/** Removes `<think>...</think>` blocks; what was removed is returned so it can go to the scratchpad. */
export function stripThinkBlocks(text: string): { text: string; reasoning: string[] } {
  const reasoning: string[] = [];
  const cleaned = text.replace(/<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi, (_m, inner: string) => {
    reasoning.push(inner.trim());
    return '';
  });
  // An opening tag with no closing tag: everything after it is reasoning.
  const open = /<think(?:ing)?>/i.exec(cleaned);
  if (open) {
    reasoning.push(cleaned.slice(open.index + open[0].length).trim());
    return { text: cleaned.slice(0, open.index).trim(), reasoning };
  }
  return { text: cleaned.trim(), reasoning };
}

const REASONING_MARKERS: { id: string; pattern: RegExp }[] = [
  { id: 'think tag', pattern: /<\/?think(?:ing)?>/i },
  { id: 'self-narration', pattern: /\b(let me think|let's think|let me see|okay, so (the|this) user|the user (is asking|wants|said)|i need to (figure|think|check|decide))\b/i },
  { id: 'step-by-step', pattern: /\bstep\s*\d+\s*[:.)]/i },
  { id: 'analysis heading', pattern: /^\s*(reasoning|analysis|thoughts?|chain of thought)\s*:/im },
];

/** ADM-6 machine check: returns the markers found in an output (empty if none). */
export function scanReasoning(text: string): string[] {
  return REASONING_MARKERS.filter((m) => m.pattern.test(text)).map((m) => m.id);
}

/** A local place for internal reasoning and routing trace (wazaa's scratchpad). Nothing here is ever posted. */
export interface Scratchpad {
  write(entry: { at: string; kind: string; ref?: string; text: string }): void;
}
