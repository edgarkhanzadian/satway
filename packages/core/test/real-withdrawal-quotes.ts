export const PLACEHOLDER_REFUND_P2WPKH = 'bc1qep7zv4fslevaxnx2swm3uamfxzkzxn2hau4nfw';
export const PLACEHOLDER_EVM_RECIPIENT = '0xb5660bca47faae88a0c286ca8eec920bbae1d7cf';
export const BASE_USDC = 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near';

export const REAL_BTC_ORIGIN_QUOTE: unknown = {
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
    depositAddress: 'bc1q4tqyf2eqk5jhuw3tpame0gdec53k7ft5khap86',
  },
  quoteRequest: {
    dry: false,
    depositMode: 'SIMPLE',
    swapType: 'EXACT_INPUT',
    slippageTolerance: 100,
    originAsset: 'nep141:btc.omft.near',
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: BASE_USDC,
    amount: '10000',
    refundTo: PLACEHOLDER_REFUND_P2WPKH,
    refundType: 'ORIGIN_CHAIN',
    recipient: PLACEHOLDER_EVM_RECIPIENT,
    recipientType: 'DESTINATION_CHAIN',
    deadline: '2026-11-21T16:41:38.000Z',
    confidentiality: 'public',
    quoteWaitingTimeMs: 0,
    insured: false,
    appFees: [
      {
        recipient: '5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd',
        fee: 20,
        limitOrderId: null,
      },
    ],
  },
  signature:
    'ed25519:4AhjzL1GSTpz8iDZ11SkwowdPX32PWGiMXPKsPXPx6boVkiHYDKr7wRNrJbSh2xxmbeLwtufzdHTg3j8bGhaabrn',
  timestamp: '2026-11-14T16:41:38.981Z',
  correlationId: '64f6bb63-8f08-403a-9e8e-b7943af2be8e',
};

export const REAL_BTC_ORIGIN_STATUS: unknown = {
  status: 'PENDING_DEPOSIT',
  updatedAt: '2026-11-14T16:41:39.492Z',
  correlationId: 'a50879ff-cdc2-4e3e-98e4-21d55122979f',
  swapDetails: {
    depositedAmount: null,
    depositedAmountUsd: null,
    depositedAmountFormatted: null,
    intentHashes: [],
    nearTxHashes: [],
    amountIn: null,
    amountInFormatted: null,
    amountInUsd: null,
    amountOut: null,
    amountOutFormatted: null,
    amountOutUsd: null,
    slippage: null,
    refundedAmount: '0',
    refundedAmountFormatted: '0',
    refundedAmountUsd: '0',
    refundReason: null,
    refundFee: '1900',
    withdrawFee: '2400',
    originChainTxHashes: [],
    destinationChainTxHashes: [],
  },
  quoteResponse: {
    timestamp: '2026-11-14T16:41:38.981Z',
    signature:
      'ed25519:4AhjzL1GSTpz8iDZ11SkwowdPX32PWGiMXPKsPXPx6boVkiHYDKr7wRNrJbSh2xxmbeLwtufzdHTg3j8bGhaabrn',
    quoteRequest: {
      dry: false,
      swapType: 'EXACT_INPUT',
      depositMode: 'SIMPLE',
      slippageTolerance: 100,
      originAsset: 'nep141:btc.omft.near',
      depositType: 'ORIGIN_CHAIN',
      destinationAsset: BASE_USDC,
      amount: '10000',
      refundTo: PLACEHOLDER_REFUND_P2WPKH,
      refundType: 'ORIGIN_CHAIN',
      recipient: PLACEHOLDER_EVM_RECIPIENT,
      recipientType: 'DESTINATION_CHAIN',
      deadline: '2026-11-21T16:41:38.000Z',
      appFees: [
        {
          limitOrderId: null,
          recipient: '5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd',
          fee: 20,
        },
      ],
      virtualChainRecipient: null,
      virtualChainRefundRecipient: null,
      referral: null,
      confidentiality: 'public',
    },
    quote: {
      amountIn: '10000',
      amountInFormatted: '0.0001',
      amountInUsd: '6.536500000000',
      minAmountIn: '10000',
      amountOut: '6515571',
      amountOutFormatted: '6.515571',
      amountOutUsd: '6.513173269872',
      minAmountOut: '6450415',
      timeWhenInactive: '2026-11-24T16:41:38.000Z',
      depositAddress: 'bc1q4tqyf2eqk5jhuw3tpame0gdec53k7ft5khap86',
      deadline: '2026-11-24T16:41:38.000Z',
      timeEstimate: 809,
      refundFee: '1900',
      withdrawFee: '2400',
    },
  },
};

export const REAL_BTC_ORIGIN_DRY_QUOTE: unknown = {
  quote: {
    amountIn: '10000',
    amountInFormatted: '0.0001',
    amountInUsd: '6.536500000000',
    minAmountIn: '10000',
    amountOut: '6517200',
    amountOutFormatted: '6.5172',
    amountOutUsd: '6.514801670400',
    minAmountOut: '6452028',
    timeEstimate: 809,
    refundFee: '1900',
    withdrawFee: '2400',
  },
  quoteRequest: {
    dry: true,
    depositMode: 'SIMPLE',
    swapType: 'EXACT_INPUT',
    slippageTolerance: 100,
    originAsset: 'nep141:btc.omft.near',
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: BASE_USDC,
    amount: '10000',
    refundTo: PLACEHOLDER_REFUND_P2WPKH,
    refundType: 'ORIGIN_CHAIN',
    recipient: PLACEHOLDER_EVM_RECIPIENT,
    recipientType: 'DESTINATION_CHAIN',
    deadline: '2026-11-14T18:40:40.000Z',
    confidentiality: 'public',
    quoteWaitingTimeMs: 0,
    insured: false,
    appFees: [
      {
        recipient: '5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd',
        fee: 20,
      },
    ],
  },
  signature:
    'ed25519:2v7BK61JHngjvedVMBrrywR4TbPQpCrhzSrtX1yNq32Wc2SCYsMscaCKNZjDmxgKydAMqyDSSQRgdLEYEN8zT3P8',
  timestamp: '2026-11-14T16:40:40.309Z',
  correlationId: '58816645-0e5c-4c1c-86dc-fa8d55298066',
};

export const REAL_LIMITS: unknown = {
  pegCap: 2100000000000000,
  perDepositMinimum: 10000,
  perDepositCap: 2100000000000000,
  perWithdrawalCap: 5100000000,
  rollingWithdrawalBlocks: 150,
  rollingWithdrawalCap: 15100000000,
  availableToWithdraw: 14793645086,
  accountCaps: {},
  throttleModeInitiator: null,
};

export const REAL_ACTIVE_WITHDRAWAL_CONTRACT =
  '0x0a0614f6decc7cfff2a413bd7cd4f53c25ad7fd1899acc0f736274632d7769746864726177616c';

export const REAL_SBTC_BALANCE_ADDRESS = 'SP2RY5ESETDZAXQ7XWEGN7Q4X7VFAQ13VWHY7CCQ6';
export const REAL_SBTC_BALANCE_URL =
  'https://api.hiro.so/extended/v2/addresses/SP2RY5ESETDZAXQ7XWEGN7Q4X7VFAQ13VWHY7CCQ6/balances/ft/SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token';
export const REAL_SBTC_BALANCE: unknown = { balance: '2700' };
