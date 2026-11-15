import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { API_ORIGIN, WEB_BUILD_DIR } from './config.js';

export default function globalSetup(): void {
  const index = join(WEB_BUILD_DIR, 'index.html');
  if (!existsSync(index)) {
    throw new Error(
      `No e2e web build at ${WEB_BUILD_DIR}. Run "pnpm --filter @portage/e2e build:web" first, or use "pnpm test:e2e".`
    );
  }
  if (!readFileSync(index, 'utf8').includes(API_ORIGIN)) {
    throw new Error(
      `The e2e web build at ${WEB_BUILD_DIR} was not built for ${API_ORIGIN}. Rebuild it with build:web.`
    );
  }
}
