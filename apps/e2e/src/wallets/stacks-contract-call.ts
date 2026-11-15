import { field, stringField } from '../world/http.js';
import type { World } from '../world/world.js';
import { WalletError } from './behaviour.js';

export interface CapturedContractCall {
  contract: string;
  functionName: string;
  functionArgs: string[];
  postConditions: string[];
  postConditionMode: string;
  network: string | undefined;
  address: string | undefined;
  txid: string;
}

function strings(value: unknown, what: string): string[] {
  if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) {
    throw new WalletError(-32602, `${what} must be a list of hex strings`);
  }
  return value.map(String);
}

export function approveContractCall(
  world: World,
  sender: string,
  params: unknown,
  captured: CapturedContractCall[]
): { txid: string } {
  const contract = stringField(params, 'contract');
  const functionName = stringField(params, 'functionName');
  if (!contract || !functionName) throw new WalletError(-32602, 'Missing contract or function');
  const network = stringField(params, 'network');
  if (network !== undefined && network !== 'mainnet') {
    throw new WalletError(-32602, `This test wallet is on mainnet, not ${network}`);
  }
  const functionArgs = strings(field(params, 'functionArgs') ?? [], 'functionArgs');
  const postConditions = strings(field(params, 'postConditions') ?? [], 'postConditions');
  const postConditionMode = stringField(params, 'postConditionMode') ?? 'deny';
  const tx = world.withdrawals.stacks.submit({
    sender,
    contract,
    functionName,
    functionArgs,
    postConditions,
    postConditionMode,
  });
  captured.push({
    contract,
    functionName,
    functionArgs,
    postConditions,
    postConditionMode,
    network,
    address: stringField(params, 'address'),
    txid: tx.txid,
  });
  return { txid: `0x${tx.txid}` };
}
