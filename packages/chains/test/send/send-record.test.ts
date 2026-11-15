import { base58, base64 } from '@scure/base';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OneClickToken } from '@satway/core';

import {
  type Eip1193Provider,
  type SolanaSendResult,
  buildEvmTransfer,
  sendFromEvm,
} from '../../src/index.js';
import {
  ALREADY_RECORDED_MESSAGE,
  CANNOT_SAVE_MESSAGE,
  EXPIRED_MESSAGE,
  LANDED_FAILED_MESSAGE,
  NO_LOCK_MESSAGE,
  QUOTE_EXPIRY_MARGIN_MS,
  type ResolveDeps,
  WALLET_PROMPT_WINDOW_MS,
  attemptSend,
  confirmNothingSent,
  latestSwap,
  needsConfirmation,
  promptWaitMs,
  quoteExpired,
  resendRecord,
  resolveRecord,
  sendPanel,
  settleFromProvider,
} from '../../src/send/send-attempt.js';
import {
  type KeyValueStore,
  type SendLock,
  type SendRecord,
  type SwapTarget,
  UNREADABLE_RECORD_MESSAGE,
  attemptingRecord,
  createSendRecords,
  needsChainCheck,
  releaseIfCleared,
  sendConfirmed,
  sendLockName,
  sendRecordKey,
  swapTargetOf,
  uncertainRecord,
  watchSendRecords,
} from '../../src/send/send-record.js';
import type { SimulationResult, SolanaRpc } from '../../src/send/solana/solana-rpc.js';
import {
  checkSolanaSend,
  resendSignedTransaction,
  sendSolanaDeposit,
} from '../../src/send/solana/solana-send.js';

const FROM = '0x2527D02599Ba641c19FEa793cD0F167589a0f10D';
const SWAP_ONE = '0x4352589330E4Ab9c40B2eaFBc125F4eeA38e260D';
const SWAP_TWO = '0x1111111111111111111111111111111111111111';
const HASH = '0x' + 'ab'.repeat(32);
const SIG =
  '4QMdVtgtZcuygfB7RnGhZvrPxVDjXU7WgaKCaYEd2XSeQYMGKSrthoiV4GmL6pq2fu5gHaoiHofNEYTNSJuryyr';
const SOL_SENDER = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';
const SOL_DEPOSIT = '2CXBDfuKKrEmmo5vXnYbCEbUbDyweZcbL12gXC4vHC4G';
const SYSTEM = '11111111111111111111111111111111';
const NOW = new Date('2026-11-15T10:00:00.000Z');
const USDC_BASE: OneClickToken = {
  assetId: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
  decimals: 6,
  blockchain: 'base',
  symbol: 'USDC',
  price: 1,
  contractAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
};
const SOL: OneClickToken = {
  assetId: 'nep141:sol.omft.near',
  decimals: 9,
  blockchain: 'sol',
  symbol: 'SOL',
  price: 150,
};

const ONE: SwapTarget = { address: SWAP_ONE, memo: null };
const TWO: SwapTarget = { address: SWAP_TWO, memo: null };
const SOLANA_SWAP: SwapTarget = { address: SOL_DEPOSIT, memo: null };

interface FakeStorage extends KeyValueStore {
  data: Map<string, string>;
  log: string[];
}

function fakeStorage(entries: [string, string][] = [], log: string[] = []): FakeStorage {
  const data = new Map(entries);
  return {
    data,
    log,
    getItem: key => data.get(key) ?? null,
    setItem(key, value) {
      const parsed: unknown = JSON.parse(value);
      const state =
        typeof parsed === 'object' && parsed !== null && 'state' in parsed ? parsed.state : value;
      log.push(`store ${String(state)}`);
      data.set(key, value);
    },
    removeItem(key) {
      log.push('store cleared');
      data.delete(key);
    },
  };
}

function freshRecords() {
  const storage = fakeStorage();
  return createSendRecords(() => storage, browserLocks().tab());
}

function fakeEvm(opts: { log: string[]; send(): Promise<unknown> }): Eip1193Provider {
  return {
    request(args) {
      opts.log.push(`wallet ${args.method}`);
      switch (args.method) {
        case 'eth_chainId':
          return Promise.resolve('0x2105');
        case 'eth_accounts':
          return Promise.resolve([FROM]);
        case 'eth_sendTransaction':
          return opts.send();
        default:
          return Promise.reject(new Error(`unexpected ${args.method}`));
      }
    },
  };
}

function evmSend(provider: Eip1193Provider, to: string = SWAP_ONE) {
  const transfer = buildEvmTransfer({ token: USDC_BASE, from: FROM, to, amount: '25000000' });
  return () => sendFromEvm(provider, transfer);
}

function start(target: SwapTarget, family: 'evm' | 'solana' = 'evm') {
  return { target, family, account: family === 'evm' ? FROM : SOL_SENDER, now: NOW };
}

const rejection = Object.assign(new Error('User rejected the request.'), { code: 4001 });

