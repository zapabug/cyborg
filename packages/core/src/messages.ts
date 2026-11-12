// docs/10 ADM-77..80: every sentence the system says to the people who run the business (toasts, ops-chat cards, command replies,
// the handoff card, the morning sheet). Portuguese is the product's default; English is one toggle away (`.lang en`).

export const STAFF_LANGUAGES = ['pt', 'en'] as const;
export type StaffLanguage = (typeof STAFF_LANGUAGES)[number];
/** Read at the moment a sentence is made, so a toggle takes effect at once. */
export type LanguageSource = () => StaffLanguage;
export const ENGLISH: LanguageSource = () => 'en';

export interface StaffMessages {
  prefixPerson: string;
  prefixAttention: string;
  waiting(chat: string): string;
  keyRejected(httpStatus: string | null): string;
  callCap(max: number): string;
  commands: {
    usage(command: string, args: string): string;
    simple(command: string, chat: string): string;
    oooUsage: string;
    ooo(label: string, prefix: string, scheduled: boolean): string;
    backNobody: string;
    back(chats: string): string;
    stoppedAll: string;
    startedAll: string;
    role(chat: string, role: string): string;
    unknown(command: string): string;
    done(chat: string): string;
    language(language: StaffLanguage): string;
    languageUsage: string;
  };
  presence: { onDuty: string; outOfOffice: string; outOfOfficeWithNote: string; back: string };
  card: { handoff(chat: string, since?: string): string; wants: string; collected: string; keepInMind: string; alreadyTold: string; officeToCheck: string; inChat: string; spec: string; state: string };
  /** PRV-6: what a customer wrote that was replaced by a placeholder before the model, in words for staff. */
  redacted: { email: string; phone: string; number: string; iban: string; card: string; id: string; seeChat: string };
  sheet: { morning: string; nothing: string; waitingOffice: string; complaints: string; waitingPerson: string; complaint: string; waitingTitle(chat: string): string; waitingDetail(since: string, last: string): string; complaintSpec: string };
  board: {
    colour: { red: string; yellow: string; green: string };
    reason: { waiting: string; blocked: string; lowConfidence: string; officeToCheck: string; handoff: string; stale: string; draftPending: string };
    action: { takeOver: string; leaveToBot: string };
  };
  attention: { complaintReason: string; handled: string; notAComplaint: string };
  weekdayLocale: string;
}

const pt: StaffMessages = {
  prefixPerson: '[PRECISA DE UMA PESSOA]',
  prefixAttention: '[PRECISA DE ATENÇÃO]',
  waiting: (chat) => `Um cliente está à espera de uma pessoa em ${chat}.`,
  keyRejected: (status) => `O fornecedor do modelo rejeitou a chave ou a conta ficou sem saldo${status ? ` (HTTP ${status})` : ''}. O bot não está a responder aos clientes até isto ser resolvido.`,
  callCap: (max) => `Foi atingido o limite de ${max} chamadas ao modelo em 24 horas. O bot não está a responder aos clientes até o número baixar ou o limite ser aumentado.`,
  commands: {
    usage: (command, args) => `uso: ${command} ${args}`.trim(),
    simple: (command, chat) => `${command}: ${chat}`,
    oooUsage: 'uso: ooo [nota curta, até 40 letras, números e : . , / + ( ) -]',
    ooo: (label, prefix, scheduled) => `fora do escritório${label ? `: ${label}` : ''}. Os clientes à espera não serão avisados à equipa até ${prefix}back${scheduled ? ' ou até o horário mudar' : ''}.`,
    backNobody: 'de volta ao escritório. Ninguém está à espera.',
    back: (chats) => `de volta ao escritório. À espera de uma pessoa: ${chats}`,
    stoppedAll: 'parado em todo o lado',
    startedAll: 'ativo em todo o lado',
    role: (chat, role) => `função: ${chat} agora é ${role}`,
    unknown: (command) => `comando desconhecido "${command}"`,
    done: (chat) => `feito: ${chat}`,
    language: (l) => `idioma da equipa: ${l === 'pt' ? 'português' : 'inglês'}`,
    languageUsage: 'uso: lang pt|en',
  },
  presence: {
    onDuty: 'Há uma pessoa de serviço a acompanhar esta conversa.',
    outOfOffice: 'Neste momento não há ninguém de serviço. Os pedidos ficam registados e uma pessoa trata deles quando regressar.',
    outOfOfficeWithNote: 'Neste momento não há ninguém de serviço. Nota da equipa: {note}. Os pedidos ficam registados e uma pessoa trata deles quando regressar.',
    back: 'regressa',
  },
  card: {
    handoff: (chat, since) => `Passagem: ${chat}${since ? ` (à espera desde ${since})` : ''}`,
    wants: 'pedido', collected: 'recolhido', keepInMind: 'ter em conta', alreadyTold: 'o bot já disse', officeToCheck: 'o escritório deve verificar', inChat: 'na conversa',
    spec: 'Assunto', state: 'Estado',
  },
  redacted: { email: 'um email', phone: 'um número de telefone', number: 'um número (contribuinte ou outro)', iban: 'um número de conta (IBAN)', card: 'um número de cartão de pagamento', id: 'um número de documento', seeChat: 'o bot não viu estes dados; estão na conversa' },
  sheet: {
    morning: 'Manhã',
    nothing: 'Nada pendente.',
    waitingOffice: 'À espera do escritório',
    complaints: 'Reclamações de avaliações',
    waitingPerson: 'À espera de uma pessoa',
    complaint: 'Reclamação',
    waitingTitle: (chat) => `${chat} (à espera de uma pessoa)`,
    waitingDetail: (since, last) => `desde ${since}, última mensagem ${last}`,
    complaintSpec: 'reclamações',
  },
  board: {
    colour: { red: 'precisa de ação agora', yellow: 'passagem da manhã e conversas paradas', green: 'o bot fez o trabalho: falta aceitar' },
    reason: {
      waiting: 'Está à espera de uma pessoa',
      blocked: 'O bot não conseguiu responder em segurança: precisa de uma pessoa',
      lowConfidence: 'O bot não tem a certeza da resposta: precisa de revisão',
      officeToCheck: 'Precisa de uma resposta do escritório',
      handoff: 'Resumo pronto para o escritório',
      stale: 'Conversa parada sem resposta',
      draftPending: 'O bot respondeu sem problemas: falta aceitar',
    },
    action: { takeOver: 'Assumir', leaveToBot: 'Deixar o bot' },
  },
  attention: { complaintReason: 'Há uma reclamação numa avaliação para tratar', handled: 'Tratado', notAComplaint: 'Não é uma reclamação' },
  weekdayLocale: 'pt-PT',
};

