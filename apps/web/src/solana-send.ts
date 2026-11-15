import { base58, base64 } from '@scure/base';
import { encode } from 'uqr';

import { type OneClickToken, errorMessage } from '@portage/core';

import { SOLANA_RPC_URL } from './config.js';
import { solanaPayUrl } from './solana-pay.js';
import { type SimulationResult, type SolanaRpc, createSolanaRpc } from './solana-rpc.js';
import {
  buildSolanaTransfer,
  checkSolanaTarget,
  recipientTokenAccountReady,
  sameMessage,
} from './solana-transfer.js';
import {
  SendError,
  type SolanaAccount,
  type SolanaSendResult,
  isSolanaSignature,
  notSent,
  walletFailure,
} from './source-wallet.js';

export interface SolanaDepositInput {
  token: OneClickToken;
  recipient: string;
  amount: string;
  memo?: string | undefined;
}

function defaultRpc(): SolanaRpc {
  return createSolanaRpc(SOLANA_RPC_URL);
}

export function simulationReason(result: SimulationResult): string {
  const failing = [...result.logs]
    .reverse()
    .find(line => /error|failed|insufficient/i.test(line))
    ?.replace(/^Program log: /, '');
  const reason = failing ?? result.err ?? 'unknown error';
  return reason.length > 300 ? `${reason.slice(0, 300)}…` : reason;
}

function signatureOf(transaction: Uint8Array): string {
  const signature = transaction.subarray(1, 65);
  if (signature.length !== 64 || signature.every(byte => byte === 0))
    throw new Error('The wallet did not sign the transaction. Nothing was sent.');
  return base58.encode(signature);
}

export interface SignedSolanaSend {
  signature: string;
  transaction: Uint8Array;
  lastValidBlockHeight: bigint;
}

export interface SolanaSendHooks {
  onSigned?(signed: SignedSolanaSend): void;
}

interface PreparedSolanaTransfer {
  transaction: Uint8Array;
  lastValidBlockHeight: bigint;
}

async function prepareSolanaTransfer(
  input: SolanaDepositInput,
  account: SolanaAccount,
  rpc: SolanaRpc
): Promise<PreparedSolanaTransfer> {
  const latest = await rpc.latestBlockhash();
  const transfer = await buildSolanaTransfer(
    { ...input, sender: account.address },
    addresses => rpc.accounts(addresses),
    latest
  );
  const simulation = await rpc.simulate(base64.encode(transfer.transaction));
  if (simulation.err !== null)
    throw new Error(
      `Solana says this transfer would fail, so it was not sent: ${simulationReason(simulation)}`
    );
  return { transaction: transfer.transaction, lastValidBlockHeight: latest.lastValidBlockHeight };
}

function signedBy(transaction: Uint8Array, expected: Uint8Array): string {
  if (!sameMessage(transaction, expected))
    throw new Error('The wallet changed the transaction before signing it. Nothing was sent.');
  return signatureOf(transaction);
}

export async function sendSolanaDeposit(
  input: SolanaDepositInput,
  account: SolanaAccount,
  rpc: SolanaRpc = defaultRpc(),
  hooks: SolanaSendHooks = {}
): Promise<string> {
  let prepared: PreparedSolanaTransfer;
  try {
    prepared = await prepareSolanaTransfer(input, account, rpc);
  } catch (err) {
    throw notSent(err);
  }

  let result: SolanaSendResult;
  try {
    result = await account.sender.send(prepared.transaction);
  } catch (err) {
    throw walletFailure(err, 'The wallet did not confirm whether it sent the transaction');
  }
  if (result.kind === 'sent') {
    if (!isSolanaSignature(result.signature))
      throw new SendError('The wallet did not return a transaction signature', 'uncertain');
    return result.signature;
  }
  let signature: string;
  try {
    signature = signedBy(result.transaction, prepared.transaction);
  } catch (err) {
    throw notSent(err);
  }
  hooks.onSigned?.({
    signature,
    transaction: result.transaction,
    lastValidBlockHeight: prepared.lastValidBlockHeight,
  });
  let accepted: string;
  try {
    accepted = await rpc.send(base64.encode(result.transaction));
  } catch (err) {
    throw new SendError(
      `Solana did not confirm that it accepted the signed transaction: ${errorMessage(err) ?? 'unknown error'}`,
      'uncertain',
      signature,
      { cause: err }
    );
  }
  return isSolanaSignature(accepted) ? accepted : signature;
}

export async function resendSignedTransaction(
  signed: Pick<SignedSolanaSend, 'signature' | 'transaction'>,
  rpc: SolanaRpc = defaultRpc()
): Promise<string> {
  if (signatureOf(signed.transaction) !== signed.signature)
    throw new Error('The saved transaction does not match its signature');
  await rpc.send(base64.encode(signed.transaction));
  return signed.signature;
}

export type SolanaSendCheck =
  | { status: 'landed' }
  | { status: 'failed'; reason: string }
  | { status: 'expired' }
  | { status: 'pending' };

export async function checkSolanaSend(
  sent: { signature: string; lastValidBlockHeight: bigint | null },
  rpc: SolanaRpc = defaultRpc()
): Promise<SolanaSendCheck> {
  const status = await rpc.signatureStatus(sent.signature);
  if (status !== null)
    return status.err === null ? { status: 'landed' } : { status: 'failed', reason: status.err };
  if (sent.lastValidBlockHeight === null) return { status: 'pending' };
  const height = await rpc.blockHeight();
  if (height <= sent.lastValidBlockHeight) return { status: 'pending' };
  const again = await rpc.signatureStatus(sent.signature);
  if (again !== null)
    return again.err === null ? { status: 'landed' } : { status: 'failed', reason: again.err };
  return { status: 'expired' };
}

export type SolanaPayOffer =
  | { status: 'ready'; url: string; matrix: boolean[][] }
  | { status: 'unavailable'; reason: string };

const NO_TOKEN_ACCOUNT =
  'A Solana Pay link cannot be offered: this deposit address has no token account yet, and Solana Pay wallets are not required to create one. Send it from your wallet by hand, or connect a Solana wallet above.';

export async function solanaPayOffer(
  input: SolanaDepositInput,
  rpc: SolanaRpc = defaultRpc()
): Promise<SolanaPayOffer> {
  let url: string;
  try {
    const target = checkSolanaTarget(input);
    function reader(addresses: readonly string[]) {
      return rpc.accounts(addresses);
    }
    if (target.kind === 'spl') {
      if (!(await recipientTokenAccountReady(target, reader)))
        return { status: 'unavailable', reason: NO_TOKEN_ACCOUNT };
      url = solanaPayUrl({
        recipient: target.recipient,
        amount: input.amount,
        decimals: target.decimals,
        mint: target.mint,
      });
    } else {
      const [recipient] = await reader([target.recipient]);
      if (!recipient && target.amount < (await rpc.rentExemptMinimum(0)))
        return {
          status: 'unavailable',
          reason:
            'A Solana Pay link cannot be offered: this amount is below what Solana requires to open the deposit address.',
        };
      url = solanaPayUrl({
        recipient: target.recipient,
        amount: input.amount,
        decimals: 9,
        mint: null,
      });
    }
  } catch (err) {
    return {
      status: 'unavailable',
      reason: `A Solana Pay link cannot be offered: ${errorMessage(err) ?? 'the deposit address could not be checked'}`,
    };
  }
  return { status: 'ready', url, matrix: encode(url, { ecc: 'M', border: 0 }).data };
}