function offered(record: SendRecord | null, swap: 'PENDING_DEPOSIT' | 'SUCCESS' | null) {
  return sendPanel({
    swap,
    record,
    walletCanSend: true,
    sending: false,
    durable: true,
    lockable: true,
    expired: false,
  }).kind;
}

function browserLocks(log: string[] = []) {
  const owners = new Map<string, number>();
  let tabs = 0;
  function tab(): SendLock {
    tabs += 1;
    const id = tabs;
    return {
      claim(name) {
        const owner = owners.get(name);
        if (owner !== undefined && owner !== id) return Promise.resolve(false);
        if (owner === undefined) log.push(`claim ${name}`);
        owners.set(name, id);
        return Promise.resolve(true);
      },
      release(name) {
        if (owners.get(name) !== id) return;
        owners.delete(name);
        log.push(`release ${name}`);
      },
    };
  }
  return { tab, owners };
}

describe('send record keys', () => {
  it('keys a record by the swap deposit address and memo, never by the Bitcoin address', () => {
    expect(sendRecordKey(ONE)).toBe(`satway:send-record:v1:${SWAP_ONE}:`);
    expect(sendRecordKey({ address: SWAP_ONE, memo: '17' })).not.toBe(sendRecordKey(ONE));
    expect(swapTargetOf(SWAP_ONE, '')).toEqual(ONE);
    expect(swapTargetOf(undefined, '1')).toBeNull();
  });

  it('a second deposit by the same user is unaffected by the first one’s record', async () => {
    const records = freshRecords();
    const log: string[] = [];
    const first = await attemptSend(
      records,
      start(ONE),
      evmSend(fakeEvm({ log, send: () => Promise.resolve(HASH) }))
    );
    expect(first.kind).toBe('sent');
    expect(records.read(ONE, 'evm')?.state).toBe('sent');
    expect(records.read(TWO, 'evm')).toBeNull();
    expect(offered(records.read(TWO, 'evm'), 'PENDING_DEPOSIT')).toBe('offer');
    expect(offered(records.read(ONE, 'evm'), 'PENDING_DEPOSIT')).toBe('record');
  });

  it('ignores the old session records keyed by the Bitcoin address', () => {
    const storage = fakeStorage([
      ['portage:sent-tx:bc1pytlwt3qfg4rdrk3yxtmdhcjvy0l63yp7qh3jra5xwq8yt6w4fvhqyjl7dx', HASH],
      ['stxonector:sent-tx:bc1pytlwt3qfg4rdrk3yxtmdhcjvy0l63yp7qh3jra5xwq8yt6w4fvhqyjl7dx', HASH],
    ]);
    const records = createSendRecords(() => storage, browserLocks().tab());
    expect(records.read(ONE, 'evm')).toBeNull();
    expect(offered(records.read(ONE, 'evm'), 'PENDING_DEPOSIT')).toBe('offer');
  });
});

describe('when the send button is offered', () => {
  function kind(swap: Parameters<typeof sendPanel>[0]['swap'], extra = {}) {
    return sendPanel({
      swap,
      record: null,
      walletCanSend: true,
      sending: false,
      durable: true,
      lockable: true,
      expired: false,
      ...extra,
    }).kind;
  }

  it('only once 1Click positively reports it is waiting for the deposit', () => {
    expect(kind(undefined)).toBe('checking');
    expect(kind(null)).toBe('unknown');
    expect(kind('PENDING_DEPOSIT')).toBe('offer');
    for (const swap of [
      'KNOWN_DEPOSIT_TX',
      'INCOMPLETE_DEPOSIT',
      'PROCESSING',
      'SUCCESS',
      'REFUNDED',
      'FAILED',
    ] as const) {
      expect(kind(swap)).toBe('none');
    }
  });

  it('treats a failed refresh as an unknown status, even after an earlier positive answer', () => {
    expect(latestSwap(null, false)).toBeUndefined();
    expect(latestSwap({ swap: 'PENDING_DEPOSIT' }, false)).toBe('PENDING_DEPOSIT');
    expect(latestSwap({ swap: 'PENDING_DEPOSIT' }, true)).toBeNull();
    expect(kind(latestSwap({ swap: 'PENDING_DEPOSIT' }, true))).toBe('unknown');
  });

  it('not while a send is in flight, without a covering wallet, or without durable storage', () => {
    expect(kind('PENDING_DEPOSIT', { sending: true })).toBe('sending');
    expect(kind('PENDING_DEPOSIT', { walletCanSend: false })).toBe('none');
    expect(kind('PENDING_DEPOSIT', { durable: false })).toBe('no-storage');
    expect(kind('PENDING_DEPOSIT', { lockable: false })).toBe('no-lock');
  });

  it('not once the quote deadline is near or past, whatever 1Click still reports', () => {
    expect(kind('PENDING_DEPOSIT', { expired: true })).toBe('expired');
    expect(kind(null, { expired: true, walletCanSend: false })).toBe('expired');
    const record = attemptingRecord(start(ONE));
    expect(
      sendPanel({
        swap: 'PENDING_DEPOSIT',
        record,
        walletCanSend: true,
        sending: false,
        durable: true,
        lockable: true,
        expired: true,
      }).kind
    ).toBe('record');
  });

  it('counts a quote as expired five minutes before its deadline, and when the deadline is unreadable', () => {
    const deadline = '2026-11-15T12:00:00.000Z';
    expect(quoteExpired(deadline, new Date('2026-11-15T11:54:59.999Z'))).toBe(false);
    expect(quoteExpired(deadline, new Date('2026-11-15T11:55:00.000Z'))).toBe(true);
    expect(quoteExpired(deadline, new Date('2026-11-15T13:00:00.000Z'))).toBe(true);
    expect(quoteExpired('soon', NOW)).toBe(true);
    expect(quoteExpired(undefined, NOW)).toBe(false);
    expect(QUOTE_EXPIRY_MARGIN_MS).toBe(5 * 60_000);
  });
});

