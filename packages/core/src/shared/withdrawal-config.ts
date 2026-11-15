import { MAINNET_CONFIG, type NetworkConfig } from './config.js';

export interface WithdrawalConfig {
  readonly withdrawalContractName: string;
  readonly withdrawalFunctionName: string;
  readonly registryContractName: string;
  readonly tokenContractName: string;
  readonly tokenAssetName: string;
  readonly minWithdrawalSats: number;
  readonly withdrawalDeadlineMinutes: number;
  readonly withdrawalSlippageOptionsBps: readonly number[];
  readonly withdrawalDefaultSlippageBps: number;
  readonly soloSweepVsize: number;
  readonly feeCapMargin: number;
  readonly minFeeCapSats: number;
  readonly maxFeeCapSats: number;
  readonly maxFeeRateSatsPerVbyte: number;
  readonly rejectionBlocks: number;
}

export const MAINNET_WITHDRAWAL_CONFIG: WithdrawalConfig = Object.freeze({
  withdrawalContractName: 'sbtc-withdrawal',
  withdrawalFunctionName: 'initiate-withdrawal-request',
  registryContractName: 'sbtc-registry',
  tokenContractName: 'sbtc-token',
  tokenAssetName: 'sbtc-token',
  minWithdrawalSats: 10_000,
  withdrawalDeadlineMinutes: 2_880,
  withdrawalSlippageOptionsBps: Object.freeze([100, 300]),
  withdrawalDefaultSlippageBps: 100,
  soloSweepVsize: 380,
  feeCapMargin: 2,
  minFeeCapSats: 3_000,
  maxFeeCapSats: 100_000,
  maxFeeRateSatsPerVbyte: 500,
  rejectionBlocks: 27,
});

export type WithdrawalFlowConfig = NetworkConfig & WithdrawalConfig;

export const MAINNET_WITHDRAWAL_FLOW_CONFIG: WithdrawalFlowConfig = Object.freeze({
  ...MAINNET_CONFIG,
  ...MAINNET_WITHDRAWAL_CONFIG,
});
