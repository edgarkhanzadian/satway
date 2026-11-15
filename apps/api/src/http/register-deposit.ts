import {
  type FetchLike,
  depositAddressFromScripts,
  signerKeyOfDepositScript,
  snapshotOutpoints,
} from '@portage/core';

import {
  type KV,
  MAX_REGISTRATIONS_PER_ADDRESS,
  type WatchRegistration,
  type WatchedDeposit,
  getWatched,
  putWatched,
  registrationsOf,
} from '../store/index.js';
import { BadRequest } from './proxy.js';

const HEX = /^[0-9a-f]+$/;
const SNAPSHOT_PAGES = 4;
const RETRY_WINDOW_MS = 10 * 60 * 1000;

function hexScript(name: string, value: unknown): string {
  if (typeof value !== 'string' || value.length < 12 || value.length > 400 || !HEX.test(value)) {
    throw new BadRequest(`"${name}" must be lowercase hex`);
  }
  return value;
}

function swapAddressOf(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) {
    throw new BadRequest('"swapDepositAddress" must be a short string');
  }
  return value;
}

function samePrior(a: WatchRegistration, b: WatchRegistration): boolean {
  return JSON.stringify(a.priorOutpoints) === JSON.stringify(b.priorOutpoints);
}

function isRepeat(existing: readonly WatchRegistration[], next: WatchRegistration): boolean {
  if (next.swapDepositAddress !== undefined) {
    return existing.some(r => r.swapDepositAddress === next.swapDepositAddress);
  }
  const last = existing.at(-1);
  return (
    last !== undefined &&
    last.swapDepositAddress === undefined &&
    samePrior(last, next) &&
    Date.parse(next.createdAt) - Date.parse(last.createdAt) < RETRY_WINDOW_MS
  );
}

export async function registerDeposit(
  kv: KV,
  body: unknown,
  deps: { btcApiUrl: string; fetchFn?: FetchLike; now?: Date }
): Promise<{ address: string }> {
  if (typeof body !== 'object' || body === null) throw new BadRequest('Body must be a JSON object');
  const { depositScript, reclaimScript, swapDepositAddress }: Record<string, unknown> = {
    ...body,
  };
  const deposit = hexScript('depositScript', depositScript);
  const reclaim = hexScript('reclaimScript', reclaimScript);
  const swap = swapAddressOf(swapDepositAddress);
  if (!signerKeyOfDepositScript(deposit))
    throw new BadRequest('"depositScript" is not an sBTC deposit script');

  let derived: { address: string; scriptPubKey: string };
  try {
    derived = depositAddressFromScripts(deposit, reclaim);
  } catch {
    throw new BadRequest('Scripts do not form a valid deposit address');
  }
  const now = deps.now ?? new Date();
  const existing = await getWatched(kv, derived.address);
  const known =
    existing && existing.depositScript === deposit && existing.reclaimScript === reclaim
      ? existing
      : null;

  let snapshot: { outpoints: string[]; truncated: boolean } | null = null;
  try {
    snapshot = await snapshotOutpoints(deps.btcApiUrl, derived.address, derived.scriptPubKey, {
      maxPages: SNAPSHOT_PAGES,
      fetchFn: deps.fetchFn,
    });
  } catch {
    snapshot = null;
  }
  const alreadyRegistered = (known?.registered ?? []).map(r => r.outpoint);
  const registration: WatchRegistration = {
    createdAt: now.toISOString(),
    priorOutpoints: snapshot
      ? [...new Set([...snapshot.outpoints, ...alreadyRegistered])].sort()
      : null,
    ...(snapshot?.truncated ? { priorTruncated: true } : {}),
    ...(swap === undefined ? {} : { swapDepositAddress: swap }),
  };

  const previous = known ? registrationsOf(known) : [];
  if (known && isRepeat(previous, registration)) return { address: derived.address };
  const record: WatchedDeposit = {
    depositScript: deposit,
    reclaimScript: reclaim,
    createdAt: known?.createdAt ?? registration.createdAt,
    registrations: [...previous, registration].slice(-MAX_REGISTRATIONS_PER_ADDRESS),
    registered: known?.registered ?? [],
  };
  await putWatched(kv, derived.address, record, now);
  return { address: derived.address };
}
