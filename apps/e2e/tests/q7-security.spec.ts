import type { Request } from '@playwright/test';

import { PROGRESS } from '../src/app/satway-app.js';
import { codeEvalCounts, installCodeEvalProbe } from '../src/browser/probes.js';
import { API_ORIGIN, APP_ORIGIN, TEST_ONECLICK_JWT, UPSTREAM } from '../src/config.js';
import { expect, test } from '../src/fixtures.js';
import { finishJourney, startAwaitingFunds } from '../src/scenario/journeys.js';

const JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]+/;

const EXPECTED_CSP: Record<string, string[]> = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'blob:'],
  'font-src': ["'self'", 'data:'],
  'connect-src': [
    "'self'",
    API_ORIGIN,
    'https://api.hiro.so',
    'https://stacks-node.alexlab.co',
    'https://mempool.space',
    'https://sbtc-emily.com',
  ],
  'frame-src': ["'none'"],
  'base-uri': ["'self'"],
  'object-src': ["'none'"],
  'form-action': ["'none'"],
};

interface SeenRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

test.describe('Q7. security posture of the production build', () => {
  test('the CSP meta is exactly the expected policy, there are no inline scripts, and the referrer is withheld', async ({
    app,
  }) => {
    await app.open();
    const page = await app.page.evaluate(() => ({
      csp: document
        .querySelector('meta[http-equiv="Content-Security-Policy"]')
        ?.getAttribute('content'),
      cspMetas: document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]').length,
      referrer: document.querySelector('meta[name="referrer"]')?.getAttribute('content'),
      inlineScripts: document.querySelectorAll('script:not([src])').length,
      scriptSources: Array.from(document.querySelectorAll('script[src]')).map(s =>
        s.getAttribute('src')
      ),
      inlineHandlers: Array.from(document.querySelectorAll('*')).filter(el =>
        el.getAttributeNames().some(n => n.startsWith('on'))
      ).length,
    }));
    expect(page.cspMetas).toBe(1);
    const directives: Record<string, string[]> = {};
    for (const part of (page.csp ?? '').split(';')) {
      const [name, ...values] = part.trim().split(/\s+/);
      if (name !== undefined && name !== '') directives[name] = values;
    }
    expect(directives).toEqual(EXPECTED_CSP);
    expect(page.csp).not.toContain('unsafe-eval');
    expect(page.referrer).toBe('no-referrer');
    expect(page.inlineScripts).toBe(0);
    expect(page.inlineHandlers).toBe(0);
    for (const src of page.scriptSources) {
      if (src === null) throw new Error('A script element lost its src');
      expect(new URL(src, APP_ORIGIN).origin).toBe(APP_ORIGIN);
    }
  });

  test('a full journey: no eval or new Function, only allowlisted origins, nothing third-party before a user action, no referrer, no JWT outside Worker->1Click', async ({
    app,
    harness,
    world,
    api,
  }) => {
    await installCodeEvalProbe(app.page);
    const seen: SeenRequest[] = [];
    app.page.on('request', (request: Request) => {
      seen.push({
        url: request.url(),
        headers: request.headers(),
        body: request.postData() ?? '',
      });
    });

    await app.open();
    await harness.idle();
    expect(harness.network.filter(e => new URL(e.url).origin !== APP_ORIGIN)).toEqual([]);

    await startAwaitingFunds(app);
    await app.sendFromWallet();
    await finishJourney(app, world);
    await expect(app.progress(PROGRESS.done)).toBeVisible();

    expect(await codeEvalCounts(app.page)).toEqual({ evalCalls: 0, functionCalls: 0 });

    const origins = [...new Set(harness.network.map(e => new URL(e.url).origin))].sort();
    expect(origins).toEqual(
      [
        APP_ORIGIN,
        API_ORIGIN,
        UPSTREAM.hiro,
        UPSTREAM.alex,
        UPSTREAM.mempool,
        UPSTREAM.emily,
      ].sort()
    );

    const offOrigin = seen.filter(r => new URL(r.url).origin !== APP_ORIGIN);
    expect(offOrigin.length).toBeGreaterThan(0);
    for (const r of offOrigin) expect(r.headers.referer, r.url).toBeUndefined();

    const nonBackend = seen.filter(r => ![APP_ORIGIN, API_ORIGIN].includes(new URL(r.url).origin));
    for (const r of [...nonBackend, ...seen.filter(r => new URL(r.url).origin === API_ORIGIN)]) {
      const everything = `${r.url}\n${JSON.stringify(r.headers)}\n${r.body}`;
      expect(everything, r.url).not.toContain(TEST_ONECLICK_JWT);
      expect(everything, r.url).not.toMatch(JWT);
    }
    for (const r of api.requests) expect(r.responseBody).not.toContain(TEST_ONECLICK_JWT);

    const html = await app.page.content();
    expect(html).not.toContain(TEST_ONECLICK_JWT);
    expect(html).not.toMatch(JWT);
    for (const [key, value] of Object.entries(await app.storage())) {
      expect(value, key).not.toContain(TEST_ONECLICK_JWT);
      expect(value, key).not.toMatch(JWT);
    }

    expect(world.authorizations.length).toBeGreaterThan(0);
    expect(
      world.authorizations.map(a => ({ caller: a.caller, service: a.service, value: a.value }))
    ).toEqual(
      world.authorizations.map(() => ({
        caller: 'worker',
        service: 'oneclick',
        value: `Bearer ${TEST_ONECLICK_JWT}`,
      }))
    );
  });
});
