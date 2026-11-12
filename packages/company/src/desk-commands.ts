import type { CyborgEvent, OutboundSink, StaffLanguage } from '@cyborg/core';
import { decideBooking, listBookings } from './bookings.ts';
import { confirmCancelDay, previewCancelDay, type ScheduleOptions } from './bookings-schedule.ts';
import { listPartners, partnerAccount } from './partners.ts';
import { dismissMaintenance, doneMaintenance, listMaintenance, scheduleMaintenance } from './maintenance.ts';
import { answerQuestion, listNotes, listTickets, openQuestions, saveNote, type NoteKind } from './desk.ts';
import type { Company } from './runtime.ts';

// feat-wazaa-port W5, WZP-48: the commands wazaa had that the gate does not: wazaa's save, bug, idea, status, help and the office's ANSWER and LEARN, in
// English and Portuguese. It wraps the company so the core stays as it is: an event from an authorised sender that starts with the command prefix and
// names one of these is handled here and acknowledged to the same sink the gate acknowledges to; everything else goes to the gate unchanged.

const ALIASES: Record<string, string> = {
  save: 'save', guardar: 'save', bug: 'bug', erro: 'bug', fail: 'bug', idea: 'idea', ideia: 'idea', feature: 'idea', suggestion: 'idea',
  status: 'status', estado: 'status', help: 'help', ajuda: 'help', questions: 'questions', perguntas: 'questions',
  answer: 'answer', responder: 'answer', learn: 'learn', aprender: 'learn', forget: 'forget', esquecer: 'forget',
  confirm: 'confirm', confirmar: 'confirm', decline: 'decline', recusar: 'decline', bookings: 'bookings', reservas: 'bookings',
  partners: 'partners', parceiros: 'partners', account: 'account', conta: 'account', cancel: 'cancelday', cancelar: 'cancelday', maintenance: 'maintenance', manutencao: 'maintenance', manutenção: 'maintenance', schedule: 'schedule', agendar: 'schedule', dismiss: 'dismiss', dispensar: 'dismiss', done: 'done', feito: 'done',
};

