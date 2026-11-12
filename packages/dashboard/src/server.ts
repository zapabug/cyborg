import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Company, TestChat } from '@cyborg/company';
import { STAFF_LANGUAGES, type FlagReason, type Marking, type StaffLanguage } from '@cyborg/core';
import { PAGE } from './page.ts';
import { SERVICE_WORKER } from './sw.ts';
import { deskTabs } from './desk-tabs.ts';
import type { SheetStore } from './business-tab.ts';
import { tabsForPage, testChatTab, validateTabs, type DashboardTab } from './tabs.ts';

// docs/10 ADM-86..90: the company dashboard. A small web server for the office machine, on the machine's own address only.

export interface DashboardOptions {
  /** 0 picks a free port. */
  port?: number;
  /** Replaces the random token (tests). */
  token?: string;
  /** How often the live stream looks for a change, in ms. */
  streamEveryMs?: number;
  now?: () => Date;
  /** ADM-111: the channel adapter's link state, shown as a panel while it is not null. */
  link?: () => LinkStatus | null;
  /** WZP-10: a test chat to type into from the page (its own company, never the install's). It is contributed as the Test tab; without it there is none (DSH-4). */
  testChat?: TestChat;
  /** feat-tailored: where the Business tab keeps the client's words (a file in the customer repository). Without it the tab still works and keeps nothing. */
  businessSheet?: SheetStore;
  /** WZP-40: the tabs the company's modules and integrations contribute. The shell knows none of them. */
  tabs?: DashboardTab[];
  /** The company's name for the header and the page title: the brand is the company's, never the framework's (DSH-7). */
  name?: string;
}

/** ADM-111: how linking a channel stands. The dashboard draws `qr` and knows no channel (ADM-102). */
export interface LinkStatus {
  channel: string;
  state: 'starting' | 'waiting' | 'linking' | 'linked' | 'error';
  /** The code to scan as rows of `0`/`1` modules (`1` is dark). */
  qr?: string[];
  /** The linked account, as the adapter shows it. */
  account?: string;
  /** An extra line per staff language. */
  hint?: Partial<Record<StaffLanguage, string>>;
}

export interface Dashboard {
  url: string;
  port: number;
  /** Sent by the page with every request; anything without it is refused (ADM-87). */
  token: string;
  close(): Promise<void>;
}

const same = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 10_000) throw new Error('request too large');
    chunks.push(chunk as Buffer);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

/**
 * ADM-87. Safe by construction for a page on the office machine: it listens on 127.0.0.1 only; a request whose Host is not this
 * address is refused (a web page on another site cannot reach it through DNS tricks); every API call and every change needs the token
 * the page was served with, which no other site can read; a browser Origin that is not this page is refused; nothing is cached; the
 * page loads nothing from outside.
 */
