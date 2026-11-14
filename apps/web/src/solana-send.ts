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
import { type SolanaAccount, isSolanaSignature } from './source-wallet.js';

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

export async function sendSolanaDeposit(
  input: SolanaDepositInput,
  account: SolanaAccount,
  rpc: SolanaRpc = defaultRpc()
): Promise<string> {
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

  const result = await account.sender.send(transfer.transaction);
  if (result.kind === 'sent') {
    if (!isSolanaSignature(result.signature))
      throw new Error('The wallet did not return a transaction signature');
    return result.signature;
  }
  if (!sameMessage(result.transaction, transfer.transaction))
    throw new Error('The wallet changed the transaction before signing it. Nothing was sent.');
  const signature = signatureOf(result.transaction);
  let accepted: string;
  try {
    accepted = await rpc.send(base64.encode(result.transaction));
  } catch (err) {
    throw new Error(
      `Solana did not accept the signed transaction: ${errorMessage(err) ?? 'unknown error'}`
    );
  }
  return isSolanaSignature(accepted) ? accepted : signature;
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
