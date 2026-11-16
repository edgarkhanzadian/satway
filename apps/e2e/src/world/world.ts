import { buildDepositAddress } from '@satway/core';

import { UPSTREAM } from '../config.js';
import { AlexStacksNode } from './alex.js';
import {
  BitcoinChain,
  type ChainTx,
  type Outpoint,
  type SignerCoin,
  Wallet,
  fundSignerCoin,
  outpointKey,
  scriptOfAddress,
  sweepDeposit,
} from './bitcoin.js';
import { type Gate, RealDate, gate, realNow } from './clock.js';
import { Emily, type EmilyDeposit } from './emily.js';
import { EvmChains, type EvmTransfer } from './evm.js';
import { Hiro } from './hiro.js';
import type { Reply } from './http.js';
import { type BitcoinKey, bitcoinKey, stacksAddressOf } from './keys.js';
import { BTC_ASSET_ID, OneClick, type Swap, TOKENS } from './oneclick.js';
import { Rng } from './random.js';
import { parseDepositScript } from './sbtc-scripts.js';
import { WithdrawalWorld } from './withdrawals.js';

export type Caller = 'page' | 'worker' | 'notifier' | 'wallet' | 'test';
export type Service = 'hiro' | 'alex' | 'mempool' | 'emily' | 'oneclick';

export interface WorldRequest {
  method: string;
  url: string;
  headers: Headers;
  body: string;
}

export interface WorldLogEntry {
  seq: number;
  caller: Caller;
  service: Service | 'unknown';
  method: string;
  url: string;
  status: number | 'hang' | 'network-error';
  requestBody?: string;
  responseBody?: string;
  fault?: string;
}

export interface HeldReply {
  hold: Promise<void>;
}

export type FaultOutcome = Reply | 'hang' | 'network-error' | HeldReply;

export interface FaultRule {
  service: Service;
  method?: string;
  path?: RegExp;
  bodyIncludes?: string;
  callers?: readonly Caller[];
  outcome: FaultOutcome;
  times?: number;
  skip?: number;
  label?: string;
}

interface ActiveFault extends FaultRule {
  remaining: number;
  skipping: number;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type WorldReply = Reply | 'network-error' | 'hang';

const BROWSER_SERVICES: ReadonlySet<Service> = new Set(['hiro', 'alex', 'mempool', 'emily']);

export const START_HEIGHT = 975_800;
export const EVIDENCE_AMOUNT_SATS = 20_000_774;

function serviceOf(url: URL): Service | null {
  switch (url.origin) {
    case UPSTREAM.hiro:
      return 'hiro';
    case UPSTREAM.mempool:
      return 'mempool';
    case UPSTREAM.emily:
      return 'emily';
    case UPSTREAM.oneClick:
      return 'oneclick';
    case UPSTREAM.alex:
      return 'alex';
    default:
      return null;
  }
}

function headersOf(init: RequestInit | undefined): Headers {
  return new Headers(init?.headers);
}

function bodyOf(init: RequestInit | undefined): string {
  const body = init?.body ?? '';
  if (typeof body === 'string') return body;
  throw new Error('The world only accepts string request bodies');
}

export interface PayoutResult {
  swap: Swap;
  tx: ChainTx;
  outpoint: Outpoint;
  amountSats: number;
}

export type EvidenceVariant =
  | 'unswept'
  | 'only-one-swept'
  | 'other-signer-key'
  | 'without-signer-utxo';

export interface EvidenceItem {
  deposit: Outpoint;
  sweep: string | null;
}

export const EVIDENCE_COUNT = 2;
export const SIGNER_UTXO_SATS = 12_000_000_000;

export class World {
  readonly rng: Rng;
  readonly bitcoin: BitcoinChain;
  readonly treasury: Wallet;
  readonly signer: BitcoinKey;
  readonly emily: Emily;
  readonly hiro: Hiro;
  readonly alex: AlexStacksNode;
  readonly oneClick: OneClick;
  readonly evm: EvmChains;
  readonly withdrawals: WithdrawalWorld;
  readonly log: WorldLogEntry[] = [];
  readonly unexpected: string[] = [];
  readonly authorizations: {
    caller: Caller;
    service: Service | null;
    url: string;
    value: string;
  }[] = [];
  evidence: EvidenceItem[];
  private readonly signerCoins = new Map<string, SignerCoin>();
  private readonly evidenceRng: Rng;
  private evidenceWallet: Wallet | null = null;
  private readonly faults: ActiveFault[] = [];
  private clockOffsetMs = 0;
  private seq = 0;
  private parkedCount = 0;

