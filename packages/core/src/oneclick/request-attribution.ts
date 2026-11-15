import type { NetworkConfig } from '../shared/index.js';
import type { OneClickAppFee } from './oneclick.js';

export const QUOTE_REFERRAL = 'portage';

export type AppFeeConfig = Pick<NetworkConfig, 'appFeeBps' | 'appFeeRecipient'>;

export function assertAppFeeConfig(config: AppFeeConfig): void {
  if (config.appFeeBps < 0 || config.appFeeBps > 100) {
    throw new Error('App fee must be between 0 and 100 basis points');
  }
}

export function appFeesFor(config: AppFeeConfig): OneClickAppFee[] | undefined {
  if (!(config.appFeeBps > 0)) return undefined;
  if (!config.appFeeRecipient) throw new Error('App fee is set but has no recipient');
  return [{ recipient: config.appFeeRecipient, fee: config.appFeeBps }];
}
