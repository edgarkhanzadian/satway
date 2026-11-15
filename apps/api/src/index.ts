import { MAINNET_CONFIG as config } from '@portage/core';

import { type Env, handle } from './http/index.js';
import { runNotifier } from './notifier/index.js';

export { type Env, handle };

export default {
  fetch: (request: Request, env: Env) => handle(request, env),
  async scheduled(_event: unknown, env: Env): Promise<void> {
    const report = await runNotifier(env.DEPOSITS, config);
    console.log(JSON.stringify(report));
  },
};
