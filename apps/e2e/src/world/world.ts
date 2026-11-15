import { buildDepositAddress } from '@portage/core';

import { SOLANA_MAINNET_CAIP2, UPSTREAM } from '../config.js';
import {
  BitcoinChain,
  type ChainTx,
  type Outpoint,
  Wallet,
  outpointKey,
  scriptOfAddress,
  sweepDeposit,
} from './bitcoin.js';
import { type Gate, RealDate, gate, realNow } from './clock.js';
import { Emily, type EmilyDeposit } from './emily.js';
import { EvmChains, type EvmTransfer } from './evm.js';
import { Hiro } from './hiro.js';
import { type Reply, field, parseJson, text } from './http.js';
import { type BitcoinKey, bitcoinKey, p2trOf, stacksAddressOf } from './keys.js';
import { OneClick, type Swap, TOKENS } from './oneclick.js';
import { Rng } from './random.js';
import { parseDepositScript } from './sbtc-scripts.js';
import { type Credit, NATIVE_SOL_ASSET, SolanaChain } from './solana.js';
import { FakeRelay } from './walletconnect-relay.js';

export type Caller = 'page' | 'worker' | 'notifier' | 'wallet' | 'test';
export type Service = 'hiro' | 'mempool' | 'emily' | 'oneclick' | 'solana';

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
  rpcMethod?: string;
  bodyIncludes?: string;
  callers?: readonly Caller[];
  outcome: FaultOutcome;
  times?: number;
  label?: string;
}

interface ActiveFault extends FaultRule {
  remaining: number;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type WorldReply = Reply | 'network-error' | 'hang';

const BROWSER_SERVICES: ReadonlySet<Service> = new Set(['hiro', 'mempool', 'emily', 'solana']);

export const START_HEIGHT = 975_800;
export const EVIDENCE_AMOUNT_SATS = 20_000_774;
const SOLANA_SLOT_MS = 400;

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
    case UPSTREAM.solanaRpc:
      return 'solana';
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

export type EvidenceVariant = 'unswept' | 'other-signer-key';

export class World {
  readonly rng: Rng;
  readonly bitcoin: BitcoinChain;
  readonly treasury: Wallet;
  readonly signer: BitcoinKey;
  readonly emily: Emily;
  readonly hiro: Hiro;
  readonly oneClick: OneClick;
  readonly solana: SolanaChain;
  readonly evm: EvmChains;
  readonly relay: FakeRelay;
  readonly log: WorldLogEntry[] = [];
  readonly unexpected: string[] = [];
  readonly authorizations: {
    caller: Caller;
    service: Service | null;
    url: string;
    value: string;
  }[] = [];
  evidence: { deposit: Outpoint; sweep: string | null };
  private readonly faults: ActiveFault[] = [];
  private clockOffsetMs = 0;
  private solanaClockRemainderMs = 0;
  private seq = 0;
  private parkedCount = 0;

  private readonly frozenAt: number | null;

  constructor(seed: string, options: { frozenAt?: number } = {}) {
    this.frozenAt = options.frozenAt ?? null;
    this.rng = new Rng(seed);
    this.bitcoin = new BitcoinChain(this.rng, START_HEIGHT, Math.floor(this.baseNow() / 1000));
    this.relay = new FakeRelay(this.rng, () => this.now().getTime());
    this.treasury = new Wallet(this.bitcoin, bitcoinKey(this.rng), this.rng, 5_000_000_000);
    this.signer = bitcoinKey(this.rng);
    this.emily = new Emily(this.bitcoin, () => this.signer.xOnly);
    this.hiro = new Hiro(() => this.signer.publicKey);
    this.oneClick = new OneClick(this.rng, () => this.now());
    this.solana = new SolanaChain(this.rng, credit => this.solanaCredit(credit));
    this.evm = new EvmChains(this.rng, (transfer, hash) => this.evmTransfer(transfer, hash));
    this.evidence = this.seedEvidence({ signerKey: this.signer, swept: true });
    this.solana.createMint(
      TOKENS.usdcSol.contractAddress,
      TOKENS.usdcSol.decimals,
      this.rng.base58(32)
    );
  }

  private baseNow(): number {
    return this.frozenAt ?? realNow();
  }

  now(): Date {
    return new RealDate(this.baseNow() + this.clockOffsetMs);
  }

  get clockOffset(): number {
    return this.clockOffsetMs;
  }

  advanceClock(ms: number): void {
    this.clockOffsetMs += ms;
    const total = this.solanaClockRemainderMs + ms;
    const slots = Math.floor(total / SOLANA_SLOT_MS);
    this.solanaClockRemainderMs = total - slots * SOLANA_SLOT_MS;
    if (slots > 0) this.solana.advance(slots);
  }

  get parked(): number {
    return this.parkedCount;
  }