describe('attemptSend across tabs', () => {
  it('claims the per-swap lock before writing the record, and keeps it once something may have been sent', async () => {
    const log: string[] = [];
    const storage = fakeStorage([], log);
    const locks = browserLocks(log);
    const records = createSendRecords(() => storage, locks.tab());
    await attemptSend(
      records,
      start(ONE),
      evmSend(fakeEvm({ log, send: () => Promise.resolve(HASH) }))
    );
    const name = sendLockName(ONE);
    expect(name).toBe(`${sendRecordKey(ONE)}:lock`);
    expect(log).toEqual([
      `claim ${name}`,
      'store attempting',
      'wallet eth_chainId',
      'wallet eth_accounts',
      'wallet eth_sendTransaction',
      'store sent',
    ]);
    expect(locks.owners.has(name)).toBe(true);
  });

  it('lets only one of two racing tabs ask the wallet, even if the other cannot see the record yet', async () => {
    const locks = browserLocks();
    const tabA = createSendRecords(() => fakeStorage(), locks.tab());
    const tabB = createSendRecords(() => fakeStorage(), locks.tab());
    let asked = 0;
    function send() {
      asked += 1;
      return Promise.resolve(HASH);
    }
    const outcomes = await Promise.all([
      attemptSend(tabA, start(ONE), send),
      attemptSend(tabB, start(ONE), send),
    ]);
    expect(asked).toBe(1);
    expect(outcomes.map(o => o.kind).sort()).toEqual(['refused', 'sent']);
    expect(outcomes.find(o => o.kind === 'refused')).toEqual({
      kind: 'refused',
      message: ALREADY_RECORDED_MESSAGE,
    });
  });

  it('releases the lock when nothing was sent, so another tab can send', async () => {
    const storage = fakeStorage();
    const locks = browserLocks();
    const tabA = createSendRecords(() => storage, locks.tab());
    const tabB = createSendRecords(() => storage, locks.tab());
    const rejected = await attemptSend(tabA, start(ONE), () => Promise.reject(rejection));
    expect(rejected).toMatchObject({ kind: 'cleared', rejected: true });
    expect(locks.owners.size).toBe(0);
    expect((await attemptSend(tabB, start(ONE), () => Promise.resolve(HASH))).kind).toBe('sent');
  });

  it('refuses and releases when the record is already there, and does not lock other swaps', async () => {
    const storage = fakeStorage();
    const locks = browserLocks();
    const tab = createSendRecords(() => storage, locks.tab());
    tab.write(attemptingRecord(start(ONE)));
    let asked = false;
    const outcome = await attemptSend(tab, start(ONE), () => {
      asked = true;
      return Promise.resolve(HASH);
    });
    expect(outcome).toEqual({ kind: 'refused', message: ALREADY_RECORDED_MESSAGE });
    expect(asked).toBe(false);
    expect(locks.owners.size).toBe(0);
    expect((await attemptSend(tab, start(TWO), () => Promise.resolve(HASH))).kind).toBe('sent');
  });

  it('lets the user clear an unprovable attempt, which frees the lock for other tabs', async () => {
    const storage = fakeStorage();
    const locks = browserLocks();
    const tabA = createSendRecords(() => storage, locks.tab());
    await attemptSend(tabA, start(ONE), () => Promise.reject(new Error('socket closed')));
    const record = tabA.read(ONE, 'evm');
    if (!record) throw new Error('expected a record');
    expect(locks.owners.size).toBe(1);
    expect(confirmNothingSent(tabA, record)).toBe(true);
    expect(locks.owners.size).toBe(0);
  });

  it('a tab that holds the lock lets go once another tab cleared the record, so that tab can send', async () => {
    const storage = fakeStorage();
    const locks = browserLocks();
    const tabA = createSendRecords(() => storage, locks.tab());
    const tabB = createSendRecords(() => storage, locks.tab());
    await attemptSend(tabA, start(ONE), () => Promise.reject(new Error('socket closed')));
    expect(releaseIfCleared(tabA, ONE, 'evm')).toBe(false);
    expect(locks.owners.size).toBe(1);
    const record = tabB.read(ONE, 'evm');
    if (!record) throw new Error('expected a record');
    expect(confirmNothingSent(tabB, record)).toBe(true);
    expect(locks.owners.size).toBe(1);

    expect(releaseIfCleared(tabA, ONE, 'evm')).toBe(true);
    expect(locks.owners.size).toBe(0);
    const outcome = await attemptSend(tabB, start(ONE), () => Promise.resolve(HASH));
    expect(outcome.kind).toBe('sent');
  });

  it.each([
    ['no lock is available', null],
    [
      'the lock cannot be taken',
      { claim: () => Promise.reject(new Error('SecurityError')), release: () => undefined },
    ],
  ])('refuses wallet sending when %s', async (_name, lock) => {
    const records = createSendRecords(() => fakeStorage(), lock);
    expect(records.lockable()).toBe(lock !== null);
    let asked = false;
    const outcome = await attemptSend(records, start(ONE), () => {
      asked = true;
      return Promise.resolve(HASH);
    });
    expect(outcome).toEqual({ kind: 'refused', message: NO_LOCK_MESSAGE });
    expect(asked).toBe(false);
    expect(records.read(ONE, 'evm')).toBeNull();
  });
});

