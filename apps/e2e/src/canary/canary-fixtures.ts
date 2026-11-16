import { type BrowserContext, type Route, test as base, expect } from '@playwright/test';

import { type Env, handle } from '@satway/api';

import { type AppHarness, SatwayApp } from '../app/satway-app.js';
import { BINDING } from '../browser/harness.js';
import { type PageScriptOptions, installSatwayPage } from '../browser/page-script.js';
import { API_ORIGIN, APP_ORIGIN, UPSTREAM } from '../config.js';
import { EVM_WALLET_NAME, EvmWallet } from '../wallets/evm-wallet.js';
import { STACKS_WALLET_ID, STACKS_WALLET_NAME, StacksWallet } from '../wallets/stacks-wallet.js';
import { MemoryKv } from '../worker/kv.js';
import { field, parseJson, stringField } from '../world/http.js';
import { World } from '../world/world.js';

export const CANARY_JWT_ENV = 'CANARY_ONECLICK_JWT';

const ICON =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiBmaWxsPSIjMzMzIi8+PC9zdmc+';

const ADDRESS_ONLY = {
  evm: ['eth_requestAccounts', 'eth_accounts', 'eth_chainId'],
  stacks: ['getAddresses', 'stx_getAddresses'],
} as const;

const NO_SIGNING_BUTTONS =
  /^(Continue|Send from .*|Reclaim BTC|I checked my wallet.*|Send the same signed transaction again)$/;

export interface CanaryLog {
  violations: string[];
  realRequests: { method: string; url: string; status: number | 'failed' }[];
  workerCalls: { method: string; path: string; status: number }[];
}

export interface CanaryWallets {
  evm: EvmWallet;
  stacks: StacksWallet;
}

function envFor(): Env {
  const jwt = process.env[CANARY_JWT_ENV];
  return {
    DEPOSITS: new MemoryKv(() => Date.now()),
    ALLOWED_ORIGINS: APP_ORIGIN,
    ...(jwt ? { ONECLICK_JWT: jwt } : {}),
  };
}

export interface NetworkRules {
  humanMayStartDeposit: boolean;
}

function requestProblem(
  method: string,
  url: URL,
  body: string,
  rules: NetworkRules
): string | null {
  if (url.origin === API_ORIGIN) {
    if (rules.humanMayStartDeposit) return null;
    if (method === 'POST' && url.pathname === '/quote' && field(parseJson(body), 'dry') !== true)
      return `a non-dry quote was requested: ${body.slice(0, 200)}`;
    if (method === 'POST' && url.pathname !== '/quote')
      return `POST ${url.pathname} to the backend is not allowed in the canary`;
    return null;
  }
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null;
  if (url.origin === UPSTREAM.hiro && url.pathname.startsWith('/v2/contracts/call-read/'))
    return null;
  return `${method} ${url.href} is not read-only`;
}

const ALLOWED_PAGE_ORIGINS: readonly string[] = [
  UPSTREAM.hiro,
  UPSTREAM.alex,
  UPSTREAM.mempool,
  UPSTREAM.emily,
];

