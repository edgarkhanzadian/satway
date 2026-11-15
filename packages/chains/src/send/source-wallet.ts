import { type OneClickToken, errorMessage, parseWith, z } from '@satway/core';

import {
  EVM_CHAIN_IDS,
  EVM_NATIVE_DECIMALS,
  chainFamily,
  isKnownEvmNative,
  isSolanaSignature,
} from '../metadata/index.js';

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export interface EvmWalletOption {
  id: string;
  name: string;
  provider: Eip1193Provider;
}

export type SolanaSendResult =
  | { kind: 'sent'; signature: string }
  | { kind: 'signed'; transaction: Uint8Array };

export interface SolanaSender {
  send(transaction: Uint8Array): Promise<SolanaSendResult>;
}

export interface SolanaAccount {
  address: string;
  sender: SolanaSender;
}

export type SourceWallet =
  | {
      kind: 'evm';
      name: string;
      address: string;
      provider: Eip1193Provider;
      solana?: SolanaAccount;
    }
  | { kind: 'solana'; name: string; address: string; sender?: SolanaSender };

export function walletAddressFor(
  wallet: SourceWallet | null,
  family: 'evm' | 'solana' | 'other'
): string | null {
  if (!wallet || family === 'other') return null;
  if (wallet.kind === family) return wallet.address;
  if (wallet.kind === 'evm' && family === 'solana') return wallet.solana?.address ?? null;
  return null;
}

export function solanaSenderOf(wallet: SourceWallet | null): SolanaAccount | null {
  if (wallet?.kind === 'solana')
    return wallet.sender ? { address: wallet.address, sender: wallet.sender } : null;
  return wallet?.solana ?? null;
}

export function walletCovers(
  wallet: SourceWallet | null,
  token: OneClickToken | undefined
): boolean {
  return Boolean(token && walletAddressFor(wallet, chainFamily(token.blockchain)) !== null);
}

export interface RefundField {
  value: string;
  autofilled: string | null;
}

export function nextRefundField(field: RefundField, walletAddress: string | null): RefundField {
  if (walletAddress !== null) return { value: walletAddress, autofilled: walletAddress };
  if (field.autofilled !== null && field.value === field.autofilled)
    return { value: '', autofilled: null };
  return { value: field.value, autofilled: null };
}

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

export function isSentTxFor(family: 'evm' | 'solana' | 'other', value: string): boolean {
  if (family === 'evm') return TX_HASH.test(value);
  if (family === 'solana') return isSolanaSignature(value);
  return false;
}

export type SendPhase = 'not-sent' | 'rejected' | 'uncertain';

export class SendError extends Error {
  constructor(
    message: string,
    readonly phase: SendPhase,
    readonly tx: string | null = null,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'SendError';
  }
}

const USER_REJECTED_CODES: ReadonlySet<unknown> = new Set([4001, 5000]);

export function isUserRejection(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('code' in err)) return false;
  return USER_REJECTED_CODES.has(err.code);
}

export function walletFailure(err: unknown, fallback: string, tx: string | null = null): SendError {
  if (err instanceof SendError) return err;
  const message = errorMessage(err) || fallback;
  if (isUserRejection(err)) return new SendError(message, 'rejected', null, { cause: err });
  return new SendError(message, 'uncertain', tx, { cause: err });
}

export function signOnlyFailure(err: unknown): SendError {
  if (err instanceof SendError) return err;
  const message = errorMessage(err) || 'The wallet did not sign the transaction';
  return new SendError(message, isUserRejection(err) ? 'rejected' : 'not-sent', null, {
    cause: err,
  });
}

