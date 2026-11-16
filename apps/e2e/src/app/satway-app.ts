import { type Locator, type Page, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

import { parseWith } from '@satway/core';

import type { Harness } from '../browser/harness.js';
import { APP_ORIGIN, POLL_INTERVAL_MS } from '../config.js';
import { EVM_WALLET_NAME } from '../wallets/evm-wallet.js';
import { STACKS_WALLET_NAMES } from '../wallets/stacks-wallet.js';
import type { World } from '../world/world.js';
import { type ReceiptFile, receiptFileSchema } from './receipt.js';

export const PROGRESS = {
  awaitingFunds: 'Waiting for your funds to arrive at the swap address.',
  swapping: 'Funds received. Swapping to BTC.',
  awaitingPayout: 'Swap complete. Waiting for the BTC payout to appear on the Bitcoin network.',
  payoutUnconfirmed:
    'BTC is on its way to your deposit address. Waiting for Bitcoin confirmations.',
  awaitingNotification: 'BTC arrived. Registering the deposit with the sBTC signers.',
  minting: 'BTC arrived and the deposit is registered. Waiting for the signers to mint sBTC.',
  mintingSwept: 'The sBTC signers have taken in this deposit. Waiting for them to mint sBTC.',
  done: 'sBTC has been minted to your Stacks address.',
} as const;

export const NEW_ADDRESS_NOTE =
  'A new Bitcoin deposit address for this deposit only, built from your keys when you continue.';

export const STOP_NAMES = [
  'Your chain',
  'Swap to BTC',
  'Bitcoin deposit',
  'sBTC on Stacks',
] as const;

export interface QuotePreview {
  expectedSats: number;
  minimumSats: number;
  providerFees: string;
  ourFee: string;
  paysOutTo: string;
}

export interface StartedDeposit {
  receipt: ReceiptFile;
  receiptPath: string;
  fileName: string;
}

function satsIn(text: string): number {
  const match = /([\d,]+) sats/.exec(text);
  if (!match?.[1]) throw new Error(`No sats amount in "${text}"`);
  return Number(match[1].replaceAll(',', ''));
}

export type AppHarness = Pick<Harness, 'idle' | 'touch'>;

export class SatwayApp {
  readonly page: Page;
  private readonly harness: AppHarness;
  private readonly world: World;

  constructor(page: Page, harness: AppHarness, world: World) {
    this.page = page;
    this.harness = harness;
    this.world = world;
  }

  get from(): Locator {
    return this.page.getByRole('region', { name: 'From' });
  }

  get to(): Locator {
    return this.page.getByRole('region', { name: 'To' });
  }

  get assetSelect(): Locator {
    return this.page.getByLabel('You send');
  }

  get amountInput(): Locator {
    return this.page.getByLabel(/^Amount/);
  }

  get refundInput(): Locator {
    return this.page.getByLabel(/^Refund address/);
  }

  get sendButton(): Locator {
    return this.page.getByRole('button', { name: /^Send from / });
  }

  get route(): Locator {
    return this.page.getByRole('list', { name: 'Deposit progress' });
  }

  stop(name: (typeof STOP_NAMES)[number]): Locator {
    return this.route.getByRole('listitem').filter({ hasText: name });
  }

  progress(message: string | RegExp): Locator {
    return this.page.getByRole('status').filter({ hasText: message });
  }

  definition(term: string): Locator {
    return this.page.locator(`dt:text-is("${term}") + dd`).filter({ visible: true });
  }

  async open(): Promise<void> {
    await this.page.goto(`${APP_ORIGIN}/`);
    await expect(this.page.getByRole('heading', { name: 'satway', level: 1 })).toBeVisible();
  }

  async connectStacksWallet(): Promise<void> {
    await this.to.getByRole('button', { name: 'Connect Stacks wallet' }).click();
    const modal = this.page.locator('connect-modal');
    await modal
      .getByRole('listitem')
      .filter({ hasText: STACKS_WALLET_NAMES })
      .getByRole('button', { name: 'Connect' })
      .click();
    await expect(this.to.getByText('Connected', { exact: true })).toBeVisible();
    await expect(modal).toHaveCount(0);
  }

  async connectEvmWallet(): Promise<void> {
    await this.from.getByRole('button', { name: new RegExp(EVM_WALLET_NAME) }).click();
    await expect(this.from.getByText(`${EVM_WALLET_NAME} connected`)).toBeVisible();
  }

  async fillDeposit(input: { asset?: string; amount: string; refundTo?: string }): Promise<void> {
    if (input.asset !== undefined) await this.assetSelect.selectOption({ label: input.asset });
    await this.amountInput.fill(input.amount);
    if (input.refundTo !== undefined) await this.refundInput.fill(input.refundTo);
  }

  async getQuote(): Promise<QuotePreview> {
    await this.page.getByRole('button', { name: 'Get quote' }).click();
    const alert = this.page.getByRole('alert');
    await expect(this.definition('You receive about').or(alert).first()).toBeVisible();
    if (await alert.isVisible())
      throw new Error(`The app refused the quote: ${await alert.innerText()}`);
    return {
      expectedSats: satsIn(await this.definition('You receive about').innerText()),
      minimumSats: satsIn(await this.definition('At least').innerText()),
      providerFees: await this.definition('Swap provider fees').innerText(),
      ourFee: await this.definition('Our fee').innerText(),
      paysOutTo: await this.definition('Pays out to').innerText(),
    };
  }

  async continue(): Promise<StartedDeposit> {
    const downloaded = this.page.waitForEvent('download');
    await this.page.getByRole('button', { name: 'Continue' }).click();
    const download = await downloaded;
    const receiptPath = await download.path();
    const receipt = parseWith(
      receiptFileSchema,
      JSON.parse(await readFile(receiptPath, 'utf8')),
      'the downloaded receipt'
    );
    await expect(this.page.getByRole('heading', { name: 'Deposit in progress' })).toBeVisible();
    return { receipt, receiptPath, fileName: download.suggestedFilename() };
  }

  async clickSend(): Promise<void> {
    await this.sendButton.click();
  }

  async sendFromWallet(): Promise<void> {
    await this.clickSend();
    await expect(this.progress('Sent from your wallet.')).toBeVisible();
    await expect(this.progress('Do not send again.')).toBeVisible();
    await expect(this.sendButton).toHaveCount(0);
  }

  async openTab(name: 'Deposit' | 'Withdraw'): Promise<void> {
    await this.page.getByRole('button', { name, exact: true }).click();
  }

  get trackingHeading(): Locator {
    return this.page.getByRole('heading', { name: /^Deposit (in progress|complete)$/ });
  }

  async openYourDeposits(): Promise<void> {
    await this.openTab('Deposit');
    await expect(this.trackingHeading.or(this.yourDepositsHeading).first()).toBeVisible();
    if (await this.trackingHeading.isVisible()) {
      const hide = this.page.getByRole('button', { name: 'Hide', exact: true });
      if (await hide.isVisible()) await hide.click();
      else await this.page.getByRole('button', { name: 'Start another', exact: true }).click();
    }
    await expect(this.yourDepositsHeading).toBeVisible();
  }

  get yourDepositsHeading(): Locator {
    return this.page.getByRole('heading', { name: 'Your deposits', exact: true });
  }

  get savedReceipts(): Locator {
    return this.page.getByRole('list', { name: 'Your deposits' });
  }

  get savedEntries(): Locator {
    return this.savedReceipts.getByRole('listitem');
  }

  savedEntry(startsWith: string): Locator {
    return this.savedEntries.filter({
      has: this.page.locator(':scope > p:first-child', { hasText: startsWith }),
    });
  }

  async savedReceiptLabels(): Promise<string[]> {
    const labels = await this.savedEntries.locator(':scope > p:first-child').allInnerTexts();
    return labels.map(l => l.trim());
  }

  async pickSavedReceipt(startsWith: string): Promise<void> {
    const labels = await this.savedReceiptLabels();
    const index = labels.findIndex(l => l.startsWith(startsWith));
    if (index < 0)
      throw new Error(`No saved receipt starts with "${startsWith}": ${labels.join(' | ')}`);
    await this.savedEntries
      .nth(index)
      .getByRole('button', { name: 'Show details', exact: true })
      .click();
  }

  async followSaved(startsWith: string): Promise<void> {
    const labels = await this.savedReceiptLabels();
    const index = labels.findIndex(l => l.startsWith(startsWith));
    if (index < 0)
      throw new Error(`No saved receipt starts with "${startsWith}": ${labels.join(' | ')}`);
    await this.savedEntries.nth(index).getByRole('button', { name: 'Follow', exact: true }).click();
  }

  async uploadReceipt(path: string): Promise<void> {
    const input = this.page.getByLabel('Receipt file');
    await input.setInputFiles([]);
    await input.setInputFiles(path);
  }

  async followDeposit(): Promise<void> {
    await this.page.getByRole('button', { name: 'Follow this deposit' }).click();
  }

  async startAnother(): Promise<void> {
    await this.page.getByRole('button', { name: 'Start another' }).click();
    await expect(
      this.page.getByRole('heading', { name: 'Deposit to sBTC from another chain' })
    ).toBeVisible();
  }

  async newTab(): Promise<SatwayApp> {
    const page = await this.page.context().newPage();
    return new SatwayApp(page, this.harness, this.world);
  }

  async tick(): Promise<void> {
    await this.fastForward(POLL_INTERVAL_MS);
  }

  async fastForward(ms: number): Promise<void> {
    await this.harness.idle();
    this.world.advanceClock(ms);
    await this.page.context().clock.fastForward(ms);
    this.harness.touch();
    await this.harness.idle({ quietMs: 120 });
  }

  async harnessIdle(): Promise<void> {
    await this.harness.idle();
  }

  async resumeSaved(startsWith: string): Promise<void> {
    await this.openYourDeposits();
    await this.pickSavedReceipt(startsWith);
    await this.followDeposit();
    await expect(this.page.getByRole('heading', { name: 'Deposit in progress' })).toBeVisible();
    await this.harness.idle();
  }

  get confirmNothingSentButton(): Locator {
    return this.page.getByRole('button', {
      name: 'I checked my wallet and nothing was sent. Let me try again',
    });
  }

  get sendError(): Locator {
    return this.page.getByRole('alert');
  }

  async storage(): Promise<Record<string, string>> {
    return this.page.evaluate(() => {
      const out: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key !== null) out[key] = localStorage.getItem(key) ?? '';
      }
      return out;
    });
  }

  async sendRecords(): Promise<unknown[]> {
    const all = await this.storage();
    return Object.entries(all)
      .filter(([key]) => key.startsWith('satway:send-record:v1:'))
      .map(([, value]) => {
        const parsed: unknown = JSON.parse(value);
        return parsed;
      });
  }

  async until(check: () => Promise<void>, options: { maxTicks?: number } = {}): Promise<void> {
    const maxTicks = options.maxTicks ?? 8;
    for (let ticks = 0; ; ticks++) {
      await this.harness.idle();
      try {
        await check();
        return;
      } catch (err) {
        if (ticks >= maxTicks) throw err;
      }
      await this.tick();
    }
  }

  async waitForProgress(message: string, options: { maxTicks?: number } = {}): Promise<void> {
    await this.until(() => expect(this.progress(message)).toBeVisible({ timeout: 750 }), options);
  }

  async expectRouteAt(
    name: (typeof STOP_NAMES)[number],
    status: 'In progress' | 'Done'
  ): Promise<void> {
    const stop = this.stop(name);
    await expect(stop).toHaveAttribute('aria-current', 'step');
    await expect(stop).toContainText(status);
  }

  async expectComplete(): Promise<void> {
    await expect(this.page.getByRole('heading', { name: 'Deposit complete' })).toBeVisible();
    await expect(this.progress(PROGRESS.done)).toBeVisible();
    for (const name of STOP_NAMES) await expect(this.stop(name)).toContainText('Done');
    await this.expectRouteAt('sBTC on Stacks', 'Done');
    await expect(this.sendButton).toHaveCount(0);
  }
}
