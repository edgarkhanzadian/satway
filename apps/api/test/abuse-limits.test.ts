import { describe, expect, it } from 'vitest';

import { DEPOSIT_INDEX_LIMIT, buildDepositAddress, MAINNET_CONFIG as config } from '@satway/core';

import {
  CAPACITY_RETRY_AFTER_SECONDS,
  DEPOSIT_RATE,
  type Env,
  MAX_DEPOSIT_BODY_BYTES,
  SIGNER_KEY_REREAD_AFTER_SECONDS,
  SIGNER_KEY_TTL_SECONDS,
  UNKNOWN_CLIENT,
  WindowLimiter,
  checkScriptShape,
  clientKeyOf,
  isCurrentSignerKey,
  lockPushHex,
  newSignerKeyState,
  registerDeposit,
} from '../src/http/index.js';
import { handle } from '../src/index.js';
import {
  CRON_PERIOD_MS,
  PAYOUT_GRACE_MS,
  rotationStart,
  rotationWindow,
  runNotifier,
} from '../src/notifier/index.js';
import {
  FULL_CYCLE_RUNS,
  INDEX_KEY,
  LOAD_KEY,
  MAX_ACTIVE_WATCHES,
  MAX_ADDRESSES_PER_RUN,
  MAX_EXTRA_SWAPS,
  MIN_REGISTRATIONS_PER_RUN,
  RUN_SUBREQUEST_BUDGET,
  SUBREQUEST_LIMIT,
  type Watch,
  type WatchIndex,
  emptyIndex,
  getIndex,
  loadOf,
  registrationKey,
} from '../src/store/index.js';
import {
  BTC,
  D,
  HIRO_KEY_URL,
  type MemoryKv,
  NOW,
  STATUS_URL,
  type SwapFake,
  type World,
  type WorldOptions,
  endpoints,
  goodBody,
  handleOptions,
  indexedBody,
  indexedDeposit,
  jsonRes,
  memoryKv,
  outpointsPosted,
  payoutTx,
  postJson,
  record,
  registerDeps,
  swapStatus,
  testEnv,
  watchKeys,
  watching,
  world,
} from './support.js';

const MEMPOOL = config.btcApiUrl;
const OTHER_KEY = 'ab'.repeat(32);
const ZERO_STACKS = 'SP000000000000000000002Q6VF78';

function liveWorld(opts: WorldOptions = {}) {
  return world({ btc: MEMPOOL, ...opts });
}

async function attempt(
  body: unknown,
  opts: {
    w?: World;
    kv?: MemoryKv;
    env?: Env;
    headers?: Record<string, string>;
    signerState?: ReturnType<typeof newSignerKeyState>;
  } = {}
) {
  const w = opts.w ?? liveWorld();
  const kv = opts.kv ?? memoryKv();
  const env = opts.env ?? testEnv();
  const res = await handle(
    postJson('/deposits', body, { origin: 'https://app.example', ...opts.headers }),
    { ...env, DEPOSITS: kv },
    w.fetchFn,
    handleOptions(opts.signerState)
  );
  const text = await res.text();
  const parsed: unknown = JSON.parse(text);
  return { res, body: parsed, text, w, kv };
}

function depositWrites(kv: MemoryKv): string[] {
  return kv.writes().filter(k => k.startsWith('dep:'));
}

function expensive(w: ReturnType<typeof world>) {
  return {
    hiro: w.hits(HIRO_KEY_URL).length,
    oneClick: w.hits(STATUS_URL).length,
    btc: w.hits(MEMPOOL).length + w.hits(BTC).length,
  };
}

function swapWorld(swap: SwapFake | 'unknown', extra: WorldOptions = {}) {
  return liveWorld({ swaps: { '0xswap0': swap }, ...extra });
}

