import {
  OneClickClient,
  type OneClickStatusResponse,
  applyRegistrations,
  buildDepositAddress,
  buildQuoteRequest,
  checkDepositAmount,
  MAINNET_CONFIG as config,
  fetchLimits,
  fetchVerifiedSigners,
  observeDeposit,
  outpointOf,
  providerFeesOf,
  registerOutputs,
  snapshotOutpoints,
} from '@portage/core';

import { loadEnv, optional, required } from './lib/env.js';
import {
  type ProofRecord,
  contextOfProof,
  loadProof,
  log,
  reclaimKeyFromEnv,
  saveProof,
} from './lib/proof.js';

loadEnv();
const client = new OneClickClient(config.oneClickBaseUrl, { jwt: optional('ONECLICK_JWT') });

async function quote(args: string[]) {
  const notify = !args.includes('--no-notify');
  const [chain, symbol, usdText, refundTo] = args.filter(a => !a.startsWith('--'));
  if (!chain || !symbol || !usdText || !refundTo) {
    console.error(
      'Usage: pnpm deposit-proof quote <chain> <symbol> <usd> <refundAddress> [--no-notify]'
    );
    console.error('Example: pnpm deposit-proof quote base USDC 12 0xYourBaseAddress');
    process.exit(1);
  }
  const usd = Number(usdText);
  const stacksAddress = required('TEST_STX_ADDRESS');
  const { publicKey: reclaimPublicKey } = reclaimKeyFromEnv();

  const signers = await fetchVerifiedSigners(config);
  const limits = await fetchLimits(config.sbtcApiUrl);
  const deposit = buildDepositAddress({
    stacksAddress,
    reclaimPublicKey,
    signersPublicKey: signers.signersPublicKey,
    maxSignerFeeSats: config.maxSignerFeeSats,
    reclaimLockBlocks: config.reclaimLockBlocks,
  });

  const tokens = await client.tokens();
  const token = tokens.find(t => t.blockchain === chain && t.symbol === symbol);
  if (!token) {
    console.error(`1Click does not list ${symbol} on ${chain}.`);
    process.exit(1);
  }
  const amount = BigInt(Math.round((usd / token.price) * 10 ** token.decimals)).toString();
  const request = buildQuoteRequest(config, {
    originAsset: token.assetId,
    amount,
    refundTo,
    depositAddress: deposit.address,
    dry: false,
  });
  const prior = await snapshotOutpoints(config.btcApiUrl, deposit.address, deposit.scriptPubKey);
  const response = await client.quote(request);
  const q = response.quote;

  const check = checkDepositAmount(Number(q.minAmountOut), limits, config.maxSignerFeeSats);
  if (!check.ok) {
    console.error(
      `Refusing: the swap could deliver as little as ${q.minAmountOut} sats, which sBTC would not accept (${check.problems.join(', ')}).`
    );
    console.error('Nothing has been sent. Try a larger amount.');
    process.exit(1);
  }

  const record: ProofRecord = {
    createdAt: new Date().toISOString(),
    stacksAddress,
    reclaimPublicKey,
    signersPublicKey: signers.signersPublicKey,
    maxSignerFeeSats: config.maxSignerFeeSats,
    reclaimLockBlocks: config.reclaimLockBlocks,
    deposit,
    origin: { chain, symbol, assetId: token.assetId },
    refundTo,
    quoteResponse: response,
    notify,
    priorOutpoints: prior.outpoints,
    priorTruncated: prior.truncated,
    events: [],
  };
  const path = saveProof(`${record.createdAt.replace(/[:.]/g, '-')}.json`, record);

  const extra = providerFeesOf(request, response).reduce((sum, f) => sum + f.fee, 0);
  console.log('Quote accepted. Nothing has moved yet.\n');
  console.log(`  sBTC recipient        ${stacksAddress}`);
  console.log(`  sBTC deposit address  ${deposit.address}`);
  console.log(`  expected payout       ${q.amountOut} sats (at least ${q.minAmountOut})`);
  console.log(`  provider fees         ${extra} bps plus ${q.withdrawFee ?? '?'} sats withdrawal`);
  console.log(`  refund goes to        ${refundTo} on ${chain}`);
  console.log(
    `  mode                  ${notify ? 'normal: payout will be registered with the signers' : 'RECLAIM DRILL: payout will NOT be registered'}`
  );
  if (check.feeCapCoversWholeAmount) {
    console.log(
      `  note                  payout is below the ${config.maxSignerFeeSats}-sat signer fee cap; fine normally, risky in a fee spike`
    );
  }
  console.log('\nTo run the proof, send from your own wallet:');
  console.log(`\n  ${q.amountInFormatted} ${symbol} on ${chain}`);
  console.log(`  to  ${q.depositAddress}${q.depositMemo ? `  memo ${q.depositMemo}` : ''}`);
  console.log(`  by  ${q.deadline}\n`);
  console.log('Send exactly that asset on exactly that chain. Then run: pnpm deposit-proof watch');
  console.log(`Record saved to ${path}`);
}

