import { staffMessages, type ControlStore, type IdentityVault, type LanguageSource, type MorningSection, type Proposal, type ProposalStore } from '@cyborg/core';
import { renderHandoffCard } from './card.ts';

const CARD_HANDLER = 'sales.handoff.card';
const LIVE_STATUSES: Proposal['status'][] = ['proposed', 'approved', 'applied'];

export interface MorningDeps {
  proposals: Pick<ProposalStore, 'list'>;
  vault: Pick<IdentityVault, 'get'>;
  control: Pick<ControlStore, 'lastSettledAt' | 'listOpenWaiting'>;
}

export interface PendingChat {
  chat: string;
  proposal: Proposal;
}

/**
 * ADM-57: chats whose latest card still has a question only the office can answer, and where nobody has replied or said `.done`
 * since the card was made. The real chat reference comes back from the vault here, for display to the admins only.
 */
export function pendingChats(deps: Pick<MorningDeps, 'proposals' | 'vault' | 'control'>): PendingChat[] {
  const latest = new Map<string, Proposal>();
  for (const proposal of deps.proposals.list({ handlerId: CARD_HANDLER })) {
    if (!LIVE_STATUSES.includes(proposal.status)) continue;
    const seen = latest.get(proposal.subject);
    if (!seen || seen.createdAt <= proposal.createdAt) latest.set(proposal.subject, proposal);
  }
  const pending: PendingChat[] = [];
  for (const proposal of latest.values()) {
    if (proposal.questions.length === 0) continue;
    const chat = deps.vault.get(proposal.subject)?.value;
    if (!chat) continue;
    const settled = deps.control.lastSettledAt(chat);
    if (settled !== null && settled >= proposal.createdAt) continue;
    pending.push({ chat, proposal });
  }
  return pending.sort((a, b) => a.proposal.createdAt.localeCompare(b.proposal.createdAt));
}

/** ADM-57, ADM-59: the sales module's contribution to the morning sheet: the cards still waiting on the office. */
export function officeAnswersSection(deps: Pick<MorningDeps, 'proposals' | 'vault' | 'control'>, language?: LanguageSource): MorningSection {
  return {
    get heading() {
      return staffMessages(language).sheet.waitingOffice;
    },
    blocks: () => pendingChats(deps).map(({ chat, proposal }) => renderHandoffCard(proposal, { chat, waitingSince: proposal.createdAt, ...(language ? { language } : {}) })),
  };
}
