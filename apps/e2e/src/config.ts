import { fileURLToPath } from 'node:url';

export const APP_PORT = 4391;
export const APP_ORIGIN = `http://127.0.0.1:${APP_PORT}`;
export const API_ORIGIN = 'http://127.0.0.1:4392';

export const WEB_BUILD_DIR = fileURLToPath(new URL('../.web-build', import.meta.url));

export const BLACK_HOLE_PROXY = { server: 'http://127.0.0.1:9', bypass: '127.0.0.1' };

export const FAVICON_URL = `${APP_ORIGIN}/favicon.ico`;

export const POLL_INTERVAL_MS = 20_000;

export const TEST_ONECLICK_JWT = 'e2e-test-oneclick-jwt';

export const UPSTREAM = {
  hiro: 'https://api.hiro.so',
  mempool: 'https://mempool.space',
  emily: 'https://sbtc-emily.com',
  oneClick: 'https://1click.chaindefuser.com',
  solanaRpc: 'https://rpc.walletconnect.org',
} as const;

export const SOLANA_MAINNET_CAIP2 = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

export const PAGE_REACHABLE_UPSTREAMS: readonly string[] = [
  UPSTREAM.hiro,
  UPSTREAM.mempool,
  UPSTREAM.emily,
  UPSTREAM.solanaRpc,
];
