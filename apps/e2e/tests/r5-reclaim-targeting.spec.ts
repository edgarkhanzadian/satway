import { PROGRESS } from '../src/app/satway-app.js';
import { expect, test } from '../src/fixtures.js';
import { payOut, startAwaitingFunds } from '../src/scenario/journeys.js';
import {
  RECLAIM_COPY,
  psbtRequests,
  reclaimControls,
  reclaimFromYourDeposits,
} from '../src/scenario/reclaim.js';
import { type Outpoint, outpointKey } from '../src/world/bitcoin.js';

function label(amount: number, o: Outpoint): string {
  return `${amount.toLocaleString('en-US')} sats, ${outpointKey(o)}: reclaimable now`;
}

test.describe('R5. which output a reclaim targets', () => {
  test('payout, a 2,000-sat outsider and 546-sat dust: payout first, the outsider never preselected, dust refused', async ({
    app,
    world,
    wallets,
  }) => {
    const started = await startAwaitingFunds(app);
    const address = started.receipt.depositAddress;
    const payout = await payOut(app, world);
    const outsider = world.payTo(address, 2_000);
    const dust = world.payTo(address, 546);
    world.mine(1);
    await app.waitForProgress(PROGRESS.minting);
    world.mine(949);

    await app.openYourDeposits();
    await app.uploadReceipt(started.receiptPath);
    const c = reclaimControls(app);
    await expect(c.output).toHaveValue(outpointKey(payout.outpoint));
    await expect(c.output.locator('option:not([disabled])')).toHaveText([
      label(payout.amountSats, payout.outpoint),
      label(2_000, outpoint(outsider)),
      label(546, outpoint(dust)),
    ]);
    const to = wallets.stacks.account.paymentAddress;
    await reclaimFromYourDeposits(app, to);
    await expect(app.progress(/^Reclaim sent for /)).toContainText(outpointKey(payout.outpoint));

    await expect(c.output).toHaveValue('');
    await expect(c.output.locator('option:not([disabled])')).toHaveText([
      label(2_000, outpoint(outsider)),
      label(546, outpoint(dust)),
    ]);
    await expect(c.button).toBeDisabled();
    await expect(app.page.getByText(RECLAIM_COPY.nothingLeft)).toHaveCount(0);

    await reclaimFromYourDeposits(app, to, { choose: outpoint(dust) });
    await expect(app.sendError).toHaveText(
      'This output holds 546 sats, which cannot cover the reclaim fee of about 504 sats at 4 sat/vB and still leave a spendable amount. It is not worth reclaiming at this fee rate.'
    );
    expect(wallets.stacks.behaviour.calls('signPsbt')).toHaveLength(1);

    await reclaimFromYourDeposits(app, to, { choose: outpoint(outsider) });
    await expect(app.progress(/^Reclaim sent for /)).toContainText(outpointKey(outpoint(outsider)));
    const requests = psbtRequests(wallets.stacks);
    expect(requests.map(r => r.inputs.map(i => `${i.txid}:${i.vout}`))).toEqual([
      [outpointKey(payout.outpoint)],
      [outpointKey(outpoint(outsider))],
    ]);
    expect(requests[1]?.outputs.map(o => o.amount)).toEqual([2_000n - 504n]);
    expect(world.bitcoin.broadcasts).toHaveLength(2);
    expect(world.bitcoin.rejected).toEqual([]);
    await expect(c.output.locator('option:not([disabled])')).toHaveText([
      label(546, outpoint(dust)),
    ]);
    await expect(c.output).toHaveValue('');
    await expect(app.page.getByText(RECLAIM_COPY.nothingLeft)).toHaveCount(0);
  });
});

function outpoint(paid: { outpoint: Outpoint }): Outpoint {
  return paid.outpoint;
}