async function install(context: BrowserContext, wallets: CanaryWallets, log: CanaryLog) {
  await context.exposeBinding(BINDING, async (_source, kind: unknown, payload: unknown) => {
    const method = stringField(payload, 'method') ?? '';
    if (kind === 'csp') {
      log.violations.push(`CSP violation: ${JSON.stringify(payload)}`);
      return null;
    }
    if (kind === 'canary-click') {
      log.violations.push(`a guarded button was pressed: ${String(payload)}`);
      return null;
    }
    if (kind === 'evm' || kind === 'stacks') {
      const allowed: readonly string[] = ADDRESS_ONLY[kind];
      if (!allowed.includes(method)) {
        log.violations.push(`the ${kind} wallet was asked to ${method}`);
        throw new Error(`The canary wallet refuses ${method}`);
      }
      if (kind === 'evm') return wallets.evm.handle(payload);
      return wallets.stacks.handle(payload);
    }
    throw new Error(`Unknown canary binding call ${String(kind)}`);
  });
  const pageOptions: PageScriptOptions = {
    binding: BINDING,
    evm: {
      name: EVM_WALLET_NAME,
      uuid: '00000000-0000-4000-a000-000000000000',
      rdns: 'test.satway.evm',
      icon: ICON,
    },
    stacks: { id: STACKS_WALLET_ID, name: STACKS_WALLET_NAME, icon: ICON },
  };
  await context.addInitScript(installSatwayPage, pageOptions);
  await context.addInitScript(
    ({ binding, pattern }) => {
      const guarded = new RegExp(pattern);
      document.addEventListener(
        'click',
        event => {
          const target = event.target instanceof Element ? event.target.closest('button') : null;
          const label = target?.textContent?.trim() ?? '';
          if (!target || !guarded.test(label)) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          const call: unknown = Reflect.get(window, binding);
          if (typeof call === 'function') void Reflect.apply(call, window, ['canary-click', label]);
        },
        true
      );
    },
    { binding: BINDING, pattern: NO_SIGNING_BUTTONS.source }
  );
  await context.routeWebSocket(/.*/, ws =>
    ws.close({ code: 1008, reason: 'No WebSockets in the canary' })
  );
  await routeThroughLocalWorker(context, log, { humanMayStartDeposit: false });
}

export async function routeThroughLocalWorker(
  context: BrowserContext,
  log: CanaryLog,
  rules: NetworkRules
): Promise<void> {
  const env = envFor();
  await context.route('**/*', route => onRoute(route, env, log, rules));
}

async function onRoute(route: Route, env: Env, log: CanaryLog, rules: NetworkRules): Promise<void> {
  const request = route.request();
  const url = new URL(request.url());
  const method = request.method();
  const body = request.postData() ?? '';
  if (url.origin === APP_ORIGIN) {
    await route.continue();
    return;
  }
  const problem = requestProblem(method, url, body, rules);
  if (problem) {
    log.violations.push(problem);
    await route.abort('blockedbyclient');
    return;
  }
  if (url.origin === API_ORIGIN) {
    const headers = new Headers();
    for (const [name, value] of Object.entries(await request.allHeaders()))
      if (!name.startsWith(':')) headers.set(name, value);
    const response = await handle(
      new Request(url.href, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : body,
      }),
      env,
      (input, init) => fetch(input, init)
    );
    log.workerCalls.push({ method, path: url.pathname, status: response.status });
    const out: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      out[name] = value;
    });
    await route.fulfill({ status: response.status, headers: out, body: await response.text() });
    return;
  }
  if (!ALLOWED_PAGE_ORIGINS.includes(url.origin)) {
    log.violations.push(`the page reached an unexpected host: ${method} ${url.href}`);
    await route.abort('blockedbyclient');
    return;
  }
  try {
    const response = await route.fetch();
    log.realRequests.push({ method, url: url.href, status: response.status() });
    await route.fulfill({ response });
  } catch {
    log.realRequests.push({ method, url: url.href, status: 'failed' });
    await route.abort('failed');
  }
}

interface CanaryFixtures {
  canaryLog: CanaryLog;
  wallets: CanaryWallets;
  app: SatwayApp;
}

export const test = base.extend<CanaryFixtures>({
  async canaryLog({}, use) {
    await use({ violations: [], realRequests: [], workerCalls: [] });
  },
  async wallets({}, use) {
    const keys = new World('satway canary placeholder keys');
    await use({
      evm: new EvmWallet(keys, { chainId: 8453 }),
      stacks: new StacksWallet(keys),
    });
  },
  async context({ context, wallets, canaryLog }, use, testInfo) {
    await install(context, wallets, canaryLog);
    await use(context);
    await testInfo.attach('canary-log.json', {
      contentType: 'application/json',
      body: JSON.stringify(canaryLog, null, 2),
    });
    expect(canaryLog.violations, 'the canary must stay read-only').toEqual([]);
  },
  async app({ page }, use) {
    const harness: AppHarness = {
      async idle() {
        await page.waitForLoadState('networkidle');
      },
      touch() {
        return undefined;
      },
    };
    await use(new SatwayApp(page, harness, new World('satway canary page object')));
  },
});

export { expect };
