import { expect } from '@playwright/test';
import { base64, hex } from '@scure/base';
import * as btc from '@scure/btc-signer';

import type { PortageApp } from '../app/portage-app.js';
import type { StacksWallet } from '../wallets/stacks-wallet.js';
import { type Outpoint, outpointKey, scriptOfAddress } from '../world/bitcoin.js';
import { field, stringField } from '../world/http.js';

export const RECLAIM_COPY = {
  signersMayMint:
    'The timelock has passed and the sBTC signers have not minted this deposit. You can reclaim your BTC now from the recovery page; until you do, the signers may still mint it.',
  reclaimed:
    'The BTC from this payout has already been moved out of the deposit address, most likely by a reclaim. Nothing is left to reclaim from it.',
  nothingLeft: 'No unspent BTC is left at this deposit address. There is nothing left to reclaim.',
  alreadySpent: 'That output has already been spent. Choose another one, if any is listed.',
} as const;

export function reclaimControls(app: PortageApp) {
  return {
    output: app.page.getByLabel('Output to reclaim'),
    to: app.page.getByLabel('Send the reclaimed BTC to'),
    button: app.page.getByRole('button', { name: 'Reclaim BTC' }),
  };
}

export async function expectNoReclaimOffered(app: PortageApp): Promise<void> {
  const c = reclaimControls(app);
  await expect(c.output).toHaveCount(0);
  await expect(c.button).toHaveCount(0);
}

export async function reclaimFromRecover(
  app: PortageApp,
  to: string,
  options: { choose?: Outpoint } = {}
): Promise<void> {
  const c = reclaimControls(app);
  if (options.choose) await c.output.selectOption(outpointKey(options.choose));
  await c.to.fill(to);
  await c.button.click();
}

export interface SignedPsbtView {
  inputs: { txid: string; vout: number; sequence: number }[];
  outputs: { script: string; amount: bigint }[];
}

export function psbtRequests(wallet: StacksWallet): SignedPsbtView[] {
  return wallet.behaviour.calls('signPsbt').map(call => {
    const psbt = stringField(call.params, 'psbt');
    if (!psbt) throw new Error('signPsbt without a psbt');
    const tx = btc.Transaction.fromPSBT(base64.decode(psbt), {
      allowUnknownInputs: true,
      allowUnknownOutputs: true,
    });
    const inputs = [];
    for (let i = 0; i < tx.inputsLength; i++) {
      const input = tx.getInput(i);
      inputs.push({
        txid: hex.encode(input.txid ?? new Uint8Array()),
        vout: input.index ?? -1,
        sequence: input.sequence ?? -1,
      });
    }
    const outputs = [];
    for (let i = 0; i < tx.outputsLength; i++) {
      const output = tx.getOutput(i);
      outputs.push({
        script: hex.encode(output.script ?? new Uint8Array()),
        amount: output.amount ?? 0n,
      });
    }
    return { inputs, outputs };
  });
}

export function expectReclaimPsbt(
  wallet: StacksWallet,
  input: { outpoint: Outpoint; amountSats: number; to: string; feeSats: number }
): void {
  const views = psbtRequests(wallet);
  expect(views).toEqual([
    {
      inputs: [{ ...input.outpoint, sequence: 950 }],
      outputs: [
        { script: scriptOfAddress(input.to), amount: BigInt(input.amountSats - input.feeSats) },
      ],
    },
  ]);
  const [call] = wallet.behaviour.calls('signPsbt');
  expect(field(call?.params, 'signInputs')).toEqual([
    { index: 0, address: wallet.account.paymentAddress },
  ]);
  expect(field(call?.params, 'broadcast')).toBe(false);
}
