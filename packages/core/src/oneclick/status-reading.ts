import type { OneClickStatusResponse } from './oneclick.js';

const TX_HASH = /^(?:0x)?([0-9a-f]{64})$/;

export function normalizeTxHash(hash: string): string | null {
  const match = TX_HASH.exec(hash.trim().toLowerCase());
  return match?.[1] ?? null;
}

export function destinationTxHashesOf(status: OneClickStatusResponse | null): string[] {
  if (!status) return [];
  const hashes = status.swapDetails.destinationChainTxHashes.map(h => normalizeTxHash(h.hash));
  return [...new Set(hashes.filter(h => h !== null))];
}

function satsOf(text: string | undefined | null): number | null {
  if (text === undefined || text === null || !/^\d+$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : null;
}

export function reportedAmountOutOf(status: OneClickStatusResponse | null): number | null {
  return satsOf(status?.swapDetails.amountOut);
}

export function quotedSatsOf(text: string): number | null {
  return satsOf(text);
}

const BASE_UNITS = /^\d+$/;

export function remainingDepositOf(
  status: OneClickStatusResponse | null,
  amountIn: string
): bigint | null {
  const deposited = status?.swapDetails.depositedAmount;
  if (status?.status !== 'INCOMPLETE_DEPOSIT' || deposited === undefined) return null;
  if (!BASE_UNITS.test(deposited) || !BASE_UNITS.test(amountIn)) return null;
  const owed = BigInt(amountIn) - BigInt(deposited);
  return BigInt(deposited) > 0n && owed > 0n ? owed : null;
}

const DECIMAL_TEXT = /^(\d+)(?:\.(\d+))?$/;

export function formattedAmountMatches(
  baseUnits: string,
  formatted: string,
  decimals: number
): boolean {
  const match = DECIMAL_TEXT.exec(formatted);
  if (!match || !BASE_UNITS.test(baseUnits)) return false;
  const whole = match[1] ?? '';
  const fraction = (match[2] ?? '').replace(/0+$/, '');
  if (fraction.length > decimals) return false;
  return BigInt(whole + fraction.padEnd(decimals, '0')) === BigInt(baseUnits);
}

export function formatBaseUnits(units: bigint, decimals: number): string {
  const digits = units.toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, '');
  return `${whole}.${fraction === '' ? '0' : fraction}`;
}
