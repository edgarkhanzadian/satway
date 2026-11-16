import { type BitcoinChain, type ChainTx, type Wallet, scriptOfAddress } from './bitcoin.js';
import { type Reply, field, json, notFound, parseJson, stringField } from './http.js';
import { bitcoinKey, p2wpkhOf } from './keys.js';
import {
  BTC_ASSET_ID,
  BTC_PRICE_USD,
  type OneClick,
  PROVIDER_FEE_BPS,
  PROVIDER_FEE_RECIPIENT,
  type QuoteRecord,
  type Swap,
  TOKENS,
} from './oneclick.js';
import type { Rng } from './random.js';
import { type ConfirmOutcome, StacksChain, type WithdrawalRequestRecord } from './stacks.js';

export const WITHDRAWAL_REFUND_FEE = '1900';
export const WITHDRAWAL_WITHDRAW_FEE = '2400';
export const SIGNER_FEE_SATS = 1_455;

export interface WithdrawalSwap {
  swap: Swap;
  destinationAsset: string;
  amountOut: bigint;
  minAmountOut: bigint;
}

type Service = 'hiro' | 'alex' | 'mempool' | 'emily' | 'oneclick';

function formatUnits(amount: bigint, decimals: number): string {
  const digits = amount.toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, '');
  return `${whole}.${fraction === '' ? '0' : fraction}`;
}

function truncatedToSeconds(iso: string): string {
  return new Date(Math.floor(Date.parse(iso) / 1000) * 1000).toISOString();
}

function emilyStatusOf(status: boolean | null): string {
  if (status === null) return 'pending';
  return status ? 'confirmed' : 'failed';
}

const BITCOIN_ADDRESS = /^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/;

export class WithdrawalWorld {
  readonly stacks: StacksChain;
  readonly swaps = new Map<string, WithdrawalSwap>();
  feeEstimate = 2.5;
  liveQuoteFactor = 1;
  private readonly rng: Rng;
  private readonly now: () => Date;
  private readonly bitcoin: BitcoinChain;
  private readonly treasury: Wallet;
  private readonly oneClick: OneClick;

  constructor(input: {
    rng: Rng;
    now(): Date;
    bitcoin: BitcoinChain;
    treasury: Wallet;
    oneClick: OneClick;
  }) {
    this.rng = input.rng;
    this.now = input.now;
    this.bitcoin = input.bitcoin;
    this.treasury = input.treasury;
    this.oneClick = input.oneClick;
    this.stacks = new StacksChain(input.rng, () => this.bitcoin.tip.height);
  }

  route(service: Service, method: string, url: URL, body: string): Reply | null {
    const path = url.pathname;
    if (service === 'hiro') return this.stacks.serve(method, path, body, url.searchParams);
    if (service === 'mempool' && method === 'GET' && path === '/api/fee-estimates') {
      return json({ '1': this.feeEstimate, '3': this.feeEstimate, '6': 1.2, '144': 1 });
    }
    if (service === 'emily' && method === 'GET' && path.startsWith('/withdrawal/')) {
      return this.emilyWithdrawal(path.slice('/withdrawal/'.length));
    }
    if (service === 'oneclick' && method === 'POST' && path === '/v0/quote') {
      const parsed = parseJson(body);
      if (field(parsed, 'originAsset') === BTC_ASSET_ID) return this.quote(parsed);
    }
    return null;
  }

  private emilyWithdrawal(id: string): Reply {
    if (!/^\d+$/.test(id)) return json({ message: 'invalid request id' }, 400);
    const r = this.stacks.requests.get(Number(id));
    if (!r) return notFound('Withdrawal not found');
    return json({
      requestId: r.requestId,
      stacksBlockHash: `0x${'0'.repeat(64)}`,
      stacksBlockHeight: 9_500_000,
      recipient: `0x${r.recipient.hashbytes}`,
      sender: r.sender,
      amount: r.amountSats,
      lastUpdateHeight: this.bitcoin.tip.height,
      lastUpdateBlockHash: this.bitcoin.tip.hash,
      status: emilyStatusOf(r.status),
      statusMessage: r.status === null ? 'Waiting' : 'Done',
      parameters: { maxFee: r.maxFeeSats },
      txid: r.txid,
      fulfillment: r.accept
        ? {
            BitcoinTxid: r.accept.bitcoinTxid,
            BitcoinTxIndex: r.accept.outputIndex,
            StacksTxid: r.accept.acceptTxid,
            BitcoinBlockHash: this.bitcoin.tip.hash,
            BitcoinBlockHeight: this.bitcoin.tip.height,
            BtcFee: r.accept.feeSats,
          }
        : null,
    });
  }