describe('POST /deposits: script shape is checked before anything else', () => {
  const belowBase = D.depositScript.replace('0000000000013880', '000000000001387f');
  const pastLimit = D.depositScript.replace(
    '0000000000013880',
    (config.baseSignerFeeSats + DEPOSIT_INDEX_LIMIT).toString(16).padStart(16, '0')
  );
  const contractPrincipal = D.depositScript.replace('0516', '0616');
  const otherLock = D.reclaimScript.replace('02b603', '02b703');
  const selfReclaim = `02b603b27520${D.signerKey}ac`;
  it.each([
    ['a fee cap below the base', { ...goodBody(), depositScript: belowBase }],
    ['a fee cap past the last deposit index', { ...goodBody(), depositScript: pastLimit }],
    ['a contract principal', { ...goodBody(), depositScript: contractPrincipal }],
    ['a reclaim lock this app does not set', { ...goodBody(), reclaimScript: otherLock }],
    ['the signers key as the reclaim key', { ...goodBody(), reclaimScript: selfReclaim }],
    ['no swap address', { depositScript: D.depositScript, reclaimScript: D.reclaimScript }],
    ['a null swap address', { ...goodBody(), swapDepositAddress: null }],
    ['a swap address with spaces', { ...goodBody(), swapDepositAddress: 'a b' }],
    ['an array body', [goodBody()]],
  ])('rejects %s with 400, no KV access and no outbound call', async (_name, body) => {
    const { res, w, kv } = await attempt(body);
    expect(res.status).toBe(400);
    expect(w.calls).toEqual([]);
    expect(kv.ops).toEqual([]);
  });

  it('accepts scripts that core builds for the configured fee cap and lock', () => {
    const built = buildDepositAddress({
      stacksAddress: ZERO_STACKS,
      reclaimPublicKey: OTHER_KEY,
      signersPublicKey: D.signerKey,
      maxSignerFeeSats: config.baseSignerFeeSats,
      reclaimLockBlocks: config.reclaimLockBlocks,
    });
    expect(checkScriptShape(built.depositScript, built.reclaimScript, config)).toEqual({
      signerKey: D.signerKey,
      reclaimKey: OTHER_KEY,
    });
    expect(checkScriptShape(D.depositScript, D.reclaimScript, config).signerKey).toBe(D.signerKey);
  });

  it.each([0, 1, 255, 4_096, DEPOSIT_INDEX_LIMIT - 1])(
    'accepts the per-deposit fee cap of deposit index %i',
    n => {
      const built = indexedDeposit(n);
      expect(checkScriptShape(built.depositScript, built.reclaimScript, config).signerKey).toBe(
        D.signerKey
      );
    }
  );

  it('still refuses a per-deposit fee cap with a lock this app does not set', () => {
    const built = buildDepositAddress({
      stacksAddress: ZERO_STACKS,
      reclaimPublicKey: OTHER_KEY,
      signersPublicKey: D.signerKey,
      maxSignerFeeSats: config.baseSignerFeeSats + 7,
      reclaimLockBlocks: 951,
    });
    expect(() => checkScriptShape(built.depositScript, built.reclaimScript, config)).toThrow(
      /lock this app sets/
    );
  });

  it.each([1, 16, 17, 127, 128, 255, 256, 950, 32_767, 32_768, 65_535])(
    'encodes a %i-block lock the way the sbtc library does',
    blocks => {
      const built = buildDepositAddress({
        stacksAddress: ZERO_STACKS,
        reclaimPublicKey: OTHER_KEY,
        signersPublicKey: D.signerKey,
        maxSignerFeeSats: config.baseSignerFeeSats,
        reclaimLockBlocks: blocks,
      });
      expect(built.reclaimScript.startsWith(`${lockPushHex(blocks)}b27520`)).toBe(true);
      expect(() =>
        checkScriptShape(built.depositScript, built.reclaimScript, {
          ...config,
          reclaimLockBlocks: blocks,
        })
      ).not.toThrow();
    }
  );
});

describe('POST /deposits: signer key', () => {
  it('rejects a deposit locked to another key after one registry read, storing nothing', async () => {
    const { res, w, kv } = await attempt(goodBody(), { w: liveWorld({ signerKey: OTHER_KEY }) });
    expect(res.status).toBe(400);
    expect(expensive(w)).toEqual({ hiro: 1, oneClick: 0, btc: 0 });
    expect(depositWrites(kv)).toEqual([]);
  });

  it('answers 503 with Retry-After and stores nothing when the registry is down', async () => {
    const { res, body, w, kv } = await attempt(goodBody(), { w: liveWorld({ hiroDown: true }) });
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('60');
    expect(body).toEqual({ message: 'The sBTC signer key could not be read. Try again later.' });
    expect(expensive(w)).toEqual({ hiro: 1, oneClick: 0, btc: 0 });
    expect(depositWrites(kv)).toEqual([]);
  });

  it('reads the registry once per isolate while the cached key is fresh', async () => {
    const w = liveWorld();
    const kv = memoryKv();
    const signerState = newSignerKeyState();
    expect((await attempt(indexedBody(1), { w, kv, signerState })).res.status).toBe(201);
    kv.data.delete('meta:signer-key');
    expect((await attempt(indexedBody(2), { w, kv, signerState })).res.status).toBe(201);
    expect(w.hits(HIRO_KEY_URL)).toHaveLength(1);
  });

  it('a fresh isolate uses the key cached in KV instead of reading the registry', async () => {
    const w = liveWorld();
    const kv = memoryKv();
    await attempt(indexedBody(1), { w, kv });
    await attempt(indexedBody(2), { w, kv });
    expect(w.hits(HIRO_KEY_URL)).toHaveLength(1);
    expect(kv.writes().filter(k => k === 'meta:signer-key')).toHaveLength(1);
  });
});