async function watch(args: string[]) {
  const { path, record } = loadProof(args[0]);
  const swapAddress = record.quoteResponse.quote.depositAddress;
  if (!swapAddress) throw new Error(`${path} has no swap deposit address`);
  console.log(`Following ${path}`);
  console.log(`sBTC deposit address ${record.deposit.address}\n`);

  const ctx = contextOfProof(record);
  for (;;) {
    let status: OneClickStatusResponse | null = null;
    try {
      status = await client.status(swapAddress, record.quoteResponse.quote.depositMemo);
    } catch {
      status = null;
    }

    let observed = await observeDeposit(config, ctx, status);
    const { selection } = observed;
    const payout = selection.payout;
    if (observed.truncated) {
      log(
        record,
        'warning',
        'address history is longer than the page cap; older outputs unchecked'
      );
    }
    if (selection.ambiguous) {
      log(
        record,
        'warning',
        `${selection.candidates.length} possible payouts and no 1Click hash: ${selection.candidates.map(c => `${outpointOf(c)} ${c.amountSats} sats`).join(', ')}`
      );
    }
    for (const o of selection.others) {
      log(record, 'other-output', `${outpointOf(o)} ${o.amountSats} sats also paid the address`);
    }
    for (const o of selection.belowMinimum) {
      log(record, 'below-minimum', `${outpointOf(o)} ${o.amountSats} sats cannot be minted`);
    }

    const progress = observed.progress;
    const detail = payout
      ? `payout ${outpointOf(payout)} ${payout.amountSats} sats (matched by ${selection.basis ?? 'unknown'})${progress.blocksUntilReclaim !== null ? `, reclaimable in ${progress.blocksUntilReclaim} blocks` : ''}`
      : `swap ${observed.swap ?? 'not seen yet'}`;
    log(record, progress.stage, detail);

    if (observed.toRegister.length > 0) {
      if (record.notify) {
        const results = await registerOutputs(config, record.deposit, observed.toRegister);
        for (const r of results) {
          if (r.error === null) {
            log(
              record,
              'notified',
              `signers told about ${r.outpoint}; sBTC API status ${r.status ?? '?'}`
            );
          } else {
            log(record, 'notify-failed', `${r.outpoint}: ${r.error}`);
          }
        }
        observed = applyRegistrations(observed, results, record.reclaimLockBlocks);
      } else {
        log(record, 'not-notifying', 'reclaim drill: leaving the payout unregistered');
        if (payout?.confirmed) {
          saveProof(path, record);
          console.log(
            `\nPayout confirmed and left unregistered. Run "pnpm reclaim" once ${progress.blocksUntilReclaim ?? record.reclaimLockBlocks} more blocks have passed.`
          );
          return;
        }
      }
    }

    saveProof(path, record);

    const final = observed.progress;
    if (final.terminal) {
      console.log(`\n${final.message}`);
      const mint = payout ? (observed.mints.get(outpointOf(payout)) ?? null) : null;
      if (final.stage === 'done' && payout) {
        record.result = {
          payoutTxid: payout.txid,
          payoutVout: payout.vout,
          payoutSats: payout.amountSats,
          mintStatus: mint ?? 'unknown',
          finishedAt: new Date().toISOString(),
        };
        saveProof(path, record);
        const quoted = Number(record.quoteResponse.quote.amountOut);
        console.log('\nPROOF PASSED: a 1Click payout was accepted as an sBTC deposit.');
        console.log(`  payout output index   ${payout.vout}`);
        console.log(
          `  payout                ${payout.amountSats} sats (quoted ${quoted}, minimum ${record.quoteResponse.quote.minAmountOut})`
        );
        console.log(
          `  elapsed               ${Math.round((Date.now() - Date.parse(record.createdAt)) / 60000)} minutes`
        );
      }
      process.exit(final.stage === 'done' ? 0 : 2);
    }
    await new Promise(r => setTimeout(r, 30_000));
  }
}

const [command, ...rest] = process.argv.slice(2);
function start(name: string | undefined, args: string[]): Promise<void> | null {
  if (name === 'quote') return quote(args);
  if (name === 'watch') return watch(args);
  return null;
}

const run = start(command, rest);
if (!run) {
  console.error(
    'Usage: pnpm deposit-proof quote <chain> <symbol> <usd> <refundAddress> [--no-notify]'
  );
  console.error('       pnpm deposit-proof watch [record]');
  process.exit(1);
}
run.catch(err => {
  console.error(err);
  process.exit(1);
});
