import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { type Plugin, defineConfig, loadEnv } from 'vite';

function contentSecurityPolicy(apiUrl: string): Plugin {
  const connect = [
    "'self'",
    new URL(apiUrl).origin,
    'https://api.hiro.so',
    'https://stacks-node.alexlab.co',
    'https://mempool.space',
    'https://sbtc-emily.com',
    'https://*.walletconnect.com',
    'https://*.walletconnect.org',
    'wss://*.walletconnect.com',
    'wss://*.walletconnect.org',
    'wss://relay.walletconnect.org',
  ];
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connect.join(' ')}`,
    'frame-src https://verify.walletconnect.org',
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'none'",
  ].join('; ');
  return {
    name: 'portage-csp',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
        injectTo: 'head-prepend',
      },
    ],
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [react(), contentSecurityPolicy(env.VITE_API_URL ?? 'http://localhost:8787')],
    resolve: {
      alias: { 'portage-styles': fileURLToPath(new URL('portage-styles', import.meta.url)) },
    },
    build: { target: 'es2022', sourcemap: true },
    server: { port: 5173 },
  };
});
