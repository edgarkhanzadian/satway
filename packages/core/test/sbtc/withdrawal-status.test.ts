import { Cl, serializeCV } from '@stacks/transactions';
import { describe, expect, it } from 'vitest';

import {
  MAINNET_WITHDRAWAL_FLOW_CONFIG as C,
  type ExpectedWithdrawal,
  type StacksTransaction,
  WithdrawalDataError,
  assertActiveWithdrawalContract,
  checkPastedWithdrawalTransaction,
  describeWithdrawalTxFailure,
  fetchActiveWithdrawalContract,
  fetchOnChainWithdrawalRequest,
  fetchStacksTransaction,
  fetchWithdrawalStatus,
  findWithdrawalAcceptEvent,
  followWithdrawalStatus,
  parseClarityHex,
  parseSweepDataValue,
  parseWith,
  parseWithdrawalCreateEvent,
  parseWithdrawalRequestValue,
  readWithdrawalRequestTransaction,
  requestIdOfResult,
  stacksTransactionSchema,
} from '../../src/index.js';
import { fakeWithdrawalApis, routesFor } from '../fake-withdrawal-apis.js';
import { defined, jsonResponse } from '../fixtures.js';
import { REAL_ACTIVE_WITHDRAWAL_CONTRACT } from '../real-withdrawal-quotes.js';
import {
  REAL_FAILED_REQUESTS,
  REAL_WITHDRAWALS,
  type RealWithdrawal,
} from '../real-withdrawals.js';

function txOf(blob: unknown): StacksTransaction {
  return parseWith(stacksTransactionSchema, blob, 'fixture');
}

function expectedOf(w: RealWithdrawal): ExpectedWithdrawal {
  return {
    sender: w.sender,
    amountSats: w.amountSats,
    maxFeeSats: w.maxFeeSats,
    recipient: { version: w.version, hashbytes: w.hashbytes },
  };
}

function createEventHex(w: RealWithdrawal): string {
  const tx = txOf(w.requestTx);
  const log = defined(
    tx.events?.find(e => e.contract_log?.contract_id.endsWith('.sbtc-registry'))?.contract_log
  );
  return log.value.hex;
}

const ACCEPTED = REAL_WITHDRAWALS.filter(w => w.outcome === 'accepted');
const REJECTED = REAL_WITHDRAWALS.filter(w => w.outcome === 'rejected');
const DIRECT = REAL_WITHDRAWALS.filter(w => w.direct);

