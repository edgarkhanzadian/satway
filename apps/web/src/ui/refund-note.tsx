import { notice } from 'satway-styles/recipes';

import type { SwapRefund } from '@satway/core';

export function RefundNote(props: {
  refund: SwapRefund | null;
  refundTo: string;
  symbol: string;
  chain: string;
}) {
  const { refund, refundTo, symbol, chain } = props;
  const amount = refund?.refundedAmountFormatted ?? null;
  return (
    <p className={notice()}>
      {amount === null ? 'The refund goes' : `${amount} ${symbol} was refunded`} to{' '}
      <code>{refundTo}</code> on {chain}
      {amount === null ? '; the swap provider did not report the amount.' : '.'}
      {refund?.refundReason ? ` Reason given by the swap provider: ${refund.refundReason}.` : ''}
    </p>
  );
}