describe('isCurrentSignerKey', () => {
  function reader(keys: string[]) {
    const state = { reads: 0 };
    return {
      state,
      read() {
        const key = keys[Math.min(state.reads, keys.length - 1)] ?? D.signerKey;
        state.reads += 1;
        return Promise.resolve(key);
      },
    };
  }
  const t0 = NOW.getTime();

  it('caches a hit in memory and in KV', async () => {
    const kv = memoryKv();
    const state = newSignerKeyState();
    const r = reader([D.signerKey]);
    expect(await isCurrentSignerKey(D.signerKey, { kv, state, nowMs: t0, read: r.read })).toBe(
      true
    );
    expect(
      await isCurrentSignerKey(D.signerKey, { kv, state, nowMs: t0 + 1000, read: r.read })
    ).toBe(true);
    expect(r.state.reads).toBe(1);
    expect(kv.writes()).toEqual(['meta:signer-key']);
  });

  it('reads again once the cached key has expired', async () => {
    const kv = memoryKv();
    const state = newSignerKeyState();
    const r = reader([D.signerKey]);
    await isCurrentSignerKey(D.signerKey, { kv, state, nowMs: t0, read: r.read });
    const later = t0 + SIGNER_KEY_TTL_SECONDS * 1000;
    await isCurrentSignerKey(D.signerKey, { kv, state, nowMs: later, read: r.read });
    expect(r.state.reads).toBe(2);
  });

  it('accepts a rotated key after exactly one re-read, then serves it from cache', async () => {
    const kv = memoryKv();
    const state = newSignerKeyState();
    const r = reader([D.signerKey, OTHER_KEY]);
    await isCurrentSignerKey(D.signerKey, { kv, state, nowMs: t0, read: r.read });
    const later = t0 + (SIGNER_KEY_REREAD_AFTER_SECONDS + 1) * 1000;
    expect(await isCurrentSignerKey(OTHER_KEY, { kv, state, nowMs: later, read: r.read })).toBe(
      true
    );
    expect(r.state.reads).toBe(2);
    expect(state.memory?.key).toBe(OTHER_KEY);
    expect(kv.writes()).toEqual(['meta:signer-key', 'meta:signer-key']);
    expect(
      await isCurrentSignerKey(OTHER_KEY, { kv, state, nowMs: later + 1000, read: r.read })
    ).toBe(true);
    expect(r.state.reads).toBe(2);
  });

  it('a wrong key costs at most one re-read per request, and none while the cache is young', async () => {
    const kv = memoryKv();
    const state = newSignerKeyState();
    const r = reader([D.signerKey]);
    await isCurrentSignerKey(D.signerKey, { kv, state, nowMs: t0, read: r.read });
    expect(await isCurrentSignerKey(OTHER_KEY, { kv, state, nowMs: t0 + 1000, read: r.read })).toBe(
      false
    );
    expect(r.state.reads).toBe(1);
    const later = t0 + (SIGNER_KEY_REREAD_AFTER_SECONDS + 1) * 1000;
    expect(await isCurrentSignerKey(OTHER_KEY, { kv, state, nowMs: later, read: r.read })).toBe(
      false
    );
    expect(r.state.reads).toBe(2);
    expect(kv.writes()).toEqual(['meta:signer-key']);
    expect(
      await isCurrentSignerKey(OTHER_KEY, { kv, state, nowMs: later + 1000, read: r.read })
    ).toBe(false);
    expect(r.state.reads).toBe(2);
  });
});