describe('reading real withdrawal request transactions', () => {
  it.each(DIRECT.map(w => [w.id, w] as const))(
    'request %i: id from the result and the withdrawal-create event agree with the arguments',
    (id, w) => {
      const reading = readWithdrawalRequestTransaction(txOf(w.requestTx), C);
      if (reading.kind !== 'tx-succeeded') throw new Error(`unexpected ${reading.kind}`);
      expect(reading.requestId).toBe(id);
      expect(reading.call).toEqual(expectedOf(w));
      expect(reading.event).toEqual({ ...expectedOf(w), requestId: id, burnHeight: w.burnHeight });
    }
  );

  it.each(REAL_WITHDRAWALS.map(w => [w.id, w] as const))(
    'request %i: the withdrawal-create print parses',
    (id, w) => {
      expect(parseWithdrawalCreateEvent(createEventHex(w))).toEqual({
        ...expectedOf(w),
        requestId: id,
        burnHeight: w.burnHeight,
      });
    }
  );

  it('reports withdrawals made through another contract as not ours to track', () => {
    for (const w of REAL_WITHDRAWALS.filter(r => !r.direct)) {
      expect(readWithdrawalRequestTransaction(txOf(w.requestTx), C).kind).toBe('not-a-withdrawal');
    }
  });

  it('parses the request id of a real result', () => {
    expect(requestIdOfResult('0x07010000000000000000000000000000140b')).toBe(5131);
    expect(() => requestIdOfResult('0x080100000000000000000000000000000001')).toThrow(/error/);
  });

  it('refuses a result whose id disagrees with the withdrawal-create event', () => {
    const w = defined(DIRECT[0]);
    const tx = txOf(w.requestTx);
    const forged = { ...tx, tx_result: { hex: `0x${serializeCV(Cl.ok(Cl.uint(w.id + 1)))}` } };
    expect(() => readWithdrawalRequestTransaction(forged, C)).toThrow(WithdrawalDataError);
  });

  it('ignores withdrawal-create prints from contracts other than the registry', () => {
    const w = defined(DIRECT[0]);
    const tx = txOf(w.requestTx);
    const spoofed = {
      ...tx,
      events: (tx.events ?? []).map(e =>
        e.contract_log
          ? {
              ...e,
              contract_log: {
                ...e.contract_log,
                contract_id: 'SP000000000000000000002Q6VF78.fake',
              },
            }
          : e
      ),
    };
    const reading = readWithdrawalRequestTransaction(spoofed, C);
    expect(reading.kind === 'tx-succeeded' ? reading.event : 'wrong').toBeNull();
  });

  it('reads pending and dropped transactions, neither of them final', () => {
    const tx = txOf(defined(DIRECT[0]).requestTx);
    expect(readWithdrawalRequestTransaction({ ...tx, tx_status: 'pending' }, C).kind).toBe(
      'tx-pending'
    );
    for (const txStatus of [
      'dropped_replace_by_fee',
      'dropped_replace_across_fork',
      'dropped_too_expensive',
      'dropped_stale_garbage',
      'dropped_problematic',
    ]) {
      expect(
        readWithdrawalRequestTransaction({ ...tx, tx_status: txStatus, tx_result: undefined }, C)
      ).toEqual({ kind: 'tx-dropped', txStatus });
    }
  });

  it('treats only a confirmed abort as a failed request', () => {
    const tx = txOf(defined(DIRECT[0]).requestTx);
    for (const txStatus of ['abort_by_response', 'abort_by_post_condition']) {
      expect(readWithdrawalRequestTransaction({ ...tx, tx_status: txStatus }, C).kind).toBe(
        'tx-failed'
      );
    }
    expect(
      readWithdrawalRequestTransaction({ ...tx, tx_status: 'some_future_status' }, C).kind
    ).toBe('tx-pending');
  });

  it('refuses a transaction to another contract or function', () => {
    const tx = txOf(defined(DIRECT[0]).requestTx);
    const call = defined(tx.contract_call);
    expect(
      readWithdrawalRequestTransaction(
        { ...tx, contract_call: { ...call, function_name: 'accept-withdrawal-request' } },
        C
      ).kind
    ).toBe('not-a-withdrawal');
    expect(
      readWithdrawalRequestTransaction(
        {
          ...tx,
          contract_call: { ...call, contract_id: 'SP000000000000000000002Q6VF78.sbtc-withdrawal' },
        },
        C
      ).kind
    ).toBe('not-a-withdrawal');
  });
});

describe('failed real withdrawal requests', () => {
  it('maps the real post-condition abort', () => {
    const f = defined(REAL_FAILED_REQUESTS.find(r => r.txid.startsWith('bd9b3e')));
    const reading = readWithdrawalRequestTransaction(txOf(f.requestTx), C);
    if (reading.kind !== 'tx-failed') throw new Error(`unexpected ${reading.kind}`);
    expect(reading.failure.code).toBe('post-condition');
    expect(reading.failure.clarityError).toBe('(err u1)');
    expect(reading.failure.message).toMatch(/no sBTC moved/);
  });

  it('maps the real insufficient-balance abort (ft-burn err u1)', () => {
    const f = defined(REAL_FAILED_REQUESTS.find(r => r.txid.startsWith('0fd045')));
    const reading = readWithdrawalRequestTransaction(txOf(f.requestTx), C);
    if (reading.kind !== 'tx-failed') throw new Error(`unexpected ${reading.kind}`);
    expect(reading.failure.code).toBe('insufficient-balance');
    expect(reading.failure.message).toMatch(/balance was too low/);
  });

  it.each([
    [500, 'invalid-recipient-version'],
    [501, 'invalid-recipient-hashbytes'],
    [502, 'below-dust'],
    [400, 'not-active-contract'],
    [507, 'other'],
  ])('maps contract error u%i', (code, expected) => {
    const tx = txOf(defined(REAL_FAILED_REQUESTS[1]).requestTx);
    const failed = {
      ...tx,
      tx_status: 'abort_by_response',
      tx_result: { hex: `0x${serializeCV(Cl.error(Cl.uint(code)))}`, repr: `(err u${code})` },
    };
    const failure = describeWithdrawalTxFailure(failed);
    expect(failure.code).toBe(expected);
    expect(failure.clarityError).toBe(`(err u${code})`);
  });
});

