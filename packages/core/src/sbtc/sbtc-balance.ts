import {
  type FetchLike,
  type NetworkConfig,
  type WithdrawalConfig,
  defaultFetch,
  requestJson,
  z,
} from '../shared/index.js';
import { assertMainnetSender, sbtcAssetIdentifier } from './withdrawal-request.js';

export type SbtcBalanceConfig = Pick<NetworkConfig, 'stxApiUrl' | 'sbtcContract'> &
  Pick<WithdrawalConfig, 'tokenContractName' | 'tokenAssetName'>;

const balanceSchema = z.looseObject({ balance: z.string().regex(/^(?:0|[1-9][0-9]*)$/) });

export async function fetchSbtcBalance(
  config: SbtcBalanceConfig,
  address: string,
  fetchFn: FetchLike = defaultFetch
): Promise<number> {
  assertMainnetSender(address);
  const asset = sbtcAssetIdentifier(config);
  const { balance } = await requestJson(
    fetchFn,
    `${config.stxApiUrl}/extended/v2/addresses/${address}/balances/ft/${asset}`,
    balanceSchema
  );
  const sats = Number(balance);
  if (!Number.isSafeInteger(sats)) throw new Error('The sBTC balance is too large to handle');
  return sats;
}

export interface BalanceShortfall {
  balanceSats: number;
  neededSats: number;
  missingSats: number;
}

export function balanceShortfall(balanceSats: number, neededSats: number): BalanceShortfall | null {
  if (balanceSats >= neededSats) return null;
  return { balanceSats, neededSats, missingSats: neededSats - balanceSats };
}

function sats(n: number): string {
  return `${n.toLocaleString('en-US')} sats`;
}

export function describeBalanceShortfall(shortfall: BalanceShortfall): string {
  return `Your sBTC balance is ${sats(shortfall.balanceSats)}, but this withdrawal locks ${sats(shortfall.neededSats)}: the amount plus the signers’ fee cap. Withdraw ${sats(shortfall.missingSats)} less.`;
}
