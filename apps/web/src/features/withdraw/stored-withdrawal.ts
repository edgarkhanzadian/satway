import { MAINNET_WITHDRAWAL_FLOW_CONFIG as config } from '@satway/core';

import { type WithdrawalReceiptFile, loadWithdrawals, withdrawalId } from '../../shared/index.js';

export function storedWithdrawal(receipt: WithdrawalReceiptFile): WithdrawalReceiptFile | null {
  const id = withdrawalId(receipt);
  return loadWithdrawals(config).find(r => withdrawalId(r) === id) ?? null;
}