  constructor(seed: string) {
    this.rng = new Rng(seed);
    this.evidenceRng = new Rng(`${seed}#signer-evidence`);
    this.bitcoin = new BitcoinChain(this.rng, START_HEIGHT, Math.floor(this.baseNow() / 1000));
    this.treasury = new Wallet(this.bitcoin, bitcoinKey(this.rng), this.rng, 5_000_000_000);
    this.signer = bitcoinKey(this.rng);
    this.emily = new Emily(this.bitcoin, () => this.signer.xOnly);
    this.hiro = new Hiro(() => this.signer.publicKey);
    this.alex = new AlexStacksNode(() => this.signer.publicKey);
    this.oneClick = new OneClick(this.rng, () => this.now());
    this.evm = new EvmChains(this.rng, (transfer, hash) => this.evmTransfer(transfer, hash));
    this.evidence = this.seedEvidenceSet('valid');
    this.withdrawals = new WithdrawalWorld({
      rng: new Rng(`${seed}#withdrawals`),
      now: () => this.now(),
      bitcoin: this.bitcoin,
      treasury: this.treasury,
      oneClick: this.oneClick,
    });
  }

  private baseNow(): number {
    return realNow();
  }

  now(): Date {
    return new RealDate(this.baseNow() + this.clockOffsetMs);
  }

  get clockOffset(): number {
    return this.clockOffsetMs;
  }

  advanceClock(ms: number): void {
    this.clockOffsetMs += ms;
  }

  get parked(): number {
    return this.parkedCount;
  }

  private evidenceFunder(): Wallet {
    this.evidenceWallet ??= new Wallet(
      this.bitcoin,
      bitcoinKey(this.evidenceRng),
      this.evidenceRng,
      1_000_000_000
    );
    return this.evidenceWallet;
  }

  private signerCoinFor(key: BitcoinKey): SignerCoin {
    const known = this.signerCoins.get(key.xOnly);
    if (known) return known;
    const funded = fundSignerCoin({
      chain: this.bitcoin,
      signerKey: key,
      rng: this.evidenceRng,
      sats: SIGNER_UTXO_SATS,
      confirmedAt: this.bitcoin.tip.height - 150,
    });
    this.signerCoins.set(key.xOnly, funded);
    return funded;
  }

  private sweepAsSigners(input: {
    outpoint: Outpoint;
    depositScript: string;
    reclaimScript: string;
    signerKey: BitcoinKey;
    withSignerUtxo: boolean;
    confirmedAt?: number;
  }): ChainTx {
    const swept = sweepDeposit({
      chain: this.bitcoin,
      outpoint: input.outpoint,
      depositScript: input.depositScript,
      reclaimScript: input.reclaimScript,
      signerKey: input.signerKey,
      signerCoin: input.withSignerUtxo ? this.signerCoinFor(input.signerKey) : null,
      feeSats: 1_502,
      ...(input.confirmedAt === undefined ? {} : { confirmedAt: input.confirmedAt }),
    });
    if (input.withSignerUtxo) this.signerCoins.set(input.signerKey.xOnly, swept.signerCoin);
    return swept.tx;
  }

  private seedEvidenceSet(variant: EvidenceVariant | 'valid'): EvidenceItem[] {
    const signerKey = variant === 'other-signer-key' ? bitcoinKey(this.rng) : this.signer;
    return Array.from({ length: EVIDENCE_COUNT }, (_, i) => {
      const swept =
        variant !== 'unswept' && !(variant === 'only-one-swept' && i === EVIDENCE_COUNT - 1);
      return this.seedEvidence({
        signerKey,
        swept,
        withSignerUtxo: variant !== 'without-signer-utxo',
        offset: i,
      });
    });
  }

