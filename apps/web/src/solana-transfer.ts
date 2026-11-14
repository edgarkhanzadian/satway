import { SYSTEM_PROGRAM_ADDRESS, getTransferSolInstruction } from '@solana-program/system';
import {
  AccountState,
  type Mint,
  TOKEN_PROGRAM_ADDRESS,
  type Token,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getMintDecoder,
  getTokenDecoder,
  getTransferCheckedInstruction,
} from '@solana-program/token';
import {
  type Address,
  type Instruction,
  address,
  appendTransactionMessageInstructions,
  blockhash,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';

import type { OneClickToken } from '@stxonector/core';

import { formatUnits } from './solana-pay.js';
import type { LatestBlockhash, RawAccount } from './solana-rpc.js';
import { isSolanaAddress } from './source-wallet.js';

export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const NATIVE_SOL_DECIMALS = 9;

const U64_MAX = 2n ** 64n - 1n;

export interface SolanaTransferInput {
  token: OneClickToken;
  sender: string;
  recipient: string;
  amount: string;
  memo?: string | undefined;
}

export type SolanaTransferRequest =
  | { kind: 'native'; sender: Address; recipient: Address; amount: bigint; symbol: string }
  | {
      kind: 'spl';
      sender: Address;
      recipient: Address;
      amount: bigint;
      symbol: string;
      mint: Address;
      decimals: number;
    };

export type ReadAccounts = (addresses: readonly string[]) => Promise<(RawAccount | null)[]>;

export interface SolanaTransfer {
  transaction: Uint8Array;
  request: SolanaTransferRequest;
  createsRecipientTokenAccount: boolean;
  recipientTokenAccount: Address | null;
}

const SEND_YOURSELF = 'Send the funds from your wallet yourself instead.';

function looksLikeSplAsset(assetId: string): boolean {
  return /^nep141:sol-/.test(assetId) || /^1cs_v1:sol:spl:/.test(assetId);
}

export type SolanaDepositTarget =
  | { kind: 'native'; recipient: Address; amount: bigint; symbol: string }
  | {
      kind: 'spl';
      recipient: Address;
      amount: bigint;
      symbol: string;
      mint: Address;
      decimals: number;
    };

export function checkSolanaTarget(input: Omit<SolanaTransferInput, 'sender'>): SolanaDepositTarget {
  const { token } = input;
  if (token.blockchain !== 'sol')
    throw new Error(`Sending from a Solana wallet is not supported on ${token.blockchain}`);
  if (input.memo !== undefined && input.memo !== '')
    throw new Error(
      `This quote asks for a deposit memo, which this app does not add to Solana transfers. ${SEND_YOURSELF}`
    );
  if (!isSolanaAddress(input.recipient))
    throw new Error('The swap deposit address is not a Solana address');
  if (!/^[1-9][0-9]*$/.test(input.amount)) throw new Error('Amount must be a positive integer');
  const amount = BigInt(input.amount);
  if (amount > U64_MAX) throw new Error('Amount is too large for a Solana transfer');
  const recipient = address(input.recipient);

  const contract = token.contractAddress;
  if (contract === undefined || contract === '') {
    if (looksLikeSplAsset(token.assetId))
      throw new Error(`The token list has no mint address for ${token.symbol}. ${SEND_YOURSELF}`);
    if (token.decimals !== NATIVE_SOL_DECIMALS)
      throw new Error('The token list gives native SOL the wrong number of decimals');
    return { kind: 'native', recipient, amount, symbol: token.symbol };
  }
  if (!isSolanaAddress(contract)) throw new Error('Token mint address is not valid');
  const listed = /^1cs_v1:sol:spl:(.+)$/.exec(token.assetId)?.[1];
  if (listed !== undefined && listed !== contract)
    throw new Error('The token list gives two different mints for this asset');
  if (!Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 255)
    throw new Error('The token list gives an invalid number of decimals');
  return {
    kind: 'spl',
    recipient,
    amount,
    symbol: token.symbol,
    mint: address(contract),
    decimals: token.decimals,
  };
}

export function checkSolanaTransfer(input: SolanaTransferInput): SolanaTransferRequest {
  const target = checkSolanaTarget(input);
  if (!isSolanaAddress(input.sender)) throw new Error('Sender is not a Solana address');
  if (input.sender === input.recipient)
    throw new Error('The swap deposit address is your own wallet. Nothing was sent.');
  return { ...target, sender: address(input.sender) };
}

export async function recipientTokenAccountReady(
  target: Extract<SolanaDepositTarget, { kind: 'spl' }>,
  readAccounts: ReadAccounts
): Promise<boolean> {
  const [mint] = await readAccounts([target.mint]);
  checkMint(mint ?? null, target.decimals);
  const ata = await associatedTokenAccount(target.recipient, target.mint);
  const [account] = await readAccounts([ata]);
  if (!account) return false;
  checkHeldBy(readTokenAccount(account), target.mint, target.recipient, 'deposit');
  return true;
}

export async function associatedTokenAccount(owner: string, mint: string): Promise<Address> {
  const [ata] = await findAssociatedTokenPda({
    owner: address(owner),
    mint: address(mint),
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  return ata;
}

function readMint(data: Uint8Array): Mint {
  if (data.length !== 82) throw new Error('The token mint account could not be read');
  let decoded: Mint | null = null;
  try {
    decoded = getMintDecoder().decode(data);
  } catch {
    decoded = null;
  }
  if (!decoded?.isInitialized) throw new Error('The token mint account could not be read');
  return decoded;
}

export function checkMint(account: RawAccount | null, expectedDecimals: number): void {
  if (!account) throw new Error('The token mint does not exist on Solana');
  if (account.owner === TOKEN_2022_PROGRAM)
    throw new Error(
      `This token uses the Token-2022 program, whose fees and transfer hooks can change the amount that arrives. ${SEND_YOURSELF}`
    );
  if (account.owner !== TOKEN_PROGRAM_ADDRESS)
    throw new Error('The token mint is not an SPL token');
  const decoded = readMint(account.data);
  if (decoded.decimals !== expectedDecimals)
    throw new Error(
      `The token list says ${expectedDecimals} decimals but the mint on Solana has ${decoded.decimals}. ${SEND_YOURSELF}`
    );
}

export function readTokenAccount(account: RawAccount): Token {
  if (account.owner !== TOKEN_PROGRAM_ADDRESS || account.data.length !== 165)
    throw new Error('A token account could not be read');
  try {
    return getTokenDecoder().decode(account.data);
  } catch {
    throw new Error('A token account could not be read');
  }
}

function checkHeldBy(token: Token, mint: Address, owner: Address, who: string): void {
  if (token.mint !== mint || token.owner !== owner)
    throw new Error(`The ${who} token account does not match the token or its owner`);
  if (token.state === AccountState.Frozen) throw new Error(`The ${who} token account is frozen`);
  if (token.state !== AccountState.Initialized)
    throw new Error(`The ${who} token account is not initialized`);
}

function compile(
  feePayer: Address,
  latest: LatestBlockhash,
  instructions: readonly Instruction[]
): Uint8Array {
  const message = pipe(
    createTransactionMessage({ version: 'legacy' }),
    m => setTransactionMessageFeePayerSigner(createNoopSigner(feePayer), m),
    m =>
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: blockhash(latest.blockhash),
          lastValidBlockHeight: latest.lastValidBlockHeight,
        },
        m
      ),
    m => appendTransactionMessageInstructions(instructions, m)
  );
  return Uint8Array.from(getTransactionEncoder().encode(compileTransaction(message)));
}

export async function buildSolanaTransfer(
  input: SolanaTransferInput,
  readAccounts: ReadAccounts,
  latest: LatestBlockhash
): Promise<SolanaTransfer> {
  const request = checkSolanaTransfer(input);
  const signer = createNoopSigner(request.sender);

  if (request.kind === 'native') {
    const [sender] = await readAccounts([request.sender]);
    if (!sender || sender.owner !== SYSTEM_PROGRAM_ADDRESS)
      throw new Error('Your Solana wallet has no SOL to send');
    if (sender.lamports < request.amount)
      throw new Error(
        `Your wallet holds ${formatUnits(sender.lamports, NATIVE_SOL_DECIMALS)} SOL, less than the ${formatUnits(request.amount, NATIVE_SOL_DECIMALS)} SOL this deposit needs`
      );
    const transfer = getTransferSolInstruction({
      source: signer,
      destination: request.recipient,
      amount: request.amount,
    });
    return {
      transaction: compile(request.sender, latest, [transfer]),
      request,
      createsRecipientTokenAccount: false,
      recipientTokenAccount: null,
    };
  }

  const [mint] = await readAccounts([request.mint]);
  checkMint(mint ?? null, request.decimals);
  const senderAta = await associatedTokenAccount(request.sender, request.mint);
  const recipientAta = await associatedTokenAccount(request.recipient, request.mint);
  const [sender, source, destination] = await readAccounts([
    request.sender,
    senderAta,
    recipientAta,
  ]);
  if (!sender || sender.owner !== SYSTEM_PROGRAM_ADDRESS)
    throw new Error('Your Solana wallet has no SOL to pay the network fee');
  if (!source)
    throw new Error(
      `Your wallet has no ${request.symbol} token account for this mint. ${SEND_YOURSELF}`
    );
  const held = readTokenAccount(source);
  checkHeldBy(held, request.mint, request.sender, 'sender');
  if (held.amount < request.amount)
    throw new Error(
      `Your wallet holds ${formatUnits(held.amount, request.decimals)} ${request.symbol}, less than the ${formatUnits(request.amount, request.decimals)} ${request.symbol} this deposit needs`
    );
  if (destination)
    checkHeldBy(readTokenAccount(destination), request.mint, request.recipient, 'deposit');

  const instructions: Instruction[] = [];
  if (!destination) {
    instructions.push(
      getCreateAssociatedTokenIdempotentInstruction({
        payer: signer,
        ata: recipientAta,
        owner: request.recipient,
        mint: request.mint,
        systemProgram: SYSTEM_PROGRAM_ADDRESS,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      })
    );
  }
  instructions.push(
    getTransferCheckedInstruction({
      source: senderAta,
      mint: request.mint,
      destination: recipientAta,
      authority: signer,
      amount: request.amount,
      decimals: request.decimals,
    })
  );
  return {
    transaction: compile(request.sender, latest, instructions),
    request,
    createsRecipientTokenAccount: !destination,
    recipientTokenAccount: recipientAta,
  };
}

export function messageOf(transaction: Uint8Array): Uint8Array {
  const count = transaction[0];
  if (count === undefined || count === 0 || count > 127)
    throw new Error('Not a single-signer Solana transaction');
  return transaction.subarray(1 + count * 64);
}

export function sameMessage(a: Uint8Array, b: Uint8Array): boolean {
  const left = messageOf(a);
  const right = messageOf(b);
  return left.length === right.length && left.every((byte, i) => byte === right[i]);
}