describe('registry read-only results', () => {
  it.each(REAL_WITHDRAWALS.map(w => [w.id, w.outcome, w] as const))(
    'request %i (%s): get-withdrawal-request parses with the right status',
    (id, outcome, w) => {
      const request = parseWithdrawalRequestValue(
        parseClarityHex(w.getWithdrawalRequest, 'fixture'),
        id
      );
      expect(request).toEqual({
        ...expectedOf(w),
        requestId: id,
        burnHeight: w.burnHeight,
        status: outcome,
      });
    }
  );

  it.each(ACCEPTED.map(w => [w.id, w] as const))(
    'request %i: the sweep data names the payout transaction',
    (_id, w) => {
      const sweep = parseSweepDataValue(parseClarityHex(w.getSweepData, 'fixture'));
      expect(sweep?.sweepTxid).toBe(w.payoutTxid);
    }
  );

  it('reads none for rejected and unknown requests', () => {
    for (const w of REJECTED) {
      expect(parseSweepDataValue(parseClarityHex(w.getSweepData, 'fixture'))).toBeNull();
    }
    expect(parseWithdrawalRequestValue(parseClarityHex('0x09', 'none'), 1)).toBeNull();
  });

  it('refuses a result of the wrong shape', () => {
    expect(() => parseWithdrawalRequestValue(Cl.uint(1), 1)).toThrow(/not an optional/);
    expect(() => parseClarityHex('0x0a', 'broken')).toThrow(/does not decode/);
    expect(() => parseClarityHex('nothex', 'broken')).toThrow(/not a hex/);
  });

  it('calls the registry read-only functions with a uint argument', async () => {
    const w = defined(ACCEPTED[0]);
    const api = fakeWithdrawalApis(routesFor(w));
    const request = await fetchOnChainWithdrawalRequest(C, w.id, api.fetchFn);
    expect(request?.status).toBe('accepted');
    expect(api.urls).toEqual([
      'https://api.hiro.so/v2/contracts/call-read/SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4/sbtc-registry/get-withdrawal-request',
    ]);
    await expect(fetchOnChainWithdrawalRequest(C, 0, api.fetchFn)).rejects.toThrow(/positive/);
  });

  it('checks the active withdrawal contract against the real registry answer', async () => {
    const api = fakeWithdrawalApis({
      readOnly: { 'get-active-protocol': REAL_ACTIVE_WITHDRAWAL_CONTRACT },
    });
    expect(await fetchActiveWithdrawalContract(C, api.fetchFn)).toBe(
      'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal'
    );
    await expect(assertActiveWithdrawalContract(C, api.fetchFn)).resolves.toBeUndefined();
    const moved = fakeWithdrawalApis({
      readOnly: {
        'get-active-protocol': `0x${serializeCV(Cl.some(Cl.principal('SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal-v2')))}`,
      },
    });
    await expect(assertActiveWithdrawalContract(C, moved.fetchFn)).rejects.toThrow(
      /sbtc-withdrawal-v2 as the withdrawal contract/
    );
    const failing = fakeWithdrawalApis({});
    await expect(assertActiveWithdrawalContract(C, failing.fetchFn)).rejects.toThrow(
      /Read-only call get-active-protocol failed/
    );
  });
});

