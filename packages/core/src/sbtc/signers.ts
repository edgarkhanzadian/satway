import { fetchTipHeight, fetchTransactionHex } from '../bitcoin/index.js';
import {
  type FetchLike,
  type NetworkConfig,
  defaultFetch,
  errorMessage,
  requestJson,
  z,
} from '../shared/index.js';
import { toXOnly } from './deposit-address.js';
import {
  type EvidenceDeposit,
  type SignerEvidence,
  type SweepTransaction,
  checkDepositSweep,
  evidenceDepositsSchema,
  evidenceOutspendSchema,
  spendingTxidOf,
  sweepTransactionSchema,
} from './signer-evidence.js';
import { verifyDepositTransaction } from './verify-deposit-transaction.js';

const ZERO_ADDRESS = 'SP000000000000000000002Q6VF78';

const readOnlyResultSchema = z.looseObject({
  okay: z.boolean(),
  result: z.string().optional(),
  cause: z.string().optional(),
});

const dataVarSchema = z.looseObject({ data: z.string() });

export function parseAggregatePubkey(clarityHex: string): string {
  const clean = clarityHex.toLowerCase().replace(/^0x/, '');
  if (!clean.startsWith('02')) throw new Error('Registry did not return a buffer');
  const length = parseInt(clean.slice(2, 10), 16);
  const body = clean.slice(10);
  if (body.length !== length * 2) throw new Error('Registry buffer length mismatch');
  if (length !== 33) throw new Error(`Expected a 33-byte signer key, got ${length} bytes`);
  return toXOnly(body);
}

export async function fetchSignersPublicKey(
  stxApiUrl: string,
  sbtcContract: string,
  fetchFn: FetchLike = defaultFetch
): Promise<string> {
  const url = `${stxApiUrl}/v2/contracts/call-read/${sbtcContract}/sbtc-registry/get-current-aggregate-pubkey`;
  const res = await requestJson(fetchFn, url, readOnlyResultSchema, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sender: ZERO_ADDRESS, arguments: [] }),
  });
  if (!res.okay || !res.result) {
    throw new Error(`Registry read failed: ${res.cause ?? 'no result'}`);
  }
  return parseAggregatePubkey(res.result);
}

export async function fetchSignersPublicKeyVar(
  stxApiUrl: string,
  sbtcContract: string,
  fetchFn: FetchLike = defaultFetch
): Promise<string> {
  const url = `${stxApiUrl}/v2/data_var/${sbtcContract}/sbtc-registry/current-aggregate-pubkey?proof=0`;
  const res = await requestJson(fetchFn, url, dataVarSchema);
  return parseAggregatePubkey(res.data);
}

export function signerKeyOfDepositScript(depositScriptHex: string): string | null {
  const script = depositScriptHex.toLowerCase();
  if (!/^[0-9a-f]*$/.test(script) || script.length % 2 !== 0) return null;
  const pushLength = parseInt(script.slice(0, 2), 16);
  if (!(pushLength >= 30 && pushLength <= 75)) return null;
  const dataEnd = 2 + pushLength * 2;
  const principalType = script.slice(18, 20);
  if (principalType !== '05' && principalType !== '06') return null;
  const tail = script.slice(dataEnd);
  const match = /^7520([0-9a-f]{64})ac$/.exec(tail);
  return match?.[1] ?? null;
}

export interface RejectedEvidence {
  txid: string;
  vout: number;
  reason: string;
}

export interface VerifiedSigners {
  signersPublicKey: string;
  evidence: SignerEvidence;
  evidenceItems: SignerEvidence[];
  rejectedEvidence: RejectedEvidence[];
  stacksSources: [string, string];
  requests: number;
}

export interface VerifySignersOptions {
  fetchFn?: FetchLike;
  secondaryStxApiUrl?: string;
  maxEvidenceAgeBlocks?: number;
  minEvidence?: number;
  maxEvidenceCandidates?: number;
  minSignerUtxoSats?: number;
}

export const SIGNER_EVIDENCE_DEFAULTS = Object.freeze({
  maxEvidenceAgeBlocks: 1008,
  minEvidence: 2,
  maxEvidenceCandidates: 6,
  minSignerUtxoSats: 10_000_000_000,
  emilyPageSize: 20,
});

export class SignerVerificationError extends Error {
  constructor(
    message: string,
    readonly rejectedEvidence: readonly RejectedEvidence[] = []
  ) {
    super(message);
    this.name = 'SignerVerificationError';
  }
}

const REFUSE = 'refusing to build an address';

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    throw new SignerVerificationError(`Stacks API URL ${url} is not a valid URL; ${REFUSE}`);
  }
}

function hostOf(url: string): string {
  return new URL(url).host;
}

async function readRegistryKey(
  primaryUrl: string,
  secondaryUrl: string,
  sbtcContract: string,
  fetchFn: FetchLike
): Promise<string> {
  const [primary, secondary] = await Promise.all([
    fetchSignersPublicKey(primaryUrl, sbtcContract, fetchFn),
    fetchSignersPublicKeyVar(secondaryUrl, sbtcContract, fetchFn).catch((err: unknown) => {
      throw new SignerVerificationError(
        `Could not read the signer key from the second Stacks source ${hostOf(secondaryUrl)} (${errorMessage(err) ?? String(err)}); ${REFUSE}`
      );
    }),
  ]);
  if (secondary !== primary) {
    throw new SignerVerificationError(
      `Signer key mismatch between Stacks APIs: ${hostOf(primaryUrl)} says ${primary}, ${hostOf(secondaryUrl)} says ${secondary}; ${REFUSE}`
    );
  }
  return primary;
}