export async function startDashboard(company: Company, options: DashboardOptions = {}): Promise<Dashboard> {
  const token = options.token ?? randomBytes(24).toString('hex');
  const now = options.now ?? (() => new Date());
  const language = (): StaffLanguage => company.store.getLanguage() ?? 'pt';
  let port = 0;
  const tabs = validateTabs([...deskTabs(company, options.businessSheet), ...(options.testChat ? [testChatTab(options.testChat)] : []), ...(options.tabs ?? [])]);
  const html = PAGE.replace('/*__TABS__*/[]', () => tabsForPage(tabs)).replaceAll('__NAME__', (options.name ?? 'Cyborg').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`));
  const fontsDir = fileURLToPath(new URL('../assets/fonts/', import.meta.url));
  const fonts = new Set(readdirSync(fontsDir).filter((f) => /^[a-z0-9-]+\.woff2$/.test(f)));

  // ADM-92: the dashboard knows no module. It shows whatever the plug-ins say needs a person.
  const state = () => ({
    language: company.store.getLanguage() ?? company.defaultLanguage,
    items: company.attention().map((item) => ({ ...item, toast: company.attentionToast(item) })),
    alerts: company.store.listOpenAlerts(),
    link: options.link?.() ?? null,
    tabs: tabs.map((t) => ({ id: t.id, chip: t.chip ?? null })),
  });

  const operator = (req: IncomingMessage): string => {
    const raw = String(req.headers['x-cyborg-operator'] ?? '');
    let name = raw;
    try { name = decodeURIComponent(raw); } catch { /* keep the raw value */ }
    const clean = name.replace(/[^\p{L}\p{N} .-]/gu, '').trim().slice(0, 40);
    return `dashboard:${clean || 'operator'}`;
  };

  const server: Server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const host = String(req.headers.host ?? '');
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return json(res, 403, { error: 'wrong host' });
      const origin = req.headers.origin;
      if (typeof origin === 'string' && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) return json(res, 403, { error: 'wrong origin' });
      const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };

      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { ...headers, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'" });
        return void res.end(html.replace('__TOKEN__', token).replace('__LANG__', language()));
      }
      // DSH-6: the three fonts are bundled with the package and served from here, never fetched from outside (ADM-87).
      const font = /^\/assets\/fonts\/([a-z0-9-]+\.woff2)$/.exec(url.pathname);
      if (req.method === 'GET' && font && fonts.has(font[1]!)) {
        res.writeHead(200, { ...headers, 'content-type': 'font/woff2' });
        return void res.end(readFileSync(join(fontsDir, font[1]!)));
      }
      if (req.method === 'GET' && url.pathname === '/sw.js') {
        res.writeHead(200, { ...headers, 'content-type': 'text/javascript; charset=utf-8', 'service-worker-allowed': '/' });
        return void res.end(SERVICE_WORKER);
      }

      // Everything below needs the token; the live stream takes it in the address because EventSource cannot set headers.
      const given = String(req.headers['x-cyborg-token'] ?? (url.pathname === '/api/stream' ? url.searchParams.get('token') : '') ?? '');
      if (!same(given, token)) return json(res, 403, { error: 'missing or wrong token' });

      if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, state());
      if (req.method === 'GET' && url.pathname === '/api/sheet') return json(res, 200, { text: company.morningSheet() });
      if (req.method === 'GET' && url.pathname === '/api/stream') {
        res.writeHead(200, { ...headers, 'content-type': 'text/event-stream', connection: 'keep-alive' });
        let last = '';
        const send = () => {
          const payload = JSON.stringify(state());
          if (payload !== last) { last = payload; res.write(`data: ${payload}\n\n`); }
        };
        send();
        const timer = setInterval(send, options.streamEveryMs ?? 2000);
        req.on('close', () => clearInterval(timer));
        return;
      }

      const chat = /^\/api\/chat\/([^/]+)(?:\/([a-z-]+))?$/.exec(url.pathname);
      if (chat) {
        const id = decodeURIComponent(chat[1]!);
        if (req.method === 'GET' && !chat[2]) return json(res, 200, await company.chatView(id));
        if (req.method === 'POST' && chat[2]) {
          const by = operator(req);
          if (chat[2] === 'take-over') company.takeOver(id, by);
          else if (chat[2] === 'hand-back') company.handBack(id, by);
          else if (chat[2] === 'done') company.gate.personReplied(id, by);
          else if (chat[2] === 'leave-to-bot') company.actOnItem(`desk:${id}`, 'leave_to_bot', by);
          else return json(res, 404, { error: 'no such action' });
          return json(res, 200, { ok: true });
        }
      }
      // ADM-91: approving or declining a waiting proposal, and marking a shadow entry. A refusal by the rules is a 400, not a crash.
      // ADM-92: the generic item view and its buttons, for any plug-in.
      const item = /^\/api\/item\/([^/]+)(?:\/act\/([a-z_]+))?$/.exec(url.pathname);
      if (item) {
        const key = decodeURIComponent(item[1]!);
        if (req.method === 'GET' && !item[2]) {
          const found = company.attention().find((i) => i.key === key) ?? null;
          const source = company.sources.find((s) => key.startsWith(`${s.id}:`));
          return json(res, 200, { item: found, detail: (await source?.detail?.(key)) ?? null });
        }
        if (req.method === 'POST' && item[2]) {
          try {
            company.actOnItem(key, item[2], operator(req));
            return json(res, 200, { ok: true });
          } catch (error) {
            return json(res, 400, { error: (error as Error).message });
          }
        }
      }
      const decide = /^\/api\/proposal\/([^/]+)\/decide$/.exec(url.pathname);
      const markPath = /^\/api\/audit\/([^/]+)\/mark$/.exec(url.pathname);
      if (req.method === 'GET' && url.pathname === '/api/audit') return json(res, 200, { rows: company.auditQueue({ limit: 200 }), counts: company.auditCounts(), records: company.trackRecords() });
      if (req.method === 'POST' && (decide || markPath)) {
        try {
          const body = (await readJson(req)) as Record<string, unknown>;
          if (decide) {
            const decision = body['decision'];
            if (decision !== 'approve' && decision !== 'decline') return json(res, 400, { error: 'decision must be approve or decline' });
            const why = { ...(typeof body['reason'] === 'string' && body['reason'] ? { reason: body['reason'] as FlagReason } : {}), ...(typeof body['note'] === 'string' && body['note'] ? { note: body['note'] } : {}) };
            company.decide(decodeURIComponent(decide[1]!), decision, operator(req), why);
          } else {
            const marking = body['marking'] as Marking;
            const factKeys = Array.isArray(body['factKeys']) ? (body['factKeys'] as unknown[]).filter((k): k is string => typeof k === 'string') : undefined;
            company.mark(decodeURIComponent(markPath![1]!), marking, operator(req), factKeys ? { factKeys } : {});
          }
          return json(res, 200, { ok: true });
        } catch (error) {
          return json(res, 400, { error: (error as Error).message });
        }
      }
      const alert = /^\/api\/alerts\/(\d+)\/seen$/.exec(url.pathname);
      if (alert && req.method === 'POST') {
        company.store.markAlertSeen(Number(alert[1]), operator(req), now().toISOString());
        return json(res, 200, { ok: true });
      }
      // WZP-40: a tab's own routes, behind the same host, origin and token checks as everything else, with the operator's name (DSH-3).
      const tabRoute = /^\/api\/tab\/([a-z][a-z0-9-]*)\/([a-z][a-z0-9-]*)$/.exec(url.pathname);
      if (tabRoute && (req.method === 'GET' || req.method === 'POST')) {
        const handler = tabs.find((t) => t.id === tabRoute[1])?.routes?.[tabRoute[2]!];
        if (!handler) return json(res, 404, { error: 'not found' });
        try {
          const body = req.method === 'POST' ? await readJson(req) : {};
          return json(res, 200, await handler({ method: req.method, body, operator: operator(req) }));
        } catch (error) {
          return json(res, 400, { error: (error as Error).message });
        }
      }
      // The log: what the store's audit table holds, newest first (DSH-2 Registo).
      if (req.method === 'GET' && url.pathname === '/api/log') return json(res, 200, { rows: company.store.listAudit().slice(-300).reverse() });
      if (url.pathname === '/api/language' && req.method === 'POST') {
        const body = (await readJson(req)) as { language?: string };
        if (!STAFF_LANGUAGES.includes(body.language as StaffLanguage)) return json(res, 400, { error: 'language must be pt or en' });
        company.store.setLanguage(body.language as StaffLanguage, operator(req), now().toISOString());
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: 'not found' });
    } catch (error) {
      return json(res, 500, { error: (error as Error).message });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => resolve());
  });
  port = (server.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}/`,
    port,
    token,
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