describe('withdrawal-accept events', () => {
  it.each(ACCEPTED.map(w => [w.id, w] as const))(
    'request %i: the accept event gives the payout outpoint and fee',
    (id, w) => {
      const event = findWithdrawalAcceptEvent(txOf(w.acceptTx), C, id);
      expect(event).toMatchObject({
        requestId: id,
        bitcoinTxid: w.payoutTxid,
        outputIndex: w.payoutVout,
        feeSats: w.feeSats,
        sweepTxid: w.payoutTxid,
      });
      expect(defined(w.feeSats)).toBeLessThanOrEqual(w.maxFeeSats);
    }
  );

  it('finds nothing for another request id or a failed transaction', () => {
    const w = defined(ACCEPTED[0]);
    const tx = txOf(w.acceptTx);
    expect(findWithdrawalAcceptEvent(tx, C, w.id + 1)).toBeNull();
    expect(
      findWithdrawalAcceptEvent({ ...tx, tx_status: 'abort_by_response' }, C, w.id)
    ).toBeNull();
  });
});

describe('fetchWithdrawalStatus on real data', () => {
  it.each(ACCEPTED.filter(w => w.direct).map(w => [w.id, w] as const))(
    'request %i: accepted, with the payout from the on-chain accept event',
    async (id, w) => {
      const api = fakeWithdrawalApis(routesFor(w));
      const status = await fetchWithdrawalStatus(C, w.requestTxid, expectedOf(w), api.fetchFn);
      if (status.kind !== 'accepted') throw new Error(`unexpected ${status.kind}`);
      expect(status.request.requestId).toBe(id);
      expect(status.payout).toEqual({
        bitcoinTxid: w.payoutTxid,
        outputIndex: w.payoutVout,
        feeSats: w.feeSats,
        acceptStacksTxid: w.acceptTxid,
        source: 'accept-event',
      });
      expect(status.sweep?.sweepTxid).toBe(w.payoutTxid);
    }
  );

  it.each(REJECTED.map(w => [w.id, w] as const))('request %i: rejected', async (id, w) => {
    const api = fakeWithdrawalApis(routesFor(w));
    const status = await fetchWithdrawalStatus(C, w.requestTxid, expectedOf(w), api.fetchFn);
    expect(status.kind).toBe('rejected');
    expect(status.kind === 'rejected' ? status.request.requestId : null).toBe(id);
  });

  it('is requested while the registry has no status', async () => {
    const w = defined(REJECTED[0]);
    const pending = `0x${serializeCV(
      Cl.some(
        Cl.tuple({
          amount: Cl.uint(w.amountSats),
          'max-fee': Cl.uint(w.maxFeeSats),
          sender: Cl.principal(w.sender),
          recipient: Cl.tuple({
            version: Cl.bufferFromHex(w.version),
            hashbytes: Cl.bufferFromHex(w.hashbytes),
          }),
          'block-height': Cl.uint(w.burnHeight),
          status: Cl.none(),
        })
      )
    )}`;
    const routes = routesFor(w);
    const api = fakeWithdrawalApis({
      ...routes,
      readOnly: { ...routes.readOnly, 'get-withdrawal-request': pending },
    });
    const status = await fetchWithdrawalStatus(C, w.requestTxid, expectedOf(w), api.fetchFn);
    expect(status.kind).toBe('requested');
  });

  it('reports an unknown transaction', async () => {
    const w = defined(ACCEPTED[0]);
    const api = fakeWithdrawalApis({});
    expect((await fetchWithdrawalStatus(C, w.requestTxid, expectedOf(w), api.fetchFn)).kind).toBe(
      'unknown-tx'
    );
  });

  it('reports a failed transaction with its reason', async () => {
    const f = defined(REAL_FAILED_REQUESTS[1]);
    const api = fakeWithdrawalApis({ stacksTxs: { [f.txid]: f.requestTx } });
    const w = defined(ACCEPTED[0]);
    const status = await fetchWithdrawalStatus(C, f.txid, expectedOf(w), api.fetchFn);
    expect(status.kind === 'tx-failed' ? status.failure.code : status.kind).toBe(
      'insufficient-balance'
    );
  });

  it.each([
    ['amount', (e: ExpectedWithdrawal) => ({ ...e, amountSats: e.amountSats + 1 }), /amount is/],
    ['fee cap', (e: ExpectedWithdrawal) => ({ ...e, maxFeeSats: e.maxFeeSats - 1 }), /fee cap is/],
    [
      'recipient',
      (e: ExpectedWithdrawal) => ({
        ...e,
        recipient: { ...e.recipient, hashbytes: '00'.repeat(20) },
      }),
      /recipient differs/,
    ],
    [
      'recipient version',
      (e: ExpectedWithdrawal) => ({ ...e, recipient: { ...e.recipient, version: '02' } }),
      /recipient differs/,
    ],
    [
      'sender',
      (e: ExpectedWithdrawal) => ({ ...e, sender: 'SP000000000000000000002Q6VF78' }),
      /sender is/,
    ],
  ])('reports a mismatch when the receipt %s differs from the chain', async (_n, tamper, msg) => {
    const w = defined(ACCEPTED[0]);
    const api = fakeWithdrawalApis(routesFor(w));
    const status = await fetchWithdrawalStatus(
      C,
      w.requestTxid,
      tamper(expectedOf(w)),
      api.fetchFn
    );
    if (status.kind !== 'mismatch') throw new Error(`unexpected ${status.kind}`);
    expect(status.requestId).toBe(w.id);
    expect(status.soft).toBe(false);
    expect(status.problems.join(' ')).toMatch(msg);
    expect(status.problems.some(p => p.startsWith('sBTC registry'))).toBe(true);
  });

  it('reports a soft mismatch when the registry has no such request', async () => {
    const w = defined(ACCEPTED[0]);
    const routes = routesFor(w);
    const api = fakeWithdrawalApis({
      ...routes,
      readOnly: { ...routes.readOnly, 'get-withdrawal-request': '0x09' },
    });
    const status = await fetchWithdrawalStatus(C, w.requestTxid, expectedOf(w), api.fetchFn);
    if (status.kind !== 'mismatch') throw new Error(`unexpected ${status.kind}`);
    expect(status.problems.join(' ')).toMatch(/no withdrawal request/);
    expect(status.soft).toBe(true);
    const tampered = await fetchWithdrawalStatus(
      C,
      w.requestTxid,
      { ...expectedOf(w), amountSats: w.amountSats + 1 },
      api.fetchFn
    );
    expect(tampered.kind === 'mismatch' ? tampered.soft : tampered.kind).toBe(false);
  });

  it('keeps the acceptance but no payout when Emily is down', async () => {
    const w = defined(ACCEPTED[0]);
    const routes = routesFor(w);
    const api = fakeWithdrawalApis({
      ...routes,
      overrides: { [`${C.sbtcApiUrl}/withdrawal/${w.id}`]: jsonResponse({}, 502) },
    });
    const status = await fetchWithdrawalStatus(C, w.requestTxid, expectedOf(w), api.fetchFn);
    if (status.kind !== 'accepted') throw new Error(`unexpected ${status.kind}`);
    expect(status.payout).toBeNull();
    expect(status.payoutError).toMatch(/HTTP 502/);
    expect(status.sweep?.sweepTxid).toBe(w.payoutTxid);
  });

  it('does not trust an Emily hint pointing at an unrelated transaction', async () => {
    const w = defined(ACCEPTED[0]);
    const other = defined(ACCEPTED[1]);
    const routes = routesFor(w);
    const api = fakeWithdrawalApis({
      ...routes,
      stacksTxs: { ...routes.stacksTxs, ...routesFor(other).stacksTxs },
      emilyWithdrawals: { [w.id]: other.emily },
    });
    const status = await fetchWithdrawalStatus(C, w.requestTxid, expectedOf(w), api.fetchFn);
    if (status.kind !== 'accepted') throw new Error(`unexpected ${status.kind}`);
    expect(status.payout).toBeNull();
    expect(status.payoutError).toMatch(/no acceptance event for this request/);
  });

  it('reports a mismatch when the accept event and registry disagree on the sweep', async () => {
    const w = defined(ACCEPTED[0]);
    const routes = routesFor(w);
    const otherSweep = `0x${serializeCV(
      Cl.some(
        Cl.tuple({
          'sweep-txid': Cl.bufferFromHex('11'.repeat(32)),
          'sweep-burn-hash': Cl.bufferFromHex('22'.repeat(32)),
          'sweep-burn-height': Cl.uint(1),
        })
      )
    )}`;
    const api = fakeWithdrawalApis({
      ...routes,
      readOnly: { ...routes.readOnly, 'get-completed-withdrawal-sweep-data': otherSweep },
    });
    const status = await fetchWithdrawalStatus(C, w.requestTxid, expectedOf(w), api.fetchFn);
    expect(status.kind === 'mismatch' ? status.problems.join(' ') : status.kind).toMatch(
      /disagree about the sweep/
    );
    expect(status.kind === 'mismatch' ? status.soft : null).toBe(true);
  });

  it('passes Stacks API failures to the caller and refuses bad txids', async () => {
    const w = defined(ACCEPTED[0]);
    const api = fakeWithdrawalApis({
      overrides: {
        [`${C.stxApiUrl}/extended/v1/tx/0x${w.requestTxid}?event_limit=50`]: jsonResponse({}, 500),
      },
    });
    await expect(
      fetchWithdrawalStatus(C, w.requestTxid, expectedOf(w), api.fetchFn)
    ).rejects.toThrow(/HTTP 500/);
    await expect(fetchStacksTransaction(C.stxApiUrl, 'abc', api.fetchFn)).rejects.toThrow(
      /Not a Stacks transaction id/
    );
  });
});