describe('POST /deposits: the swap must be a live 1Click swap that pays this address', () => {
  it.each([
    ['pays another address', { recipient: 'bc1p' + 'q'.repeat(58) }, 400],
    ['pays out another asset', { destinationAsset: 'nep141:zec.omft.near' }, 400],
    ['has a passed deadline', { deadline: '2026-11-14T11:54:59.000Z' }, 400],
    ['has a deadline this app never sets', { deadline: '2026-11-15T12:00:00.000Z' }, 400],
    ['has an unreadable deadline', { deadline: 'soon' }, 400],
    ['was refunded', { status: 'REFUNDED' }, 400],
    ['failed', { status: 'FAILED' }, 400],
    ['echoes another deposit address', { depositAddress: '0xother' }, 400],
    ['comes without its quote', { omitQuoteResponse: true }, 503],
  ])('refuses a swap that %s and stores nothing', async (_name, swap, status) => {
    const { res, body, w, kv } = await attempt(goodBody(), { w: swapWorld(swap) });
    expect(res.status).toBe(status);
    expect(body).not.toHaveProperty('code');
    expect(expensive(w)).toEqual({ hiro: 1, oneClick: 1, btc: 0 });
    expect(depositWrites(kv)).toEqual([]);
  });

  it('refuses an unknown swap address with 400 and a code the app can retry on', async () => {
    const { res, body, w, kv } = await attempt(goodBody(), { w: swapWorld('unknown') });
    expect(res.status).toBe(400);
    expect(body).toEqual({
      message: '"swapDepositAddress" is not a known 1Click swap',
      code: 'unknown-swap',
    });
    expect(expensive(w).btc).toBe(0);
    expect(depositWrites(kv)).toEqual([]);
  });

  it('answers 503 and stores nothing when 1Click is down', async () => {
    const { res, body, w, kv } = await attempt(goodBody(), {
      w: liveWorld({ oneClickDown: true }),
    });
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('60');
    expect(body).toEqual({ message: 'The swap provider is unavailable. Try again later.' });
    expect(expensive(w).btc).toBe(0);
    expect(depositWrites(kv)).toEqual([]);
  });

  it('accepts a deadline a few minutes behind the Worker clock', async () => {
    const { res } = await attempt(goodBody(), {
      w: swapWorld({ deadline: '2026-11-14T11:57:00.000Z' }),
    });
    expect(res.status).toBe(201);
  });

  it('asks 1Click with the Worker key and stores the swap deadline', async () => {
    const w = liveWorld();
    const kv = memoryKv();
    const env = testEnv({ ONECLICK_JWT: 'worker-key' });
    const { res, text } = await attempt(goodBody(), { w, env, kv });
    expect(res.status).toBe(201);
    expect(text).not.toContain('worker-key');
    expect(w.hits(STATUS_URL).map(c => c.auth)).toEqual(['Bearer worker-key']);
    expect(w.hits(STATUS_URL).map(c => c.url)).toEqual([`${STATUS_URL}?depositAddress=0xswap0`]);
    expect(JSON.parse(kv.data.get(registrationKey(D.address, '0xswap0')) ?? 'null')).toEqual({
      depositScript: D.depositScript,
      reclaimScript: D.reclaimScript,
      swapDepositAddress: '0xswap0',
      deadline: '2026-11-14T14:00:00.000Z',
      createdAt: NOW.toISOString(),
    });
  });

  it('answers 409 when the same swap re-registers a deposit address, after the live check and without writing', async () => {
    const w = liveWorld();
    const kv = memoryKv();
    await attempt(goodBody(), { w, kv });
    const key = registrationKey(D.address, '0xswap0');
    const stored = kv.data.get(key);
    const before = expensive(w);
    const writes = kv.writes().length;
    const again = await attempt(goodBody('0xswap0'), { w, kv });
    expect(again.res.status).toBe(409);
    expect(again.body).toEqual({
      message: 'This deposit is already registered',
      address: D.address,
    });
    expect(expensive(w)).toEqual({ ...before, oneClick: before.oneClick + 1 });
    expect(kv.writes()).toHaveLength(writes);
    expect(kv.data.get(key)).toBe(stored);
  });

  it('reads nothing from KV for a request that fails the live swap check', async () => {
    const w = liveWorld({ swaps: { '0xswapGone': 'unknown' } });
    const kv = memoryKv();
    await attempt(goodBody(), { w, kv });
    const reads = kv.ops.length;
    const res = await attempt(goodBody('0xswapGone'), { w, kv });
    expect(res.res.status).toBe(400);
    expect(kv.ops.slice(reads).filter(o => o.key !== 'meta:signer-key')).toEqual([]);
  });

  it('adds another live swap to the address under its own key, leaving the first alone', async () => {
    const w = liveWorld();
    const kv = memoryKv();
    await attempt(goodBody(), { w, kv });
    const key = registrationKey(D.address, '0xswap0');
    const stored = kv.data.get(key);
    const before = expensive(w).oneClick;
    const other = await attempt(goodBody('0xswapOther'), { w, kv });
    expect(other.res.status).toBe(201);
    expect(other.body).toMatchObject({ address: D.address });
    expect(expensive(w).oneClick).toBe(before + 1);
    expect(kv.data.get(key)).toBe(stored);
    expect(kv.writes()).toContain(registrationKey(D.address, '0xswapOther'));
    const repeat = await attempt(goodBody('0xswapOther'), { w, kv });
    expect(repeat.res.status).toBe(409);
    expect(repeat.body).toEqual({
      message: 'This deposit is already registered',
      address: D.address,
    });
  });

  it('refuses another swap with its own code once the Worker follows as many as it can', async () => {
    const w = liveWorld();
    const kv = memoryKv();
    await attempt(goodBody(), { w, kv });
    for (let n = 0; n < MAX_EXTRA_SWAPS; n++) {
      expect((await attempt(goodBody(`0xswapExtra${n}`), { w, kv })).res.status).toBe(201);
    }
    for (let r = 0; r < 3; r++) await runNotifier(kv, endpoints, w.fetchFn, { now: NOW });
    expect(record(kv)?.swaps).toHaveLength(MAX_EXTRA_SWAPS + 1);
    const writes = kv.writes().length;
    const over = await attempt(goodBody('0xswapOneTooMany'), { w, kv });
    expect(over.res.status).toBe(409);
    expect(over.body).toMatchObject({ address: D.address, code: 'swap-limit' });
    expect(kv.writes()).toHaveLength(writes);
  });

  it('follows at most the hard cap of swaps per address even when the handler let more through', async () => {
    const kv = memoryKv();
    const reg = {
      depositScript: D.depositScript,
      reclaimScript: D.reclaimScript,
      deadline: new Date(NOW.getTime() + 2 * 3_600_000).toISOString(),
    };
    for (let n = 0; n < MAX_EXTRA_SWAPS + 3; n++) {
      const swap = `0xswapRace${n}`;
      kv.data.set(
        registrationKey(D.address, swap),
        JSON.stringify({ ...reg, swapDepositAddress: swap, createdAt: new Date(n).toISOString() })
      );
    }
    const w = world();
    for (let r = 0; r < 4; r++) await runNotifier(kv, endpoints, w.fetchFn, { now: NOW });
    expect(record(kv)?.swaps.map(s => s.swapDepositAddress)).toEqual(
      Array.from({ length: MAX_EXTRA_SWAPS + 1 }, (_, n) => `0xswapRace${n}`)
    );
  });

  it('checks another swap like the first: one that pays another address is refused', async () => {
    const w = liveWorld({ swaps: { '0xswapElse': { recipient: 'bc1p' + 'q'.repeat(58) } } });
    const kv = memoryKv();
    await attempt(goodBody(), { w, kv });
    const writes = kv.writes().length;
    const other = await attempt(goodBody('0xswapElse'), { w, kv });
    expect(other.res.status).toBe(400);
    expect(kv.writes()).toHaveLength(writes);
  });
});