  private seedEvidence(input: {
    signerKey: BitcoinKey;
    swept: boolean;
    withSignerUtxo: boolean;
    offset: number;
  }): EvidenceItem {
    const first = input.offset === 0;
    const other = bitcoinKey(first ? this.rng : this.evidenceRng);
    const deposit = buildDepositAddress({
      stacksAddress: stacksAddressOf(other),
      reclaimPublicKey: other.xOnly,
      signersPublicKey: input.signerKey.xOnly,
      maxSignerFeeSats: 80_000,
      reclaimLockBlocks: 950,
    });
    const tip = this.bitcoin.tip.height;
    const sweptAt = tip - 12 - input.offset;
    const payout = (first ? this.treasury : this.evidenceFunder()).pay(
      [{ script: deposit.scriptPubKey, value: EVIDENCE_AMOUNT_SATS }],
      { confirmedAt: tip - 30 - input.offset }
    );
    const sweep = input.swept
      ? this.sweepAsSigners({
          outpoint: { txid: payout.txid, vout: 0 },
          depositScript: deposit.depositScript,
          reclaimScript: deposit.reclaimScript,
          signerKey: input.signerKey,
          withSignerUtxo: input.withSignerUtxo,
          confirmedAt: sweptAt,
        })
      : null;
    const parsed = parseDepositScript(deposit.depositScript);
    const block = this.bitcoin.blockAt(sweptAt);
    if (!parsed || !block) throw new Error('Could not seed the signer evidence');
    const seeded: EmilyDeposit = {
      bitcoinTxid: payout.txid,
      bitcoinTxOutputIndex: 0,
      recipient: parsed.recipient,
      amount: EVIDENCE_AMOUNT_SATS,
      lastUpdateHeight: sweptAt,
      lastUpdateBlockHash: block.hash,
      status: 'confirmed',
      statusMessage: `Included in block ${block.hash}`,
      parameters: { maxFee: 80_000, lockTime: 950 },
      reclaimScript: deposit.reclaimScript,
      depositScript: deposit.depositScript,
      ...(sweep
        ? {
            fulfillment: {
              BitcoinTxid: sweep.txid,
              BitcoinTxIndex: input.withSignerUtxo ? 1 : 0,
              BtcFee: 1_502,
            },
          }
        : {}),
    };
    this.emily.seed(seeded);
    return { deposit: { txid: payout.txid, vout: 0 }, sweep: sweep?.txid ?? null };
  }

  replaceEvidence(variant: EvidenceVariant): void {
    for (const item of this.evidence) this.emily.remove(item.deposit.txid, item.deposit.vout);
    this.evidence = this.seedEvidenceSet(variant);
  }

  private evmTransfer(transfer: EvmTransfer, hash: string): void {
    const token = this.oneClick.tokens().find(t => {
      if (t.family !== 'evm' || t.chainId !== transfer.chainId) return false;
      const contract = t.contractAddress;
      return transfer.kind === 'native'
        ? contract === undefined
        : contract?.toLowerCase() === transfer.contract;
    });
    const swap = [...this.oneClick.swaps.values()].find(
      s => s.depositAddress.toLowerCase() === transfer.to.toLowerCase()
    );
    this.oneClick.arrive({
      depositAddress: swap?.depositAddress ?? transfer.to,
      assetId: token?.assetId ?? `unknown-evm-asset:${transfer.chainId}`,
      amount: transfer.amount,
      txHash: hash,
    });
  }

  addFault(rule: FaultRule): void {
    this.faults.push({
      ...rule,
      remaining: rule.times ?? Number.MAX_SAFE_INTEGER,
      skipping: rule.skip ?? 0,
    });
  }

  hold(rule: Omit<FaultRule, 'outcome' | 'times'> & { times?: number }): Gate {
    const held = gate();
    this.addFault({ ...rule, times: rule.times ?? 1, outcome: { hold: held.promise } });
    return held;
  }

  clearFaults(): void {
    this.faults.length = 0;
  }

  private takeFault(
    service: Service,
    caller: Caller,
    method: string,
    path: string,
    body: string
  ): ActiveFault | null {
    const fault = this.faults.find(
      f =>
        f.remaining > 0 &&
        f.service === service &&
        (f.method === undefined || f.method === method) &&
        (f.path === undefined || f.path.test(path)) &&
        (f.bodyIncludes === undefined || body.includes(f.bodyIncludes)) &&
        (f.callers === undefined || f.callers.includes(caller))
    );
    if (!fault) return null;
    if (fault.skipping > 0) {
      fault.skipping -= 1;
      return null;
    }
    fault.remaining -= 1;
    return fault;
  }

  private record(entry: Omit<WorldLogEntry, 'seq'>): void {
    this.seq += 1;
    this.log.push({ seq: this.seq, ...entry });
  }