const WORDS: Record<StaffLanguage, {
  saved: (kind: NoteKind) => string; needNote: (c: string) => string; none: string; open: (n: number, name: string | null, q: string) => string;
  status: (q: number, w: number, t: number, n: number) => string; usageAnswer: (c: string) => string; answered: (kept: boolean) => string; notOpen: string;
  help: (p: string) => string; noQuestions: string;
  usageForget: (c: string) => string; forgetAsk: (n: number, again: string) => string; forgotten: (n: number) => string; forgetNone: string;
  cancelUsage: (c: string) => string; cancelPreview: (date: string, refs: string[], code: string, until: string, c: string) => string; cancelDone: (done: string[], notTold: { ref: string; why: string }[]) => string; cancelCannot: (why: string) => string;
  noPartners: string; partnerLine: (name: string, pickup: string | null) => string; accountUsage: (c: string) => string; accountLine: (name: string, month: string, bookings: number, people: number) => string; noPartner: string;
  noMaintenance: string; mnt: (ref: string, what: string, status: string) => string; usageMnt: (c: string) => string; mntGone: string; mntDone: (ref: string) => string; mntScheduled: (ref: string, date: string) => string; mntDismissed: (ref: string) => string; mntCannot: (why: string) => string;
  noBookings: string; booking: (ref: string, who: string | null, what: string, status: string) => string; usageDecide: (c: string) => string; notABooking: string; decided: (ref: string, approved: boolean) => string; cannot: string;
}> = {
  pt: {
    saved: (k) => (k === 'bug' ? 'Erro guardado.' : k === 'idea' ? 'Ideia guardada.' : 'Nota guardada.'), needNote: (c) => `Escreva a nota a seguir a ${c}.`, none: 'nenhuma pergunta à espera',
    open: (n, name, q) => `${n}. ${name ?? 'cliente sem nome'}: ${q}`, status: (q, w, t, n) => `Perguntas à espera: ${q} · conversas que precisam de uma pessoa: ${w} · pedidos abertos: ${t} · notas: ${n}`,
    usageAnswer: (c) => `Use: ${c} <número da pergunta> <texto>. Veja os números com perguntas.`, answered: (k) => (k ? 'Respondido e guardado nas respostas frequentes (por confirmar).' : 'Respondido.'),
    notOpen: 'Essa pergunta já foi respondida ou não existe.', noQuestions: 'Nenhuma pergunta à espera.',
    usageForget: (c) => `Use: ${c} <conversa>. Mostra o que apagaria; para apagar, repita com sim no fim.`, forgetAsk: (n, again) => `Isto apaga as cópias guardadas desta conversa: ${n} mensagens e respostas, o cartão da conversa e o nome do cliente. Nada é apagado no WhatsApp: apague a conversa lá. Para confirmar, envie: ${again}`, forgotten: (n) => `Esquecida: ${n} mensagens e respostas guardadas foram apagadas. Apague também a conversa no WhatsApp.`, forgetNone: 'Não encontro essa conversa.',
    cancelUsage: (c) => `Use: ${c} <data AAAA-MM-DD ou DD/MM> <passeio ou todos>: <motivo>   e depois   ${c} ok <código>`,
    cancelPreview: (date, refs, code, until, c) => `Cancelar ${date}: ${refs.length} reserva(s): ${refs.join(', ')}. Para enviar: ${c} ok ${code} (válido até ${until}).`,
    cancelDone: (done, notTold) => `Canceladas: ${done.join(', ')}. Avisos preparados para uma pessoa enviar.${notTold.length ? ` Sem aviso: ${notTold.map((n) => `${n.ref} (${n.why})`).join(', ')}.` : ''}`, cancelCannot: (why) => `Não foi possível: ${why}`,
    noPartners: 'Ainda sem parceiros.', partnerLine: (name, pickup) => (pickup ? `${name} (${pickup})` : name), accountUsage: (c) => `Use: ${c} <nome do parceiro> [AAAA-MM]`, accountLine: (name, month, b, p) => `${name}, ${month}: ${b} reserva(s), ${p} pessoa(s).`, noPartner: 'Esse parceiro não existe.',
    noMaintenance: 'Nenhum pedido de manutenção aberto.', mnt: (ref, what, status) => `${ref} · ${what} · ${status}`, usageMnt: (c) => `Use: ${c} <referência, por exemplo MNT-000001>`, mntGone: 'Esse pedido de manutenção não existe.',
    mntDone: (ref) => `${ref} feito.`, mntScheduled: (ref, date) => `${ref} agendado para ${date}.`, mntDismissed: (ref) => `${ref} dispensado.`, mntCannot: (why) => `Não foi possível: ${why}`,
    noBookings: 'Nenhum pedido de reserva à espera.', booking: (ref, who, what, status) => `${ref} · ${who ?? 'cliente sem nome'} · ${what} · ${status}`, usageDecide: (c) => `Use: ${c} <referência, por exemplo B-000001> [nota].`,
    notABooking: 'Esse pedido não existe ou já foi decidido.', decided: (ref, ok) => (ok ? `${ref} confirmada. Nada foi enviado ao cliente: avise-o como sempre.` : `${ref} recusada. Nada foi enviado ao cliente: avise-o como sempre.`), cannot: 'Não foi possível decidir esse pedido.',
    help: (p) => `Comandos (com ${p} à frente): ${p}perguntas, ${p}responder <n> <texto>, ${p}aprender <n> <texto> (responde e guarda), ${p}esquecer <conversa>, ${p}estado, ${p}manutencao, ${p}agendar <MNT-n> <AAAA-MM-DD>, ${p}feito <MNT-n>, ${p}dispensar <MNT-n>, ${p}reservas, ${p}cancelar <dia> <passeio>: <motivo>, ${p}confirmar <B-n> [nota], ${p}recusar <B-n> [nota], ${p}guardar <nota>, ${p}erro <nota>, ${p}ideia <texto>, ${p}ajuda, e os de sempre: stop, pause, start, ooo, back, done, lang.`,
  },
  en: {
    saved: (k) => (k === 'bug' ? 'Bug saved.' : k === 'idea' ? 'Idea saved.' : 'Note saved.'), needNote: (c) => `Write the note after ${c}.`, none: 'no question is waiting',
    open: (n, name, q) => `${n}. ${name ?? 'customer with no name'}: ${q}`, status: (q, w, t, n) => `Questions waiting: ${q} · chats that need a person: ${w} · open tickets: ${t} · notes: ${n}`,
    usageAnswer: (c) => `Use: ${c} <question number> <text>. See the numbers with questions.`, answered: (k) => (k ? 'Answered and kept in the FAQ (to be confirmed).' : 'Answered.'),
    notOpen: 'That question has been answered or does not exist.', noQuestions: 'No question is waiting.',
    usageForget: (c) => `Use: ${c} <chat>. It shows what it would drop; to drop it, send it again with yes at the end.`, forgetAsk: (n, again) => `This drops the saved copies of this chat: ${n} saved messages and replies, the chat's card and the customer's name. Nothing is deleted in WhatsApp: delete the chat there yourself. To confirm, send: ${again}`, forgotten: (n) => `Forgotten: ${n} saved messages and replies were dropped. Delete the chat in WhatsApp too.`, forgetNone: 'I cannot find that chat.',
    cancelUsage: (c) => `Use: ${c} <day YYYY-MM-DD or DD/MM> <service or all>: <reason>   then   ${c} ok <code>`,
    cancelPreview: (date, refs, code, until, c) => `Cancel ${date}: ${refs.length} booking(s): ${refs.join(', ')}. To go ahead: ${c} ok ${code} (valid until ${until}).`,
    cancelDone: (done, notTold) => `Cancelled: ${done.join(', ')}. Notices drafted for a person to send.${notTold.length ? ` Not told: ${notTold.map((n) => `${n.ref} (${n.why})`).join(', ')}.` : ''}`, cancelCannot: (why) => `That could not be done: ${why}`,
    noPartners: 'No partners yet.', partnerLine: (name, pickup) => (pickup ? `${name} (${pickup})` : name), accountUsage: (c) => `Use: ${c} <partner name> [YYYY-MM]`, accountLine: (name, month, b, p) => `${name}, ${month}: ${b} booking(s), ${p} people.`, noPartner: 'That partner does not exist.',
    noMaintenance: 'No maintenance record is open.', mnt: (ref, what, status) => `${ref} · ${what} · ${status}`, usageMnt: (c) => `Use: ${c} <reference, for example MNT-000001>`, mntGone: 'That maintenance record does not exist.',
    mntDone: (ref) => `${ref} done.`, mntScheduled: (ref, date) => `${ref} scheduled for ${date}.`, mntDismissed: (ref) => `${ref} dismissed.`, mntCannot: (why) => `That could not be done: ${why}`,
    noBookings: 'No booking request is waiting.', booking: (ref, who, what, status) => `${ref} · ${who ?? 'customer with no name'} · ${what} · ${status}`, usageDecide: (c) => `Use: ${c} <reference, for example B-000001> [note].`,
    notABooking: 'That request does not exist or has already been decided.', decided: (ref, ok) => (ok ? `${ref} confirmed. Nothing was sent to the customer: tell them as usual.` : `${ref} declined. Nothing was sent to the customer: tell them as usual.`), cannot: 'That request could not be decided.',
    help: (p) => `Commands (with ${p} in front): ${p}questions, ${p}answer <n> <text>, ${p}learn <n> <text> (answers and keeps it), ${p}forget <chat>, ${p}status, ${p}maintenance, ${p}schedule <MNT-n> <YYYY-MM-DD>, ${p}done <MNT-n>, ${p}dismiss <MNT-n>, ${p}bookings, ${p}cancel <day> <service>: <reason>, ${p}confirm <B-n> [note], ${p}decline <B-n> [note], ${p}save <note>, ${p}bug <note>, ${p}idea <text>, ${p}help, and the usual ones: stop, pause, start, ooo, back, done, lang.`,
  },
};