describe('POST /deposits: body size', () => {
  it('refuses a body over the limit with 413 before parsing or calling out', async () => {
    const w = liveWorld();
    const body = { ...goodBody(), pad: 'x'.repeat(MAX_DEPOSIT_BODY_BYTES) };
    const res = await handle(postJson('/deposits', body), testEnv(), w.fetchFn, handleOptions());
    expect(res.status).toBe(413);
    expect(w.calls).toEqual([]);
  });

  it('refuses a declared length over the limit without reading the body', async () => {
    const w = liveWorld();
    const res = await handle(
      postJson('/deposits', goodBody(), {
        'content-length': String(MAX_DEPOSIT_BODY_BYTES + 1),
      }),
      testEnv(),
      w.fetchFn,
      handleOptions()
    );
    expect(res.status).toBe(413);
    expect(w.calls).toEqual([]);
  });

  it('accepts a real registration well under the limit', () => {
    expect(JSON.stringify(goodBody('x'.repeat(200))).length).toBeLessThan(MAX_DEPOSIT_BODY_BYTES);
  });
});

describe('POST /deposits: rate limit', () => {
  function limitedEnv(clock: { now: number }) {
    return testEnv({ DEPOSIT_RATE_LIMITER: new WindowLimiter(DEPOSIT_RATE, () => clock.now) });
  }
  function from(ip?: string): Record<string, string> {
    return ip ? { 'cf-connecting-ip': ip } : {};
  }

  it('allows a burst, then answers 429 with Retry-After and makes no outbound call', async () => {
    const clock = { now: NOW.getTime() };
    const env = limitedEnv(clock);
    const kv = memoryKv();
    const w = liveWorld();
    const ip = from('203.0.113.7');
    for (let i = 0; i < DEPOSIT_RATE.limit; i += 1) {
      const ok = await attempt(indexedBody(i), { w, env, kv, headers: ip });
      expect(ok.res.status).toBe(201);
    }
    const calls = w.calls.length;
    const writes = depositWrites(kv).length;
    const blocked = await attempt(indexedBody(100), { w, env, kv, headers: ip });
    expect(blocked.res.status).toBe(429);
    expect(blocked.res.headers.get('retry-after')).toBe(String(DEPOSIT_RATE.periodSeconds));
    expect(blocked.res.headers.get('access-control-expose-headers')).toBe('retry-after');
    expect(blocked.body).toEqual({ message: 'Too many requests. Try again later.' });
    expect(w.calls).toHaveLength(calls);
    expect(depositWrites(kv)).toHaveLength(writes);

    clock.now += DEPOSIT_RATE.periodSeconds * 1000;
    const reset = await attempt(indexedBody(100), { w, env, kv, headers: ip });
    expect(reset.res.status).toBe(201);
  });

  it('keeps clients apart by IP, and puts clients without an IP header in one bucket', async () => {
    const clock = { now: NOW.getTime() };
    const env = limitedEnv(clock);
    const w = liveWorld({ signerKey: OTHER_KEY });
    for (let i = 0; i < DEPOSIT_RATE.limit; i += 1) {
      expect(
        (await attempt(goodBody(), { w, env, headers: from('198.51.100.1') })).res.status
      ).toBe(400);
    }
    expect((await attempt(goodBody(), { w, env, headers: from('198.51.100.1') })).res.status).toBe(
      429
    );
    expect((await attempt(goodBody(), { w, env, headers: from('198.51.100.2') })).res.status).toBe(
      400
    );
    for (let i = 0; i < DEPOSIT_RATE.limit; i += 1) await attempt(goodBody(), { w, env });
    expect((await attempt(goodBody(), { w, env })).res.status).toBe(429);
  });

  it('does not count requests that fail the local checks', async () => {
    const clock = { now: NOW.getTime() };
    const env = limitedEnv(clock);
    for (let i = 0; i < DEPOSIT_RATE.limit * 2; i += 1) {
      expect((await attempt({ junk: i }, { env, headers: from('192.0.2.9') })).res.status).toBe(
        400
      );
    }
    expect((await attempt(goodBody(), { env, headers: from('192.0.2.9') })).res.status).toBe(201);
  });

  it('falls back to the in-isolate limiter when the binding throws', async () => {
    const env = testEnv({
      DEPOSIT_RATE_LIMITER: { limit: () => Promise.reject(new Error('binding down')) },
    });
    const fallback = {
      deposit: new WindowLimiter({ limit: 0, periodSeconds: 60 }, () => NOW.getTime()),
      proxy: new WindowLimiter({ limit: 0, periodSeconds: 60 }, () => NOW.getTime()),
    };
    const w = liveWorld();
    await handle(postJson('/deposits', goodBody()), env, w.fetchFn, {
      ...handleOptions(),
      fallbackLimiters: fallback,
    });
    const res = await handle(postJson('/deposits', goodBody('0xswap9')), env, w.fetchFn, {
      ...handleOptions(),
      fallbackLimiters: fallback,
    });
    expect(res.status).toBe(429);
  });

  it('reads the client key from CF-Connecting-IP only', () => {
    expect(clientKeyOf(new Request('https://x.example'))).toBe(UNKNOWN_CLIENT);
    expect(
      clientKeyOf(
        new Request('https://x.example', {
          headers: { 'cf-connecting-ip': '2001:DB8::1', 'x-forwarded-for': '1.2.3.4' },
        })
      )
    ).toBe('2001:db8::1');
  });

  it('rate-limits the proxy routes too', async () => {
    const env = testEnv({
      PROXY_RATE_LIMITER: new WindowLimiter({ limit: 1, periodSeconds: 60 }, () => NOW.getTime()),
    });
    let upstream = 0;
    function fetchFn(): Promise<Response> {
      upstream += 1;
      return Promise.resolve(new Response('[]'));
    }
    expect((await handle(new Request('https://api.example/tokens'), env, fetchFn)).status).toBe(
      200
    );
    const blocked = await handle(new Request('https://api.example/tokens'), env, fetchFn);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBe('60');
    expect(upstream).toBe(1);
  });
});