  private seedEvidence(input: { signerKey: BitcoinKey; swept: boolean }): {
    deposit: Outpoint;
    sweep: string | null;
  } {
    const other = bitcoinKey(this.rng);
    const deposit = buildDepositAddress({
      stacksAddress: stacksAddressOf(other),
      reclaimPublicKey: other.xOnly,
      signersPublicKey: input.signerKey.xOnly,
      maxSignerFeeSats: 80_000,
      reclaimLockBlocks: 950,
    });
    const tip = this.bitcoin.tip.height;
    const payout = this.treasury.pay(
      [{ script: deposit.scriptPubKey, value: EVIDENCE_AMOUNT_SATS }],
      { confirmedAt: tip - 30 }
    );
    const sweep = input.swept
      ? sweepDeposit({
          chain: this.bitcoin,
          outpoint: { txid: payout.txid, vout: 0 },
          depositScript: deposit.depositScript,
          reclaimScript: deposit.reclaimScript,
          signerKey: input.signerKey,
          toScript: p2trOf(input.signerKey).script,
          feeSats: 1_502,
          confirmedAt: tip - 12,
        })
      : null;
    const parsed = parseDepositScript(deposit.depositScript);
    const block = this.bitcoin.blockAt(tip - 12);
    if (!parsed || !block) throw new Error('Could not seed the signer evidence');
    const seeded: EmilyDeposit = {
      bitcoinTxid: payout.txid,
      bitcoinTxOutputIndex: 0,
      recipient: parsed.recipient,
      amount: EVIDENCE_AMOUNT_SATS,
      lastUpdateHeight: tip - 12,
      lastUpdateBlockHash: block.hash,
      status: 'confirmed',
      statusMessage: `Included in block ${block.hash}`,
      parameters: { maxFee: 80_000, lockTime: 950 },
      reclaimScript: deposit.reclaimScript,
      depositScript: deposit.depositScript,
      ...(sweep
        ? { fulfillment: { BitcoinTxid: sweep.txid, BitcoinTxIndex: 0, BtcFee: 1_502 } }
        : {}),
    };
    this.emily.seed(seeded);
    return { deposit: { txid: payout.txid, vout: 0 }, sweep: sweep?.txid ?? null };
  }

  replaceEvidence(variant: EvidenceVariant): void {
    this.emily.remove(this.evidence.deposit.txid, this.evidence.deposit.vout);
    this.evidence = this.seedEvidence({
      signerKey: variant === 'other-signer-key' ? bitcoinKey(this.rng) : this.signer,
      swept: variant !== 'unswept',
    });
  }

  private solanaCredit(credit: Credit): void {
    const assetId =
      credit.assetMint === null
        ? NATIVE_SOL_ASSET
        : (this.oneClick
            .tokens()
            .find(
              t =>
                t.family === 'solana' &&
                t.contractAddress !== undefined &&
                t.contractAddress === credit.assetMint
            )?.assetId ?? `unknown-mint:${credit.assetMint}`);
    this.oneClick.arrive({
      depositAddress: credit.owner,
      assetId,
      amount: credit.amount,
      txHash: credit.signature,
    });
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
    this.faults.push({ ...rule, remaining: rule.times ?? Number.MAX_SAFE_INTEGER });
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
        (f.rpcMethod === undefined || field(parseJson(body), 'method') === f.rpcMethod) &&
        (f.bodyIncludes === undefined || body.includes(f.bodyIncludes)) &&
        (f.callers === undefined || f.callers.includes(caller))
    );
    if (!fault) return null;
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
    switch (service) {
      case 'hiro':
        return this.hiro.serve(request.method, url.pathname, request.body);
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
      case 'solana':
        if (
          request.method !== 'POST' ||
          url.pathname !== '/v1/' ||
          url.searchParams.get('chainId') !== SOLANA_MAINNET_CAIP2 ||
          !url.searchParams.get('projectId')
        )
          return text('Bad Request', 400);
        return this.solana.serve(parseJson(request.body));
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
    filter: { caller?: Caller; method?: string; path?: string | RegExp; rpcMethod?: string } = {}
  ): WorldLogEntry[] {
    return this.log.filter(e => {
      if (e.service !== service) return false;
      if (filter.caller && e.caller !== filter.caller) return false;
      if (filter.method && e.method !== filter.method) return false;
      const path = new URL(e.url).pathname;
      if (typeof filter.path === 'string' && path !== filter.path) return false;
      if (filter.path instanceof RegExp && !filter.path.test(path)) return false;
      if (
        filter.rpcMethod !== undefined &&
        (e.requestBody === undefined ? undefined : field(parseJson(e.requestBody), 'method')) !==
          filter.rpcMethod
      )
        return false;
      return true;
    });
  }

  swap(depositAddress?: string): Swap {
    return depositAddress === undefined
      ? this.oneClick.latestSwap()
      : this.oneClick.swap(depositAddress);
  }

  reportDeposit(options: { depositAddress?: string; amount?: bigint } = {}): Swap {
    const swap = this.swap(options.depositAddress);
    const updated = this.oneClick.arrive({
      depositAddress: swap.depositAddress,
      assetId: swap.token.assetId,
      amount: options.amount ?? swap.amountIn,
      txHash: swap.token.family === 'solana' ? this.rng.base58(64) : `0x${this.rng.hex(32)}`,
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
      return sweepDeposit({
        chain: this.bitcoin,
        outpoint: o,
        depositScript: deposit.depositScript,
        reclaimScript: deposit.reclaimScript,
        signerKey: this.signer,
        toScript: p2trOf(this.signer).script,
        feeSats: 1_502,
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
