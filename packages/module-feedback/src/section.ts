import { Lifecycle, staffMessages, type AttentionSource, type LanguageSource, type MorningSection, type ProposalStore } from '@cyborg/core';
import { REVIEW_HANDLER_ID } from './handlers.ts';

/** ADM-58, ADM-59: complaints nobody has decided on. Approving a proposal means "seen and handled", declining "not a complaint". */
export function complaintsSection(proposals: Pick<ProposalStore, 'list'>, language?: LanguageSource): MorningSection {
  return {
    get heading() {
      return staffMessages(language).sheet.complaints;
    },
    blocks: () => {
      const m = staffMessages(language);
      return proposals
        .list({ handlerId: REVIEW_HANDLER_ID, status: 'proposed' })
        .map((p) => `${m.sheet.complaint}: ${p.subject}\n${m.card.spec}: ${m.sheet.complaintSpec}\n${m.card.state}: ${p.findings.map((f) => `${f.statement.replace(/^complaint: /, '')} ("${f.evidence}")`).join('; ')}`);
    },
  };
}

/**
 * ADM-92: the same complaints as an attention source, so the dashboard shows them and toasts them without knowing this module.
 * They are yellow: they need a person's follow-up, not an answer now. "Handled" approves the proposal, "not a complaint" declines it.
 */
export function complaintsAttention(store: ProposalStore, language?: LanguageSource): AttentionSource {
  const lifecycle = new Lifecycle({ store });
  const m = () => staffMessages(language);
  const open = () => store.list({ handlerId: REVIEW_HANDLER_ID, status: 'proposed' });
  return {
    id: 'feedback',
    items: () =>
      open().map((p) => {
        const topics = p.findings.map((f) => f.statement.replace(/^complaint: /, '')).join('; ');
        return {
          key: `feedback:${p.id}`,
          source: 'feedback',
          kind: 'complaint',
          colour: 'yellow' as const,
          title: p.subject,
          summary: topics,
          reference: p.subject,
          reasonText: m().attention.complaintReason,
          since: p.createdAt,
          reasons: ['complaint'],
          actions: [
            { id: 'handled', label: m().attention.handled },
            { id: 'not_a_complaint', label: m().attention.notAComplaint },
          ],
        };
      }),
    act: (key, action, by) => {
      const id = key.replace(/^feedback:/, '');
      if (action === 'handled') lifecycle.decide(id, 'approve', by);
      else if (action === 'not_a_complaint') lifecycle.decide(id, 'decline', by);
      else throw new Error(`"${action}" is not an action of a complaint`);
    },
    detail: async (key) => {
      const p = store.get(key.replace(/^feedback:/, ''));
      return p ? { title: p.subject, text: p.findings.map((f) => `${f.statement.replace(/^complaint: /, '')} ("${f.evidence}")`).join('\n') } : null;
    },
  };
}