export function notSent(err: unknown): SendError {
  if (err instanceof SendError) return err;
  const phase = isUserRejection(err) ? 'rejected' : 'not-sent';
  return new SendError(errorMessage(err) || 'Nothing was sent', phase, null, { cause: err });
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function word(hexNoPrefix: string): string {
  return hexNoPrefix.toLowerCase().padStart(64, '0');
}

export function encodeErc20Transfer(to: string, amount: bigint): string {
  if (!EVM_ADDRESS.test(to)) throw new Error('Recipient is not an EVM address');
  if (amount <= 0n) throw new Error('Amount must be greater than zero');
  return `0xa9059cbb${word(to.slice(2))}${word(amount.toString(16))}`;
}

export interface EvmTransfer {
  chainId: number;
  tx: { from: string; to: string; value: string; data?: string };
}

const SEND_MANUALLY = 'Send the funds from your wallet yourself instead.';

function checkTokenListing(token: OneClickToken, chainId: number, contract: string): void {
  const embedded = token.assetId.match(/0x[0-9a-fA-F]+/g) ?? [];
  if (embedded.some(hex => hex.toLowerCase() !== contract.toLowerCase()))
    throw new Error(
      `The token list gives two different contract addresses for ${token.symbol}. ${SEND_MANUALLY}`
    );
  const omniChain = /^nep245:v2_1\.omni\.hot\.tg:(\d+)_/.exec(token.assetId)?.[1];
  if (omniChain !== undefined && Number(omniChain) !== chainId)
    throw new Error(
      `The token list puts ${token.symbol} on a different network than ${token.blockchain}. ${SEND_MANUALLY}`
    );
}

export function buildEvmTransfer(input: {
  token: OneClickToken;
  from: string;
  to: string;
  amount: string;
}): EvmTransfer {
  const { token } = input;
  const chainId = EVM_CHAIN_IDS[token.blockchain];
  if (chainId === undefined)
    throw new Error(`Sending from a wallet is not supported on ${token.blockchain}`);
  if (!EVM_ADDRESS.test(input.from)) throw new Error('Sender is not an EVM address');
  if (!EVM_ADDRESS.test(input.to))
    throw new Error('The swap deposit address is not an EVM address');
  if (!/^[1-9][0-9]*$/.test(input.amount)) throw new Error('Amount must be a positive integer');
  const amount = BigInt(input.amount);

  const contract = token.contractAddress;
  const native = isKnownEvmNative(token);
  if (contract === undefined || contract === '') {
    if (!native)
      throw new Error(
        `The token list has no contract address for ${token.symbol} on ${token.blockchain}, and it is not a known native coin. ${SEND_MANUALLY}`
      );
    if (token.decimals !== EVM_NATIVE_DECIMALS)
      throw new Error(
        `The token list gives ${token.symbol} the wrong number of decimals for a native coin. ${SEND_MANUALLY}`
      );
    return { chainId, tx: { from: input.from, to: input.to, value: `0x${amount.toString(16)}` } };
  }
  if (native)
    throw new Error(
      `The token list gives a contract address for the native coin ${token.symbol}. ${SEND_MANUALLY}`
    );
  if (!EVM_ADDRESS.test(contract)) throw new Error('Token contract address is not valid');
  checkTokenListing(token, chainId, contract);
  return {
    chainId,
    tx: {
      from: input.from,
      to: contract,
      value: '0x0',
      data: encodeErc20Transfer(input.to, amount),
    },
  };
}

const chainIdSchema = z.string();
const accountsSchema = z.array(z.string());

async function walletResult<T>(
  provider: Eip1193Provider,
  method: string,
  schema: z.ZodType<T>
): Promise<T> {
  return parseWith(schema, await provider.request({ method }), `the wallet (${method})`);
}

async function prepareEvmWallet(provider: Eip1193Provider, transfer: EvmTransfer): Promise<void> {
  const wanted = `0x${transfer.chainId.toString(16)}`;
  const current = await walletResult(provider, 'eth_chainId', chainIdSchema);
  if (BigInt(current) !== BigInt(wanted)) {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: wanted }] });
    const after = await walletResult(provider, 'eth_chainId', chainIdSchema);
    if (BigInt(after) !== BigInt(wanted))
      throw new Error('The wallet did not switch to the required network');
  }
  const accounts = await walletResult(provider, 'eth_accounts', accountsSchema);
  if (!accounts.some(a => a.toLowerCase() === transfer.tx.from.toLowerCase())) {
    throw new Error('The connected wallet account changed. Reconnect and try again.');
  }
}

export async function sendFromEvm(
  provider: Eip1193Provider,
  transfer: EvmTransfer
): Promise<string> {
  try {
    await prepareEvmWallet(provider, transfer);
  } catch (err) {
    throw notSent(err);
  }
  let hash: unknown;
  try {
    hash = await provider.request({ method: 'eth_sendTransaction', params: [transfer.tx] });
  } catch (err) {
    throw walletFailure(err, 'The wallet did not confirm whether it sent the transaction');
  }
  if (typeof hash !== 'string' || !TX_HASH.test(hash)) {
    throw new SendError('The wallet did not return a transaction hash', 'uncertain');
  }
  return hash;
}

export type EvmTransactionState = 'succeeded' | 'reverted' | 'pending' | 'unknown';

const receiptSchema = z.looseObject({ status: z.string().optional() }).nullable();
const transactionSchema = z.looseObject({ hash: z.string().optional() }).nullable();

export async function evmTransactionState(
  provider: Eip1193Provider,
  hash: string
): Promise<EvmTransactionState> {
  const receipt = parseWith(
    receiptSchema,
    await provider.request({ method: 'eth_getTransactionReceipt', params: [hash] }),
    'the wallet (eth_getTransactionReceipt)'
  );
  if (receipt?.status === '0x1') return 'succeeded';
  if (receipt?.status === '0x0') return 'reverted';
  const transaction = parseWith(
    transactionSchema,
    await provider.request({ method: 'eth_getTransactionByHash', params: [hash] }),
    'the wallet (eth_getTransactionByHash)'
  );
  return transaction === null ? 'unknown' : 'pending';
}

export async function connectEvm(option: EvmWalletOption): Promise<SourceWallet> {
  const accounts = await walletResult(option.provider, 'eth_requestAccounts', accountsSchema);
  const address = accounts[0];
  if (!address || !EVM_ADDRESS.test(address))
    throw new Error('The wallet did not share an account');
  return { kind: 'evm', name: option.name, address, provider: option.provider };
}
