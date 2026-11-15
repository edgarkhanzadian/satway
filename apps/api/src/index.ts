import { MAINNET_CONFIG as config } from '@satway/core';

import { type Env, handle } from './http/index.js';
import { CRON_PERIOD_MS, runNotifier } from './notifier/index.js';

export { type Env, handle };

function scheduledTimeOf(event: unknown): Date {
  const time: unknown =
    typeof event === 'object' && event !== null ? Reflect.get(event, 'scheduledTime') : undefined;
  return typeof time === 'number' && Number.isFinite(time) ? new Date(time) : new Date();
}

export default {
  fetch: (request: Request, env: Env) => handle(request, env),
  async scheduled(event: unknown, env: Env): Promise<void> {
    const now = scheduledTimeOf(event);
    const report = await runNotifier(env.DEPOSITS, config, undefined, {
      now,
      runIndex: Math.floor(now.getTime() / CRON_PERIOD_MS),
    });
    console.log(JSON.stringify(report));
  },
};
