import type { RefObject } from 'react';

import { css, cx } from 'satway-styles/css';
import { actions, button, details, notice } from 'satway-styles/recipes';

import {
  type OneClickToken,
  type WithdrawalPreview,
  MAINNET_WITHDRAWAL_FLOW_CONFIG as config,
} from '@satway/core';

import { type LiveQuote, describeQuoteChange, formatTokenAmount, sats } from './flow.js';

const afterActions = cx(notice(), css({ marginTop: 'space.08' }));

const confirmBox = css({
  borderLeftWidth: 'accent',
  borderLeftStyle: 'solid',
  borderLeftColor: 'route.bitcoin',
  borderRadius: 'sm',
  backgroundColor: 'stage',
  paddingBlock: { base: 'space.08', md: 'space.10' },
  paddingInline: { base: 'space.08', md: 'space.10' },
  marginBlock: 'space.10',
});

const confirmTitle = css({
  textStyle: 'emphasis',
  marginTop: 'space.00',
  marginBottom: 'space.04',
});

export function PreviewDetails(props: {
  preview: WithdrawalPreview;
  token: OneClickToken;
  balance: number | null;
}) {
  const { preview, token, balance } = props;
  return (
    <dl className={details()}>
      <dt>You receive about</dt>
      <dd>
        {formatTokenAmount(preview.amountOut, token)} {token.symbol} on {token.blockchain}
      </dd>
      <dt>At least</dt>
      <dd>
        {formatTokenAmount(preview.minAmountOut, token)} {token.symbol}, or the BTC is refunded
      </dd>
      <dt>You withdraw</dt>
      <dd>{sats(preview.amountSats)} of sBTC</dd>
      <dt>Signer fee cap</dt>
      <dd>
        Up to {sats(preview.maxFeeSats)} for the Bitcoin payout, at {preview.feeRateSatsPerVbyte}{' '}
        sat/vB; the unused part comes back as sBTC
      </dd>
      <dt>Swap provider fees</dt>
      <dd>
        {preview.providerFees.reduce((sum, f) => sum + f.fee, 0) / 100}%
        {preview.refundFeeSats !== null
          ? `, and ${sats(preview.refundFeeSats)} if the BTC has to be refunded`
          : ''}
      </dd>
      <dt>Our fee</dt>
      <dd>{config.appFeeBps / 100}%</dd>
      <dt>Typical time</dt>
      <dd>A few hours; the sBTC signers wait for Bitcoin confirmations before paying out</dd>
      {balance !== null && preview.lockedSats > balance && (
        <dd className={notice({ tone: 'warn' })}>
          Your balance of {sats(balance)} does not cover the {sats(preview.lockedSats)} this locks
          (the amount plus the fee cap).
        </dd>
      )}
    </dl>
  );
}

export function ConfirmLiveQuote(props: {
  live: LiveQuote;
  preview: WithdrawalPreview;
  token: OneClickToken;
  walletOpen: boolean;
  headingRef: RefObject<HTMLHeadingElement>;
  onSign(): void;
  onCancel(): void;
}) {
  const { live, preview, token, walletOpen } = props;
  return (
    <div className={confirmBox}>
      <h3 ref={props.headingRef} tabIndex={-1} className={confirmTitle}>
        Check the live quote before you sign
      </h3>
      {live.change?.worse &&
        describeQuoteChange(live.change, preview, live.receipt, token).map(line => (
          <p key={line} className={notice({ tone: 'warn' })} role="alert">
            {line}
          </p>
        ))}
      <dl className={details()}>
        <dt>You sign away</dt>
        <dd>
          {sats(live.receipt.lockedSats)} of sBTC: {sats(live.receipt.amountSats)} plus a fee cap of{' '}
          {sats(live.receipt.maxFeeSats)}
        </dd>
        <dt>You receive about</dt>
        <dd>
          {formatTokenAmount(live.receipt.amountOut, token)} {token.symbol} on {token.blockchain}
        </dd>
        <dt>At least</dt>
        <dd>
          {formatTokenAmount(live.receipt.minAmountOut, token)} {token.symbol}
        </dd>
        <dt>Delivered to</dt>
        <dd>
          <code>{live.receipt.destinationRecipient}</code>
        </dd>
        <dt>BTC is paid to the swap at</dt>
        <dd>
          <code>{live.receipt.depositAddress}</code>
        </dd>
        <dt>Refunds go to</dt>
        <dd>
          <code>{live.receipt.refundTo}</code>
        </dd>
        <dt>Quote valid until</dt>
        <dd>{new Date(live.receipt.quoteDeadline).toLocaleString()}</dd>
      </dl>
      <div className={actions()}>
        <button
          className={button({ variant: 'primary' })}
          aria-disabled={walletOpen}
          onClick={props.onSign}
        >
          {walletOpen ? 'Confirm in your wallet…' : 'Sign the withdrawal in your wallet'}
        </button>
        <button className={button()} disabled={walletOpen} onClick={props.onCancel}>
          Cancel
        </button>
      </div>
      <p className={afterActions}>
        Your wallet shows a post-condition that lets exactly {sats(live.receipt.lockedSats)} of sBTC
        leave your account and nothing else. Signing downloads a receipt file; keep it.
      </p>
    </div>
  );
}
