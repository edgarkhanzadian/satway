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
