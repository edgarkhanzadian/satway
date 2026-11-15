import type {
  BrowserContext,
  Page,
  Request as PlaywrightRequest,
  Route,
  WebSocketRoute,
} from '@playwright/test';
import { base64 } from '@scure/base';

import { API_ORIGIN, APP_ORIGIN, PAGE_REACHABLE_UPSTREAMS } from '../config.js';
import { EVM_WALLET_NAME, type EvmWallet } from '../wallets/evm-wallet.js';
import {
  SOLANA_WALLET_NAME,
  type SolanaFeature,
  type SolanaWallet,
} from '../wallets/solana-wallet.js';
import {
  STACKS_WALLET_ID,
  STACKS_WALLET_NAME,
  type StacksWallet,
} from '../wallets/stacks-wallet.js';
import type { ApiWorker } from '../worker/worker.js';
import { type Gate, gate } from '../world/clock.js';
import { RELAY_ORIGIN, VERIFY_ORIGIN } from '../world/walletconnect-relay.js';
import type { World } from '../world/world.js';
import { type PageScriptOptions, installSatwayPage } from './page-script.js';

export const BINDING = '__satwayE2E';

export type WalletConnectMode = 'blocked' | 'fake-relay';

const VERIFY_PAGE = [
  '<!doctype html><html><head><title>verify</title><script>',
  'const query = new URLSearchParams(location.search);',
  "const part = value => btoa(JSON.stringify(value)).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');",
  "const attestation = [part({ alg: 'none', typ: 'JWT' }), part({ id: query.get('id'), origin: query.get('origin'), isVerified: true, isScam: false }), 'AAAA'].join('.');",
  "parent.postMessage(JSON.stringify({ type: 'verify_attestation', attestation }), '*');",
  '</script></head><body></body></html>',
].join('\n');

const ICON =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiBmaWxsPSIjMzMzIi8+PC9zdmc+';

export interface WalletSetup {
  evm: boolean;
  solana: false | { features: readonly SolanaFeature[] };
  stacks: boolean;
}

export interface Wallets {
  evm: EvmWallet;
  solana: SolanaWallet;
  stacks: StacksWallet;
}

export interface BrowserEvent {
  page: string;
  text: string;
  url?: string;
}

interface BackendOutage {
  method: string | undefined;
  path: RegExp | undefined;
  mode: 'refused' | 'hang';
  remaining: number;
}

export interface NetworkEntry {
  page: string;
  method: string;
  url: string;
  handledBy: 'app' | 'worker' | 'world' | 'blocked';
  status?: number | 'hang' | 'network-error';
}

function pageName(page: Page | null, pages: Map<Page, string>): string {
  if (!page) return 'no-page';
  const known = pages.get(page);
  if (known) return known;
  const name = `page-${pages.size + 1}`;
  pages.set(page, name);
  return name;
}

const SIMPLE_CONTENT_TYPES: readonly string[] = [
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
];

function listHeader(value: string | null): string[] {
  return (value ?? '')
    .split(',')
    .map(v => v.trim().toLowerCase())
    .filter(v => v !== '');
}

function unsafeRequestHeaders(request: Request): string[] {
  const contentType = request.headers.get('content-type');
  if (contentType === null) return [];
  const essence = contentType.split(';')[0]?.trim().toLowerCase();
  return essence !== undefined && SIMPLE_CONTENT_TYPES.includes(essence) ? [] : ['content-type'];
}

function corsProblem(request: Request, response: Response): string | null {
  const origin = request.headers.get('origin');
  if (origin === null) return null;
  const allowOrigin = response.headers.get('access-control-allow-origin');
  if (allowOrigin === origin || allowOrigin === '*') return null;
  return `response did not allow origin ${origin} (got ${allowOrigin ?? 'nothing'})`;
}

const CLOSED =
  /Target page, context or browser has been closed|Target closed|Route is already handled/;

async function unlessClosed(settle: () => Promise<void>): Promise<void> {
  try {
    await settle();
  } catch (err) {
    if (err instanceof Error && CLOSED.test(err.message)) return;
    throw err;
  }
}