function otherDeposit(i: number) {
  const reclaimKey = (i + 1).toString(16).padStart(64, '0');
  return buildDepositAddress({
    stacksAddress: ZERO_STACKS,
    reclaimPublicKey: reclaimKey,
    signersPublicKey: D.signerKey,
    maxSignerFeeSats: config.baseSignerFeeSats,
    reclaimLockBlocks: config.reclaimLockBlocks,
  });
}

function watchFor(
  address: string,
  scripts: { depositScript: string; reclaimScript: string },
  over: Partial<Watch> = {}
): Watch {
  return {
    address,
    depositScript: scripts.depositScript,
    reclaimScript: scripts.reclaimScript,
    createdAt: NOW.toISOString(),
    swaps: [
      {
        swapDepositAddress: `0x${address.slice(-8)}`,
        deadline: new Date(NOW.getTime() + 2 * 3_600_000).toISOString(),
        createdAt: NOW.toISOString(),
      },
    ],
    registered: [],
    ...over,
  };
}

function seed(kv: MemoryKv, watches: readonly Watch[]): void {
  const index: WatchIndex = {
    ...emptyIndex(),
    watches: [...watches].sort((a, b) => (a.address < b.address ? -1 : 1)),
    listedAt: NOW.getTime(),
  };
  kv.data.set(INDEX_KEY, JSON.stringify(index));
  kv.data.set(LOAD_KEY, JSON.stringify(loadOf(index)));
}

function fills(count: number): Watch[] {
  return Array.from({ length: count }, (_, i) => {
    const other = otherDeposit(i);
    return watchFor(other.address, other);
  });
}

describe('POST /deposits: global cap on active watches', () => {
  it('answers 503 at capacity, with Retry-After, without a list, the mempool snapshot or a write', async () => {
    const kv = memoryKv();
    seed(kv, fills(MAX_ACTIVE_WATCHES));
    const writes = kv.writes().length;
    const { res, body, w } = await attempt(goodBody(), { kv });
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe(String(CAPACITY_RETRY_AFTER_SECONDS));
    expect(body).toEqual({
      message: 'Background tracking is at capacity. The open tab still registers the payout.',
    });
    expect(expensive(w).btc).toBe(0);
    expect(kv.writes().slice(writes)).toEqual(['meta:signer-key']);
    expect(kv.ops.filter(o => o.op === 'list')).toEqual([]);
  });

  it('still takes another swap for an address it already follows when at capacity', async () => {
    const kv = memoryKv();
    seed(kv, [...fills(MAX_ACTIVE_WATCHES - 1), watchFor(D.address, D)]);
    expect((await attempt(goodBody('0xswapMore'), { kv })).res.status).toBe(201);
    expect((await attempt(indexedBody(1), { kv })).res.status).toBe(503);
  });

  it('never follows more than the cap: a new address waits in line until a slot frees', async () => {
    const kv = memoryKv();
    const w = world();
    await registerDeposit(kv, goodBody(), registerDeps(w));
    seed(kv, fills(MAX_ACTIVE_WATCHES));
    const later = { now: new Date(NOW.getTime() + 15 * 60_000) };
    await runNotifier(kv, endpoints, w.fetchFn, later);
    expect(record(kv)).toBeNull();
    expect(watchKeys(kv)).toHaveLength(MAX_ACTIVE_WATCHES + 1);
    const index = (await getIndex(kv)).index;
    if (!index) throw new Error('no index');
    index.watches = index.watches.slice(1);
    kv.data.set(INDEX_KEY, JSON.stringify(index));
    await runNotifier(kv, endpoints, w.fetchFn, later);
    expect(record(kv)?.swaps.map(s => s.swapDepositAddress)).toEqual(['0xswap0']);
  });
});

function utxoVisits(calls: readonly string[]): string[] {
  return calls.flatMap(url => {
    const m = /\/address\/([a-z0-9]+)\/utxo$/.exec(url);
    return m?.[1] ? [m[1]] : [];
  });
}

function simulatedWorld(mode: 'down' | 'processing') {
  const calls: string[] = [];
  function fetchFn(url: string): Promise<Response> {
    calls.push(url);
    if (url.endsWith('/utxo')) return Promise.resolve(jsonRes([]));
    if (url.includes('/v0/status')) {
      if (mode === 'down') return Promise.resolve(jsonRes({ message: 'down' }, 503));
      return Promise.resolve(jsonRes(swapStatus('0x', { status: 'PROCESSING' })));
    }
    return Promise.resolve(jsonRes({ message: 'not found' }, 404));
  }
  return { calls, fetchFn };
}

