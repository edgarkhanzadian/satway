import { checkDestinationAddress, destinationSupported } from '@satway/chains';
import {
  type FetchLike,
  type OneClickToken,
  type QuoteChange,
  type WithdrawalAmountCheck,
  type WithdrawalFlowConfig,
  type WithdrawalPreview,
  type WithdrawalReceipt,
  balanceShortfall,
  compareWithdrawalQuotes,
  describeBalanceShortfall,
  describeWithdrawalAmountProblem,
  fetchSbtcBalance,
  formatBaseUnits,
  prepareWithdrawal,
  previewWithdrawal,
} from '@satway/core';

import type { Backend, WithdrawalBackend } from '../../shared/index.js';

const POPULAR = ['USDC', 'USDT', 'ETH', 'SOL', 'BNB'];

export function sats(n: number): string {
  return `${n.toLocaleString('en-US')} sats`;
}

export function withdrawalDestinations(
  tokens: readonly OneClickToken[],
  btcAssetId: string
): OneClickToken[] {
  function rank(t: OneClickToken): number {
    return POPULAR.indexOf(t.symbol) + 1 || POPULAR.length + 1;
  }
  return tokens
    .filter(
      t =>
        t.assetId !== btcAssetId &&
        t.blockchain !== 'btc' &&
        t.price > 0 &&
        !/deprecated/i.test(t.symbol) &&
        destinationSupported(t.blockchain)
    )
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        a.symbol.localeCompare(b.symbol) ||
        a.blockchain.localeCompare(b.blockchain)
    );
}

export function parseSats(text: string): number {
  const trimmed = text.trim().replaceAll(',', '');
  if (!/^\d+$/.test(trimmed)) throw new Error('Enter a whole number of sats, like 50000');
  const sats = Number(trimmed);
  if (!Number.isSafeInteger(sats) || sats <= 0) {
    throw new Error('Enter a whole number of sats, like 50000');
  }
  return sats;
}

export function satsOrNull(text: string): number | null {
  try {
    return parseSats(text);
  } catch {
    return null;
  }
}

export function formatTokenAmount(
  baseUnits: string,
  token: Pick<OneClickToken, 'decimals'>
): string {
  if (!/^\d+$/.test(baseUnits)) return baseUnits;
  return formatBaseUnits(BigInt(baseUnits), token.decimals);
}

export interface WithdrawalForm {
  token: OneClickToken;
  amount: string;
  recipient: string;
  refundTo: string;
  slippageBps: number;
}

export interface FlowDeps {
  config: WithdrawalFlowConfig;
  backend: Pick<Backend, 'status'>;
  quotes: WithdrawalBackend;
  fetchFn?: FetchLike;
}

function amountProblem(check: WithdrawalAmountCheck): Error {
  return new Error(check.problems.map(p => describeWithdrawalAmountProblem(p, check)).join(' '));
}

function checkedRecipient(form: WithdrawalForm): string {
  const check = checkDestinationAddress(form.token.blockchain, form.recipient.trim());
  if (!check.ok) throw new Error(check.message);
  return check.address;
}

export async function previewFor(deps: FlowDeps, form: WithdrawalForm): Promise<WithdrawalPreview> {
  const recipient = checkedRecipient(form);
  const result = await previewWithdrawal(
    deps.config,
    {
      amountSats: parseSats(form.amount),
      destinationAsset: form.token.assetId,
      recipient,
      refundTo: form.refundTo.trim(),
      slippageBps: form.slippageBps,
    },
    { fetchFn: deps.fetchFn, requestQuote: request => deps.quotes.quote(request) }
  );
  if (!result.ok) throw amountProblem(result.amountCheck);
  return result.preview;
}

export interface LiveQuote {
  receipt: WithdrawalReceipt;
  balanceSats: number;
  change: QuoteChange | null;
}

export async function liveQuoteFor(
  deps: FlowDeps,
  form: WithdrawalForm,
  sender: string,
  preview: WithdrawalPreview | null
): Promise<LiveQuote> {
  const recipient = checkedRecipient(form);
  const amountSats = parseSats(form.amount);
  const balanceSats = await fetchSbtcBalance(deps.config, sender, deps.fetchFn);
  const early = balanceShortfall(balanceSats, amountSats + (preview?.maxFeeSats ?? 0));
  if (early) throw new Error(describeBalanceShortfall(early));
  const prepared = await prepareWithdrawal(
    deps.config,
    {
      sender,
      amountSats,
      destinationAsset: form.token.assetId,
      recipient,
      refundTo: form.refundTo.trim(),
      slippageBps: form.slippageBps,
    },
    {
      fetchFn: deps.fetchFn,
      requestQuote: request => deps.quotes.quote(request),
      fetchSwapStatus: address => deps.backend.status(address),
    }
  );
  if (!prepared.ok) throw amountProblem(prepared.amountCheck);
  const shortfall = balanceShortfall(balanceSats, prepared.receipt.lockedSats);
  if (shortfall) throw new Error(describeBalanceShortfall(shortfall));
  return {
    receipt: prepared.receipt,
    balanceSats,
    change: preview ? compareWithdrawalQuotes(preview, prepared.receipt) : null,
  };
}

export function describeQuoteChange(
  change: QuoteChange,
  preview: Pick<WithdrawalPreview, 'amountOut' | 'minAmountOut' | 'maxFeeSats'>,
  live: Pick<WithdrawalReceipt, 'amountOut' | 'minAmountOut' | 'maxFeeSats'>,
  token: Pick<OneClickToken, 'decimals' | 'symbol'>
): string[] {
  const lines: string[] = [];
  function amount(units: string): string {
    return `${formatTokenAmount(units, token)} ${token.symbol}`;
  }
  if (change.amountOutDropped) {
    lines.push(
      `You now receive about ${amount(live.amountOut)}, down from ${amount(preview.amountOut)}.`
    );
  }
  if (change.minAmountOutDropped) {
    lines.push(
      `The guaranteed minimum is now ${amount(live.minAmountOut)}, down from ${amount(preview.minAmountOut)}.`
    );
  }
  if (change.feeCapRose) {
    lines.push(
      `Bitcoin fees went up: the signers’ fee cap is now ${live.maxFeeSats.toLocaleString('en-US')} sats, up from ${preview.maxFeeSats.toLocaleString('en-US')}.`
    );
  }
  return lines;
}