function requestPage(request: PlaywrightRequest): Page | null {
  try {
    return request.frame().page();
  } catch {
    return null;
  }
}

export class Harness {
  readonly network: NetworkEntry[] = [];
  readonly blocked: NetworkEntry[] = [];
  readonly csp: (BrowserEvent & { detail: unknown })[] = [];
  readonly cors: BrowserEvent[] = [];
  readonly pageErrors: BrowserEvent[] = [];
  readonly consoleErrors: BrowserEvent[] = [];
  private readonly pages = new Map<Page, string>();
  private inflight = new Set<string>();
  private lastActivity = performance.now();
  readonly consoleAllowances: RegExp[] = [];
  private counter = 0;
  private walletConnect: WalletConnectMode = 'blocked';
  private readonly outages: BackendOutage[] = [];
  private heldByOutage = 0;
  private outageGate: Gate = gate();
  readonly context: BrowserContext;
  private readonly world: World;
  private readonly worker: ApiWorker;
  private readonly wallets: Wallets;

  constructor(context: BrowserContext, world: World, worker: ApiWorker, wallets: Wallets) {
    this.context = context;
    this.world = world;
    this.worker = worker;
    this.wallets = wallets;
  }

  async install(setup: WalletSetup, walletConnect: WalletConnectMode = 'blocked'): Promise<void> {
    this.walletConnect = walletConnect;
    this.wallets.evm.attach((event, payload) => this.emitEvm(event, payload));
    this.context.on('page', page => this.watchPage(page));
    for (const page of this.context.pages()) this.watchPage(page);
    await this.context.exposeBinding(BINDING, (source, kind: unknown, payload: unknown) =>
      this.onBinding(source.page, kind, payload)
    );
    await this.context.addInitScript(installSatwayPage, this.pageOptions(setup));
    await this.context.route('**/*', route => this.onRoute(route));
    await this.context.routeWebSocket(/.*/, ws => this.onWebSocket(ws));
  }

  private async onWebSocket(ws: WebSocketRoute): Promise<void> {
    const entry: NetworkEntry = {
      page: 'websocket',
      method: 'WS',
      url: ws.url(),
      handledBy: 'blocked',
    };
    this.network.push(entry);
    if (this.walletConnect === 'fake-relay' && new URL(ws.url()).origin === RELAY_ORIGIN) {
      entry.handledBy = 'world';
      const relay = this.world.relay;
      const socket = {
        send: (text: string) => ws.send(text),
        close() {
          void unlessClosed(() => ws.close({ code: 1001, reason: 'The fake relay went away' }));
        },
      };
      const onFrame = relay.accept(socket, ws.url());
      if (!onFrame) {
        entry.status = 'network-error';
        return;
      }
      entry.status = 101;
      ws.onMessage(message => onFrame(typeof message === 'string' ? message : message.toString()));
      ws.onClose(() => relay.closed(socket));
      return;
    }
    this.blocked.push(entry);
    await ws.close({ code: 1008, reason: 'Blocked by the e2e network layer' });
  }

  private pageOptions(setup: WalletSetup): PageScriptOptions {
    const solana = setup.solana;
    return {
      binding: BINDING,
      evm: setup.evm
        ? {
            name: EVM_WALLET_NAME,
            uuid: this.world.rng.uuid(),
            rdns: 'test.satway.evm',
            icon: ICON,
          }
        : null,
      solana: solana
        ? {
            name: SOLANA_WALLET_NAME,
            icon: ICON,
            address: this.wallets.solana.address,
            publicKey: base64.encode(this.wallets.solana.key.publicKey),
            features: solana.features,
          }
        : null,
      stacks: setup.stacks ? { id: STACKS_WALLET_ID, name: STACKS_WALLET_NAME, icon: ICON } : null,
    };
  }

  private watchPage(page: Page): void {
    const name = pageName(page, this.pages);
    page.on('console', message => {
      if (message.type() !== 'error') return;
      this.consoleErrors.push({ page: name, text: message.text(), url: message.location().url });
    });
    page.on('pageerror', error => {
      this.pageErrors.push({
        page: name,
        text: `${error.name}: ${error.message}\n${error.stack ?? ''}`,
      });
    });
  }

