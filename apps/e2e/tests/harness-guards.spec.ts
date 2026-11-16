import { NO_ALLOWANCES, collectViolations } from '../src/browser/violations.js';
import { expect, test } from '../src/fixtures.js';

test.describe('harness self-checks: the always-on guards see what they must', () => {
  test.beforeEach(async ({ app }) => {
    await app.open();
  });

  test('a request to a host outside the world is blocked and recorded', async ({
    app,
    harness,
    world,
  }) => {
    const outside = await app.page.context().newPage();
    await outside.evaluate(async () => {
      try {
        await fetch('https://outside.example/v3/wallets');
      } catch {
        return;
      }
    });
    await outside.close();
    await harness.idle();
    const found = collectViolations(harness, world, [], NO_ALLOWANCES);
    expect(found.blockedRequests.map(r => r.url)).toEqual(['https://outside.example/v3/wallets']);
    harness.acknowledge();
  });

  test('a page script outside the bundle is a CSP violation', async ({ app, harness, world }) => {
    await app.page.evaluate(() => {
      const script = document.createElement('script');
      script.textContent = 'window.injected = true';
      document.head.append(script);
    });
    await expect.poll(() => harness.csp.length).toBeGreaterThan(0);
    const found = collectViolations(harness, world, [], NO_ALLOWANCES);
    expect(found.cspViolations).toEqual([
      expect.objectContaining({ effectiveDirective: 'script-src-elem', blockedURI: 'inline' }),
    ]);
    harness.acknowledge();
  });

  test('an uncaught error and a console error are recorded', async ({ app, harness, world }) => {
    await app.page.evaluate(() => {
      queueMicrotask(() => {
        throw new Error('boom from the page');
      });
    });
    await app.page.evaluate('console.error("something went wrong")');
    await expect.poll(() => harness.pageErrors.length).toBe(1);
    const found = collectViolations(harness, world, [], NO_ALLOWANCES);
    expect(found.pageErrors[0]?.text).toContain('boom from the page');
    expect(found.consoleErrors.map(e => e.text)).toEqual(['something went wrong']);
    harness.acknowledge();
  });

  test('an error thrown in a timer that time reaches by itself becomes a console error', async ({
    app,
    harness,
    world,
  }) => {
    await app.page.evaluate(() => {
      setTimeout(() => {
        throw new Error('boom from a timer');
      }, 10);
    });
    await expect.poll(() => harness.consoleErrors.length).toBe(1);
    const found = collectViolations(harness, world, [], NO_ALLOWANCES);
    expect(found.consoleErrors[0]?.text).toContain('boom from a timer');
    harness.acknowledge();
  });

  test('an error thrown in a timer that a fast-forward runs fails the fast-forward', async ({
    app,
  }) => {
    await app.page.evaluate(() => {
      setTimeout(() => {
        throw new Error('boom from a polled timer');
      }, 20_000);
    });
    await expect(app.tick()).rejects.toThrow('boom from a polled timer');
  });

  test('a world route that does not exist is recorded', async ({ app, harness, world }) => {
    await app.page.evaluate(async () => {
      await fetch('https://mempool.space/api/v1/not-a-route');
    });
    await harness.idle();
    expect(collectViolations(harness, world, [], NO_ALLOWANCES).worldUnexpected).toEqual([
      'page GET https://mempool.space/api/v1/not-a-route -> 404 (no world route)',
    ]);
    harness.acknowledge();
  });

  test('the test process cannot use the real network', async ({ realNodeFetches }) => {
    const before = realNodeFetches.length;
    await expect(fetch('https://api.hiro.so/v2/info')).rejects.toThrow(
      'A test process tried to use the real network'
    );
    expect(realNodeFetches.slice(before)).toEqual(['https://api.hiro.so/v2/info']);
    realNodeFetches.splice(before);
  });
});
