import {
  type OneClickQuoteResponse,
  type OneClickSwapStatus,
  type PayoutVerification,
  MAINNET_WITHDRAWAL_FLOW_CONFIG as W,
  type WithdrawalFacts,
  type WithdrawalObservation,
  type WithdrawalStatus,
  deriveWithdrawalProgress,
  encodeWithdrawalRecipient,
  oneClickQuoteResponseSchema,
  parseWith,
} from '@satway/core';

import {
  WITHDRAWAL_RECEIPT_KIND,
  type WithdrawalReceiptFile,
} from '../../src/shared/withdrawal-receipt.js';

export const BASE_USDC = 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near';
export const EVM_RECIPIENT = '0xb5660bca47faae88a0c286ca8eec920bbae1d7cf';
export const REFUND = 'bc1qep7zv4fslevaxnx2swm3uamfxzkzxn2hau4nfw';
export const SWAP_ADDRESS = 'bc1q4tqyf2eqk5jhuw3tpame0gdec53k7ft5khap86';
export const SENDER = 'SP2RY5ESETDZAXQ7XWEGN7Q4X7VFAQ13VWHY7CCQ6';
export const STACKS_TXID = 'a'.repeat(64);

export const QUOTE: OneClickQuoteResponse = parseWith(
  oneClickQuoteResponseSchema,
  {
    quote: {
      amountIn: '10000',
      amountInFormatted: '0.0001',
      amountInUsd: '6.536500000000',
      minAmountIn: '10000',
      amountOut: '6515571',
      amountOutFormatted: '6.515571',
      amountOutUsd: '6.513173269872',
      minAmountOut: '6450415',
      timeEstimate: 809,
      refundFee: '1900',
      withdrawFee: '2400',
      deadline: '2026-11-24T16:41:38.000Z',
      timeWhenInactive: '2026-11-24T16:41:38.000Z',
      depositAddress: SWAP_ADDRESS,
    },
    quoteRequest: {
      dry: false,
      depositMode: 'SIMPLE',
      swapType: 'EXACT_INPUT',
      slippageTolerance: 100,
      originAsset: W.btcAssetId,
      depositType: 'ORIGIN_CHAIN',
      destinationAsset: BASE_USDC,
      amount: '10000',
      refundTo: REFUND,
      refundType: 'ORIGIN_CHAIN',
      recipient: EVM_RECIPIENT,
      recipientType: 'DESTINATION_CHAIN',
      deadline: '2026-11-16T16:41:38.000Z',
      appFees: [
        {
          recipient: '5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd',
          fee: 20,
          limitOrderId: null,
        },
      ],
    },
    signature: 'ed25519:4AhjzL1GSTpz8iDZ11SkwowdPX32PWGiMXPKsPXPx6boVkiHYDKr7wRNrJbSh2xxmbe',
    timestamp: '2026-11-14T16:41:38.981Z',
    correlationId: '64f6bb63-8f08-403a-9e8e-b7943af2be8e',
  },
  'fixture'
);

export function receiptFixture(over: Partial<WithdrawalReceiptFile> = {}): WithdrawalReceiptFile {
  return {
    kind: WITHDRAWAL_RECEIPT_KIND,
    version: 1,
    createdAt: '2026-11-14T16:41:38.000Z',
    stacksTxid: STACKS_TXID,
    sender: SENDER,
    amountSats: 10_000,
    maxFeeSats: 3_000,
    depositAddress: SWAP_ADDRESS,
    recipient: encodeWithdrawalRecipient(SWAP_ADDRESS).recipient,
    destination: {
      assetId: BASE_USDC,
      chain: 'base',
      symbol: 'USDC',
      decimals: 6,
      address: EVM_RECIPIENT,
    },
    refundTo: REFUND,
    quoteResponse: QUOTE,
    quoteDeadline: '2026-11-16T16:41:38.000Z',
    ...over,
  };
}

const REQUEST = {
  requestId: 5300,
  amountSats: 10_000,
  maxFeeSats: 3_000,
  sender: SENDER,
  recipient: encodeWithdrawalRecipient(SWAP_ADDRESS).recipient,
  burnHeight: 976_000,
};

export const STACKS = {
  unknown: { kind: 'unknown-tx' },
  pending: { kind: 'tx-pending' },
  failed: {
    kind: 'tx-failed',
    failure: { code: 'insufficient-balance', clarityError: '(err u1)', message: 'Too low.' },
  },
  requested: {
    kind: 'requested',
    request: { ...REQUEST, status: 'pending' },
    stacksBlockHeight: 1,
  },
  rejected: { kind: 'rejected', request: { ...REQUEST, status: 'rejected' } },
  accepted: {
    kind: 'accepted',
    request: { ...REQUEST, status: 'accepted' },
    sweep: null,
    payout: {
      bitcoinTxid: 'b'.repeat(64),
      outputIndex: 0,
      feeSats: 1_200,
      acceptStacksTxid: 'c'.repeat(64),
      source: 'accept-event',
    },
    payoutError: null,
  },
  mismatch: { kind: 'mismatch', requestId: 5300, problems: ['sBTC registry: amount differs'] },
} satisfies Record<string, WithdrawalStatus>;

export function payoutOf(over: Partial<PayoutVerification> = {}): PayoutVerification {
  return {
    ok: true,
    txid: 'b'.repeat(64),
    vout: 0,
    valueSats: 10_000,
    problems: [],
    confirmed: true,
    blockHeight: 976_010,
    confirmations: 2,
    ...over,
  };
}

export function observationOf(input: {
  stacks: WithdrawalStatus | null;
  payout?: PayoutVerification | null;
  swap?: OneClickSwapStatus | null;
  mismatches?: string[];
  deadlinePassed?: boolean;
}): WithdrawalObservation {
  const payout = input.payout ?? null;
  const swap = input.swap ?? null;
  const mismatches = input.mismatches ?? [];
  const facts: WithdrawalFacts = {
    requestId: null,
    request: null,
    txFailure: null,
    feeSats: null,
    payoutTxid: null,
    payoutVout: null,
    payoutConfirmations: null,
    payoutVerified: payout?.ok ?? false,
    swapStatus: swap,
    swapEcho: swap === null ? null : 'matched',
    destinationTxHashes: [],
    refund: null,
    deadlinePassed: input.deadlinePassed ?? false,
    mismatches,
    errors: [],
  };
  return {
    stacks: input.stacks,
    payout,
    facts,
    progress: deriveWithdrawalProgress({
      stacks: input.stacks,
      payout,
      swap,
      swapEcho: facts.swapEcho,
      mismatches,
      deadlinePassed: facts.deadlinePassed,
      rejectionBlocks: W.rejectionBlocks,
    }),
  };
}
