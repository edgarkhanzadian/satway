import {
  OneClickClient,
  type OneClickStatusResponse,
  type ReclaimOption,
  type ReclaimPlan,
  buildReclaimPsbt,
  MAINNET_CONFIG as config,
  destinationTxHashesOf,
  fetchDeposit,
  fetchDepositOutputs,
  fetchLimits,
  fetchTipHeight,
  findReclaimOption,
  isOutputSpent,
  outpointOf,
  parseWith,
  planReclaim,
  priorOutputsOf,
  quotedSatsOf,
  reclaimAmountProblem,
  reportedAmountOutOf,
  selectPayout,
  signReclaimPsbt,
  z,
} from '@satway/core';

import { loadEnv, optional } from './lib/env.js';
import { contextOfProof, loadProof, reclaimKeyFromEnv } from './lib/proof.js';

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
      'Usage: pnpm reclaim [record] --to <yourBitcoinAddress> [--outpoint <txid:vout>] [--fee-rate <sat/vB>] [--broadcast]'
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
  const option = await chooseOutput(record);
  const payout = option.output;
  console.log(`Output   ${outpointOf(payout)}  ${payout.amountSats} sats`);

  if (await isOutputSpent(config.btcApiUrl, payout.txid, payout.vout)) {
    const known = await fetchDeposit(config.sbtcApiUrl, payout.txid, payout.vout);
    console.error(
      `That output is already spent${known ? ` (sBTC API status: ${known.status})` : ''}. Choose another with --outpoint, if any is listed.`
    );
    process.exit(1);
  }
  if (!payout.confirmed || payout.blockHeight === null) {
    console.error('That output is not confirmed yet. The timelock starts at confirmation.');
    process.exit(1);
  }

  const tip = await fetchTipHeight(config.btcApiUrl);
  const confirmations = tip - payout.blockHeight + 1;
  const remaining = record.reclaimLockBlocks - confirmations;
  console.log(`Timelock ${confirmations} of ${record.reclaimLockBlocks} confirmations`);

  const feeRateFlag = flag('--fee-rate');
  const feeRate =
    (feeRateFlag === undefined ? 0 : Number(feeRateFlag)) || (await recommendedFeeRate());
  const tooSmall = reclaimAmountProblem(payout.amountSats, feeRate);
  if (tooSmall) {
    console.error(tooSmall);
    process.exit(1);
  }
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
  console.log('Other unspent outputs at the address, if any, need their own reclaim.');
}

function whenReclaimable(o: ReclaimOption): string {
  if (o.ready) return 'reclaimable now';
  if (o.blocksUntilReclaim === null) return 'unconfirmed';
  return `reclaimable in ${o.blocksUntilReclaim} blocks`;
}

function describeOption(o: ReclaimOption): string {
  return `  ${outpointOf(o.output)}  ${o.output.amountSats} sats  ${whenReclaimable(o)}`;
}

function listOptions(plan: ReclaimPlan): void {
  console.error('Unspent outputs at the deposit address:');
  for (const o of plan.options) console.error(describeOption(o));
}

async function swapStatus(swapAddress: string | undefined, memo: string | undefined) {
  if (!swapAddress) return null;
  const client = new OneClickClient(config.oneClickBaseUrl, { jwt: optional('ONECLICK_JWT') });
  try {
    return await client.status(swapAddress, memo);
  } catch {
    return null;
  }
}

async function chooseOutput(record: Parameters<typeof contextOfProof>[0]): Promise<ReclaimOption> {
  const ctx = contextOfProof(record);
  const quote = record.quoteResponse.quote;
  const status: OneClickStatusResponse | null = await swapStatus(
    quote.depositAddress,
    quote.depositMemo
  );
  const [fetched, tip, limits] = await Promise.all([
    fetchDepositOutputs(config.btcApiUrl, ctx.depositAddress, ctx.depositScriptPubKey, {
      txids: destinationTxHashesOf(status),
      history: 'always',
    }),
    fetchTipHeight(config.btcApiUrl),
    fetchLimits(config.sbtcApiUrl).catch(() => null),
  ]);
  if (fetched.truncated) console.log('Note     address history truncated; older outputs unchecked');
  const selection = selectPayout({
    outputs: fetched.outputs,
    prior: priorOutputsOf(ctx),
    minAmountOutSats: quotedSatsOf(ctx.minAmountOut),
    reportedAmountOutSats: reportedAmountOutOf(status),
    destinationTxHashes: destinationTxHashesOf(status),
    perDepositMinimum: limits?.perDepositMinimum ?? null,
    swapStatus: status?.status ?? null,
  });
  const plan = planReclaim({
    outputs: fetched.outputs,
    selected: selection.payout,
    tipHeight: tip,
    reclaimLockBlocks: record.reclaimLockBlocks,
  });
  if (plan.nothingLeft) {
    console.error('No unspent BTC is at the deposit address. Nothing to reclaim.');
    process.exit(1);
  }
  const requested = flag('--outpoint');
  if (requested !== undefined) {
    const found = findReclaimOption(plan, requested);
    if (!found) {
      console.error(`${requested} is not an unspent output of the deposit address.`);
      listOptions(plan);
      process.exit(1);
    }
    return found;
  }
  if (plan.target) {
    console.log(`Payout   selected by ${selection.basis ?? 'unknown'}`);
    return plan.target;
  }
  console.error(
    selection.payout
      ? 'The payout of this deposit has already been spent. Pick an output explicitly with --outpoint <txid:vout>.'
      : 'Could not tell which output is this deposit’s payout. Pick one explicitly with --outpoint <txid:vout>.'
  );
  listOptions(plan);
  process.exit(1);
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