  private onBinding(page: Page | null, kind: unknown, payload: unknown): unknown {
    switch (kind) {
      case 'csp':
        this.csp.push({
          page: pageName(page, this.pages),
          text: JSON.stringify(payload),
          detail: payload,
        });
        return null;
      case 'evm':
        return this.wallets.evm.handle(payload);
      case 'solana':
        return this.wallets.solana.handle(payload);
      case 'stacks':
        return this.wallets.stacks.handle(payload);
      default:
        throw new Error(`Unknown e2e binding call ${String(kind)}`);
    }
  }

  private begin(): string {
    this.counter += 1;
    const id = String(this.counter);
    this.inflight.add(id);
    this.lastActivity = performance.now();
    return id;
  }

  private end(id: string): void {
    this.inflight.delete(id);
    this.lastActivity = performance.now();
  }

  touch(): void {
    this.lastActivity = performance.now();
  }

  backendDown(
    rule: { method?: string; path?: RegExp; mode?: 'refused' | 'hang'; times?: number } = {}
  ): void {
    this.outages.push({
      method: rule.method,
      path: rule.path,
      mode: rule.mode ?? 'refused',
      remaining: rule.times ?? Number.MAX_SAFE_INTEGER,
    });
  }

  backendUp(): void {
    this.outages.length = 0;
    this.outageGate.release();
    this.outageGate = gate();
  }

  get heldBackendRequests(): number {
    return this.heldByOutage;
  }

  private takeOutage(method: string, path: string): 'refused' | 'hang' | null {
    const outage = this.outages.find(
      o =>
        o.remaining > 0 &&
        (o.method === undefined || o.method === method) &&
        (o.path === undefined || o.path.test(path))
    );
    if (!outage) return null;
    outage.remaining -= 1;
    return outage.mode;
  }

  allowConsoleErrors(...patterns: RegExp[]): void {
    this.consoleAllowances.push(...patterns);
  }

  private async onRoute(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const entry: NetworkEntry = {
      page: pageName(requestPage(request), this.pages),
      method: request.method(),
      url: request.url(),
      handledBy: 'blocked',
    };
    this.network.push(entry);
    const id = this.begin();
    try {
      if (url.origin === APP_ORIGIN) {
        entry.handledBy = 'app';
        await route.continue();
        return;
      }
      if (url.origin === API_ORIGIN) {
        entry.handledBy = 'worker';
        const outage = this.takeOutage(request.method(), url.pathname);
        if (outage !== null) {
          entry.handledBy = 'blocked';
          if (outage === 'hang') {
            entry.status = 'hang';
            this.heldByOutage += 1;
            try {
              await this.outageGate.promise;
            } finally {
              this.heldByOutage -= 1;
            }
          }
          entry.status = 'network-error';
          await unlessClosed(() => route.abort('connectionrefused'));
          return;
        }
        const fetchRequest = await this.toFetchRequest(request);
        const preflightProblem = await this.preflight(fetchRequest);
        const response = preflightProblem ? null : await this.worker.dispatch(fetchRequest);
        const problem = preflightProblem ?? (response ? corsProblem(fetchRequest, response) : null);
        if (problem || !response) {
          entry.status = 'network-error';
          this.cors.push({
            page: entry.page,
            text: `${entry.method} ${entry.url}: ${problem ?? 'no response'}`,
          });
          await unlessClosed(() => route.abort('failed'));
          return;
        }
        entry.status = response.status;
        const headers: Record<string, string> = {};
        response.headers.forEach((value, name) => {
          headers[name] = value;
        });
        const body = await response.text();
        await unlessClosed(() => route.fulfill({ status: response.status, headers, body }));
        return;
      }
      if (PAGE_REACHABLE_UPSTREAMS.includes(url.origin)) {
        entry.handledBy = 'world';
        const reply = await this.world.serve('page', {
          method: request.method(),
          url: request.url(),
          headers: new Headers(await request.allHeaders()),
          body: request.postData() ?? '',
        });
        if (reply === 'hang') {
          entry.status = 'hang';
          return;
        }
        if (reply === 'network-error') {
          entry.status = 'network-error';
          await unlessClosed(() => route.abort('failed'));
          return;
        }
        entry.status = reply.status;
        await unlessClosed(() =>
          route.fulfill({ status: reply.status, headers: reply.headers, body: reply.body })
        );
        return;
      }
      if (
        this.walletConnect === 'fake-relay' &&
        url.origin === VERIFY_ORIGIN &&
        url.pathname === '/v3/attestation'
      ) {
        entry.handledBy = 'world';
        entry.status = 200;
        this.world.relay.verifyLoads.push(request.url());
        await unlessClosed(() =>
          route.fulfill({
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
            body: VERIFY_PAGE,
          })
        );
        return;
      }
      this.blocked.push(entry);
      await route.abort('blockedbyclient');
    } finally {
      this.end(id);
    }
  }

