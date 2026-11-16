import {
  type OneClickToken,
  type WithdrawalContractCall,
  MAINNET_WITHDRAWAL_FLOW_CONFIG as config,
} from '@satway/core';

import {
  type ActiveWithdrawal,
  StacksWalletDeclinedError,
  downloadWithdrawalReceipt,
  forgetWithdrawalDraft,
  rememberWithdrawal,
  setActiveWithdrawal,
  withStacksTxid,
  withdrawalId,
  withdrawalReceiptOf,
} from '../../shared/index.js';
import type { LiveQuote } from './flow.js';

export const DECLINED_MESSAGE =
  'You declined the request in your wallet, so nothing was signed or sent.';

export type SignOutcome = 'sent' | 'declined' | 'unanswered';

export interface SignDeps {
  requestWithdrawal(call: WithdrawalContractCall): Promise<string>;
  onActive(update: (current: ActiveWithdrawal | null) => ActiveWithdrawal | null): void;
}

export async function signWithdrawal(
  deps: SignDeps,
  quote: LiveQuote,
  token: Pick<OneClickToken, 'assetId' | 'blockchain' | 'symbol' | 'decimals'>
): Promise<SignOutcome> {
  const draft = withdrawalReceiptOf(quote.receipt, {
    assetId: token.assetId,
    chain: token.blockchain,
    symbol: token.symbol,
    decimals: token.decimals,
  });
  const draftSaved = rememberWithdrawal(config, draft);
  if (draftSaved) setActiveWithdrawal(draft);
  const mine = withdrawalId(draft);
  function show(next: ActiveWithdrawal | null) {
    deps.onActive(current =>
      current === null || withdrawalId(current.receipt) === mine ? next : current
    );
  }
  show({ receipt: draft, receiptUnsaved: !draftSaved, walletPrompt: true });
  try {
    const txid = await deps.requestWithdrawal(quote.receipt.contractCall);
    const receipt = withStacksTxid(draft, txid);
    const remembered = rememberWithdrawal(config, receipt);
    setActiveWithdrawal(receipt);
    downloadWithdrawalReceipt(receipt);
    show({ receipt, receiptUnsaved: !remembered, walletPrompt: false });
    return 'sent';
  } catch (err) {
    if (err instanceof StacksWalletDeclinedError) {
      forgetWithdrawalDraft(config, draft);
      setActiveWithdrawal(null);
      show(null);
      return 'declined';
    }
    show({ receipt: draft, receiptUnsaved: !draftSaved, walletPrompt: false });
    return 'unanswered';
  }
}