  async serve(caller: Caller, request: WorldRequest): Promise<WorldReply> {
    const url = new URL(request.url);
    const service = serviceOf(url);
    const authorization = request.headers.get('authorization');
    if (authorization !== null)
      this.authorizations.push({ caller, service, url: request.url, value: authorization });
    if (!service) {
      this.unexpected.push(`${caller} ${request.method} ${request.url}`);
      this.record({
        caller,
        service: 'unknown',
        method: request.method,
        url: request.url,
        status: 'network-error',
      });
      return 'network-error';
    }
    const fault = this.takeFault(service, caller, request.method, url.pathname, request.body);
    if (fault) {
      const label = fault.label ?? 'fault';
      const outcome = fault.outcome;
      if (outcome === 'hang' || outcome === 'network-error') {
        this.record({
          caller,
          service,
          method: request.method,
          url: request.url,
          status: outcome,
          requestBody: request.body || undefined,
          fault: label,
        });
        return outcome;
      }
      if ('hold' in outcome) {
        this.parkedCount += 1;
        try {
          await outcome.hold;
        } finally {
          this.parkedCount -= 1;
        }
        return this.answer(caller, service, request, url, label);
      }
      this.record({
        caller,
        service,
        method: request.method,
        url: request.url,
        status: outcome.status,
        fault: label,
        requestBody: request.body || undefined,
        responseBody: outcome.body,
      });
      return this.withCors(service, outcome);
    }
    return this.answer(caller, service, request, url, undefined);
  }

  private answer(
    caller: Caller,
    service: Service,
    request: WorldRequest,
    url: URL,
    fault: string | undefined
  ): Reply {
    const reply = this.route(service, request, url);
    this.record({
      caller,
      service,
      method: request.method,
      url: request.url,
      status: reply.status,
      requestBody: request.body || undefined,
      responseBody: reply.body.length > 4_000 ? `${reply.body.slice(0, 4_000)}…` : reply.body,
      ...(fault === undefined ? {} : { fault }),
    });
    if (reply.status === 404 && service !== 'emily' && service !== 'oneclick') {
      this.unexpected.push(`${caller} ${request.method} ${request.url} -> 404 (no world route)`);
    }
    return this.withCors(service, reply);
  }

  private withCors(service: Service, reply: Reply): Reply {
    if (!BROWSER_SERVICES.has(service)) return reply;
    return { ...reply, headers: { ...reply.headers, 'access-control-allow-origin': '*' } };
  }

  private route(service: Service, request: WorldRequest, url: URL): Reply {
    if (request.method === 'OPTIONS') {
      return {
        status: 204,
        headers: {
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'content-type, accept',
        },
        body: '',
      };
    }
    const withdrawal = this.withdrawals.route(service, request.method, url, request.body);
    if (withdrawal) return withdrawal;
    switch (service) {
      case 'hiro':
        return this.hiro.serve(request.method, url.pathname, request.body);
      case 'alex':
        return this.alex.serve(request.method, url.pathname, url.searchParams);
      case 'mempool':
        return this.bitcoin.serve(request.method, url.pathname, request.body);
      case 'emily':
        return this.emily.serve(request.method, url.pathname, url.searchParams, request.body);
      case 'oneclick':
        return this.oneClick.serve(
          request.method,
          url.pathname,
          url.searchParams,
          request.body,
          request.headers
        );
      default:
        throw new Error(`Unknown service ${String(service satisfies never)}`);
    }
  }

  fetchFor(caller: Caller): FetchLike {
    return async (input, init) => {
      const reply = await this.serve(caller, {
        method: init?.method ?? 'GET',
        url: input,
        headers: headersOf(init),
        body: bodyOf(init),
      });
      if (reply === 'hang') {
        if (caller === 'worker') this.parkedCount += 1;
        return new Promise<never>(() => undefined);
      }
      if (reply === 'network-error') throw new TypeError('fetch failed');
      return new Response(reply.status === 204 ? null : reply.body, {
        status: reply.status,
        headers: reply.headers,
      });
    };
  }

  requestsTo(
    service: Service,
    filter: { caller?: Caller; method?: string; path?: string | RegExp } = {}
  ): WorldLogEntry[] {
    return this.log.filter(e => {
      if (e.service !== service) return false;
      if (filter.caller && e.caller !== filter.caller) return false;
      if (filter.method && e.method !== filter.method) return false;
      const path = new URL(e.url).pathname;
      if (typeof filter.path === 'string' && path !== filter.path) return false;
      if (filter.path instanceof RegExp && !filter.path.test(path)) return false;
      return true;
    });
  }

