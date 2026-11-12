import { staffMessages, type LanguageSource, type Proposal } from '@cyborg/core';

const RULE = '────────────────────────────────────────';

/**
 * ADM-56, ADM-70: the card in zapa's Status.md layout (Spec: and State: blocks split by rules, no table), made to be read faster than
 * the chat it summarises: a block that holds nothing is left out, and the customer's own words that back each line stay in the proposal
 * (the staff have the chat) unless `evidence` is asked for. It is built in code from the proposal; nothing here calls a model. `chat` is
 * the real chat reference the adapter holds, put back only for display in an admin chat or on the dashboard (never in a prompt).
 */
export function renderHandoffCard(
  proposal: Pick<Proposal, 'changes' | 'findings' | 'questions'>,
  ctx: { chat: string; waitingSince?: string; evidence?: boolean; language?: LanguageSource },
): string {
  const pick = (prefix: string) =>
    proposal.findings
      .filter((f) => f.statement.startsWith(prefix))
      .map((f) => (ctx.evidence ? `${f.statement.slice(prefix.length)} ("${f.evidence}")` : f.statement.slice(prefix.length)));
  const m = staffMessages(ctx.language).card;
  const blocks: [string, string][] = [
    [m.wants, pick('wants: ').join('; ')],
    [m.collected, proposal.changes.map((c) => `${c.field}: ${String(c.newValue)}`).join('; ')],
    [m.inChat, pick('in the chat: ').join('; ')],
    [m.keepInMind, pick('needs: ').join('; ')],
    [m.alreadyTold, pick('the bot said: ').join('; ')],
    [m.officeToCheck, proposal.questions.join('; ')],
  ];
  const lines = blocks.filter(([, state]) => state !== '').map(([spec, state]) => `${m.spec}: ${spec}\n${m.state}: ${state}`);
  const head = m.handoff(ctx.chat, ctx.waitingSince);
  return [head, RULE, lines.join(`\n${RULE}\n`)].join('\n');
}
