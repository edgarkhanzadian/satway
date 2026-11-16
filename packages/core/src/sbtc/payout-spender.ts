import { type FetchLike, defaultFetch, requestJson } from '../shared/index.js';
import { depositLeafControlBlock, reclaimLeafControlBlock } from './deposit-address.js';
import {
  type SweepTransaction,
  evidenceOutspendSchema,
  sweepTransactionSchema,
} from './signer-evidence.js';

export type PayoutSpender = 'signers' | 'reclaim';

export interface DepositScripts {
  depositScript: string;
  reclaimScript: string;
}

const TXID = /^[0-9a-f]{64}$/;

export function spenderOfWitness(
  witness: readonly string[],
  scripts: DepositScripts
): PayoutSpender | null {
  const items = witness.map(item => item.toLowerCase());
  if (items.length < 3) return null;
  const script = items.at(-2);
  const controlBlock = items.at(-1);
  const depositScript = scripts.depositScript.toLowerCase();
  const reclaimScript = scripts.reclaimScript.toLowerCase();
  if (
    script === depositScript &&
    controlBlock === depositLeafControlBlock(depositScript, reclaimScript)
  ) {
    return 'signers';
  }
  if (
    script === reclaimScript &&
    controlBlock === reclaimLeafControlBlock(depositScript, reclaimScript)
  ) {
    return 'reclaim';
  }
  return null;
}

export function spenderOfTransaction(
  spend: SweepTransaction,
  outpoint: { txid: string; vout: number },
  scripts: DepositScripts
): PayoutSpender | null {
  const txid = outpoint.txid.toLowerCase();
  const input = spend.vin.find(i => i.txid.toLowerCase() === txid && i.vout === outpoint.vout);
  return input ? spenderOfWitness(input.witness ?? [], scripts) : null;
}

export type PayoutSpend = PayoutSpender | 'unspent' | 'unknown';

export async function fetchPayoutSpend(
  btcApiUrl: string,
  outpoint: { txid: string; vout: number },
  scripts: DepositScripts,
  fetchFn: FetchLike = defaultFetch
): Promise<PayoutSpend> {
  const txid = outpoint.txid.toLowerCase();
  if (!TXID.test(txid)) return 'unknown';
  const outspend = await requestJson(
    fetchFn,
    `${btcApiUrl}/tx/${txid}/outspend/${outpoint.vout}`,
    evidenceOutspendSchema
  );
  if (!outspend.spent) return 'unspent';
  const spender = outspend.txid?.toLowerCase();
  if (spender === undefined || !TXID.test(spender)) return 'unknown';
  const spend = await requestJson(fetchFn, `${btcApiUrl}/tx/${spender}`, sweepTransactionSchema);
  if (spend.txid.toLowerCase() !== spender) return 'unknown';
  return spenderOfTransaction(spend, { txid, vout: outpoint.vout }, scripts) ?? 'unknown';
}

export async function fetchPayoutSpender(
  btcApiUrl: string,
  outpoint: { txid: string; vout: number },
  scripts: DepositScripts,
  fetchFn: FetchLike = defaultFetch
): Promise<PayoutSpender | null> {
  const spend = await fetchPayoutSpend(btcApiUrl, outpoint, scripts, fetchFn);
  return spend === 'signers' || spend === 'reclaim' ? spend : null;
}
