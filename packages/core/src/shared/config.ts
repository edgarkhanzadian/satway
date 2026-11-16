export interface NetworkConfig {
  readonly name: 'mainnet';
  readonly sbtcContract: string;
  readonly stxApiUrl: string;
  readonly stxSecondaryApiUrl: string;
  readonly btcApiUrl: string;
  readonly sbtcApiUrl: string;
  readonly oneClickBaseUrl: string;
  readonly btcAssetId: string;
  readonly baseSignerFeeSats: number;
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
  stxSecondaryApiUrl: 'https://stacks-node.alexlab.co',
  btcApiUrl: 'https://mempool.space/api',
  sbtcApiUrl: 'https://sbtc-emily.com',
  oneClickBaseUrl: 'https://1click.chaindefuser.com',
  btcAssetId: 'nep141:btc.omft.near',
  baseSignerFeeSats: 80_000,
  reclaimLockBlocks: 950,
  appFeeBps: 0,
  appFeeRecipient: null,
  slippageBps: 100,
  quoteDeadlineMinutes: 120,
});

export const DEPOSIT_INDEX_LIMIT = 65_536;

export const DEPOSIT_INDEX_WINDOW = 256;

export const P2TR_DUST_SATS = 330;

export const MAX_FEE_RATE_SATS_PER_VBYTE = 500;

export function feeRateAboveCapMessage(feeRate: number): string {
  return `The current Bitcoin fee rate is ${feeRate} sat/vB, above the ${MAX_FEE_RATE_SATS_PER_VBYTE} sat/vB this page pays for a reclaim, so no reclaim was built and nothing was signed or sent. Your BTC stays reclaimable: try again when fees are lower.`;
}