describe('following a dropped withdrawal transaction', () => {
  const w = defined(DIRECT.find(d => d.outcome === 'accepted'));
  const DROPPED_TXID = 'ab'.repeat(32);
  const real = txOf(w.requestTx);
  const nonce = defined(real.nonce);
  const droppedTx = {
    ...txOf(w.requestTx),
    tx_id: `0x${DROPPED_TXID}`,
    tx_status: 'dropped_replace_by_fee',
    tx_result: undefined,
    events: [],
  };
  const confirmedUrl = `${C.stxApiUrl}/extended/v1/tx?from_address=${w.sender}&nonce=${nonce}&limit=10`;
  const mempoolUrl = `${C.stxApiUrl}/extended/v1/tx/mempool?sender_address=${w.sender}&limit=50`;

  function apisWith(confirmed: unknown[], pending: unknown[]) {
    const routes = routesFor(w);
    return fakeWithdrawalApis({
      ...routes,
      stacksTxs: { ...routes.stacksTxs, [DROPPED_TXID]: droppedTx },
      overrides: {
        [confirmedUrl]: jsonResponse({ results: confirmed }),
        [mempoolUrl]: jsonResponse({ results: pending }),
      },
    });
  }

  it('follows a confirmed replacement at the same nonce that makes the same call', async () => {
    const api = apisWith([w.requestTx], []);
    const followed = await followWithdrawalStatus(C, DROPPED_TXID, expectedOf(w), api.fetchFn);
    expect(followed.stacksTxid).toBe(w.requestTxid);
    expect(followed.status.kind).toBe('accepted');
    expect(api.urls).toContain(confirmedUrl);
    expect(api.urls).toContain(mempoolUrl);
  });

  it('follows a pending replacement in the mempool', async () => {
    const pendingTxid = 'cd'.repeat(32);
    const pending = {
      ...txOf(w.requestTx),
      tx_id: `0x${pendingTxid}`,
      tx_status: 'pending',
      tx_result: undefined,
      events: [],
    };
    const api = apisWith([], [pending]);
    const followed = await followWithdrawalStatus(C, DROPPED_TXID, expectedOf(w), api.fetchFn);
    expect(followed).toEqual({ stacksTxid: pendingTxid, status: { kind: 'tx-pending' } });
  });

  it('does not follow a confirmed different call at the same nonce, and ends the withdrawal', async () => {
    const other = structuredClone(w.requestTx);
    const call = defined(txOf(other).contract_call);
    const args = defined(call.function_args).map((a, i) =>
      i === 0 ? { ...a, hex: `0x${serializeCV(Cl.uint(w.amountSats + 1))}` } : a
    );
    const api = apisWith([{ ...txOf(other), contract_call: { ...call, function_args: args } }], []);
    const followed = await followWithdrawalStatus(C, DROPPED_TXID, expectedOf(w), api.fetchFn);
    expect(followed).toEqual({
      stacksTxid: DROPPED_TXID,
      status: { kind: 'tx-cancelled', replacedBy: w.requestTxid.replace(/^0x/, '') },
    });
  });

  it('ends the withdrawal when a different transaction confirmed at that nonce, like a wallet cancel', async () => {
    const cancelTxid = 'ef'.repeat(32);
    const cancel = {
      tx_id: `0x${cancelTxid}`,
      tx_status: 'success',
      tx_type: 'token_transfer',
      sender_address: w.sender,
      nonce,
      block_height: 9_000_000,
    };
    const api = apisWith([cancel], []);
    const followed = await followWithdrawalStatus(C, DROPPED_TXID, expectedOf(w), api.fetchFn);
    expect(followed).toEqual({
      stacksTxid: DROPPED_TXID,
      status: { kind: 'tx-cancelled', replacedBy: cancelTxid },
    });
  });

  it('keeps waiting while the only other transaction at that nonce is still in the mempool', async () => {
    const pending = {
      tx_id: `0x${'ef'.repeat(32)}`,
      tx_status: 'pending',
      tx_type: 'token_transfer',
      sender_address: w.sender,
      nonce,
    };
    const api = apisWith([], [pending]);
    const followed = await followWithdrawalStatus(C, DROPPED_TXID, expectedOf(w), api.fetchFn);
    expect(followed.status.kind).toBe('tx-dropped');
  });

  it('never matches a call with no arguments, even to the same function', async () => {
    const empty = (tx: StacksTransaction): StacksTransaction => ({
      ...tx,
      contract_call: { ...defined(tx.contract_call), function_args: [] },
    });
    const routes = routesFor(w);
    const pendingTxid = 'cd'.repeat(32);
    const pending = {
      ...empty(txOf(w.requestTx)),
      tx_id: `0x${pendingTxid}`,
      tx_status: 'pending',
    };
    const api = fakeWithdrawalApis({
      ...routes,
      stacksTxs: { ...routes.stacksTxs, [DROPPED_TXID]: empty(droppedTx) },
      overrides: {
        [confirmedUrl]: jsonResponse({ results: [] }),
        [mempoolUrl]: jsonResponse({ results: [pending] }),
      },
    });
    const followed = await followWithdrawalStatus(C, DROPPED_TXID, expectedOf(w), api.fetchFn);
    expect(followed.stacksTxid).toBe(DROPPED_TXID);
  });

  it('does not follow a replacement whose re-read by ID shows another sender, nonce or call', async () => {
    const pendingTxid = 'cd'.repeat(32);
    const listed = {
      ...txOf(w.requestTx),
      tx_id: `0x${pendingTxid}`,
      tx_status: 'pending',
      tx_result: undefined,
      events: [],
    };
    for (const reread of [
      { ...listed, sender_address: 'SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7' },
      { ...listed, nonce: nonce + 1 },
      { ...listed, contract_call: { ...defined(listed.contract_call), function_name: 'other' } },
    ]) {
      const routes = routesFor(w);
      const api = fakeWithdrawalApis({
        ...routes,
        stacksTxs: { ...routes.stacksTxs, [DROPPED_TXID]: droppedTx, [pendingTxid]: reread },
        overrides: {
          [confirmedUrl]: jsonResponse({ results: [] }),
          [mempoolUrl]: jsonResponse({ results: [listed] }),
        },
      });
      const followed = await followWithdrawalStatus(C, DROPPED_TXID, expectedOf(w), api.fetchFn);
      expect(followed.stacksTxid).toBe(DROPPED_TXID);
      expect(followed.status.kind).toBe('tx-dropped');
    }
  });

  it('keeps watching the dropped transaction when the replacement lookup fails', async () => {
    const routes = routesFor(w);
    const api = fakeWithdrawalApis({
      ...routes,
      stacksTxs: { ...routes.stacksTxs, [DROPPED_TXID]: droppedTx },
    });
    const followed = await followWithdrawalStatus(C, DROPPED_TXID, expectedOf(w), api.fetchFn);
    expect(followed.stacksTxid).toBe(DROPPED_TXID);
    if (followed.status.kind !== 'tx-dropped') throw new Error(followed.status.kind);
    expect(followed.status.lookupError).toMatch(/HTTP 404/);
  });

  it('does not look anything up for a dropped transaction without a nonce', async () => {
    const routes = routesFor(w);
    const api = fakeWithdrawalApis({
      ...routes,
      stacksTxs: { ...routes.stacksTxs, [DROPPED_TXID]: { ...droppedTx, nonce: undefined } },
    });
    const followed = await followWithdrawalStatus(C, DROPPED_TXID, expectedOf(w), api.fetchFn);
    expect(followed.status).toEqual({
      kind: 'tx-dropped',
      txStatus: 'dropped_replace_by_fee',
      lookupError: null,
    });
    expect(api.urls).toHaveLength(1);
  });
});

