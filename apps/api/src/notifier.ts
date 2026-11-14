import {
  type FetchLike,
  type NetworkConfig,
  depositAddressFromScripts,
  errorMessage,
  fetchDeposit,
  findPayouts,
  notifyDeposit,
  signerKeyOfDepositScript,
} from '@stxonector/core';

import { BadRequest } from './proxy.js';
import { type KV, deleteWatched, listWatched, putWatched } from './store.js';

type Endpoints = Pick<NetworkConfig, 'btcApiUrl' | 'sbtcApiUrl'>;

const HEX = /^[0-9a-f]+$/;

function hexScript(name: string, value: unknown): string {
  if (typeof value !== 'string' || value.length < 12 || value.length > 400 || !HEX.test(value)) {
    throw new BadRequest(`"${name}" must be lowercase hex`);
  }
  return value;
}

export async function registerDeposit(
  kv: KV,
  body: unknown,
  now = new Date()
): Promise<{ address: string }> {
  if (typeof body !== 'object' || body === null) throw new BadRequest('Body must be a JSON object');
  const { depositScript, reclaimScript }: Record<string, unknown> = { ...body };
  const deposit = hexScript('depositScript', depositScript);
  const reclaim = hexScript('reclaimScript', reclaimScript);
  if (!signerKeyOfDepositScript(deposit))
    throw new BadRequest('"depositScript" is not an sBTC deposit script');

  let address: string;
  try {
    address = depositAddressFromScripts(deposit, reclaim).address;
  } catch {
    throw new BadRequest('Scripts do not form a valid deposit address');
  }
  await putWatched(kv, address, {
    depositScript: deposit,
    reclaimScript: reclaim,
    createdAt: now.toISOString(),
  });
  return { address };
}

export interface NotifierReport {
  watched: number;
  notified: { address: string; txid: string; vout: number }[];
  finished: string[];
  errors: { address: string; message: string }[];
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

  for (const { address, deposit } of watched) {
    try {
      const derived = depositAddressFromScripts(deposit.depositScript, deposit.reclaimScript);
      if (derived.address !== address) {
        await deleteWatched(kv, address);
        throw new Error('Stored scripts do not match the stored address; record dropped');
      }
      const payouts = await findPayouts(
        config.btcApiUrl,
        derived.address,
        derived.scriptPubKey,
        fetchFn
      );
      if (payouts.length === 0) continue;

      let allRegistered = true;
      for (const payout of payouts) {
        const known = await fetchDeposit(config.sbtcApiUrl, payout.txid, payout.vout, fetchFn);
        if (known) continue;
        allRegistered = false;
        await notifyDeposit(
          config.sbtcApiUrl,
          {
            bitcoinTxid: payout.txid,
            bitcoinTxOutputIndex: payout.vout,
            depositScript: deposit.depositScript,
            reclaimScript: deposit.reclaimScript,
          },
          fetchFn
        );
        report.notified.push({ address, txid: payout.txid, vout: payout.vout });
      }
      if (allRegistered) {
        await deleteWatched(kv, address);
        report.finished.push(address);
      }
    } catch (err) {
      report.errors.push({ address, message: errorMessage(err) ?? String(err) });
    }
  }
  return report;
}
