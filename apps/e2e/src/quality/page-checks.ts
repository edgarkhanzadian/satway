import { type Page, expect } from '@playwright/test';

export type Theme = 'light' | 'dark';

export const THEMES: readonly Theme[] = ['light', 'dark'];

export interface FocusStop {
  tag: string;
  name: string;
  outlineStyle: string;
  outlineWidth: number;
  inShadow: boolean;
}

export async function useTheme(page: Page, theme: Theme): Promise<void> {
  await page.emulateMedia({ colorScheme: theme });
}

export async function expectPageStructure(page: Page): Promise<void> {
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('portage');
  await expect(page.getByRole('banner')).toHaveCount(1);
  await expect(page.getByRole('navigation', { name: 'Page' })).toHaveCount(1);
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.getByRole('contentinfo')).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'From' })).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'To' })).toHaveCount(1);
}

export async function expectNamedControls(page: Page): Promise<void> {
  const controls = page.locator(
    'main input, main select, main textarea, main button, main a[href], header button'
  );
  const count = await controls.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const control = controls.nth(i);
    if (!(await control.isVisible())) continue;
    await expect(control).toHaveAccessibleName(/\S/);
  }
}

export async function expectRouteExposed(page: Page, tracking: boolean): Promise<void> {
  const route = page.getByRole('list', {
    name: tracking ? 'Deposit progress' : 'Route of a deposit',
  });
  await expect(route).toHaveCount(1);
  await expect(route.getByRole('listitem')).toHaveCount(4);
  const current = route.locator('li[aria-current="step"]');
  if (!tracking) {
    await expect(current).toHaveCount(0);
    return;
  }
  await expect(current).toHaveCount(1);
  await expect(current).toContainText(/In progress|Done|Stopped here/);
  for (const item of await route.getByRole('listitem').all())
    await expect(item).toContainText(/Not reached yet|In progress|Done|Stopped here/);
}

export async function activeFocus(page: Page): Promise<FocusStop | null> {
  return page.evaluate(() => {
    let element: Element | null = document.activeElement;
    let inShadow = false;
    while (element?.shadowRoot?.activeElement) {
      element = element.shadowRoot.activeElement;
      inShadow = true;
    }
    if (!element || element === document.body) return null;
    const style = getComputedStyle(element);
    const label =
      element.getAttribute('aria-label') ??
      (element instanceof HTMLInputElement || element instanceof HTMLSelectElement
        ? (element.labels?.[0]?.textContent ?? '')
        : (element.textContent ?? ''));
    return {
      tag: element.tagName.toLowerCase(),
      name: label.replace(/\s+/g, ' ').trim().slice(0, 80),
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
      inShadow,
    };
  });
}

export async function startFocusAtTop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const top = document.querySelector('h1');
    if (!(top instanceof HTMLElement)) throw new Error('The page has no h1 to start from');
    top.setAttribute('tabindex', '-1');
    top.focus();
    top.removeAttribute('tabindex');
    window.scrollTo(0, 0);
  });
}

export async function tabWalk(page: Page, maxStops = 60): Promise<FocusStop[]> {
  await startFocusAtTop(page);
  const stops: FocusStop[] = [];
  for (let i = 0; i < maxStops; i++) {
    await page.keyboard.press('Tab');
    const stop = await activeFocus(page);
    if (stop === null) break;
    const first = stops[0];
    if (first && stops.length > 1 && first.name === stop.name && first.tag === stop.tag) break;
    stops.push(stop);
  }
  return stops;
}

export function expectVisibleFocus(stops: readonly FocusStop[]): void {
  expect(stops.length).toBeGreaterThan(0);
  for (const stop of stops) {
    expect(stop.outlineStyle, `focus outline on ${stop.tag} "${stop.name}"`).not.toBe('none');
    expect(
      stop.outlineWidth,
      `focus outline width on ${stop.tag} "${stop.name}"`
    ).toBeGreaterThanOrEqual(2);
  }
}

export interface Overflow {
  scrollWidth: number;
  clientWidth: number;
}

export async function horizontalOverflow(page: Page): Promise<Overflow> {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

export async function expectNoHorizontalScroll(page: Page, step: string): Promise<void> {
  const overflow = await horizontalOverflow(page);
  expect(overflow.scrollWidth, `horizontal overflow at "${step}"`).toBeLessThanOrEqual(
    overflow.clientWidth
  );
}

export async function fontsReady(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}
