import { base64, hex } from '@scure/base';

import { buildDepositAddress, buildReclaimPsbt, finalizeSignedReclaim } from '@satway/core';

import { expect, test } from '../src/fixtures.js';
import { field, stringField } from '../src/world/http.js';

test('harness self-check: the Stacks test wallet signs a real reclaim PSBT that the world accepts', async ({
  world,
  wallets,
}) => {
  const account = wallets.stacks.account;
  const deposit = buildDepositAddress({
    stacksAddress: account.stacksAddress,
    reclaimPublicKey: account.paymentKey.xOnly,
    signersPublicKey: world.signer.xOnly,
    maxSignerFeeSats: 80_000,
    reclaimLockBlocks: 950,
  });
  const payout = world.treasury.pay([{ script: deposit.scriptPubKey, value: 50_000 }]);
  world.mine(951);

  const { psbtHex } = buildReclaimPsbt({
    payout: { txid: payout.txid, vout: 0, amountSats: 50_000 },
    bitcoinAddress: account.paymentAddress,
    stacksAddress: account.stacksAddress,
    reclaimPublicKey: account.paymentKey.xOnly,
    signersPublicKey: world.signer.xOnly,
    maxSignerFeeSats: 80_000,
    reclaimLockBlocks: 950,
    feeRate: world.bitcoin.feeRates.halfHourFee,
  });
  const reply = await wallets.stacks.handle({
    method: 'signPsbt',
    params: {
      psbt: base64.encode(hex.decode(psbtHex)),
      signInputs: [{ index: 0, address: account.paymentAddress }],
      broadcast: false,
      network: 'mainnet',
    },
  });
  const signed = stringField(field(reply, 'result'), 'psbt');
  if (!signed) throw new Error(`The wallet did not sign: ${JSON.stringify(reply)}`);

  const { txHex, txid } = finalizeSignedReclaim(base64.decode(signed));
  const broadcast = world.bitcoin.serve('POST', '/api/tx', txHex);
  expect(broadcast).toMatchObject({ status: 200, body: txid });
  expect(world.bitcoin.isSpent({ txid: payout.txid, vout: 0 })).toBe(true);
  expect(world.bitcoin.transaction(txid)?.inputs[0]?.witness).toHaveLength(3);
});