function uniqueCandidates(
  deposits: readonly EvidenceDeposit[],
  signersPublicKey: string,
  limit: number
): EvidenceDeposit[] {
  const seen = new Set<string>();
  const out: EvidenceDeposit[] = [];
  for (const d of deposits) {
    if (out.length >= limit) break;
    if (signerKeyOfDepositScript(d.depositScript) !== signersPublicKey) continue;
    const key = `${d.bitcoinTxid.toLowerCase()}:${d.bitcoinTxOutputIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

export async function fetchVerifiedSigners(
  config: Pick<
    NetworkConfig,
    'stxApiUrl' | 'stxSecondaryApiUrl' | 'btcApiUrl' | 'sbtcApiUrl' | 'sbtcContract'
  >,
  options: VerifySignersOptions = {}
): Promise<VerifiedSigners> {
  const baseFetch = options.fetchFn ?? defaultFetch;
  let requests = 0;
  function fetchFn(input: string, init?: RequestInit): Promise<Response> {
    requests += 1;
    return baseFetch(input, init);
  }
  const maxAgeBlocks =
    options.maxEvidenceAgeBlocks ?? SIGNER_EVIDENCE_DEFAULTS.maxEvidenceAgeBlocks;
  const minEvidence = Math.max(1, options.minEvidence ?? SIGNER_EVIDENCE_DEFAULTS.minEvidence);
  const maxCandidates = Math.max(
    minEvidence,
    options.maxEvidenceCandidates ?? SIGNER_EVIDENCE_DEFAULTS.maxEvidenceCandidates
  );
  const minSignerUtxoSats = options.minSignerUtxoSats ?? SIGNER_EVIDENCE_DEFAULTS.minSignerUtxoSats;

  const secondaryUrl = options.secondaryStxApiUrl ?? config.stxSecondaryApiUrl;
  if (originOf(secondaryUrl) === originOf(config.stxApiUrl)) {
    throw new SignerVerificationError(
      `The second Stacks source must be a different host from ${hostOf(config.stxApiUrl)}; ${REFUSE}`
    );
  }

  const [signersPublicKey, recent, tipHeight] = await Promise.all([
    readRegistryKey(config.stxApiUrl, secondaryUrl, config.sbtcContract, fetchFn),
    requestJson(
      fetchFn,
      `${config.sbtcApiUrl}/deposit?status=confirmed&pageSize=${SIGNER_EVIDENCE_DEFAULTS.emilyPageSize}`,
      evidenceDepositsSchema
    ),
    fetchTipHeight(config.btcApiUrl, fetchFn),
  ]);

  const candidates = uniqueCandidates(recent.deposits, signersPublicKey, maxCandidates);
  if (candidates.length === 0) {
    throw new SignerVerificationError(
      `Signer key from the registry does not appear in any recent confirmed sBTC deposit; ${REFUSE}`
    );
  }

  const sweeps = new Map<string, Promise<SweepTransaction>>();
  function sweepOf(txid: string): Promise<SweepTransaction> {
    const known = sweeps.get(txid);
    if (known) return known;
    const pending = requestJson(fetchFn, `${config.btcApiUrl}/tx/${txid}`, sweepTransactionSchema);
    sweeps.set(txid, pending);
    return pending;
  }

  const rules = { tipHeight, maxAgeBlocks, minSignerUtxoSats };
  async function check(deposit: EvidenceDeposit): Promise<SignerEvidence> {
    const outpoint = {
      txid: deposit.bitcoinTxid.toLowerCase(),
      vout: deposit.bitcoinTxOutputIndex,
    };
    const [fundingHex, outspend] = await Promise.all([
      fetchTransactionHex(config.btcApiUrl, outpoint.txid, fetchFn),
      requestJson(
        fetchFn,
        `${config.btcApiUrl}/tx/${outpoint.txid}/outspend/${outpoint.vout}`,
        evidenceOutspendSchema
      ),
    ]);
    verifyDepositTransaction(fundingHex, {
      ...outpoint,
      depositScript: deposit.depositScript.toLowerCase(),
      reclaimScript: deposit.reclaimScript.toLowerCase(),
    });
    const sweep = await sweepOf(spendingTxidOf(deposit, outspend));
    return checkDepositSweep(deposit, outspend, sweep, rules);
  }

  const accepted: SignerEvidence[] = [];
  const rejected: RejectedEvidence[] = [];
  let next = 0;
  while (accepted.length < minEvidence && next < candidates.length) {
    const batch = candidates.slice(next, next + (minEvidence - accepted.length));
    next += batch.length;
    const results = await Promise.allSettled(batch.map(check));
    results.forEach((result, i) => {
      const deposit = batch[i];
      if (result.status === 'fulfilled') accepted.push(result.value);
      else if (deposit) {
        rejected.push({
          txid: deposit.bitcoinTxid,
          vout: deposit.bitcoinTxOutputIndex,
          reason: errorMessage(result.reason) ?? String(result.reason),
        });
      }
    });
  }

  const [first] = accepted;
  if (!first || accepted.length < minEvidence) {
    const reasons = rejected.map(r => `${r.txid}:${r.vout}: ${r.reason}`).join('; ');
    throw new SignerVerificationError(
      `Found ${accepted.length} of the ${minEvidence} recent on-chain sweeps needed to trust the registry signer key (checked ${candidates.length} deposit(s)${reasons ? `; ${reasons}` : ''}); ${REFUSE}`,
      rejected
    );
  }

  return {
    signersPublicKey,
    evidence: first,
    evidenceItems: accepted,
    rejectedEvidence: rejected,
    stacksSources: [originOf(config.stxApiUrl), originOf(secondaryUrl)],
    requests,
  };
}
