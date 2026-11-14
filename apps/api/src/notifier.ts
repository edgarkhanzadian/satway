import {
  type AddressOutput,
  type FetchLike,
  type NetworkConfig,
  type PriorOutputs,
  depositAddressFromScripts,
  errorMessage,
  fetchDeposit,
  fetchLimits,
  fetchTipHeight,
  fetchUnspentOutputs,
  isPriorOutput,
  notifyDeposit,
  outpointOf,
  outputsToRegister,
  priorOutputsOf,
  signerKeyOfDepositScript,
  snapshotOutpoints,
} from '@stxonector/core';

import { BadRequest } from './proxy.js';
import {
  type KV,
  MAX_REGISTRATIONS_PER_ADDRESS,
  type RegisteredOutput,
  type WatchRegistration,
  type WatchedDeposit,
  deleteWatched,
  getWatched,
  listWatched,
  putWatched,
  registrationsOf,
} from './store.js';

type Endpoints = Pick<NetworkConfig, 'btcApiUrl' | 'sbtcApiUrl' | 'reclaimLockBlocks'>;

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

export interface NotifierReport {
  watched: number;
  notified: { address: string; txid: string; vout: number }[];
  finished: string[];
  errors: { address: string; outpoint?: string; message: string }[];
}

function once<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    pending ??= load();
    return pending;
  };
}

function eligibleFor(output: RegisteredOutput, prior: PriorOutputs): boolean {
  const [txid = '', voutText = ''] = output.outpoint.split(':');
  return !isPriorOutput(
    { txid, vout: Number(voutText), confirmed: output.confirmed, blockTime: output.blockTime },
    prior
  );
}

export function watchSatisfied(deposit: WatchedDeposit): boolean {
  const known = deposit.registered ?? [];
  const regs = [...registrationsOf(deposit)].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const used = new Set<string>();
  for (const reg of regs) {
    const prior = priorOutputsOf({
      createdAt: reg.createdAt,
      priorOutpoints: reg.priorOutpoints ?? undefined,
      priorTruncated: reg.priorTruncated,
    });
    const match = known.find(o => !used.has(o.outpoint) && eligibleFor(o, prior));
    if (!match) return false;
    used.add(match.outpoint);
  }
  return true;
}

function registeredFrom(o: AddressOutput): RegisteredOutput {
  return { outpoint: outpointOf(o), confirmed: o.confirmed, blockTime: o.blockTime };
}

async function watchAddress(
  kv: KV,
  config: Endpoints,
  address: string,
  deposit: WatchedDeposit,
  shared: { minimum(): Promise<number | null>; tip(): Promise<number | null> },
  report: NotifierReport,
  fetchFn: FetchLike | undefined
): Promise<void> {
  const derived = depositAddressFromScripts(deposit.depositScript, deposit.reclaimScript);
  if (derived.address !== address) {
    await deleteWatched(kv, address);
    throw new Error('Stored scripts do not match the stored address; record dropped');
  }
  const priors = registrationsOf(deposit).map(r =>
    priorOutputsOf({
      createdAt: r.createdAt,
      priorOutpoints: r.priorOutpoints ?? undefined,
      priorTruncated: r.priorTruncated,
    })
  );
  const registered = new Map((deposit.registered ?? []).map(r => [r.outpoint, r]));
  const unspent = await fetchUnspentOutputs(config.btcApiUrl, derived.address, fetchFn);

  function isPrior(o: AddressOutput): boolean {
    return priors.every(p => isPriorOutput(o, p));
  }
  const fresh = unspent.filter(o => !isPrior(o) && !registered.has(outpointOf(o)));
  if (fresh.length > 0) {
    const minimum = await shared.minimum();
    if (minimum === null) {
      report.errors.push({ address, message: 'Could not read the sBTC deposit minimum' });
      return;
    }
    const candidates = outputsToRegister(fresh, {
      isPrior,
      minimumSats: minimum,
      tipHeight: await shared.tip(),
      reclaimLockBlocks: config.reclaimLockBlocks,
    });
    for (const output of candidates) {
      const outpoint = outpointOf(output);
      try {
        const known = await fetchDeposit(config.sbtcApiUrl, output.txid, output.vout, fetchFn);
        if (!known) {
          await notifyDeposit(
            config,
            {
              bitcoinTxid: output.txid,
              bitcoinTxOutputIndex: output.vout,
              depositScript: deposit.depositScript,
              reclaimScript: deposit.reclaimScript,
            },
            fetchFn
          );
          report.notified.push({ address, txid: output.txid, vout: output.vout });
        }
        registered.set(outpoint, registeredFrom(output));
      } catch (err) {
        report.errors.push({
          address,
          outpoint,
          message: `Registering ${outpoint} with the sBTC API failed: ${errorMessage(err) ?? String(err)}`,
        });
      }
    }
  }

  const next: WatchedDeposit = { ...deposit, registered: [...registered.values()] };
  if (watchSatisfied(next)) {
    await deleteWatched(kv, address);
    report.finished.push(address);
    return;
  }
  if (registered.size !== (deposit.registered ?? []).length) {
    await putWatched(kv, address, next);
  }
}

export async function runNotifier(
  kv: KV,
  config: Endpoints,
  fetchFn?: FetchLike
): Promise<NotifierReport> {
  const watched = await listWatched(kv);
  const report: NotifierReport = {
    watched: watched.length,
    notified: [],
    finished: [],
    errors: [],
  };
  const shared = {
    minimum: once(async () => {
      try {
        return (await fetchLimits(config.sbtcApiUrl, fetchFn)).perDepositMinimum;
      } catch {
        return null;
      }
    }),
    tip: once(async () => {
      try {
        return await fetchTipHeight(config.btcApiUrl, fetchFn);
      } catch {
        return null;
      }
    }),
  };

  for (const { address, deposit } of watched) {
    try {
      await watchAddress(kv, config, address, deposit, shared, report, fetchFn);
    } catch (err) {
      report.errors.push({ address, message: errorMessage(err) ?? String(err) });
    }
  }
  return report;
}
