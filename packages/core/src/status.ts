// docs/02: proposal state machine (BEH-1, BEH-2).

export const STATUSES = [
  'proposed',
  'approved',
  'applied',
  'apply_failed',
  'declined',
  'superseded',
  'expired',
  'invalid_output',
  'reverted',
] as const;
export type ProposalStatus = (typeof STATUSES)[number];

/** BEH-1: a proposal starts in one of these. */
export type InitialStatus = 'proposed' | 'invalid_output';

const LEGAL: Readonly<Record<ProposalStatus, readonly ProposalStatus[]>> = {
  proposed: ['approved', 'declined', 'superseded', 'expired'],
  approved: ['applied', 'apply_failed'],
  applied: ['reverted'],
  apply_failed: [],
  declined: [],
  superseded: [],
  expired: [],
  invalid_output: [],
  reverted: [],
};

export function canTransition(from: ProposalStatus, to: ProposalStatus): boolean {
  return LEGAL[from].includes(to);
}

export function legalTransitions(): [ProposalStatus, ProposalStatus][] {
  return STATUSES.flatMap((from) => LEGAL[from].map((to): [ProposalStatus, ProposalStatus] => [from, to]));
}

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: ProposalStatus | null,
    readonly to: ProposalStatus,
  ) {
    super(`illegal proposal transition ${from ?? '(none)'} -> ${to} (BEH-2)`);
    this.name = 'IllegalTransitionError';
  }
}
