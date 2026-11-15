import { expect } from '@playwright/test';

import type { SatwayApp } from '../app/satway-app.js';

export const EVM_CHAINS = [1, 10, 56, 100, 137, 8453, 42161, 43114, 80094, 534352];

export const WC_COPY = {
  scan: 'Scan with a WalletConnect wallet, then approve the connection there.',
  unreachable:
    'Could not reach the WalletConnect relay. Use a browser wallet, or skip this and send the funds yourself.',
} as const;

export function walletConnectButton(app: SatwayApp) {
  return app.from.getByRole('button', { name: /^WalletConnect/ });
}

export async function startPairing(app: SatwayApp): Promise<string> {
  await walletConnectButton(app).click();
  await expect(app.page.getByText(WC_COPY.scan)).toBeVisible();
  await expect(app.page.getByRole('img', { name: 'WalletConnect pairing code' })).toBeVisible();
  const uri = await app.page.locator('a[href^="wc:"]').getAttribute('href');
  if (uri === null) throw new Error('The pairing box has no wc: link');
  return uri;
}