describe('attemptSend on EVM', () => {
  it('writes the record before the wallet is asked anything', async () => {
    const log: string[] = [];
    const storage = fakeStorage([], log);
    const records = createSendRecords(() => storage, browserLocks().tab());
    await attemptSend(
      records,
      start(ONE),
      evmSend(fakeEvm({ log, send: () => Promise.resolve(HASH) }))
    );
    expect(log).toEqual([
      'store attempting',
      'wallet eth_chainId',
      'wallet eth_accounts',
      'wallet eth_sendTransaction',
      'store sent',
    ]);
    expect(records.read(ONE, 'evm')).toMatchObject({ state: 'sent', tx: HASH, via: 'wallet' });
  });

  it('survives a tab close and is visible to another tab', async () => {
    const storage = fakeStorage();
    const releases: ((hash: string) => void)[] = [];
    const pending = new Promise<string>(resolve => {
      releases.push(resolve);
    });
    function release(hash: string) {
      for (const resolve of releases) resolve(hash);
    }
    const tabA = createSendRecords(() => storage, browserLocks().tab());
    const tabB = createSendRecords(() => storage, browserLocks().tab());
    const events = new EventTarget();
    const seen: (string | null)[] = [];
    const stop = watchSendRecords(events, () => seen.push(tabB.read(ONE, 'evm')?.state ?? null));
    const sending = attemptSend(tabA, start(ONE), () => pending);
    await vi.waitFor(() => expect(tabA.read(ONE, 'evm')).not.toBeNull());
    events.dispatchEvent(new Event('storage'));
    expect(tabB.read(ONE, 'evm')?.state).toBe('attempting');
    expect(offered(tabB.read(ONE, 'evm'), 'PENDING_DEPOSIT')).toBe('record');
    release(HASH);
    await sending;
    events.dispatchEvent(new Event('storage'));
    stop();
    expect(seen).toEqual(['attempting', 'sent']);
    const reopened = createSendRecords(() => storage, browserLocks().tab());
    expect(reopened.read(ONE, 'evm')).toMatchObject({ state: 'sent', tx: HASH });
  });

  it('clears the record on a user rejection, so the button returns', async () => {
    const records = freshRecords();
    const log: string[] = [];
    const outcome = await attemptSend(
      records,
      start(ONE),
      evmSend(fakeEvm({ log, send: () => Promise.reject(rejection) }))
    );
    expect(outcome).toMatchObject({ kind: 'cleared', rejected: true });
    expect(records.read(ONE, 'evm')).toBeNull();
    expect(offered(null, 'PENDING_DEPOSIT')).toBe('offer');
  });

  it('clears the record when it fails before the wallet is asked to send', async () => {
    const records = freshRecords();
    const provider: Eip1193Provider = {
      request: args =>
        Promise.resolve(
          args.method === 'eth_chainId' ? '0x2105' : ['0x000000000000000000000000000000000000dEaD']
        ),
    };
    const outcome = await attemptSend(records, start(ONE), evmSend(provider));
    expect(outcome).toMatchObject({ kind: 'cleared', rejected: false });
    expect(records.read(ONE, 'evm')).toBeNull();
  });

  it('keeps an uncertain record and hides the button when the wallet fails after dispatch', async () => {
    const records = freshRecords();
    const outcome = await attemptSend(
      records,
      start(ONE),
      evmSend(fakeEvm({ log: [], send: () => Promise.reject(new Error('Request expired')) }))
    );
    expect(outcome.kind).toBe('uncertain');
    const record = records.read(ONE, 'evm');
    expect(record).toMatchObject({ state: 'uncertain', tx: null, message: 'Request expired' });
    expect(offered(record, 'PENDING_DEPOSIT')).toBe('record');
    expect(record && needsConfirmation(record)).toBe(true);
  });

  it('never asks the wallet twice for one swap', async () => {
    const storage = fakeStorage();
    const records = createSendRecords(() => storage, browserLocks().tab());
    await attemptSend(records, start(ONE), () => Promise.resolve(HASH));
    let asked = false;
    const second = await attemptSend(records, start(ONE), () => {
      asked = true;
      return Promise.resolve(HASH);
    });
    expect(second).toEqual({ kind: 'refused', message: ALREADY_RECORDED_MESSAGE });
    expect(asked).toBe(false);
  });

  it('does not ask the wallet when the record cannot be saved', async () => {
    const broken: KeyValueStore = {
      getItem: () => null,
      setItem() {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
    };
    const records = createSendRecords(() => broken, browserLocks().tab());
    expect(records.durable()).toBe(false);
    let asked = false;
    const outcome = await attemptSend(records, start(ONE), () => {
      asked = true;
      return Promise.resolve(HASH);
    });
    expect(outcome).toEqual({ kind: 'refused', message: CANNOT_SAVE_MESSAGE });
    expect(asked).toBe(false);
    expect(records.read(ONE, 'evm')).toBeNull();
    expect(createSendRecords(() => undefined).durable()).toBe(false);
  });

  it('remembers a send in the tab when storage fails after the attempt began', async () => {
    const storage = fakeStorage();
    const records = createSendRecords(() => storage, browserLocks().tab());
    const outcome = await attemptSend(records, start(ONE), () => {
      storage.setItem = () => {
        throw new Error('QuotaExceededError');
      };
      return Promise.resolve(HASH);
    });
    expect(outcome.kind).toBe('sent');
    expect(records.read(ONE, 'evm')?.state).toBe('sent');
    expect(createSendRecords(() => storage, browserLocks().tab()).read(ONE, 'evm')?.state).toBe(
      'attempting'
    );
  });
});

describe('reading stored records', () => {
  it('treats an unreadable or mismatched record as uncertain rather than ignoring it', () => {
    const key = sendRecordKey(ONE);
    const corrupt = createSendRecords(() => fakeStorage([[key, '{not json']]));
    expect(corrupt.read(ONE, 'evm')).toMatchObject({
      state: 'uncertain',
      message: UNREADABLE_RECORD_MESSAGE,
    });
    const wrongHash = JSON.stringify({
      version: 1,
      state: 'sent',
      swap: ONE,
      family: 'evm',
      account: FROM,
      startedAt: NOW.toISOString(),
      tx: SIG,
      via: 'wallet',
    });
    expect(createSendRecords(() => fakeStorage([[key, wrongHash]])).read(ONE, 'evm')?.state).toBe(
      'uncertain'
    );
  });
});

describe('resolving an uncertain record', () => {
  const noChecks: ResolveDeps = {
    checkSolana: () => Promise.reject(new Error('not used')),
    evmState: () => Promise.reject(new Error('not used')),
  };

  it('lets the user clear a record nothing can prove, after checking their wallet', async () => {
    const records = freshRecords();
    await attemptSend(records, start(ONE), () => Promise.reject(new Error('socket closed')));
    const record = records.read(ONE, 'evm');
    if (!record) throw new Error('expected a record');
    expect(await resolveRecord(records, record, noChecks)).toEqual({
      kind: 'unchanged',
      note: null,
    });
    expect(confirmNothingSent(records, record)).toBe(true);
    expect(records.read(ONE, 'evm')).toBeNull();
    expect(offered(records.read(ONE, 'evm'), 'PENDING_DEPOSIT')).toBe('offer');
  });

  it('treats the deposit as sent once 1Click reports it, and keeps the button hidden', async () => {
    const records = freshRecords();
    await attemptSend(records, start(ONE), () => Promise.reject(new Error('socket closed')));
    const settled = settleFromProvider(records, records.read(ONE, 'evm'), 'KNOWN_DEPOSIT_TX');
    expect(settled).toMatchObject({ state: 'sent', via: 'provider' });
    expect(records.read(ONE, 'evm')?.state).toBe('sent');
    expect(offered(records.read(ONE, 'evm'), 'PENDING_DEPOSIT')).toBe('record');
    expect(settleFromProvider(records, null, null)).toBeNull();
  });

  it('reflects an EVM receipt for a known hash', async () => {
    const storage = fakeStorage();
    const records = createSendRecords(() => storage, browserLocks().tab());
    const uncertain: SendRecord = {
      version: 1,
      state: 'uncertain',
      swap: ONE,
      family: 'evm',
      account: FROM,
      startedAt: NOW.toISOString(),
      tx: HASH,
      message: 'lost',
      signed: null,
    };
    records.write(uncertain);
    const pending = await resolveRecord(records, uncertain, {
      ...noChecks,
      evmState: () => Promise.resolve('pending'),
    });
    expect(pending.kind).toBe('unchanged');
    const done = await resolveRecord(records, uncertain, {
      ...noChecks,
      evmState: () => Promise.resolve('succeeded'),
    });
    expect(done.kind).toBe('sent');
    expect(records.read(ONE, 'evm')).toMatchObject({ state: 'sent', tx: HASH, via: 'chain' });
  });
});

describe('checking a send the wallet acknowledged', () => {
  function noSolana(): ReturnType<ResolveDeps['checkSolana']> {
    return Promise.reject(new Error('not used'));
  }

  async function walletSent() {
    const records = freshRecords();
    const log: string[] = [];
    await attemptSend(
      records,
      start(ONE),
      evmSend(fakeEvm({ log, send: () => Promise.resolve(HASH) }))
    );
    const record = records.read(ONE, 'evm');
    if (!record) throw new Error('expected a record');
    return { records, record };
  }

  it('records the wallet’s answer as sent but not yet confirmed on chain', async () => {
    const { record } = await walletSent();
    expect(record).toMatchObject({ state: 'sent', tx: HASH, via: 'wallet', confirmed: false });
    if (record.state !== 'sent') throw new Error('expected a sent record');
    expect(sendConfirmed(record)).toBe(false);
    expect(needsChainCheck(record)).toBe(true);
  });

  it('clears a send that reverted on chain, so the user can send again', async () => {
    const { records, record } = await walletSent();
    const result = await resolveRecord(records, record, {
      checkSolana: noSolana,
      evmState: () => Promise.resolve('reverted'),
    });
    expect(result).toEqual({ kind: 'cleared', message: LANDED_FAILED_MESSAGE });
    expect(records.read(ONE, 'evm')).toBeNull();
    expect(offered(records.read(ONE, 'evm'), 'PENDING_DEPOSIT')).toBe('offer');
  });

  it.each(['pending', 'unknown'] as const)(
    'never clears a send the chain reports as %s',
    async state => {
      const { records, record } = await walletSent();
      const result = await resolveRecord(records, record, {
        checkSolana: noSolana,
        evmState: () => Promise.resolve(state),
      });
      expect(result.kind).toBe('unchanged');
      expect(records.read(ONE, 'evm')).toMatchObject({ state: 'sent', confirmed: false });
    }
  );

  it('confirms a send that succeeded and then stops checking it', async () => {
    const { records, record } = await walletSent();
    const result = await resolveRecord(records, record, {
      checkSolana: noSolana,
      evmState: () => Promise.resolve('succeeded'),
    });
    expect(result.kind).toBe('sent');
    const confirmed = records.read(ONE, 'evm');
    expect(confirmed).toMatchObject({ state: 'sent', confirmed: true });
    if (!confirmed) throw new Error('expected a record');
    expect(needsChainCheck(confirmed)).toBe(false);
    expect(
      await resolveRecord(records, confirmed, {
        checkSolana: noSolana,
        evmState: () => Promise.reject(new Error('should not be asked')),
      })
    ).toEqual({ kind: 'unchanged', note: null });
  });

  it('confirms an unverified send once 1Click reports the deposit', async () => {
    const { records, record } = await walletSent();
    expect(settleFromProvider(records, record, 'PENDING_DEPOSIT')).toBe(record);
    expect(settleFromProvider(records, record, 'PROCESSING')).toMatchObject({
      state: 'sent',
      confirmed: true,
    });
  });

  it('still never lets the user claim nothing was sent after the wallet said it sent', async () => {
    const { records, record } = await walletSent();
    expect(confirmNothingSent(records, record, new Date(NOW.getTime() + 86_400_000))).toBe(false);
  });

  it('reads an older sent record without the confirmation flag: a wallet answer is unverified', () => {
    const base = {
      version: 1 as const,
      state: 'sent' as const,
      swap: ONE,
      family: 'evm' as const,
      account: FROM,
      startedAt: NOW.toISOString(),
      tx: HASH,
    };
    const storage = fakeStorage([
      [sendRecordKey(ONE), JSON.stringify({ ...base, via: 'wallet' })],
      [sendRecordKey(TWO), JSON.stringify({ ...base, swap: TWO, via: 'chain' })],
    ]);
    const records = createSendRecords(() => storage, browserLocks().tab());
    const wallet = records.read(ONE, 'evm');
    const chain = records.read(TWO, 'evm');
    if (!wallet || !chain) throw new Error('expected records');
    expect(wallet.state).toBe('sent');
    expect(needsChainCheck(wallet)).toBe(true);
    expect(needsChainCheck(chain)).toBe(false);
  });
});

describe('Solana sign-only sends', () => {
  const OK: SimulationResult = { err: null, logs: [], unitsConsumed: 150 };

  function chain(opts: { send(wire: string): Promise<string>; height?: bigint }) {
    const sent: string[] = [];
    const built: string[] = [];
    let landed = false;
    const rpc: SolanaRpc = {
      latestBlockhash() {
        built.push('latestBlockhash');
        return Promise.resolve({
          blockhash: 'BL2sQysVf3SYJqtmRgfXG6oUWf7RUSN4sHXM582sjJsZ',
          lastValidBlockHeight: 500n,
        });
      },
      accounts: addresses =>
        Promise.resolve(
          addresses.map(a =>
            a === SOL_SENDER
              ? { owner: SYSTEM, lamports: 10n ** 10n, data: new Uint8Array(0), executable: false }
              : null
          )
        ),
      rentExemptMinimum: () => Promise.resolve(890_880n),
      simulate: () => Promise.resolve(OK),
      async send(wire) {
        sent.push(wire);
        const result = await opts.send(wire);
        landed = true;
        return result;
      },
      signatureStatus: () =>
        Promise.resolve(landed ? { err: null, confirmation: 'confirmed' } : null),
      blockHeight: () => Promise.resolve(opts.height ?? 100n),
    };
    return { rpc, sent, built };
  }

  const signer = {
    address: SOL_SENDER,
    sender: {
      send(tx: Uint8Array): Promise<SolanaSendResult> {
        const signed = Uint8Array.from(tx);
        signed.set(base58.decode(SIG), 1);
        return Promise.resolve({ kind: 'signed', transaction: signed });
      },
    },
  };

  const input = { token: SOL, recipient: SOL_DEPOSIT, amount: '1000000000' };

  async function failedFirstSend() {
    const storage = fakeStorage();
    const records = createSendRecords(() => storage, browserLocks().tab());
    let fail = true;
    const net = chain({
      send() {
        if (fail) return Promise.reject(new Error('Could not reach the Solana RPC: reset'));
        return Promise.resolve(SIG);
      },
    });
    const outcome = await attemptSend(records, start(SOLANA_SWAP, 'solana'), hooks =>
      sendSolanaDeposit(input, signer, net.rpc, hooks)
    );
    fail = false;
    return { storage, records, net, outcome };
  }

  it('persists the signature and signed bytes when the RPC send throws', async () => {
    const { storage, records, net, outcome } = await failedFirstSend();
    expect(outcome.kind).toBe('uncertain');
    const record = createSendRecords(() => storage, browserLocks().tab()).read(
      SOLANA_SWAP,
      'solana'
    );
    expect(record).toMatchObject({ state: 'uncertain', tx: SIG });
    if (!record || record.state === 'sent' || !record.signed) throw new Error('expected bytes');
    expect(record.signed.lastValidBlockHeight).toBe('500');
    expect(record.signed.transaction).toBe(net.sent[0]);
    expect(offered(records.read(SOLANA_SWAP, 'solana'), 'PENDING_DEPOSIT')).toBe('record');
  });

  it('retries by resending the same signed bytes, never a new transaction', async () => {
    const { records, net } = await failedFirstSend();
    const record = records.read(SOLANA_SWAP, 'solana');
    if (!record) throw new Error('expected a record');
    const builtBefore = net.built.length;
    const resent = await resendRecord(records, record, signed =>
      resendSignedTransaction(signed, net.rpc)
    );
    expect(resent.kind).toBe('sent');
    expect(net.sent).toHaveLength(2);
    expect(base64.decode(String(net.sent[1]))).toEqual(base64.decode(String(net.sent[0])));
    expect(net.built.length).toBe(builtBefore);
    expect(records.read(SOLANA_SWAP, 'solana')).toMatchObject({ state: 'sent', tx: SIG });
  });

  it('becomes sent when the signature is found on chain', async () => {
    const { records, net } = await failedFirstSend();
    await net.rpc.send('landed-elsewhere');
    const record = records.read(SOLANA_SWAP, 'solana');
    if (!record) throw new Error('expected a record');
    const result = await resolveRecord(records, record, {
      checkSolana: sent => checkSolanaSend(sent, net.rpc),
      evmState: () => Promise.reject(new Error('not used')),
    });
    expect(result.kind).toBe('sent');
    expect(records.read(SOLANA_SWAP, 'solana')).toMatchObject({ state: 'sent', via: 'chain' });
  });

  it('keeps checking a send the RPC accepted, and clears it if it expires unlanded', async () => {
    const storage = fakeStorage();
    const records = createSendRecords(() => storage, browserLocks().tab());
    const accepted = chain({ send: () => Promise.resolve(SIG) });
    const outcome = await attemptSend(records, start(SOLANA_SWAP, 'solana'), hooks =>
      sendSolanaDeposit(input, signer, accepted.rpc, hooks)
    );
    expect(outcome.kind).toBe('sent');
    const record = records.read(SOLANA_SWAP, 'solana');
    if (!record) throw new Error('expected a record');
    expect(record).toMatchObject({
      state: 'sent',
      tx: SIG,
      confirmed: false,
      lastValidBlockHeight: '500',
    });
    const unseen: SolanaRpc = {
      ...accepted.rpc,
      signatureStatus: () => Promise.resolve(null),
      blockHeight: () => Promise.resolve(500n),
    };
    const waiting = await resolveRecord(records, record, {
      checkSolana: sent => checkSolanaSend(sent, unseen),
      evmState: () => Promise.reject(new Error('not used')),
    });
    expect(waiting.kind).toBe('unchanged');
    expect(records.read(SOLANA_SWAP, 'solana')).not.toBeNull();
    const result = await resolveRecord(records, record, {
      checkSolana: sent =>
        checkSolanaSend(sent, { ...unseen, blockHeight: () => Promise.resolve(501n) }),
      evmState: () => Promise.reject(new Error('not used')),
    });
    expect(result).toEqual({ kind: 'cleared', message: EXPIRED_MESSAGE });
    expect(records.read(SOLANA_SWAP, 'solana')).toBeNull();
  });

  it('never expires a sent signature whose validity window is unknown', async () => {
    const records = freshRecords();
    const sent: SendRecord = {
      version: 1,
      state: 'sent',
      swap: SOLANA_SWAP,
      family: 'solana',
      account: SOL_SENDER,
      startedAt: NOW.toISOString(),
      tx: SIG,
      via: 'wallet',
      confirmed: false,
    };
    records.write(sent);
    const net = chain({ send: () => Promise.resolve(SIG), height: 10_000n });
    const unseen: SolanaRpc = { ...net.rpc, signatureStatus: () => Promise.resolve(null) };
    const result = await resolveRecord(records, sent, {
      checkSolana: s => checkSolanaSend(s, unseen),
      evmState: () => Promise.reject(new Error('not used')),
    });
    expect(result.kind).toBe('unchanged');
    expect(records.read(SOLANA_SWAP, 'solana')).toMatchObject({ state: 'sent' });
  });

  it('clears the record once the blockhash expired with the signature unseen, and allows a fresh attempt', async () => {
    const { records } = await failedFirstSend();
    const expired = chain({ send: () => Promise.resolve(SIG), height: 501n });
    const record = records.read(SOLANA_SWAP, 'solana');
    if (!record) throw new Error('expected a record');
    const notYet = chain({ send: () => Promise.resolve(SIG), height: 500n });
    expect(
      (
        await resolveRecord(records, record, {
          checkSolana: sent => checkSolanaSend(sent, notYet.rpc),
          evmState: () => Promise.reject(new Error('not used')),
        })
      ).kind
    ).toBe('unchanged');
    const result = await resolveRecord(records, record, {
      checkSolana: sent => checkSolanaSend(sent, expired.rpc),
      evmState: () => Promise.reject(new Error('not used')),
    });
    expect(result).toEqual({ kind: 'cleared', message: EXPIRED_MESSAGE });
    expect(records.read(SOLANA_SWAP, 'solana')).toBeNull();
    expect(offered(null, 'PENDING_DEPOSIT')).toBe('offer');
    const fresh = await attemptSend(records, start(SOLANA_SWAP, 'solana'), hooks =>
      sendSolanaDeposit(input, signer, expired.rpc, hooks)
    );
    expect(fresh.kind).toBe('sent');
  });
});

describe('a wallet request that may still be open', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function recordInProgress() {
    const records = freshRecords();
    const record = attemptingRecord(start(ONE));
    records.write(record);
    return { records, record };
  }

  it('waits out the WalletConnect request expiry before an attempt can be cleared', () => {
    const { record } = recordInProgress();
    expect(WALLET_PROMPT_WINDOW_MS).toBe(15 * 60_000);
    expect(promptWaitMs(record, NOW)).toBe(WALLET_PROMPT_WINDOW_MS);
    expect(promptWaitMs(record, new Date(NOW.getTime() + 5_000))).toBe(
      WALLET_PROMPT_WINDOW_MS - 5_000
    );
    expect(promptWaitMs(record, new Date(NOW.getTime() + WALLET_PROMPT_WINDOW_MS))).toBe(0);
  });

  it('refuses to clear a seconds-old attempt, and clears it after the window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW.getTime() + 3_000));
    const { records, record } = recordInProgress();
    expect(confirmNothingSent(records, record)).toBe(false);
    expect(records.read(ONE, 'evm')?.state).toBe('attempting');
    vi.setSystemTime(new Date(NOW.getTime() + WALLET_PROMPT_WINDOW_MS - 1));
    expect(confirmNothingSent(records, record)).toBe(false);
    vi.setSystemTime(new Date(NOW.getTime() + WALLET_PROMPT_WINDOW_MS));
    expect(confirmNothingSent(records, record)).toBe(true);
    expect(records.read(ONE, 'evm')).toBeNull();
  });

  it('never holds back an uncertain or unreadable record', () => {
    const { record } = recordInProgress();
    const uncertain = uncertainRecord(record, 'Request expired', null);
    expect(promptWaitMs(uncertain, NOW)).toBe(0);
    expect(promptWaitMs({ ...record, startedAt: '' }, NOW)).toBe(0);
  });

  it('does not hide the control for ever when the start time is far in the future', () => {
    const { record } = recordInProgress();
    const before = new Date(NOW.getTime() - WALLET_PROMPT_WINDOW_MS - 1);
    expect(promptWaitMs(record, before)).toBe(0);
    const slightlyBefore = new Date(NOW.getTime() - 60_000);
    expect(promptWaitMs(record, slightlyBefore)).toBe(WALLET_PROMPT_WINDOW_MS + 60_000);
  });
});
