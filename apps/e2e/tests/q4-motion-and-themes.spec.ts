import type { Page } from '@playwright/test';

import { PROGRESS, type PortageApp } from '../src/app/portage-app.js';
import { expect, test } from '../src/fixtures.js';
import { startAwaitingFunds } from '../src/scenario/journeys.js';

const PRESET = {
  light: {
    paper: '#ffffff',
    ink: '#131416',
    stage: '#f3f2f0',
    violet: '#5546ff',
    muted: '#595754',
  },
  dark: { paper: '#131416', ink: '#f3f2f0', stage: '#1f2123', violet: '#8c82ff', muted: '#a6a39d' },
} as const;

function rgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

interface LegStyle {
  status: string | null;
  animationName: string;
  color: string;
}

async function legs(page: Page): Promise<LegStyle[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('ol li > span[data-status]')).map(el => {
      const style = getComputedStyle(el);
      return {
        status: el.getAttribute('data-status'),
        animationName: style.animationName,
        color: style.color,
      };
    })
  );
}

async function toSwapping(app: PortageApp): Promise<void> {
  await startAwaitingFunds(app);
  await app.sendFromWallet();
  await app.waitForProgress(PROGRESS.swapping);
}

test.describe('Q4. reduced motion and themes', () => {
  test('without a motion preference only the active leg animates', async ({ app }) => {
    await app.page.emulateMedia({ reducedMotion: 'no-preference' });
    await toSwapping(app);
    const found = await legs(app.page);
    expect(found.map(l => l.status)).toEqual(['active', 'pending', 'pending']);
    expect(found.map(l => l.animationName)).toEqual(['legAcross', 'none', 'none']);
  });

  test('without a motion preference the narrow layout animates the active leg downwards', async ({
    app,
  }) => {
    await app.page.setViewportSize({ width: 390, height: 844 });
    await app.page.emulateMedia({ reducedMotion: 'no-preference' });
    await toSwapping(app);
    expect((await legs(app.page)).map(l => l.animationName)).toEqual(['legDown', 'none', 'none']);
  });

  test('with prefers-reduced-motion: reduce nothing animates', async ({ app }) => {
    await app.page.emulateMedia({ reducedMotion: 'reduce' });
    await toSwapping(app);
    const found = await legs(app.page);
    expect(found.map(l => l.status)).toEqual(['active', 'pending', 'pending']);
    expect(found.map(l => l.animationName)).toEqual(['none', 'none', 'none']);
    const anyAnimated = await app.page.evaluate(() =>
      Array.from(document.querySelectorAll('*')).some(
        el => getComputedStyle(el).animationName !== 'none'
      )
    );
    expect(anyAnimated).toBe(false);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`the ${theme} theme applies the preset's tokens`, async ({ app }) => {
      await app.page.emulateMedia({ colorScheme: theme });
      await toSwapping(app);
      const tokens = PRESET[theme];
      const seen = await app.page.evaluate(() => {
        const body = getComputedStyle(document.body);
        const stage = document.querySelector('main > div');
        const hint = document.querySelector('main dt');
        return {
          paper: body.backgroundColor,
          ink: body.color,
          stage: stage ? getComputedStyle(stage).backgroundColor : '',
          muted: hint ? getComputedStyle(hint).color : '',
          scheme: getComputedStyle(document.documentElement).colorScheme,
        };
      });
      expect(seen.paper).toBe(rgb(tokens.paper));
      expect(seen.ink).toBe(rgb(tokens.ink));
      expect(seen.stage).toBe(rgb(tokens.stage));
      expect(seen.scheme).toBe(theme);
      expect((await legs(app.page))[0]?.color).toBe(rgb(tokens.violet));
      expect(seen.muted).toBe(rgb(tokens.muted));
    });
  }
});