  private quote(request: unknown): Reply {
    const destinationAsset = stringField(request, 'destinationAsset');
    const amountText = stringField(request, 'amount');
    const recipient = stringField(request, 'recipient');
    const refundTo = stringField(request, 'refundTo');
    const deadline = stringField(request, 'deadline');
    const slippage = field(request, 'slippageTolerance');
    const dry = field(request, 'dry');
    const token = destinationAsset ? this.oneClick.token(destinationAsset) : null;
    if (!token || token.assetId === BTC_ASSET_ID)
      return json({ message: 'tokenOut is not valid' }, 400);
    if (!amountText || !/^[1-9][0-9]*$/.test(amountText))
      return json({ message: 'amount is not valid' }, 400);
    if (!recipient || !refundTo || !deadline || typeof dry !== 'boolean')
      return json({ message: 'request is missing fields' }, 400);
    if (!BITCOIN_ADDRESS.test(refundTo)) return json({ message: 'refundTo is not valid' }, 400);
    if (typeof slippage !== 'number')
      return json({ message: 'slippageTolerance is not valid' }, 400);

    const amountIn = BigInt(amountText);
    const usd = (Number(amountIn) / 1e8) * BTC_PRICE_USD * (dry ? 1 : this.liveQuoteFactor);
    const gross = (usd / token.price) * 10 ** token.decimals;
    const amountOut = BigInt(Math.floor((gross * (10_000 - PROVIDER_FEE_BPS)) / 10_000));
    if (amountOut <= 0n) return json({ message: 'Amount is too low for bridge' }, 400);
    const minAmountOut = (amountOut * BigInt(10_000 - slippage)) / 10_000n;
    const appFees = field(request, 'appFees');
    const ownFees: unknown[] = Array.isArray(appFees) ? appFees : [];
    const echoed: Record<string, unknown> = {
      ...(typeof request === 'object' && request !== null ? request : {}),
      depositMode: 'SIMPLE',
      deadline: truncatedToSeconds(deadline),
      confidentiality: 'public',
      quoteWaitingTimeMs: 0,
      insured: false,
      appFees: [
        ...ownFees,
        dry
          ? { recipient: PROVIDER_FEE_RECIPIENT, fee: PROVIDER_FEE_BPS }
          : { recipient: PROVIDER_FEE_RECIPIENT, fee: PROVIDER_FEE_BPS, limitOrderId: null },
      ],
    };
    const depositAddress = dry ? undefined : p2wpkhOf(bitcoinKey(this.rng)).address;
    const later = new Date(Date.parse(deadline) + 72 * 3_600_000).toISOString();
    const quote: Record<string, unknown> = {
      ...(depositAddress ? { depositAddress } : {}),
      amountIn: amountIn.toString(),
      amountInFormatted: formatUnits(amountIn, 8),
      amountInUsd: ((Number(amountIn) / 1e8) * BTC_PRICE_USD).toFixed(12),
      minAmountIn: amountIn.toString(),
      amountOut: amountOut.toString(),
      amountOutFormatted: formatUnits(amountOut, token.decimals),
      amountOutUsd: usd.toFixed(12),
      minAmountOut: minAmountOut.toString(),
      timeEstimate: 809,
      refundFee: WITHDRAWAL_REFUND_FEE,
      withdrawFee: WITHDRAWAL_WITHDRAW_FEE,
      ...(dry
        ? {}
        : { deadline: truncatedToSeconds(later), timeWhenInactive: truncatedToSeconds(later) }),
    };
    const response: Record<string, unknown> = {
      quote,
      quoteRequest: echoed,
      signature: `ed25519:${this.rng.base58(64)}`,
      timestamp: this.now().toISOString(),
      correlationId: this.rng.uuid(),
    };
    this.oneClick.tamper?.(response, { dry });
    const record: QuoteRecord = {
      request: { ...(typeof request === 'object' && request !== null ? request : {}) },
      response,
      authorization: null,
      dry,
    };
    this.oneClick.quotes.push(record);
    if (depositAddress) {
      const swap: Swap = {
        depositAddress,
        token: TOKENS.btc,
        amountIn,
        amountOut: Number(amountOut),
        minAmountOut: Number(minAmountOut),
        recipient,
        refundTo,
        quote: record,
        status: 'PENDING_DEPOSIT',
        received: 0n,
        originTxHashes: [],
        destinationTxHashes: [],
        withheldHashes: [],
        reportedAmountOut: null,
        refundedAmount: null,
        refundReason: null,
        updatedAt: this.now().toISOString(),
      };
      this.oneClick.swaps.set(depositAddress, swap);
      this.swaps.set(depositAddress, {
        swap,
        destinationAsset: token.assetId,
        amountOut,
        minAmountOut,
      });
    }
    return json(response);
  }

