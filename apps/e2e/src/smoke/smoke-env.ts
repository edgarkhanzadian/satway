import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const SMOKE_ENV = {
  metamask: 'SMOKE_METAMASK_EXTENSION',
  leather: 'SMOKE_LEATHER_EXTENSION',
  profile: 'SMOKE_PROFILE_DIR',
} as const;

function unpackedExtension(path: string | undefined): boolean {
  return (
    path !== undefined &&
    existsSync(path) &&
    statSync(path).isDirectory() &&
    existsSync(join(path, 'manifest.json'))
  );
}

export function smokeEnvProblem(env: NodeJS.ProcessEnv): string | null {
  const missing = [SMOKE_ENV.metamask, SMOKE_ENV.leather].filter(
    name => !unpackedExtension(env[name])
  );
  if (missing.length === 0) return null;
  return [
    `The real-wallet smoke test needs ${missing.join(' and ')} to point at unpacked extension directories (each with a manifest.json).`,
    'Unpack MetaMask and Leather into local folders, set up a throwaway wallet in each by hand, then run for example:',
    `  ${SMOKE_ENV.metamask}=/path/to/metamask ${SMOKE_ENV.leather}=/path/to/leather pnpm test:e2e:smoke`,
    `Optionally set ${SMOKE_ENV.profile} to a Chromium profile directory to keep the wallets between runs.`,
    'See README "Real-wallet smoke test".',
  ].join('\n');
}
