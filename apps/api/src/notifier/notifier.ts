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
} from '@portage/core';

import {
  type KV,
  type RegisteredOutput,
  type WatchedDeposit,
  deleteWatched,
  listWatched,
  putWatched,
  registrationsOf,
} from '../store/index.js';

type Endpoints = Pick<NetworkConfig, 'btcApiUrl' | 'sbtcApiUrl' | 'reclaimLockBlocks'>;

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
