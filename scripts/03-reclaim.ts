import {
  buildReclaimPsbt,
  MAINNET_CONFIG as config,
  fetchDeposit,
  fetchTipHeight,
  findPayouts,
  isOutputSpent,
  parseWith,
  signReclaimPsbt,
  z,
} from '@stxonector/core';

import { loadEnv } from './lib/env.js';
import { loadProof, reclaimKeyFromEnv } from './lib/proof.js';

loadEnv();

const feesSchema = z.looseObject({ halfHourFee: z.number() });

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const positional = process.argv
    .slice(2)
    .filter((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'));
  const { path, record } = loadProof(positional[0]);
  const to = flag('--to');
  if (!to) {
    console.error(
      'Usage: pnpm reclaim [record] --to <yourBitcoinAddress> [--fee-rate <sat/vB>] [--broadcast]'
    );
    process.exit(1);
  }
  const broadcast = process.argv.includes('--broadcast');

  const { privateKey, publicKey } = reclaimKeyFromEnv();
  if (publicKey !== record.reclaimPublicKey) {
    console.error('TEST_BTC_WIF is not the reclaim key this deposit was built with.');
    process.exit(1);
  }

  console.log(`Record   ${path}`);
  console.log(`Address  ${record.deposit.address}`);
  const payouts = await findPayouts(
    config.btcApiUrl,
    record.deposit.address,
    record.deposit.scriptPubKey
  );
  const payout = payouts[0];
  if (!payout) {
    console.error('No BTC has arrived at the deposit address. Nothing to reclaim.');
    process.exit(1);
  }
  console.log(`Payout   ${payout.txid}:${payout.vout}  ${payout.amountSats} sats`);

  if (await isOutputSpent(config.btcApiUrl, payout.txid, payout.vout)) {
    const known = await fetchDeposit(config.sbtcApiUrl, payout.txid, payout.vout);
    console.error(
      `That output is already spent${known ? ` (sBTC API status: ${known.status})` : ''}. Nothing to reclaim.`
    );
    process.exit(1);
  }
  if (!payout.confirmed || payout.blockHeight === null) {
    console.error('The payout is not confirmed yet. The timelock starts at confirmation.');
    process.exit(1);
  }

  const tip = await fetchTipHeight(config.btcApiUrl);
  const confirmations = tip - payout.blockHeight + 1;
  const remaining = record.reclaimLockBlocks - confirmations;
  console.log(`Timelock ${confirmations} of ${record.reclaimLockBlocks} confirmations`);

  const feeRateFlag = flag('--fee-rate');
  const feeRate =
    (feeRateFlag === undefined ? 0 : Number(feeRateFlag)) || (await recommendedFeeRate());
  const { psbtHex } = buildReclaimPsbt({
    payout,
    bitcoinAddress: to,
    stacksAddress: record.stacksAddress,
    reclaimPublicKey: record.reclaimPublicKey,
    signersPublicKey: record.signersPublicKey,
    maxSignerFeeSats: record.maxSignerFeeSats,
    reclaimLockBlocks: record.reclaimLockBlocks,
    feeRate,
  });
  const { txHex, txid } = signReclaimPsbt(psbtHex, privateKey);
  console.log(`Fee rate ${feeRate} sat/vB`);
  console.log(`Reclaim  ${txid}`);
  console.log(`\n${txHex}\n`);

  if (remaining > 0) {
    console.log(
      `Not broadcastable yet: ${remaining} more blocks (about ${Math.round((remaining * 10) / 60)} hours). The network will reject it until then.`
    );
    return;
  }
  if (!broadcast) {
    console.log('Timelock has passed. Re-run with --broadcast to send it.');
    return;
  }
  const res = await fetch(`${config.btcApiUrl}/tx`, { method: 'POST', body: txHex });
  const body = await res.text();
  if (!res.ok) {
    console.error(`Broadcast failed: ${body}`);
    process.exit(1);
  }
  console.log(`Broadcast. ${payout.amountSats} sats (minus fee) are on their way to ${to}.`);
}

async function recommendedFeeRate(): Promise<number> {
  const url = `${config.btcApiUrl}/v1/fees/recommended`;
  const res = await fetch(url);
  const fees = parseWith(feesSchema, await res.json(), url);
  return Math.max(1, fees.halfHourFee);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
