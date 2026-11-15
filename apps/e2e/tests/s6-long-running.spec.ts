import { PROGRESS, type PortageApp } from '../src/app/portage-app.js';
import type { Harness } from '../src/browser/harness.js';
import { installTimerProbe, timerCounts } from '../src/browser/probes.js';
import { expect, test } from '../src/fixtures.js';
import { finishJourney, startAwaitingFunds } from '../src/scenario/journeys.js';

const TEN_MINUTES = 10 * 60_000;
const HOUR = 60 * 60_000;

function pageRequests(harness: Harness): number {
  return harness.network.filter(e => e.handledBy !== 'app').length;
}

async function pollOnce(app: PortageApp, harness: Harness, ms: number): Promise<number> {
  const before = pageRequests(harness);
  await app.fastForward(ms);
  return pageRequests(harness) - before;
}

test.describe('S6. a deposit left open for a long time', () => {
  test('five simulated hours awaiting funds: one poll per interval, a constant number of requests per poll, no timer growth', async ({
    app,
    harness,
  }) => {
    await installTimerProbe(app.page);
    await startAwaitingFunds(app);
    await pollOnce(app, harness, TEN_MINUTES);
    const baseline = await timerCounts(app.page);
    const perPoll: number[] = [];
    for (let i = 0; i < 30; i++) {
      perPoll.push(await pollOnce(app, harness, TEN_MINUTES));
      expect(await timerCounts(app.page)).toEqual(baseline);
    }
    const first = perPoll[0] ?? 0;
    expect(first).toBeGreaterThan(0);
    expect(perPoll).toEqual(perPoll.map(() => first));
    expect(baseline.intervals).toBe(0);
    expect(baseline.longTimeouts).toBe(1);
    await expect(app.progress(PROGRESS.awaitingFunds)).toBeVisible();
  });

  test('the quote deadline passes before any funds arrive: while 1Click still reports PENDING_DEPOSIT the page keeps offering the wallet send and the stale "before" time', async ({
    app,
    world,
  }) => {
    const started = await startAwaitingFunds(app);
    const deadline = started.receipt.quoteResponse.quote;
    const shown = app.page.getByText(/^before /);
    const before = await shown.innerText();
    await app.fastForward(2 * HOUR + TEN_MINUTES);
    await app.tick();
    expect(world.swap().status).toBe('PENDING_DEPOSIT');
    await expect(shown).toHaveText(before);
    await expect(app.sendButton).toBeVisible();
    await expect(app.progress(PROGRESS.awaitingFunds)).toBeVisible();
    expect(deadline.depositAddress).toBe(world.swap().depositAddress);
  });

  test('terminal states stop polling: after Done, hours pass with no requests and no pending poll timer', async ({
    app,
    harness,
    world,
  }) => {
    await installTimerProbe(app.page);
    await startAwaitingFunds(app);
    await app.sendFromWallet();
    await finishJourney(app, world);
    for (let i = 0; i < 6; i++) expect(await pollOnce(app, harness, HOUR)).toBe(0);
    expect((await timerCounts(app.page)).longTimeouts).toBeLessThanOrEqual(1);
  });
});