  swap(depositAddress?: string): Swap {
    return depositAddress === undefined
      ? this.oneClick.latestSwap()
      : this.oneClick.swap(depositAddress);
  }

  liveSwapFor(recipient: string, options: { deadlineMinutes?: number } = {}): Swap {
    const deadline = new RealDate(
      this.now().getTime() + (options.deadlineMinutes ?? 120) * 60_000
    ).toISOString();
    const reply = this.oneClick.serve(
      'POST',
      '/v0/quote',
      new URLSearchParams(),
      JSON.stringify({
        dry: false,
        swapType: 'EXACT_INPUT',
        slippageTolerance: 100,
        originAsset: TOKENS.usdcBase.assetId,
        depositType: 'ORIGIN_CHAIN',
        destinationAsset: BTC_ASSET_ID,
        amount: '100000000',
        refundTo: '0x2222222222222222222222222222222222222222',
        refundType: 'ORIGIN_CHAIN',
        recipient,
        recipientType: 'DESTINATION_CHAIN',
        deadline,
      }),
      new Headers()
    );
    if (reply.status !== 200) throw new Error(`1Click refused the quote: ${reply.body}`);
    return this.oneClick.latestSwap();
  }

  reportDeposit(options: { depositAddress?: string; amount?: bigint } = {}): Swap {
    const swap = this.swap(options.depositAddress);
    const updated = this.oneClick.arrive({
      depositAddress: swap.depositAddress,
      assetId: swap.token.assetId,
      amount: options.amount ?? swap.amountIn,
      txHash: `0x${this.rng.hex(32)}`,
    });
    if (!updated) throw new Error('The deposit did not match the swap');
    return updated;
  }

  completeSwap(
    options: { depositAddress?: string; amountSats?: number; reportHash?: boolean } = {}
  ): PayoutResult {
    const swap = this.swap(options.depositAddress);
    if (swap.status !== 'PROCESSING')
      throw new Error(`Swap ${swap.depositAddress} is ${swap.status}, not PROCESSING`);
    const amountSats = options.amountSats ?? swap.amountOut;
    const tx = this.treasury.pay([{ script: scriptOfAddress(swap.recipient), value: amountSats }]);
    this.oneClick.succeed(swap, tx.txid, amountSats, { reportHash: options.reportHash ?? true });
    return { swap, tx, outpoint: { txid: tx.txid, vout: 0 }, amountSats };
  }

  payTo(address: string, amountSats: number): { tx: ChainTx; outpoint: Outpoint } {
    const tx = this.treasury.pay([{ script: scriptOfAddress(address), value: amountSats }]);
    return { tx, outpoint: { txid: tx.txid, vout: 0 } };
  }

  mine(count = 1): void {
    this.bitcoin.mine(count);
  }

  readonly signers = {
    accept: (o: Outpoint): EmilyDeposit =>
      this.emily.setStatus(o.txid, o.vout, 'accepted', 'The signers accepted the deposit'),
    sweep: (o: Outpoint): ChainTx => {
      const deposit = this.emily.get(o.txid, o.vout);
      if (!deposit) throw new Error(`The signers cannot sweep ${outpointKey(o)}: not registered`);
      return this.sweepAsSigners({
        outpoint: o,
        depositScript: deposit.depositScript,
        reclaimScript: deposit.reclaimScript,
        signerKey: this.signer,
        withSignerUtxo: true,
      });
    },
    confirm: (o: Outpoint): EmilyDeposit => {
      const deposit = this.emily.setStatus(
        o.txid,
        o.vout,
        'confirmed',
        `Included in block ${this.bitcoin.tip.hash}`
      );
      deposit.fulfillment = { BitcoinBlockHeight: this.bitcoin.tip.height, BtcFee: 1_502 };
      return deposit;
    },
    fail: (o: Outpoint, message = 'The signers rejected the deposit'): EmilyDeposit =>
      this.emily.setStatus(o.txid, o.vout, 'failed', message),
    mint: (o: Outpoint): EmilyDeposit => {
      this.signers.accept(o);
      this.signers.sweep(o);
      this.mine(1);
      return this.signers.confirm(o);
    },
  };
}