describe('runNotifier: bounded, fair work', () => {
  it('derives its per-run bounds from the free-plan subrequest limit', () => {
    expect(SUBREQUEST_LIMIT).toBe(50);
    expect(RUN_SUBREQUEST_BUDGET).toBeLessThan(SUBREQUEST_LIMIT);
    expect(MAX_ADDRESSES_PER_RUN).toBe(16);
    expect(MAX_ACTIVE_WATCHES).toBe(320);
    expect(MIN_REGISTRATIONS_PER_RUN).toBeGreaterThanOrEqual(2);
  });

  it('rotates a window from where the last run stopped', () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    expect(rotationWindow(items, 0, 4)).toEqual([0, 1, 2, 3]);
    expect(rotationWindow(items, 8, 4)).toEqual([8, 9, 0, 1]);
    expect(rotationWindow(items.slice(0, 3), 2, 4)).toEqual([2, 0, 1]);
    expect(rotationStart({ at: 3, run: 10 }, 11, 4, 10)).toBe(3);
    expect(rotationStart({ at: 3, run: 10 }, 13, 4, 10)).toBe(1);
    expect(rotationStart({ at: 3, run: 10 }, 10, 4, 10)).toBe(3);
  });

  it.each(['down', 'processing'] as const)(
    'with 320 watches that all cost end-of-watch reads (1Click %s), visits each within one cycle',
    async mode => {
      const kv = memoryKv();
      const all = fills(MAX_ACTIVE_WATCHES).map((watch, i) => ({
        ...watch,
        registered: [`${'ab'.repeat(32)}:${i}`],
      }));
      seed(kv, all);
      const sim = simulatedWorld(mode);
      const lastSeen = new Map<string, number>();
      let worstGap = 0;
      const runs = 3 * FULL_CYCLE_RUNS;
      for (let r = 0; r < runs; r += 1) {
        const from = sim.calls.length;
        const report = await runNotifier(kv, endpoints, sim.fetchFn, {
          now: new Date(NOW.getTime() + r * CRON_PERIOD_MS),
          runIndex: 5_000 + r,
          clock: { now: () => 0, deadline: 1e12 },
        });
        expect(report.subrequests).toBeLessThanOrEqual(RUN_SUBREQUEST_BUDGET);
        for (const a of utxoVisits(sim.calls.slice(from))) {
          const previous = lastSeen.get(a);
          worstGap = Math.max(worstGap, previous === undefined ? r + 1 : r - previous);
          lastSeen.set(a, r);
        }
      }
      expect(lastSeen.size).toBe(MAX_ACTIVE_WATCHES);
      for (const a of all) {
        const seen = lastSeen.get(a.address) ?? -1;
        worstGap = Math.max(worstGap, runs - 1 - seen);
      }
      expect(worstGap).toBeLessThanOrEqual(FULL_CYCLE_RUNS);
    }
  );

  it('a run cut short by time resumes where it stopped instead of skipping the rest', async () => {
    const kv = memoryKv();
    const all = fills(40);
    seed(kv, all);
    const sim = simulatedWorld('processing');
    let ticks = 0;
    await runNotifier(kv, endpoints, sim.fetchFn, {
      now: NOW,
      runIndex: 1,
      clock: { now: () => ticks++, deadline: 5 },
    });
    const first = utxoVisits(sim.calls);
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThan(MAX_ADDRESSES_PER_RUN);
    const from = sim.calls.length;
    await runNotifier(kv, endpoints, sim.fetchFn, { now: NOW, runIndex: 2 });
    const sorted = all.map(w => w.address).sort();
    expect(utxoVisits(sim.calls.slice(from))).toEqual(
      sorted.slice(first.length, first.length + MAX_ADDRESSES_PER_RUN)
    );
  });

  it('never spends more than the per-run budget, and counts what it spends', async () => {
    const kv = memoryKv();
    seed(kv, [...fills(30), watchFor(D.address, D)]);
    const txs = [0, 1, 2, 3, 4, 5].map(i =>
      payoutTx(0, { txid: (i + 10).toString(16).padStart(64, 'e'), value: 20_000 + i })
    );
    const w = liveWorld({ btc: BTC, txs, notifyStatus: 500 });
    w.arrive();
    for (let r = 0; r < 4; r += 1) {
      const kvFrom = kv.ops.length;
      const callsFrom = w.calls.length;
      const report = await runNotifier(kv, endpoints, w.fetchFn, { now: NOW, runIndex: r });
      const spent = kv.ops.length - kvFrom + (w.calls.length - callsFrom);
      expect(spent).toBe(report.subrequests);
      expect(spent).toBeLessThanOrEqual(RUN_SUBREQUEST_BUDGET);
    }
    const small = await runNotifier(kv, endpoints, w.fetchFn, { now: NOW, budget: 9 });
    expect(small.subrequests).toBeLessThanOrEqual(9);
    expect(small.skipped).toBeGreaterThan(0);
  });

  it('defers registrations it cannot afford, keeps them queued, and does them first next run', async () => {
    const kv = memoryKv();
    seed(kv, [watchFor(D.address, D)]);
    const txs = [0, 1, 2, 3, 4].map(i =>
      payoutTx(0, { txid: (i + 10).toString(16).padStart(64, 'e'), value: 20_000 + i })
    );
    const w = liveWorld({ btc: BTC, txs, known: true });
    w.arrive();
    const report = await runNotifier(kv, endpoints, w.fetchFn, { now: NOW, budget: 9 });
    expect(report.subrequests).toBeLessThanOrEqual(9);
    expect(report.deferred).toEqual([D.address]);
    expect(report.finished).toEqual([]);
    expect(watchKeys(kv)).toEqual([`dep:${D.address}`]);
    const queued = (await getIndex(kv)).index?.queue ?? [];
    expect(queued.length).toBeGreaterThan(0);
    const next = await runNotifier(kv, endpoints, w.fetchFn, { now: NOW });
    expect(next.finished).toEqual([D.address]);
  });
});