const en: StaffMessages = {
  prefixPerson: '[NEEDS A PERSON]',
  prefixAttention: '[NEEDS ATTENTION]',
  waiting: (chat) => `A customer is waiting for a person in ${chat}.`,
  keyRejected: (status) => `The inference provider rejected the key or the account is out of credit${status ? ` (HTTP ${status})` : ''}. The bot is not answering customers until this is fixed.`,
  callCap: (max) => `The limit of ${max} model calls in 24 hours was reached. The bot is not answering customers until the count drops or the limit is raised.`,
  commands: {
    usage: (command, args) => `usage: ${command} ${args}`.trim(),
    simple: (command, chat) => `${command}: ${chat}`,
    oooUsage: 'usage: ooo [short note, up to 40 letters, digits and : . , / + ( ) -]',
    ooo: (label, prefix, scheduled) => `out of office${label ? `: ${label}` : ''}. Customers waiting will not be pushed to staff until ${prefix}back${scheduled ? ' or the schedule changes' : ''}.`,
    backNobody: 'back in office. Nobody is waiting.',
    back: (chats) => `back in office. Waiting for a person: ${chats}`,
    stoppedAll: 'stopped everywhere',
    startedAll: 'started everywhere',
    role: (chat, role) => `role: ${chat} is now ${role}`,
    unknown: (command) => `unknown command "${command}"`,
    done: (chat) => `done: ${chat}`,
    language: (l) => `staff language: ${l === 'pt' ? 'Portuguese' : 'English'}`,
    languageUsage: 'usage: lang pt|en',
  },
  presence: {
    onDuty: 'A person is on duty and watching this chat.',
    outOfOffice: 'No person is on duty right now. Requests are noted and a person handles them when back.',
    outOfOfficeWithNote: 'No person is on duty right now. Staff note: {note}. Requests are noted and a person handles them when back.',
    back: 'back',
  },
  card: {
    handoff: (chat, since) => `Handoff: ${chat}${since ? ` (waiting since ${since})` : ''}`,
    wants: 'wants', collected: 'collected', keepInMind: 'keep in mind', alreadyTold: 'already told', officeToCheck: 'office to check', inChat: 'in the chat',
    spec: 'Spec', state: 'State',
  },
  redacted: { email: 'an email address', phone: 'a phone number', number: 'a number (tax or other)', iban: 'a bank account number (IBAN)', card: 'a payment card number', id: 'an ID number', seeChat: 'the bot did not see these; they are in the chat' },
  sheet: {
    morning: 'Morning',
    nothing: 'Nothing is pending.',
    waitingOffice: 'Waiting on the office',
    complaints: 'Review complaints',
    waitingPerson: 'Waiting for a person',
    complaint: 'Complaint',
    waitingTitle: (chat) => `${chat} (waiting for a person)`,
    waitingDetail: (since, last) => `since ${since}, last message ${last}`,
    complaintSpec: 'complaints',
  },
  board: {
    colour: { red: 'needs action now', yellow: 'morning handoff and stale chats', green: 'the bot did its job: waiting to be accepted' },
    reason: {
      waiting: 'Waiting for a person',
      blocked: 'The bot could not answer safely: needs a person',
      lowConfidence: 'The bot is not sure of its reply: needs a review',
      officeToCheck: 'Needs an answer from the office',
      handoff: 'A summary is ready for the office',
      stale: 'The chat has gone quiet without an answer',
      draftPending: 'The bot answered without a problem: waiting to be accepted',
    },
    action: { takeOver: 'Take over', leaveToBot: 'Leave it to the bot' },
  },
  attention: { complaintReason: 'A review complaint needs following up', handled: 'Handled', notAComplaint: 'Not a complaint' },
  weekdayLocale: 'en-GB',
};

export const STAFF_MESSAGES: Record<StaffLanguage, StaffMessages> = { pt, en };

export const staffMessages = (language: LanguageSource = ENGLISH): StaffMessages => STAFF_MESSAGES[language()];

/** Portuguese command names for the people who run the desk; each is another name for the same command. */
export const COMMAND_ALIASES: Record<string, string> = {
  parar: 'stop', pausar: 'pause', iniciar: 'start', reiniciar: 'restart', parartudo: 'stopall', iniciartudo: 'startall',
  funcao: 'role', função: 'role', fora: 'ooo', voltei: 'back', feito: 'done', idioma: 'lang',
};
