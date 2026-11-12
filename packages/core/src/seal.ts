import type { AnyHandler, IdentityVault } from './types.ts';

/**
 * PRV-2: `identity` and `secret` values go to the vault and the handler only ever sees
 * the vault code. So no handler, check or `toProposal` can copy a raw identity value
 * into a proposal, the ledger or the audit log.
 */
export function sealInput(
  handler: AnyHandler,
  input: Record<string, unknown>,
  vault: IdentityVault | undefined,
): Record<string, unknown> {
  const sealed = { ...input };
  for (const [field, cls] of Object.entries(handler.input.classes)) {
    if (cls !== 'identity' && cls !== 'secret') continue;
    const value = input[field];
    if (value === undefined || value === null) continue;
    if (!vault) {
      throw new Error(`handler "${handler.id}" has ${cls} field "${field}" but no identity vault is configured (PRV-2)`);
    }
    sealed[field] = vault.put(cls, typeof value === 'string' ? value : JSON.stringify(value));
  }
  return sealed;
}
