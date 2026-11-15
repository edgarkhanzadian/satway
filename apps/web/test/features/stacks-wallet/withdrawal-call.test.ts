import { describe, expect, it } from 'vitest';

import { MAINNET_WITHDRAWAL_FLOW_CONFIG as W, buildWithdrawalContractCall } from '@satway/core';

import { walletCallParams } from '../../../src/features/stacks-wallet/withdrawal-call.js';
import { SENDER, SWAP_ADDRESS } from '../../shared/withdrawal-fixtures.js';

const CALL = buildWithdrawalContractCall(W, {
  sender: SENDER,
  amountSats: 10_000,
  maxFeeSats: 3_000,
  recipientAddress: SWAP_ADDRESS,
});

describe('walletCallParams', () => {
  it('asks the wallet for exactly the built call, in deny mode with the one post-condition', () => {
    expect(walletCallParams(CALL)).toEqual({
      contract: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal',
      functionName: 'initiate-withdrawal-request',
      functionArgs: CALL.functionArgs,
      postConditions: CALL.postConditionsHex,
      postConditionMode: 'deny',
      network: 'mainnet',
      address: SENDER,
    });
  });

  it('refuses a call without exactly one post-condition', () => {
    expect(() => walletCallParams({ ...CALL, postConditionsHex: [] })).toThrow(/exactly one/);
    expect(() =>
      walletCallParams({ ...CALL, postConditionsHex: [...CALL.postConditionsHex, 'ff'] })
    ).toThrow(/exactly one/);
  });
});