describe('runNotifier: deadline-based expiry', () => {
  const deadline = new Date(NOW.getTime() + 2 * 3_600_000);
  const pastGrace = { now: new Date(deadline.getTime() + PAYOUT_GRACE_MS + 60_000) };
  const withinGrace = { now: new Date(deadline.getTime() + PAYOUT_GRACE_MS - 60_000) };

  it('ends a watch whose deadline and grace have passed with nothing seen', async () => {
    const w = world({});
    const kv = await watching(w);
    const report = await runNotifier(kv, endpoints, w.fetchFn, pastGrace);
    expect(report.expired).toEqual([D.address]);
    expect(watchKeys(kv)).toEqual([]);
  });

  it('keeps a watch inside the grace period', async () => {
    const w = world({});
    const kv = await watching(w);
    const report = await runNotifier(kv, endpoints, w.fetchFn, withinGrace);
    expect(report.expired).toEqual([]);
    expect(watchKeys(kv)).toHaveLength(1);
  });

  it('registers a late eligible payout instead of expiring', async () => {
    const w = world({ txs: [payoutTx(0)] });
    const kv = await watching(w);
    const report = await runNotifier(kv, endpoints, w.fetchFn, pastGrace);
    expect(report.notified).toHaveLength(1);
    expect(report.finished).toEqual([D.address]);
    expect(report.expired).toEqual([]);
  });

  it('keeps an expired watch while an eligible payout is still unregistered', async () => {
    const w = world({ txs: [payoutTx(0)], notifyStatus: 500 });
    const kv = await watching(w);
    const report = await runNotifier(kv, endpoints, w.fetchFn, pastGrace);
    expect(report.errors).toHaveLength(1);
    expect(report.expired).toEqual([]);
    expect(watchKeys(kv)).toHaveLength(1);
  });

  it('keeps an expired watch when the sBTC minimum cannot be read', async () => {
    const w = world({ txs: [payoutTx(0)], limitsDown: true });
    const kv = await watching(w);
    const report = await runNotifier(kv, endpoints, w.fetchFn, pastGrace);
    expect(report.expired).toEqual([]);
    expect(watchKeys(kv)).toHaveLength(1);
  });

  it('expires on dust alone, which is never eligible', async () => {
    const dust = payoutTx(0, { txid: 'dd'.repeat(32), value: 546 });
    const w = world({ txs: [dust] });
    const kv = await watching(w);
    const report = await runNotifier(kv, endpoints, w.fetchFn, pastGrace);
    expect(report.expired).toEqual([D.address]);
  });

  it('a later swap to the address keeps it watched until that swap’s own deadline and grace', async () => {
    const later = new Date(NOW.getTime() + 20 * 3_600_000);
    const laterDeadline = new Date(later.getTime() + 2 * 3_600_000);
    const w = world({
      swaps: {
        '0xswapA': { status: 'PENDING_DEPOSIT' },
        '0xswapB': { deadline: laterDeadline.toISOString() },
      },
    });
    const kv = await watching(w, memoryKv(), '0xswapA');
    await watching(w, kv, '0xswapB', { now: later });
    const quiet = await runNotifier(kv, endpoints, w.fetchFn, pastGrace);
    expect(quiet).toMatchObject({ expired: [], finished: [] });
    expect(watchKeys(kv)).toEqual([`dep:${D.address}`]);

    w.arrive(payoutTx(0));
    const paid = await runNotifier(kv, endpoints, w.fetchFn, pastGrace);
    expect(outpointsPosted(w)).toEqual([`${D.txid}:0`]);
    expect(paid.finished).toEqual([D.address]);
  });

  it('a pre-registered address still expires after the latest swap’s deadline and grace', async () => {
    const later = new Date(NOW.getTime() + 20 * 3_600_000);
    const laterDeadline = new Date(later.getTime() + 2 * 3_600_000);
    const w = world({ swaps: { '0xswapB': { deadline: laterDeadline.toISOString() } } });
    const kv = await watching(w, memoryKv(), '0xswapA');
    await watching(w, kv, '0xswapB', { now: later });
    const report = await runNotifier(kv, endpoints, w.fetchFn, {
      now: new Date(laterDeadline.getTime() + PAYOUT_GRACE_MS + 60_000),
    });
    expect(report.expired).toEqual([D.address]);
  });
});
