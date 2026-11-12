import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// feat-wazaa-port WZP-5. Reading a client's real chats needs the client's written agreement first: the fine print is shown in the dashboard, a person of the
// client presses one "I agree" button, and the record (when, which version of the text, the dashboard's operator label) is kept in the channel's data folder on the
// install machine. Until it exists the channel watches nothing. The record is never sent to a model.

export interface AgreementText {
  pt: string[];
  en: string[];
}

/** The framework's own fine print: only what the software does, no business and no promise about a service. Paragraphs, plain text. */
export const FINE_PRINT: AgreementText = {
  en: [
    'This bot reads the WhatsApp chats you choose on this computer, and only those. Chats you leave on "Ignore" are never read, stored or logged.',
    'Before any text is shown to the AI service, phone numbers, email addresses and other numbers in it are replaced by placeholders. Names are not replaced: a name a customer writes in a message reaches the AI service. The AI service is the one you pay for with your own account.',
    'In shadow mode nothing is sent to your customers. The bot writes drafts into your own "Message yourself" chat, and a person decides what is sent.',
    'The chats, drafts and records are kept on this computer, in this business\'s data folder. You can change a chat back to "Ignore" at any time, and the bot stops reading it.',
    'Your customers\' messages are theirs. By agreeing you confirm that you are allowed to let the bot read the chats you choose.',
  ],
  pt: [
    'Este bot lê as conversas de WhatsApp que escolher neste computador, e só essas. As conversas em «Ignorar» nunca são lidas, guardadas nem registadas.',
    'Antes de qualquer texto ser mostrado ao serviço de IA, os números de telefone, os endereços de email e outros números são trocados por marcas. Os nomes não são trocados: um nome que um cliente escreva numa mensagem chega ao serviço de IA. O serviço de IA é o que paga com a sua própria conta.',
    'Em modo sombra nada é enviado aos seus clientes. O bot escreve rascunhos na sua própria conversa («Mensagens para si») e uma pessoa decide o que se envia.',
    'As conversas, os rascunhos e os registos ficam neste computador, na pasta de dados deste negócio. Pode voltar a pôr uma conversa em «Ignorar» a qualquer momento e o bot deixa de a ler.',
    'As mensagens dos seus clientes são deles. Ao concordar, confirma que pode deixar o bot ler as conversas que escolher.',
  ],
};

export interface AgreementRecord {
  /** The dashboard's operator label (not a typed name); may be empty. */
  by: string;
  at: string;
  version: string;
}

export interface AgreementView {
  text: AgreementText;
  /** The business's own terms (`terms.md`), shown after the fine print; null when it has none. */
  terms: string | null;
  version: string;
  recorded: AgreementRecord | null;
}

const FILE = 'agreement.json';
// N-22 (docs/02).
const NAME_MAX = 120;
const TERMS_MAX = 20_000;

export function versionOf(text: AgreementText, terms: string | null): string {
  return createHash('sha256').update(JSON.stringify([text.en, text.pt, terms ?? ''])).digest('hex').slice(0, 16);
}

/** The business's own terms: `terms.md` in the business folder, if there is one. */
export function readTerms(root: string): string | null {
  const file = resolve(root, 'terms.md');
  if (!existsSync(file)) return null;
  const body = readFileSync(file, 'utf8').trim();
  return body === '' ? null : body.slice(0, TERMS_MAX);
}

export class Agreement {
  constructor(private readonly dataDir: string, private readonly terms: string | null, private readonly text: AgreementText = FINE_PRINT) {}

  get version(): string {
    return versionOf(this.text, this.terms);
  }

  /** The record, if a person agreed to this version of the text; an older version's record does not count. */
  record(): AgreementRecord | null {
    const file = resolve(this.dataDir, FILE);
    if (!existsSync(file)) return null;
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<AgreementRecord>;
      if (typeof raw.by === 'string' && typeof raw.at === 'string' && raw.version === this.version) return { by: raw.by, at: raw.at, version: raw.version };
    } catch { /* a damaged record is no record */ }
    return null;
  }

  agreed(): boolean {
    return this.record() !== null;
  }

  view(): AgreementView {
    return { text: this.text, terms: this.terms, version: this.version, recorded: this.record() };
  }

  /** Records that the client agreed to the text the page showed (`version`). It refuses a version the page did not show. */
  accept(version: string, operator = '', now = new Date()): AgreementRecord {
    if (version !== this.version) throw new Error('the fine print has changed: read it again');
    const by = operator.trim().slice(0, NAME_MAX);
    const record: AgreementRecord = { by, at: now.toISOString(), version };
    mkdirSync(this.dataDir, { recursive: true });
    writeFileSync(resolve(this.dataDir, FILE), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    return record;
  }
}
