import { request } from '@stacks/connect';

import { type WithdrawalContractCall, normalizeStacksTxid } from '@satway/core';

import { stacksWalletError } from './wallet.js';

export interface WalletCallParams {
  contract: `${string}.${string}`;
  functionName: string;
  functionArgs: string[];
  postConditions: string[];
  postConditionMode: 'deny';
  network: 'mainnet';
  address: string;
}

export function walletCallParams(call: WithdrawalContractCall): WalletCallParams {
  if (call.postConditionMode !== 'deny' || call.postConditionsHex.length !== 1) {
    throw new Error('A withdrawal request must carry exactly one post-condition in deny mode');
  }
  return {
    contract: call.contract,
    functionName: call.functionName,
    functionArgs: [...call.functionArgs],
    postConditions: [...call.postConditionsHex],
    postConditionMode: 'deny',
    network: 'mainnet',
    address: call.sender,
  };
}

export async function requestWithdrawalWithWallet(call: WithdrawalContractCall): Promise<string> {
  let result;
  try {
    result = await request('stx_callContract', walletCallParams(call));
  } catch (err) {
    throw stacksWalletError(err);
  }
  const txid = result.txid;
  if (typeof txid !== 'string' || txid === '') {
    throw new Error('The wallet did not return a transaction id');
  }
  return normalizeStacksTxid(txid);
}
