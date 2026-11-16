import { type Locator, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

import { parseWith, z } from '@satway/core';

import type { SatwayApp } from './satway-app.js';

export const WITHDRAW_PROGRESS = {
  awaitingTx: 'Waiting for the withdrawal transaction to confirm on Stacks.',
  awaitingSigners: /^The withdrawal request is on chain\. Waiting for the sBTC signers/,
  payoutBroadcast:
    'The sBTC signers accepted the withdrawal. Confirming the BTC payout on the Bitcoin network.',
  payoutConfirmed:
    'The sBTC signers sent the BTC to the swap and it is confirmed. Waiting for the swap provider to pick it up.',
  swapping: 'The BTC arrived at the swap. Swapping now.',
  done: 'The swap is complete and the funds were delivered.',
  rejected:
    'The sBTC signers rejected this withdrawal. The full amount and fee cap were returned to your wallet as sBTC.',
  refunded: /^The swap did not complete\. The swap provider refunded the BTC/,
  deadline: /^The quote deadline has passed/,
  mismatch: /Do not sign anything else for this withdrawal\. Keep this page and contact support\.$/,
} as const;

export const STEP_NAMES = [
  'Request submitted',
  'Stacks transaction confirmed',
  'Accepted by the sBTC signers',
  'BTC paid to the swap address',
  'Swapped by NEAR Intents',
  'Delivered to your address',
] as const;

export const WITHDRAWAL_STOPS = [
  'sBTC on Stacks',
  'Bitcoin payout',
  'Swap from BTC',
  'Your chain',
] as const;

export const withdrawalFileSchema = z.looseObject({
  kind: z.literal('satway-withdrawal'),
  version: z.literal(1),
  createdAt: z.string(),
  stacksTxid: z.string().nullable(),
  sender: z.string(),
  amountSats: z.number(),
  maxFeeSats: z.number(),
  depositAddress: z.string(),
  recipient: z.looseObject({ version: z.string(), hashbytes: z.string() }),
  destination: z.looseObject({
    assetId: z.string(),
    chain: z.string(),
    symbol: z.string(),
    decimals: z.number(),
    address: z.string(),
  }),
  refundTo: z.string(),
  quoteDeadline: z.string(),
  quoteResponse: z.looseObject({
    quote: z.looseObject({
      depositAddress: z.string(),
      amountOut: z.string(),
      minAmountOut: z.string(),
    }),
    quoteRequest: z.looseObject({ amount: z.string(), recipient: z.string() }),
  }),
});

export type WithdrawalFile = z.infer<typeof withdrawalFileSchema>;

export interface WithdrawalPreview {
  receive: string;
  minimum: string;
  feeCap: string;
}

export interface StartedWithdrawal {
  receipt: WithdrawalFile;
  receiptPath: string;
  fileName: string;
}

export class WithdrawPage {
  readonly app: SatwayApp;

  constructor(app: SatwayApp) {
    this.app = app;
  }

  get page() {
    return this.app.page;
  }

  get assetSelect(): Locator {
    return this.page.getByLabel('You receive');
  }

  get amountInput(): Locator {
    return this.page.getByLabel(/^Amount of sBTC/);
  }

  get recipientInput(): Locator {
    return this.page.getByLabel(/^Receive at/);
  }

  get refundInput(): Locator {
    return this.page.getByLabel('Bitcoin refund address');
  }

  get signButton(): Locator {
    return this.page.getByRole('button', {
      name: /^Sign the withdrawal in your wallet|^Confirm in your wallet/,
    });
  }

  get route(): Locator {
    return this.page.getByRole('list', { name: 'Withdrawal progress' });
  }

  stop(name: (typeof WITHDRAWAL_STOPS)[number]): Locator {
    return this.route.getByRole('listitem').filter({ hasText: name });
  }

  step(name: (typeof STEP_NAMES)[number]): Locator {
    return this.app.definition(name);
  }

  async open(): Promise<void> {
    await this.page.getByRole('button', { name: 'Withdraw', exact: true }).click();
    await expect(
      this.page.getByRole('heading', { name: 'Withdraw sBTC to another chain' })
    ).toBeVisible();
  }

  async fill(input: {
    asset?: string;
    amount: string;
    recipient?: string;
    refundTo?: string;
    slippage?: string;
  }): Promise<void> {
    if (input.asset !== undefined) await this.assetSelect.selectOption({ label: input.asset });
    await this.amountInput.fill(input.amount);
    if (input.recipient !== undefined) await this.recipientInput.fill(input.recipient);
    if (input.refundTo !== undefined) await this.refundInput.fill(input.refundTo);
    if (input.slippage !== undefined)
      await this.page.getByLabel('Slippage tolerance').selectOption({ label: input.slippage });
  }

  async getQuote(): Promise<WithdrawalPreview> {
    await this.page.getByRole('button', { name: 'Get quote' }).click();
    const alert = this.page.getByRole('alert');
    await expect(this.app.definition('You receive about').or(alert).first()).toBeVisible();
    if (await alert.isVisible())
      throw new Error(`The app refused the quote: ${await alert.innerText()}`);
    return {
      receive: await this.app.definition('You receive about').innerText(),
      minimum: await this.app.definition('At least').innerText(),
      feeCap: await this.app.definition('Signer fee cap').innerText(),
    };
  }

  async continueToConfirm(): Promise<void> {
    await this.page.getByRole('button', { name: 'Continue' }).click();
    await expect(
      this.page.getByRole('heading', { name: 'Check the live quote before you sign' })
    ).toBeVisible();
  }

  async sign(): Promise<StartedWithdrawal> {
    const downloaded = this.page.waitForEvent('download');
    await this.signButton.click();
    const download = await downloaded;
    const receiptPath = await download.path();
    const receipt = parseWith(
      withdrawalFileSchema,
      JSON.parse(await readFile(receiptPath, 'utf8')),
      'the downloaded withdrawal receipt'
    );
    await expect(this.page.getByRole('heading', { name: /^Withdrawal/ })).toBeVisible();
    return { receipt, receiptPath, fileName: download.suggestedFilename() };
  }

  async waitFor(message: string | RegExp, options: { maxTicks?: number } = {}): Promise<void> {
    await this.app.until(
      () => expect(this.app.progress(message)).toBeVisible({ timeout: 750 }),
      options
    );
  }

  async expectSteps(statuses: readonly string[]): Promise<void> {
    for (const [i, name] of STEP_NAMES.entries()) {
      await expect(this.step(name)).toHaveText(statuses[i] ?? 'Not reached yet');
    }
  }

  async expectRouteAt(
    name: (typeof WITHDRAWAL_STOPS)[number],
    status: 'In progress' | 'Done' | 'Stopped here'
  ): Promise<void> {
    const stop = this.stop(name);
    await expect(stop).toHaveAttribute('aria-current', 'step');
    await expect(stop).toContainText(status);
  }

  async openWithdrawals(): Promise<void> {
    await this.app.openTab('Withdraw');
    await expect(this.page.getByRole('heading', { name: 'Your withdrawals' })).toBeVisible();
  }

  async uploadReceipt(path: string): Promise<void> {
    const input = this.page.getByLabel('Withdrawal receipt (JSON)');
    await input.setInputFiles([]);
    await input.setInputFiles(path);
  }

  get savedWithdrawals(): Locator {
    return this.page.getByRole('list', { name: 'Your withdrawals' }).getByRole('listitem');
  }

  savedWithdrawal(startsWith: string): Locator {
    return this.savedWithdrawals.filter({ hasText: startsWith });
  }

  async followSaved(startsWith: string): Promise<void> {
    await this.savedWithdrawal(startsWith).getByRole('button', { name: 'Follow' }).click();
  }
}