describe('checking a pasted withdrawal transaction', () => {
  const w = defined(DIRECT[0]);
  const id = w.requestTxid.replace(/^0x/, '');

  function apisWithTx(tx: unknown) {
    const routes = routesFor(w);
    return fakeWithdrawalApis({ ...routes, stacksTxs: { [id]: tx } });
  }

  it('accepts the transaction that makes exactly this withdrawal’s call', async () => {
    const api = apisWithTx(w.requestTx);
    await expect(
      checkPastedWithdrawalTransaction(C, `0x${id.toUpperCase()}`, expectedOf(w), api.fetchFn)
    ).resolves.toEqual({ kind: 'matches', stacksTxid: id });
  });

  it('says when Stacks does not know the transaction yet', async () => {
    const routes = routesFor(w);
    const api = fakeWithdrawalApis({ ...routes, stacksTxs: {} });
    await expect(
      checkPastedWithdrawalTransaction(C, id, expectedOf(w), api.fetchFn)
    ).resolves.toEqual({ kind: 'not-found' });
  });

  it('refuses a call to another contract or function', async () => {
    const tx = txOf(w.requestTx);
    const call = defined(tx.contract_call);
    for (const contract_call of [
      { ...call, contract_id: `${C.sbtcContract}.sbtc-deposit` },
      { ...call, function_name: 'transfer' },
    ]) {
      const api = apisWithTx({ ...tx, contract_call });
      const check = await checkPastedWithdrawalTransaction(C, id, expectedOf(w), api.fetchFn);
      expect(check).toEqual({
        kind: 'different',
        message: `It is not a call to ${C.sbtcContract}.sbtc-withdrawal::initiate-withdrawal-request.`,
      });
    }
  });

  it('refuses a transaction sent from another account', async () => {
    const api = apisWithTx({
      ...txOf(w.requestTx),
      sender_address: 'SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7',
    });
    await expect(
      checkPastedWithdrawalTransaction(C, id, expectedOf(w), api.fetchFn)
    ).resolves.toEqual({
      kind: 'different',
      message: `It was sent from SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7, not from ${w.sender}.`,
    });
  });

  it('refuses the right call with a different amount, fee cap or Bitcoin address', async () => {
    const tx = txOf(w.requestTx);
    const call = defined(tx.contract_call);
    const args = defined(call.function_args).map((a, i) =>
      i === 0 ? { ...a, hex: `0x${serializeCV(Cl.uint(w.amountSats + 1))}` } : a
    );
    const api = apisWithTx({ ...tx, contract_call: { ...call, function_args: args } });
    await expect(
      checkPastedWithdrawalTransaction(C, id, expectedOf(w), api.fetchFn)
    ).resolves.toEqual({
      kind: 'different',
      message: 'It withdraws a different amount, fee cap or Bitcoin address than this withdrawal.',
    });
  });
});
