// docs/04: every input field declares one data class.

export const DATA_CLASSES = ['public', 'deal', 'freetext', 'identity', 'secret'] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

/** Classes that may be mapped to a prompt slot. `freetext` only after the scrubber passes (PRV-6). */
export const PROMPT_SAFE_CLASSES: readonly DataClass[] = ['public', 'deal', 'freetext'];

/** Classes whose values must never appear in a proposal, the ledger or the audit log (PRV-2). */
export const VAULT_CLASSES: readonly DataClass[] = ['identity', 'secret'];

export function isDataClass(value: unknown): value is DataClass {
  return typeof value === 'string' && (DATA_CLASSES as readonly string[]).includes(value);
}
