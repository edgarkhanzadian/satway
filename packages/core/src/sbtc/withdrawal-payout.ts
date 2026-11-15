import { hex } from '@scure/base';
import * as btc from '@scure/btc-signer';

import {
  type BtcTxStatus,
  fetchTipHeight,
  fetchTransaction,
  fetchTransactionHex,
} from '../bitcoin/index.js';
import { type FetchLike, type NetworkConfig, errorMessage } from '../shared/index.js';

export interface PayoutExpectation {
  txid: string;
  vout: number | null;
  amountSats: number;
  scriptPubKey: string;
}

export type PayoutProblem =
  | 'tx-not-found'
  | 'tx-unparseable'
  | 'txid-mismatch'
  | 'no-such-output'
  | 'wrong-script'
  | 'wrong-value'
  | 'no-matching-output'
  | 'several-matching-outputs';

export interface PayoutVerification {
  ok: boolean;
  txid: string;
  vout: number | null;
  valueSats: number | null;
  problems: PayoutProblem[];
  confirmed: boolean;
  blockHeight: number | null;
  confirmations: number | null;
}

const TXID = /^[0-9a-f]{64}$/;

function parseTransaction(transactionHex: string): btc.Transaction | null {
  try {
    const bytes = hex.decode(transactionHex);
    if (hex.encode(btc.RawTx.encode(btc.RawTx.decode(bytes))) !== transactionHex) return null;
    return btc.Transaction.fromRaw(bytes, {
      allowUnknownInputs: true,
      allowUnknownOutputs: true,
      disableScriptCheck: true,
    });
  } catch {
    return null;
  }
}

function idOf(tx: btc.Transaction): string | null {
  try {
    return tx.id;
  } catch {
    return null;
  }
}

function confirmationsOf(status: BtcTxStatus | null, tipHeight: number | null): number | null {
  if (!status?.confirmed || status.block_height === undefined || tipHeight === null) return null;
  return Math.max(0, tipHeight - status.block_height + 1);
}

export function verifyPayoutTransaction(
  transactionHex: string,
  status: BtcTxStatus | null,
  tipHeight: number | null,
  expected: PayoutExpectation
): PayoutVerification {
  const txid = expected.txid.toLowerCase();
  const wantedScript = expected.scriptPubKey.toLowerCase();
  const base = {
    txid,
    confirmed: status?.confirmed ?? false,
    blockHeight: status?.block_height ?? null,
    confirmations: confirmationsOf(status, tipHeight),
  };
  function failed(problem: PayoutProblem, vout: number | null = expected.vout): PayoutVerification {
    return { ...base, ok: false, vout, valueSats: null, problems: [problem] };
  }

  const tx = parseTransaction(transactionHex.toLowerCase());
  if (!tx) return failed('tx-unparseable');
  if (idOf(tx) !== txid) return failed('txid-mismatch');

  const outputs = Array.from({ length: tx.outputsLength }, (_, i) => {
    const out = tx.getOutput(i);
    return {
      vout: i,
      script: out.script ? hex.encode(out.script) : null,
      amount: out.amount ?? null,
    };
  });

  let vout = expected.vout;
  if (vout === null) {
    const matches = outputs.filter(
      o => o.script === wantedScript && o.amount === BigInt(expected.amountSats)
    );
    if (matches.length === 0) return failed('no-matching-output', null);
    if (matches.length > 1) return failed('several-matching-outputs', null);
    vout = matches[0]?.vout ?? null;
  }
  const output = vout === null ? undefined : outputs[vout];
  if (vout === null || !Number.isSafeInteger(vout) || vout < 0 || !output) {
    return failed('no-such-output');
  }
  const problems: PayoutProblem[] = [];
  if (output.script !== wantedScript) problems.push('wrong-script');
  if (output.amount !== BigInt(expected.amountSats)) problems.push('wrong-value');
  const valueSats =
    output.amount !== null && output.amount <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(output.amount)
      : null;
  return { ...base, ok: problems.length === 0, vout, valueSats, problems };
}

export function describePayoutProblem(problem: PayoutProblem): string {
  switch (problem) {
    case 'tx-not-found':
      return 'The Bitcoin payout transaction was not found.';
    case 'tx-unparseable':
      return 'The Bitcoin payout transaction data could not be parsed.';
    case 'txid-mismatch':
      return 'The Bitcoin API returned a different transaction than the one requested.';
    case 'no-such-output':
      return 'The Bitcoin payout transaction has no output at the reported index.';
    case 'wrong-script':
      return 'The payout output does not pay the Bitcoin address in the request.';
    case 'wrong-value':
      return 'The payout output does not carry exactly the requested amount.';
    case 'no-matching-output':
      return 'No output of the sweep transaction pays the requested amount to the requested address.';
    case 'several-matching-outputs':
      return 'Several outputs of the sweep transaction pay the requested amount to the requested address.';
    default:
      throw new Error(`Unknown payout problem: ${String(problem satisfies never)}`);
  }
}

export interface FetchedPayoutVerification {
  verification: PayoutVerification;
  tipError: string | null;
}

export async function fetchAndVerifyWithdrawalPayout(
  config: Pick<NetworkConfig, 'btcApiUrl'>,
  expected: PayoutExpectation,
  fetchFn?: FetchLike
): Promise<FetchedPayoutVerification> {
  const txid = expected.txid.toLowerCase();
  if (!TXID.test(txid)) throw new Error(`Not a Bitcoin txid: ${expected.txid}`);
  const tx = await fetchTransaction(config.btcApiUrl, txid, fetchFn);
  if (!tx) {
    return {
      verification: {
        ok: false,
        txid,
        vout: expected.vout,
        valueSats: null,
        problems: ['tx-not-found'],
        confirmed: false,
        blockHeight: null,
        confirmations: null,
      },
      tipError: null,
    };
  }
  const transactionHex = await fetchTransactionHex(config.btcApiUrl, txid, fetchFn);
  let tipHeight: number | null = null;
  let tipError: string | null = null;
  if (tx.status.confirmed) {
    try {
      tipHeight = await fetchTipHeight(config.btcApiUrl, fetchFn);
    } catch (err) {
      tipError = errorMessage(err) ?? String(err);
    }
  }
  return {
    verification: verifyPayoutTransaction(transactionHex, tx.status, tipHeight, expected),
    tipError,
  };
}
