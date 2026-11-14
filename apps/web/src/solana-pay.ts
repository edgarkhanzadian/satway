import { isSolanaAddress } from './source-wallet.js';

export function formatUnits(amount: bigint, decimals: number): string {
  if (amount < 0n) throw new Error('Amount must not be negative');
  if (!Number.isInteger(decimals) || decimals < 0) throw new Error('Invalid number of decimals');
  const digits = amount.toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, '');
  return fraction === '' ? whole : `${whole}.${fraction}`;
}

export interface SolanaPayRequest {
  recipient: string;
  amount: string;
  decimals: number;
  mint: string | null;
}

export function solanaPayUrl(request: SolanaPayRequest): string {
  if (!isSolanaAddress(request.recipient)) throw new Error('Recipient is not a Solana address');
  if (!/^[1-9][0-9]*$/.test(request.amount)) throw new Error('Amount must be a positive integer');
  if (request.mint !== null && !isSolanaAddress(request.mint))
    throw new Error('Token mint address is not valid');
  const amount = formatUnits(BigInt(request.amount), request.decimals);
  const token = request.mint === null ? '' : `&spl-token=${request.mint}`;
  return `solana:${request.recipient}?amount=${amount}${token}`;
}
