export interface NetworkConfig {
  readonly name: 'mainnet';
  readonly sbtcContract: string;
  readonly stxApiUrl: string;
  readonly btcApiUrl: string;
  readonly sbtcApiUrl: string;
  readonly oneClickBaseUrl: string;
  readonly btcAssetId: string;
  readonly maxSignerFeeSats: number;
  readonly reclaimLockBlocks: number;
  readonly appFeeBps: number;
  readonly appFeeRecipient: string | null;
  readonly slippageBps: number;
  readonly quoteDeadlineMinutes: number;
}

export const MAINNET_CONFIG: NetworkConfig = Object.freeze({
  name: 'mainnet',
  sbtcContract: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4',
  stxApiUrl: 'https://api.hiro.so',
  btcApiUrl: 'https://mempool.space/api',
  sbtcApiUrl: 'https://sbtc-emily.com',
  oneClickBaseUrl: 'https://1click.chaindefuser.com',
  btcAssetId: 'nep141:btc.omft.near',
  maxSignerFeeSats: 80_000,
  reclaimLockBlocks: 950,
  appFeeBps: 0,
  appFeeRecipient: null,
  slippageBps: 100,
  quoteDeadlineMinutes: 120,
});

export const P2TR_DUST_SATS = 330;
