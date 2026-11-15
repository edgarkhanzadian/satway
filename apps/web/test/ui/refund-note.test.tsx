import { renderToStaticMarkup } from 'react-dom/server';

import { describe, expect, it } from 'vitest';

import { RefundNote } from '../../src/ui/refund-note.js';

const REFUND_TO = '0x2527D02599Ba641c19FEa793cD0F167589a0f10D';

function text(refund: Parameters<typeof RefundNote>[0]['refund']): string {
  return renderToStaticMarkup(
    <RefundNote refund={refund} refundTo={REFUND_TO} symbol="USDC" chain="base" />
  ).replace(/<[^>]+>/g, '');
}

describe('RefundNote', () => {
  it('says how much went back, where, and why', () => {
    expect(
      text({
        refunded: true,
        refundedAmount: '99990000',
        refundedAmountFormatted: '99.99',
        refundReason: 'Price moved beyond the slippage',
        refundFee: '10000',
      })
    ).toBe(
      `99.99 USDC was refunded to ${REFUND_TO} on base. Reason given by the swap provider: Price moved beyond the slippage.`
    );
  });

  it('still names the refund address when the amount and reason are not reported', () => {
    expect(text(null)).toBe(
      `The refund goes to ${REFUND_TO} on base; the swap provider did not report the amount.`
    );
  });
});