export interface DeskCommandOptions {
  commandPrefix: string;
  /** The same list the gate reads (it may change while the channel runs). */
  authorisedSenders: readonly string[];
  /** Where the gate sends acknowledgements. */
  ack: OutboundSink;
  /** The booking settings, when cancelling a service day is switched on (WZP-63). */
  bookings?: ScheduleOptions;
}

export function withDeskCommands(company: Company, options: DeskCommandOptions): Company {
  const language = () => company.store.getLanguage() ?? company.defaultLanguage;
  const nameOf = (chat: string) => {
    const code = company.store.getContact(chat);
    const full = code ? company.vault.get(code)?.value ?? null : null;
    return full ? (full.trim().split(/\s+/)[0] ?? null) : null;
  };
  const run = async (word: string, rest: string, chat: string, by: string): Promise<string> => {
    const w = WORDS[language()];
    const prefix = options.commandPrefix;
    switch (word) {
      case 'help': return w.help(prefix);
      case 'save': case 'bug': case 'idea': {
        if (rest === '') return w.needNote(`${prefix}${word}`);
        saveNote(company, word, rest, by, chat);
        return w.saved(word);
      }
      case 'status': {
        const waiting = company.board().filter((r) => r.colour !== 'none').length;
        return w.status(openQuestions(company).length, waiting, listTickets(company).filter((t) => t.ticket.status === 'open').length, listNotes(company).length);
      }
      case 'questions': {
        const open = openQuestions(company);
        return open.length ? open.map((q, i) => w.open(i + 1, q.name, q.questions[0] ?? '')).join('\n') : w.noQuestions;
      }
      case 'answer': case 'learn': {
        const m = /^(\d+)\s+([\s\S]+)$/.exec(rest);
        if (!m) return w.usageAnswer(`${prefix}${word}`);
        const question = openQuestions(company)[Number(m[1]) - 1];
        if (!question) return w.notOpen;
        const { remembered } = answerQuestion(company, question.chat, m[2]!, by, word === 'learn' && question.questions[0] ? { remember: question.questions[0] } : {});
        return w.answered(remembered);
      }
      case 'forget': {
        // ADM-115: two steps. The first shows what would be dropped; only the same command with yes drops it.
        const m = /^(\S+)(?:\s+(yes|sim))?$/i.exec(rest.trim());
        if (!m) return w.usageForget(`${prefix}${word}`);
        const token = m[1]!;
        const rows = company.board().filter((r) => r.chat === token || (r.name !== null && r.name.toLowerCase() === token.toLowerCase()));
        const target = rows.length === 1 ? rows[0]!.chat : company.store.chatEntryCount(token) > 0 ? token : null;
        if (target === null) return w.forgetNone;
        if (m[2] === undefined) return w.forgetAsk(company.store.chatEntryCount(target), `${prefix}${word} ${token} yes`);
        return w.forgotten(company.forgetChat(target, by).entries);
      }
      case 'partners': {
        const all = listPartners(company);
        return all.length ? all.map((p) => w.partnerLine(p.name, p.pickup)).join('\n') : w.noPartners;
      }
      case 'account': {
        const m = /^(.+?)(?:\s+(\d{4}-\d{2}))?$/.exec(rest);
        if (!m) return w.accountUsage(`${prefix}${language() === 'pt' ? 'conta' : 'account'}`);
        const partner = listPartners(company).find((p) => p.name.toLowerCase() === m[1]!.trim().toLowerCase());
        if (!partner) return w.noPartner;
        const month = m[2] ?? new Date().toISOString().slice(0, 7);
        const a = partnerAccount(company, partner.chat, month);
        return w.accountLine(partner.name, month, a.bookings, a.people);
      }
      case 'cancelday': {
        const c = options.bookings;
        const cmd = `${prefix}${language() === 'pt' ? 'cancelar' : 'cancel'}`;
        const m = /^ok\s+(\d{4})$/i.exec(rest);
        try {
          if (m) {
            const run = await confirmCancelDay(company, { code: m[1]!, by }, c!);
            return w.cancelDone(run.cancelled, run.notTold);
          }
          const p = /^(\S+)\s+(.+?)\s*:\s*([\s\S]+)$/.exec(rest);
          if (!p) return w.cancelUsage(cmd);
          const service = /^(all|todos|todas)$/i.test(p[2]!.trim()) ? null : p[2]!.trim();
          const preview = previewCancelDay(company, { date: p[1]!, service, reason: p[3]!, by }, c!);
          return w.cancelPreview(preview.date, preview.refs, preview.code, preview.expiresAt.slice(11, 16), cmd);
        } catch (error) {
          return w.cancelCannot((error as Error).message);
        }
      }
      case 'maintenance': {
        const open = listMaintenance(company).filter((r) => r.status === 'open' || r.status === 'scheduled');
        return open.length ? open.map((r) => w.mnt(r.ref, `${r.label ?? r.asset}: ${r.issue}${r.mentions > 1 ? ` (×${r.mentions})` : ''}`, `${r.priority}${r.status === 'scheduled' ? `, scheduled ${r.scheduledFor ?? ''}` : ''}`)).join('\n') : w.noMaintenance;
      }
      case 'schedule': case 'dismiss': case 'done': {
        const m = /^(?:MNT-)?0*(\d+)\s*([\s\S]*)$/i.exec(rest);
        if (!m) return w.usageMnt(`${prefix}${word}`);
        const record = listMaintenance(company).find((r) => r.ref === `MNT-${m[1]!.padStart(6, '0')}`);
        if (!record) return w.mntGone;
        try {
          if (word === 'schedule') { scheduleMaintenance(company, record.id, m[2]!.trim(), by); return w.mntScheduled(record.ref, m[2]!.trim()); }
          if (word === 'dismiss') { dismissMaintenance(company, record.id, by, m[2]!.trim() || undefined); return w.mntDismissed(record.ref); }
          doneMaintenance(company, record.id, by);
          return w.mntDone(record.ref);
        } catch (error) {
          return w.mntCannot((error as Error).message);
        }
      }
      case 'bookings': {
        const open = listBookings(company).filter((b) => b.status === 'proposed').reverse();
        return open.length ? open.map((b) => w.booking(b.ref, b.name, `${b.service} × ${b.partySize}, ${b.date}, ${b.total}`, b.status)).join('\n') : w.noBookings;
      }
      case 'confirm': case 'decline': {
        const m = /^(?:B-)?0*(\d+)\b\s*([\s\S]*)$/i.exec(rest);
        if (!m) return w.usageDecide(`${prefix}${word}`);
        const booking = listBookings(company).find((b) => b.ref === `B-${m[1]!.padStart(6, '0')}`);
        if (!booking || booking.status !== 'proposed') return w.notABooking;
        try {
          decideBooking(company, booking.id, word === 'confirm' ? 'approve' : 'decline', by, m[2]!.trim() || undefined);
        } catch {
          return w.cannot;
        }
        return w.decided(booking.ref, word === 'confirm');
      }
      default: return w.help(prefix);
    }
  };
  return {
    ...company,
    async process(event: CyborgEvent) {
      const p = event.payload;
      const text = typeof p['text'] === 'string' ? p['text'] : '';
      const sender = typeof p['sender'] === 'string' ? p['sender'] : '';
      const chat = typeof p['chat'] === 'string' ? p['chat'] : '';
      if (text.startsWith(options.commandPrefix) && options.authorisedSenders.includes(sender) && company.store.getRole(chat) !== null && company.store.getRole(chat) !== 'ignored') {
        const [first = '', ...more] = text.slice(options.commandPrefix.length).trim().split(/\s+/);
        const word = ALIASES[first.toLowerCase()];
        // `.done <chat>` is the gate's own; only `.done MNT-n` is the maintenance record's (the gate keeps its meaning).
        if (word && (word !== 'done' || /^MNT-?\d+/i.test(more.join(' ').trim())) && (word !== 'cancelday' || options.bookings?.config.cancellations)) {
          const ack = await run(word, more.join(' ').trim(), chat, `command:${sender}`);
          await options.ack.send({ text: ack });
          return { ran: false as const, decision: { kind: 'command' as const, command: word, ack } };
        }
      }
      return company.process(event);
    },
  };
}
