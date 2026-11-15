import { NO_ALLOWANCES, collectViolations } from '../src/browser/violations.js';
import { API_ORIGIN, APP_ORIGIN } from '../src/config.js';
import { expect, test } from '../src/fixtures.js';

test.describe('harness self-check: the Worker CORS rules are enforced like a browser would', () => {
  test.use({ workerEnv: { ALLOWED_ORIGINS: 'https://someone-else.example' } });

  test('a Worker that does not allow the app origin breaks the page', async ({
    app,
    harness,
    world,
  }) => {
    await app.open();
    await app.connectStacksWallet();
    await expect(app.page.getByRole('alert')).toContainText('Could not load the asset list');
    await harness.idle();
    const found = collectViolations(harness, world, [], NO_ALLOWANCES);
    expect(found.corsFailures.map(f => f.text)).toEqual([
      expect.stringMatching(
        new RegExp(`^GET ${API_ORIGIN}/tokens: response did not allow origin ${APP_ORIGIN}`)
      ),
    ]);
    harness.acknowledge();
  });
});
