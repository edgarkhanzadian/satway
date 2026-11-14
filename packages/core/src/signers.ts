import type { NetworkConfig } from './config.js';
import { toXOnly } from './deposit-address.js';
import { type FetchLike, defaultFetch, requestJson, requestText } from './http.js';
import { z } from './schema.js';

const ZERO_ADDRESS = 'SP000000000000000000002Q6VF78';

const readOnlyResultSchema = z.looseObject({
  okay: z.boolean(),
  result: z.string().optional(),
  cause: z.string().optional(),
});

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

const recentDepositsSchema = z.looseObject({
  deposits: z.array(
    z.looseObject({
      bitcoinTxid: z.string(),
      bitcoinTxOutputIndex: z.number(),
      depositScript: z.string(),
    })
  ),
});

const outspendSchema = z.looseObject({
  spent: z.boolean(),
  status: z.looseObject({ confirmed: z.boolean(), block_height: z.number().optional() }).optional(),
});

export interface VerifiedSigners {
  signersPublicKey: string;
  evidence: { txid: string; vout: number; sweptAtHeight: number; blocksAgo: number };
}

export interface VerifySignersOptions {
  fetchFn?: FetchLike;
  secondaryStxApiUrl?: string;
  maxEvidenceAgeBlocks?: number;
}

export async function fetchVerifiedSigners(
  config: Pick<NetworkConfig, 'stxApiUrl' | 'btcApiUrl' | 'sbtcApiUrl' | 'sbtcContract'>,
  options: VerifySignersOptions = {}
): Promise<VerifiedSigners> {
  const fetchFn = options.fetchFn ?? defaultFetch;
  const maxAge = options.maxEvidenceAgeBlocks ?? 1008;

  const signersPublicKey = await fetchSignersPublicKey(
    config.stxApiUrl,
    config.sbtcContract,
    fetchFn
  );

  if (options.secondaryStxApiUrl) {
    const second = await fetchSignersPublicKey(
      options.secondaryStxApiUrl,
      config.sbtcContract,
      fetchFn
    );
    if (second !== signersPublicKey) {
      throw new Error('Signer key mismatch between Stacks APIs; refusing to build an address');
    }
  }

  const recent = await requestJson(
    fetchFn,
    `${config.sbtcApiUrl}/deposit?status=confirmed&pageSize=20`,
    recentDepositsSchema
  );
  const matching = recent.deposits.filter(
    d => signerKeyOfDepositScript(d.depositScript) === signersPublicKey
  );
  if (matching.length === 0) {
    throw new Error(
      'Signer key from the registry does not appear in any recent confirmed sBTC deposit; refusing to build an address'
    );
  }

  const tipText = await requestText(fetchFn, `${config.btcApiUrl}/blocks/tip/height`);
  const tip = Number(tipText);
  if (!Number.isSafeInteger(tip)) throw new Error('Bitcoin API returned a bad tip height');

  for (const candidate of matching.slice(0, 3)) {
    const outspend = await requestJson(
      fetchFn,
      `${config.btcApiUrl}/tx/${candidate.bitcoinTxid}/outspend/${candidate.bitcoinTxOutputIndex}`,
      outspendSchema
    );
    const height = outspend.status?.block_height;
    if (outspend.spent && outspend.status?.confirmed && height !== undefined) {
      const blocksAgo = tip - height;
      if (blocksAgo >= 0 && blocksAgo <= maxAge) {
        return {
          signersPublicKey,
          evidence: {
            txid: candidate.bitcoinTxid,
            vout: candidate.bitcoinTxOutputIndex,
            sweptAtHeight: height,
            blocksAgo,
          },
        };
      }
    }
  }

  throw new Error(
    'Could not find a recent on-chain sweep of a deposit locked to the registry signer key; refusing to build an address'
  );
}
