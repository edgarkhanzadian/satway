import { type BrowserContext, test as base, expect } from '@playwright/test';

import { SatwayApp } from './app/satway-app.js';
import {
  Harness,
  type WalletConnectMode,
  type WalletSetup,
  type Wallets,
} from './browser/harness.js';
import {
  type Allowances,
  NO_ALLOWANCES,
  NO_VIOLATIONS,
  collectViolations,
} from './browser/violations.js';
import { EvmWallet } from './wallets/evm-wallet.js';
import { SolanaWallet } from './wallets/solana-wallet.js';
import { StacksWallet } from './wallets/stacks-wallet.js';
import { ApiWorker, type WorkerEnvOverrides, resetWorkerClock } from './worker/worker.js';
import { World } from './world/world.js';

interface TestOptions {
  walletSetup: WalletSetup;
  allow: Allowances;
  evmStartChainId: number;
  workerEnv: WorkerEnvOverrides;
  walletConnect: WalletConnectMode;
  frozenClock: number | null;
}

interface TestFixtures {
  world: World;
  api: ApiWorker;
  wallets: Wallets;
  harness: Harness;
  app: SatwayApp;
}

interface WorkerFixtures {
  realNodeFetches: string[];
}

const DEFAULT_WALLETS: WalletSetup = {
  evm: true,
  solana: { features: ['signAndSend', 'sign'] },
  stacks: true,
};

const harnesses = new WeakMap<BrowserContext, Harness>();

function describeInput(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function bigintSafe(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

export const test = base.extend<TestOptions & TestFixtures, WorkerFixtures>({
  walletSetup: [DEFAULT_WALLETS, { option: true }],
  allow: [NO_ALLOWANCES, { option: true }],
  evmStartChainId: [1, { option: true }],
  workerEnv: [{}, { option: true }],
  walletConnect: ['blocked', { option: true }],
  frozenClock: [null, { option: true }],

  realNodeFetches: [
    async ({}, use) => {
      const attempts: string[] = [];
      const original = globalThis.fetch;
      globalThis.fetch = (input: RequestInfo | URL) => {
        attempts.push(describeInput(input));
        return Promise.reject(new Error('A test process tried to use the real network'));
      };
      await use(attempts);
      globalThis.fetch = original;
    },
    { scope: 'worker', auto: true },
  ],

  async world({ frozenClock }, use, testInfo) {
    const title = testInfo.titlePath.join(' / ');
    const seed = frozenClock === null ? `${title}#${testInfo.repeatEachIndex}` : title;
    await use(new World(seed, frozenClock === null ? {} : { frozenAt: frozenClock }));
  },

  async api({ world, workerEnv }, use) {
    resetWorkerClock();
    await use(new ApiWorker(world, workerEnv));
    resetWorkerClock();
  },

  async wallets({ world, evmStartChainId }, use) {
    await use({
      evm: new EvmWallet(world, { chainId: evmStartChainId }),
      solana: new SolanaWallet(world),
      stacks: new StacksWallet(world),
    });
  },

  async context({ context, world, api, wallets, walletSetup, walletConnect, frozenClock }, use) {
    const harness = new Harness(context, world, api, wallets);
    harnesses.set(context, harness);
    await context.clock.install({ time: world.now() });
    if (frozenClock !== null) await context.clock.setFixedTime(world.now());
    await harness.install(walletSetup, walletConnect);
    await use(context);
  },

  harness: [
    async ({ context, world, api, wallets, allow, realNodeFetches }, use, testInfo) => {
      const harness = harnesses.get(context);
      if (!harness) throw new Error('The e2e harness was not installed on this context');
      const fetchesBefore = realNodeFetches.length;
      await use(harness);

      await testInfo.attach('world-log.json', {
        contentType: 'application/json',
        body: JSON.stringify(
          {
            world: world.log,
            worldUnexpected: world.unexpected,
            worker: api.requests,
            notifier: api.notifierReports,
            kv: Object.fromEntries(api.kv.entries),
            browserNetwork: harness.network,
            wallets: {
              evm: wallets.evm.behaviour.requests,
              solana: wallets.solana.behaviour.requests,
              stacks: wallets.stacks.behaviour.requests,
            },
          },
          bigintSafe,
          2
        ),
      });
      if (testInfo.status !== testInfo.expectedStatus) return;
      const violations = collectViolations(
        harness,
        world,
        realNodeFetches.slice(fetchesBefore),
        allow
      );
      expect(
        violations,
        'always-on checks: network isolation, CSP, page and console errors'
      ).toEqual(NO_VIOLATIONS);
    },
    { auto: true },
  ],

  async app({ page, harness, world }, use) {
    await use(new SatwayApp(page, harness, world));
  },
});

export { expect };