  latestSwap(): WithdrawalSwap {
    const last = [...this.swaps.values()].at(-1);
    if (!last) throw new Error('1Click has no withdrawal swap yet');
    return last;
  }

  fundSbtc(address: string, sats: number): void {
    this.stacks.fund(address, sats);
  }

  confirmRequest(outcome: ConfirmOutcome = 'success'): WithdrawalRequestRecord | null {
    return this.stacks.confirm(this.stacks.latestCall().txid, outcome);
  }

  latestRequest(): WithdrawalRequestRecord {
    const last = [...this.stacks.requests.values()].at(-1);
    if (!last) throw new Error('The sBTC registry has no withdrawal request yet');
    return last;
  }

  signersAccept(
    options: { requestId?: number; payoutSats?: number; feeSats?: number } = {}
  ): ChainTx {
    const r =
      options.requestId === undefined
        ? this.latestRequest()
        : this.stacks.request(options.requestId);
    const swapAddress = this.swapAddressOf(r);
    const payout = this.treasury.pay([
      { script: scriptOfAddress(swapAddress), value: options.payoutSats ?? r.amountSats },
    ]);
    this.stacks.accept(r.requestId, {
      bitcoinTxid: payout.txid,
      outputIndex: 0,
      feeSats: options.feeSats ?? SIGNER_FEE_SATS,
      burnHash: this.bitcoin.tip.hash.padStart(64, '0').slice(-64),
      burnHeight: this.bitcoin.tip.height,
    });
    return payout;
  }

  signersReject(requestId?: number): void {
    this.stacks.reject(requestId ?? this.latestRequest().requestId);
  }

  private swapAddressOf(r: WithdrawalRequestRecord): string {
    const match = [...this.swaps.keys()].find(address => {
      try {
        const script = scriptOfAddress(address);
        return script.endsWith(r.recipient.hashbytes);
      } catch {
        return false;
      }
    });
    if (!match) throw new Error(`No withdrawal swap matches request ${r.requestId}`);
    return match;
  }

  swapReceives(payout: ChainTx, depositAddress?: string): Swap {
    const ws = depositAddress === undefined ? this.latestSwap() : this.swaps.get(depositAddress);
    if (!ws) throw new Error('No such withdrawal swap');
    const value = payout.outputs.find(o => o.address === ws.swap.depositAddress)?.value ?? 0;
    const swap = this.oneClick.arrive({
      depositAddress: ws.swap.depositAddress,
      assetId: BTC_ASSET_ID,
      amount: BigInt(value),
      txHash: payout.txid,
    });
    if (!swap) throw new Error('The payout did not reach the swap');
    return swap;
  }

  swapDelivers(depositAddress?: string): string {
    const ws = depositAddress === undefined ? this.latestSwap() : this.swaps.get(depositAddress);
    if (!ws) throw new Error('No such withdrawal swap');
    const hash = `0x${this.rng.hex(32)}`;
    this.oneClick.succeed(ws.swap, hash, Number(ws.amountOut));
    return hash;
  }

  swapRefunds(reason = 'Price moved beyond the slippage tolerance', depositAddress?: string): Swap {
    const ws = depositAddress === undefined ? this.latestSwap() : this.swaps.get(depositAddress);
    if (!ws) throw new Error('No such withdrawal swap');
    this.oneClick.refund(ws.swap, reason);
    return ws.swap;
  }
}
