import { schnorr, secp256k1 } from '@noble/curves/secp256k1';
import { hex } from '@scure/base';

import {
  OneClickClient,
  type OneClickToken,
  buildDepositAddress,
  buildQuoteRequest,
  checkDepositAmount,
  MAINNET_CONFIG as config,
  errorMessage,
  fetchLimits,
  fetchVerifiedSigners,
} from '@stxonector/core';

import { loadEnv, optional } from './lib/env.js';

loadEnv();

const usd = Number(process.argv[2] ?? 25);

const EVM = optional('TEST_REFUND_EVM') ?? '0x2527D02599Ba641c19FEa793cD0F167589a0f10D';
const SOL = optional('TEST_REFUND_SOL') ?? 'So11111111111111111111111111111111111111112';
const TRON = optional('TEST_REFUND_TRON') ?? 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

const ROUTES: { chain: string; symbol: string; refundTo: string }[] = [
  { chain: 'base', symbol: 'USDC', refundTo: EVM },
  { chain: 'arb', symbol: 'USDC', refundTo: EVM },
  { chain: 'eth', symbol: 'USDC', refundTo: EVM },
  { chain: 'eth', symbol: 'ETH', refundTo: EVM },
  { chain: 'bsc', symbol: 'USDT', refundTo: EVM },
  { chain: 'sol', symbol: 'USDC', refundTo: SOL },
  { chain: 'sol', symbol: 'SOL', refundTo: SOL },
  { chain: 'tron', symbol: 'USDT', refundTo: TRON },
];

function baseUnits(token: OneClickToken, usdAmount: number): string {
  const units = (usdAmount / token.price) * 10 ** token.decimals;
  return BigInt(Math.round(units)).toString();
}

async function main() {
  console.log('1. Signer key');
  const signers = await fetchVerifiedSigners(config);
  console.log(`   key          ${signers.signersPublicKey}`);
  console.log(
    `   evidence     a deposit locked to this key was swept on Bitcoin ${signers.evidence.blocksAgo} blocks ago (height ${signers.evidence.sweptAtHeight})`
  );

  console.log('\n2. sBTC deposit limits');
  const limits = await fetchLimits(config.sbtcApiUrl);
  console.log(`   minimum      ${limits.perDepositMinimum} sats`);
  console.log(`   per deposit  ${limits.perDepositCap} sats`);

  console.log('\n3. Deposit address');
  const stacksAddress = optional('TEST_STX_ADDRESS') ?? 'SP1Q6W6VADA7V12SEVH6VNDNN4N7RX1PQ949EQPQ';
  const reclaimPublicKey =
    optional('TEST_RECLAIM_PUBKEY') ??
    hex.encode(schnorr.getPublicKey(secp256k1.utils.randomPrivateKey()));
  const deposit = buildDepositAddress({
    stacksAddress,
    reclaimPublicKey,
    signersPublicKey: signers.signersPublicKey,
    maxSignerFeeSats: config.maxSignerFeeSats,
    reclaimLockBlocks: config.reclaimLockBlocks,
  });
  console.log(`   recipient    ${stacksAddress}`);
  console.log(`   address      ${deposit.address}`);

  console.log(`\n4. Dry-run quotes for about $${usd}, paid out as BTC to that address`);
  const jwt = optional('ONECLICK_JWT');
  const client = new OneClickClient(config.oneClickBaseUrl, { jwt });
  const tokens = await client.tokens();
  const chains = new Set(tokens.map(t => t.blockchain));
  console.log(
    `   1Click lists ${tokens.length} assets on ${chains.size} chains; API key ${jwt ? 'set' : 'not set (keyless fee applies)'}`
  );
  console.log('');
  console.log('   route          out sats   min sats    cost   time   clears sBTC minimum');

  let ok = 0;
  for (const route of ROUTES) {
    const token = tokens.find(t => t.blockchain === route.chain && t.symbol === route.symbol);
    const label = `${route.symbol}/${route.chain}`.padEnd(12);
    if (!token) {
      console.log(`   ${label}   not listed`);
      continue;
    }
    try {
      const request = buildQuoteRequest(config, {
        originAsset: token.assetId,
        amount: baseUnits(token, usd),
        refundTo: route.refundTo,
        depositAddress: deposit.address,
        dry: true,
      });
      const { quote } = await client.quote(request);
      const check = checkDepositAmount(Number(quote.minAmountOut), limits, config.maxSignerFeeSats);
      const costPct = (1 - Number(quote.amountOutUsd) / Number(quote.amountInUsd)) * 100;
      console.log(
        `   ${label}   ${quote.amountOut.padStart(8)}   ${quote.minAmountOut.padStart(8)}   ${costPct.toFixed(2).padStart(5)}%  ${String(quote.timeEstimate).padStart(4)}s   ${check.ok ? 'yes' : 'NO: ' + check.problems.join(',')}`
      );
      if (check.ok) ok++;
    } catch (err) {
      console.log(`   ${label}   FAILED  ${(errorMessage(err) ?? String(err)).slice(0, 120)}`);
    }
  }

  console.log(
    `\n${ok} of ${ROUTES.length} routes returned a quote that pays the deposit address and clears the sBTC minimum.`
  );
  console.log(
    'A dry-run quote proves 1Click accepts the address. It does not prove the signers accept the payout; that is step 2.'
  );
  if (ok === 0) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
