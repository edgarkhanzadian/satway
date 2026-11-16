import {
  type OneClickToken,
  type WithdrawalContractCall,
  MAINNET_WITHDRAWAL_FLOW_CONFIG as config,
} from '@satway/core';

import {
  type ActiveWithdrawal,
  StacksWalletDeclinedError,
  type WithdrawalReceiptFile,
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

export interface SignStorage {
  remember(receipt: WithdrawalReceiptFile): boolean;
  setActive(receipt: WithdrawalReceiptFile | null): void;
  forgetDraft(receipt: WithdrawalReceiptFile): void;
  download(receipt: WithdrawalReceiptFile): void;
}

export const BROWSER_SIGN_STORAGE: SignStorage = {
  remember: receipt => rememberWithdrawal(config, receipt),
  setActive: setActiveWithdrawal,
  forgetDraft: receipt => forgetWithdrawalDraft(config, receipt),
  download: downloadWithdrawalReceipt,
};

export async function signWithdrawal(
  deps: SignDeps,
  quote: LiveQuote,
  token: Pick<OneClickToken, 'assetId' | 'blockchain' | 'symbol' | 'decimals'>,
  storage: SignStorage = BROWSER_SIGN_STORAGE
): Promise<SignOutcome> {
  const draft = withdrawalReceiptOf(quote.receipt, {
    assetId: token.assetId,
    chain: token.blockchain,
    symbol: token.symbol,
    decimals: token.decimals,
  });
  const draftSaved = storage.remember(draft);
  if (draftSaved) storage.setActive(draft);
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
    const remembered = storage.remember(receipt);
    storage.setActive(receipt);
    storage.download(receipt);
    show({ receipt, receiptUnsaved: !remembered, walletPrompt: false });
    return 'sent';
  } catch (err) {
    if (err instanceof StacksWalletDeclinedError) {
      storage.forgetDraft(draft);
      storage.setActive(null);
      show(null);
      return 'declined';
    }
    show({ receipt: draft, receiptUnsaved: !draftSaved, walletPrompt: false });
    return 'unanswered';
  }
}