  private async preflight(request: Request): Promise<string | null> {
    const origin = request.headers.get('origin');
    const unsafe = unsafeRequestHeaders(request);
    const simpleMethod = ['GET', 'HEAD', 'POST'].includes(request.method);
    if (origin === null || (simpleMethod && unsafe.length === 0)) return null;
    const response = await this.worker.dispatch(
      new Request(request.url, {
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': request.method,
          ...(unsafe.length > 0 ? { 'access-control-request-headers': unsafe.join(',') } : {}),
        },
      })
    );
    if (response.status < 200 || response.status > 299)
      return `preflight answered ${response.status}`;
    const allowOrigin = response.headers.get('access-control-allow-origin');
    if (allowOrigin !== origin && allowOrigin !== '*')
      return `preflight did not allow origin ${origin} (got ${allowOrigin ?? 'nothing'})`;
    const methods = listHeader(response.headers.get('access-control-allow-methods'));
    if (!simpleMethod && !methods.includes(request.method))
      return `preflight did not allow method ${request.method}`;
    const allowed = listHeader(response.headers.get('access-control-allow-headers'));
    const missing = unsafe.filter(h => !allowed.includes(h));
    if (missing.length > 0) return `preflight did not allow headers ${missing.join(', ')}`;
    return null;
  }

  private async toFetchRequest(request: PlaywrightRequest): Promise<Request> {
    const headers = new Headers();
    for (const [name, value] of Object.entries(await request.allHeaders())) {
      if (!name.startsWith(':')) headers.set(name, value);
    }
    const method = request.method();
    const body = request.postData();
    return new Request(request.url(), {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : (body ?? undefined),
    });
  }

  async idle(options: { quietMs?: number; timeoutMs?: number } = {}): Promise<void> {
    const quietMs = options.quietMs ?? 60;
    const deadline = performance.now() + (options.timeoutMs ?? 10_000);
    for (;;) {
      const now = performance.now();
      const open = this.inflight.size - this.world.parked - this.heldByOutage;
      if (open <= 0 && now - this.lastActivity >= quietMs) return;
      if (now > deadline)
        throw new Error(
          `The page did not go quiet: ${open} request(s) still open (${this.world.parked} held by the world)`
        );
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  acknowledge(): void {
    this.blocked.length = 0;
    this.csp.length = 0;
    this.cors.length = 0;
    this.pageErrors.length = 0;
    this.consoleErrors.length = 0;
    this.world.unexpected.length = 0;
  }

  async emitEvm(event: string, payload: unknown): Promise<void> {
    for (const page of this.context.pages()) {
      await page.evaluate(
        ({ binding, name, value }) => {
          const emit: unknown = Reflect.get(window, `${binding}EvmEmit`);
          if (typeof emit === 'function') Reflect.apply(emit, window, [name, value]);
        },
        { binding: BINDING, name: event, value: payload }
      );
    }
  }

  requests(
    filter: { handledBy?: NetworkEntry['handledBy']; urlIncludes?: string } = {}
  ): NetworkEntry[] {
    return this.network.filter(
      e =>
        (filter.handledBy === undefined || e.handledBy === filter.handledBy) &&
        (filter.urlIncludes === undefined || e.url.includes(filter.urlIncludes))
    );
  }
}
