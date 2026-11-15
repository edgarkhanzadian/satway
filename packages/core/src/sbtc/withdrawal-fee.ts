import type { WithdrawalConfig } from '../shared/index.js';

export type WithdrawalFeeConfig = Pick<
  WithdrawalConfig,
  'soloSweepVsize' | 'feeCapMargin' | 'minFeeCapSats' | 'maxFeeCapSats' | 'maxFeeRateSatsPerVbyte'
>;

export class FeeCapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeeCapError';
  }
}

export function withdrawalFeeCap(config: WithdrawalFeeConfig, feeRateSatsPerVbyte: number): number {
  if (!Number.isFinite(feeRateSatsPerVbyte) || feeRateSatsPerVbyte <= 0) {
    throw new FeeCapError('The Bitcoin fee rate must be a positive number of sat/vB');
  }
  if (feeRateSatsPerVbyte > config.maxFeeRateSatsPerVbyte) {
    throw new FeeCapError(
      `The Bitcoin fee rate of ${feeRateSatsPerVbyte} sat/vB is implausibly high; refusing to set a fee cap from it`
    );
  }
  const scaled = Math.ceil(feeRateSatsPerVbyte * config.soloSweepVsize * config.feeCapMargin);
  const cap = Math.max(config.minFeeCapSats, scaled);
  if (cap > config.maxFeeCapSats) {
    throw new FeeCapError(
      `Bitcoin fees are too high right now (${feeRateSatsPerVbyte} sat/vB): the withdrawal fee cap would be ${cap} sats, above the ${config.maxFeeCapSats} sat limit. Try again when fees are lower.`
    );
  }
  return cap;
}
