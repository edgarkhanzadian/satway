export const REAL_DRY_QUOTE: unknown = {
  quote: {
    amountIn: '25000000',
    amountInFormatted: '25.0',
    amountInUsd: '24.991300000000',
    minAmountIn: '25000000',
    amountOut: '36030',
    amountOutFormatted: '0.0003603',
    amountOutUsd: '23.711703300000',
    minAmountOut: '35669',
    timeEstimate: 480,
    refundFee: '2400',
    withdrawFee: '1900',
  },
  quoteRequest: {
    dry: true,
    depositMode: 'SIMPLE',
    swapType: 'EXACT_INPUT',
    slippageTolerance: 100,
    originAsset: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: 'nep141:btc.omft.near',
    amount: '25000000',
    refundTo: '0x2527D02599Ba641c19FEa793cD0F167589a0f10D',
    refundType: 'ORIGIN_CHAIN',
    recipient: 'bc1pytlwt3qfg4rdrk3yxtmdhcjvy0l63yp7qh3jra5xwq8yt6w4fvhqyjl7dx',
    recipientType: 'DESTINATION_CHAIN',
    deadline: '2026-11-14T19:50:54.000Z',
    confidentiality: 'public',
    referral: 'stxonector',
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
    'ed25519:4GwdNUhFKdo6BbCN3nKk2uu8b5QjXKSXb8XfGbWDKvMrq1XqjSNnyvDVSgrzzaVpP73vpqANTVpEW7UqfSbtNrd9',
  timestamp: '2026-11-14T17:50:54.954Z',
  correlationId: '8a0cddb7-f420-4eb9-945c-459f58e58daf',
};

export const REAL_TOKENS: unknown = [
  {
    assetId: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
    decimals: 6,
    blockchain: 'base',
    symbol: 'USDC',
    price: 0.999652,
    priceUpdatedAt: '2026-11-14T17:50:00.796Z',
    contractAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    coingeckoId: 'usd-coin',
  },
  {
    assetId: 'nep141:sol.omft.near',
    decimals: 9,
    blockchain: 'sol',
    symbol: 'SOL',
    price: 72.9,
    priceUpdatedAt: '2026-11-14T17:50:00.796Z',
    coingeckoId: 'solana',
  },
];

export const REAL_LIMITS: unknown = {
  pegCap: 2100000000000000,
  perDepositMinimum: 10000,
  perDepositCap: 2100000000000000,
  perWithdrawalCap: 5100000000,
  rollingWithdrawalBlocks: 150,
  rollingWithdrawalCap: 15100000000,
  availableToWithdraw: 14929166462,
  accountCaps: {},
  throttleModeInitiator: null,
};

export const REAL_EMILY_DEPOSIT: unknown = {
  version: 'v1',
  bitcoinTxid: '5ab7ae554358d3ffdab7cc48db49ff144c5ae4fdd617b4140eac1b1936109bf5',
  bitcoinTxOutputIndex: 0,
  recipient: '0516037370db53547d845976e26dd5b5a92a7c7436ba',
  amount: 20000774,
  lastUpdateHeight: 9483406,
  lastUpdateBlockHash: '214fc144363b8e4545ea67ba1dcb5fa8cf17773d21092142c4d75c528ccac387',
  status: 'confirmed',
  statusMessage:
    'Included in block 214fc144363b8e4545ea67ba1dcb5fa8cf17773d21092142c4d75c528ccac387',
  parameters: {
    maxFee: 80000,
    lockTime: 950,
  },
  reclaimScript: '02b603b2752051b397d3ad5ab4f803565c0243d3c1fa9d5a8124b33547bb993ee1ebeb729ff2ac',
  depositScript:
    '1e00000000000138800516037370db53547d845976e26dd5b5a92a7c7436ba7520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac',
  fulfillment: {
    BitcoinTxid: '36f2f5402c4f7e889144771687e58e0afaf10ef6f16d951363e9cf0488f3e70e',
    BitcoinTxIndex: 0,
    StacksTxid: '3b62babe4850722e74a78cbb8c5dae8554c51a814ff7792d4b72ef78fe7c2a18',
    BitcoinBlockHash: '000000000000000000008c04a09a83ae654167918fc11f0691ec06e46c5af3a2',
    BitcoinBlockHeight: 975753,
    BtcFee: 1502,
  },
};

export const REAL_DEPOSIT_TX: unknown = {
  txid: '5ab7ae554358d3ffdab7cc48db49ff144c5ae4fdd617b4140eac1b1936109bf5',
  version: 2,
  locktime: 0,
  vin: [
    {
      txid: '6c29eb2adb97a6c8c1e002bfd9ab05246d13b2d738c215af251840a0518ff08e',
      vout: 1,
      prevout: {
        scriptpubkey: '00142df601e9bf6db95982ff4579f18ca119f02c0531',
        scriptpubkey_asm: 'OP_0 OP_PUSHBYTES_20 2df601e9bf6db95982ff4579f18ca119f02c0531',
        scriptpubkey_type: 'v0_p2wpkh',
        scriptpubkey_address: 'bc1q9hmqr6dldku4nqhlg4ulrr9pr8czcpf323csys',
        value: 3759,
      },
      scriptsig: '',
      scriptsig_asm: '',
      witness: [
        '3044022045ec482d45a32b8f761cd402687ce8f9e6cc2d9b8ed5bba2c71a31fc099e77cd02200a644600d7174977f7185d630323b1f0dda4b5b81b2017bc8000639015bdd23501',
        '0251b397d3ad5ab4f803565c0243d3c1fa9d5a8124b33547bb993ee1ebeb729ff2',
      ],
      is_coinbase: false,
      sequence: 4294967293,
    },
    {
      txid: '1d3d0b28d4de5f17fb7f0a2a1c61bf04481317b658f96351586f6073fdd56a1e',
      vout: 10,
      prevout: {
        scriptpubkey: '00142df601e9bf6db95982ff4579f18ca119f02c0531',
        scriptpubkey_asm: 'OP_0 OP_PUSHBYTES_20 2df601e9bf6db95982ff4579f18ca119f02c0531',
        scriptpubkey_type: 'v0_p2wpkh',
        scriptpubkey_address: 'bc1q9hmqr6dldku4nqhlg4ulrr9pr8czcpf323csys',
        value: 20000000,
      },
      scriptsig: '',
      scriptsig_asm: '',
      witness: [
        '304402204c18dfb4eb01af4da5f1c66e9c0f79696e55803ec7c257cc7e34014af2c2d97a02202df05db704cbd99c121dd18cb908d5c2a5bd63baca86ad09dbd9c0ad82749b9c01',
        '0251b397d3ad5ab4f803565c0243d3c1fa9d5a8124b33547bb993ee1ebeb729ff2',
      ],
      is_coinbase: false,
      sequence: 4294967293,
    },
  ],
  vout: [
    {
      scriptpubkey: '512022fee5c4094546d1da2432f6dbe24c23ffa8903e05e321f686700e45e9d54b2e',
      scriptpubkey_asm:
        'OP_PUSHNUM_1 OP_PUSHBYTES_32 22fee5c4094546d1da2432f6dbe24c23ffa8903e05e321f686700e45e9d54b2e',
      scriptpubkey_type: 'v1_p2tr',
      scriptpubkey_address: 'bc1pytlwt3qfg4rdrk3yxtmdhcjvy0l63yp7qh3jra5xwq8yt6w4fvhqyjl7dx',
      value: 20000774,
    },
    {
      scriptpubkey: '00142df601e9bf6db95982ff4579f18ca119f02c0531',
      scriptpubkey_asm: 'OP_0 OP_PUSHBYTES_20 2df601e9bf6db95982ff4579f18ca119f02c0531',
      scriptpubkey_type: 'v0_p2wpkh',
      scriptpubkey_address: 'bc1q9hmqr6dldku4nqhlg4ulrr9pr8czcpf323csys',
      value: 2764,
    },
  ],
  size: 382,
  weight: 880,
  sigops: 2,
  fee: 221,
  status: {
    confirmed: true,
    block_height: 975752,
    block_hash: '0000000000000000000055293873da9e6eb5a2ae280b1f6b08350ddd0485501b',
    block_time: 1794637952,
  },
};

export const REAL_OUTSPEND: unknown = {
  spent: true,
  txid: '36f2f5402c4f7e889144771687e58e0afaf10ef6f16d951363e9cf0488f3e70e',
  vin: 1,
  status: {
    confirmed: true,
    block_height: 975753,
    block_hash: '000000000000000000008c04a09a83ae654167918fc11f0691ec06e46c5af3a2',
    block_time: 1794639427,
  },
};

export const LIVE_PROBE_QUOTE: unknown = {
  quote: {
    amountIn: '25000000',
    amountInFormatted: '25.0',
    amountInUsd: '24.990750000000',
    minAmountIn: '25000000',
    amountOut: '37096',
    amountOutFormatted: '0.00037096',
    amountOutUsd: '23.724746800000',
    minAmountOut: '36725',
    timeEstimate: 482,
    refundFee: '2400',
    withdrawFee: '1900',
  },
  quoteRequest: {
    dry: true,
    depositMode: 'SIMPLE',
    swapType: 'EXACT_INPUT',
    slippageTolerance: 100,
    originAsset: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: 'nep141:btc.omft.near',
    amount: '25000000',
    refundTo: '0x2527D02599Ba641c19FEa793cD0F167589a0f10D',
    refundType: 'ORIGIN_CHAIN',
    recipient: 'bc1pytlwt3qfg4rdrk3yxtmdhcjvy0l63yp7qh3jra5xwq8yt6w4fvhqyjl7dx',
    recipientType: 'DESTINATION_CHAIN',
    deadline: '2026-11-15T10:15:02.350Z',
    confidentiality: 'public',
    referral: 'portage',
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
    'ed25519:5dnkvPb1o2xv5qo3Vu1JFNAHfzCCt75LcF9hEcHwt6StRqyHbUejc7YSQjDhUe6MVCCBWhGM2vh6cNKrc1nvczWC',
  timestamp: '2026-11-15T08:15:01.485Z',
  correlationId: '3d7e6693-314a-4c92-bd0a-bf2460ce83ac',
};

export const REAL_LIVE_QUOTE: unknown = {
  quote: {
    amountIn: '25000000',
    amountInFormatted: '25.0',
    amountInUsd: '24.991050000000',
    minAmountIn: '25000000',
    amountOut: '36226',
    amountOutFormatted: '0.00036226',
    amountOutUsd: '23.685645580000',
    minAmountOut: '35863',
    timeEstimate: 465,
    refundFee: '9972',
    withdrawFee: '1900',
    deadline: '2026-11-17T17:26:56.000Z',
    timeWhenInactive: '2026-11-17T17:26:56.000Z',
    depositAddress: '2CXBDfuKKrEmmo5vXnYbCEbUbDyweZcbL12gXC4vHC4G',
  },
  quoteRequest: {
    dry: false,
    depositMode: 'SIMPLE',
    swapType: 'EXACT_INPUT',
    slippageTolerance: 100,
    originAsset: 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near',
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: 'nep141:btc.omft.near',
    amount: '25000000',
    refundTo: '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9',
    refundType: 'ORIGIN_CHAIN',
    recipient: 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr',
    recipientType: 'DESTINATION_CHAIN',
    deadline: '2026-11-14T17:26:56.000Z',
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
    'ed25519:3nJLa3Fb3BVcrwRdXHWcekLnwpmoisHX7wVHUmPuLokJyvoBTk29K9gmx6nQXyTeo8bRQ3n2vFuKNWRxHMCfTBBC',
  timestamp: '2026-11-14T16:56:56.742Z',
  correlationId: '41fc5037-5860-4884-9483-4304f0b2afaa',
};

export const REAL_LIVE_STATUS: unknown = {
  status: 'PENDING_DEPOSIT',
  updatedAt: '2026-11-14T16:56:57.169Z',
  correlationId: '113e0005-b8a2-4373-9542-76038e41b67a',
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
    refundFee: '9972',
    withdrawFee: '1900',
    originChainTxHashes: [],
    destinationChainTxHashes: [],
  },
  quoteResponse: {
    timestamp: '2026-11-14T16:56:56.742Z',
    signature:
      'ed25519:3nJLa3Fb3BVcrwRdXHWcekLnwpmoisHX7wVHUmPuLokJyvoBTk29K9gmx6nQXyTeo8bRQ3n2vFuKNWRxHMCfTBBC',
    quoteRequest: {
      dry: false,
      swapType: 'EXACT_INPUT',
      depositMode: 'SIMPLE',
      slippageTolerance: 100,
      originAsset: 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near',
      depositType: 'ORIGIN_CHAIN',
      destinationAsset: 'nep141:btc.omft.near',
      amount: '25000000',
      refundTo: '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9',
      refundType: 'ORIGIN_CHAIN',
      recipient: 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr',
      recipientType: 'DESTINATION_CHAIN',
      deadline: '2026-11-14T17:26:56.000Z',
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
      amountIn: '25000000',
      amountInFormatted: '25.0',
      amountInUsd: '24.991050000000',
      minAmountIn: '25000000',
      amountOut: '36226',
      amountOutFormatted: '0.00036226',
      amountOutUsd: '23.685645580000',
      minAmountOut: '35863',
      timeWhenInactive: '2026-11-17T17:26:56.000Z',
      depositAddress: '2CXBDfuKKrEmmo5vXnYbCEbUbDyweZcbL12gXC4vHC4G',
      deadline: '2026-11-17T17:26:56.000Z',
      timeEstimate: 465,
      refundFee: '9972',
      withdrawFee: '1900',
    },
  },
};

export const REAL_EMILY_RECLAIM_KEY_DEPOSITS: unknown = {
  nextToken: null,
  deposits: [
    {
      version: 'v1',
      bitcoinTxid: '5ab7ae554358d3ffdab7cc48db49ff144c5ae4fdd617b4140eac1b1936109bf5',
      bitcoinTxOutputIndex: 0,
      recipient: '0516037370db53547d845976e26dd5b5a92a7c7436ba',
      maxFee: 80000,
      amount: 20000774,
      lastUpdateHeight: 9483406,
      lastUpdateBlockHash: '214fc144363b8e4545ea67ba1dcb5fa8cf17773d21092142c4d75c528ccac387',
      status: 'confirmed',
      reclaimScript:
        '02b603b2752051b397d3ad5ab4f803565c0243d3c1fa9d5a8124b33547bb993ee1ebeb729ff2ac',
      depositScript:
        '1e00000000000138800516037370db53547d845976e26dd5b5a92a7c7436ba7520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac',
    },
    {
      version: 'v1',
      bitcoinTxid: '6c29eb2adb97a6c8c1e002bfd9ab05246d13b2d738c215af251840a0518ff08e',
      bitcoinTxOutputIndex: 0,
      recipient: '0516037370db53547d845976e26dd5b5a92a7c7436ba',
      maxFee: 80000,
      amount: 98999847,
      lastUpdateHeight: 9483160,
      lastUpdateBlockHash: 'cfab0bf5b7244775ec4eb9cca7dadf4850d6abc710fac2f676311e47165a21e6',
      status: 'confirmed',
      reclaimScript:
        '02b603b2752051b397d3ad5ab4f803565c0243d3c1fa9d5a8124b33547bb993ee1ebeb729ff2ac',
      depositScript:
        '1e00000000000138800516037370db53547d845976e26dd5b5a92a7c7436ba7520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac',
    },
    {
      version: 'v1',
      bitcoinTxid: 'ac83e594011d20b8600b35ddd8f72aaa9375fe55f4b4785b407f877613c10933',
      bitcoinTxOutputIndex: 0,
      recipient: '0516037370db53547d845976e26dd5b5a92a7c7436ba',
      maxFee: 80000,
      amount: 996020,
      lastUpdateHeight: 9482846,
      lastUpdateBlockHash: 'e7fa74a5b6326cfb93c7237387863fef06f78b3114462c6a92dcfab80a7c08c6',
      status: 'confirmed',
      reclaimScript:
        '02b603b2752051b397d3ad5ab4f803565c0243d3c1fa9d5a8124b33547bb993ee1ebeb729ff2ac',
      depositScript:
        '1e00000000000138800516037370db53547d845976e26dd5b5a92a7c7436ba7520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac',
    },
  ],
};

export const REAL_EMILY_RECLAIM_KEY_FIRST_PAGE: unknown = {
  nextToken:
    'eyJCaXRjb2luVHhpZCI6IjVhYjdhZTU1NDM1OGQzZmZkYWI3Y2M0OGRiNDlmZjE0NGM1YWU0ZmRkNjE3YjQxNDBlYWMxYjE5MzYxMDliZjUiLCJCaXRjb2luVHhPdXRwdXRJbmRleCI6MCwiUmVjbGFpbVB1YmtleXNIYXNoIjoiMWNjZTI4OWI3NzFjN2NiNmU4OGExMjM3ZWFiMWRiNGRkMTkxZjY3OWNjMWVkYzNkZmI2NmY0YTBiZTJiNzlhMyIsIkxhc3RVcGRhdGVIZWlnaHQiOjk0ODM0MDZ9',
  deposits: [
    {
      version: 'v1',
      bitcoinTxid: '5ab7ae554358d3ffdab7cc48db49ff144c5ae4fdd617b4140eac1b1936109bf5',
      bitcoinTxOutputIndex: 0,
      recipient: '0516037370db53547d845976e26dd5b5a92a7c7436ba',
      maxFee: 80000,
      amount: 20000774,
      lastUpdateHeight: 9483406,
      lastUpdateBlockHash: '214fc144363b8e4545ea67ba1dcb5fa8cf17773d21092142c4d75c528ccac387',
      status: 'confirmed',
      reclaimScript:
        '02b603b2752051b397d3ad5ab4f803565c0243d3c1fa9d5a8124b33547bb993ee1ebeb729ff2ac',
      depositScript:
        '1e00000000000138800516037370db53547d845976e26dd5b5a92a7c7436ba7520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac',
    },
  ],
};

export const REAL_EMILY_RECLAIM_KEY_UNKNOWN: unknown = { nextToken: null, deposits: [] };

export const REAL_EMILY_RECLAIM_KEY_BAD_KEY: unknown = {
  message: 'HTTP request failed with status code 400 Bad Request: invalid pubkey',
};

export const REAL_USED_ADDRESS_STATS: unknown = {
  address: 'bc1pytlwt3qfg4rdrk3yxtmdhcjvy0l63yp7qh3jra5xwq8yt6w4fvhqyjl7dx',
  chain_stats: {
    funded_txo_count: 3,
    funded_txo_sum: 119996641,
    spent_txo_count: 3,
    spent_txo_sum: 119996641,
    tx_count: 6,
  },
  mempool_stats: {
    funded_txo_count: 0,
    funded_txo_sum: 0,
    spent_txo_count: 0,
    spent_txo_sum: 0,
    tx_count: 0,
  },
};

export const REAL_UNUSED_ADDRESS_STATS: unknown = {
  address: 'bc1p8vqs7u8lnh8slfzyejq5ml4smmdjj64mjcz9yswhakthg7fcgs3qja4a4x',
  chain_stats: {
    funded_txo_count: 0,
    funded_txo_sum: 0,
    spent_txo_count: 0,
    spent_txo_sum: 0,
    tx_count: 0,
  },
  mempool_stats: {
    funded_txo_count: 0,
    funded_txo_sum: 0,
    spent_txo_count: 0,
    spent_txo_sum: 0,
    tx_count: 0,
  },
};
