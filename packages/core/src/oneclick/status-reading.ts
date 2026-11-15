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
