import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

import { API_ORIGIN, WEB_BUILD_DIR } from '../src/config.js';

const webRoot = fileURLToPath(new URL('../../web', import.meta.url));

function fail(message: string): never {
  process.stderr.write(`build-web: ${message}\n`);
  process.exit(1);
}

const codegen = spawnSync('pnpm', ['--filter', '@satway/web', 'codegen'], { stdio: 'inherit' });
if (codegen.status !== 0) fail('panda codegen failed');

const readByWebConfig = ['.env', '.env.local', '.env.production', '.env.production.local'];
const present = readByWebConfig.filter(name => existsSync(join(webRoot, name)));
if (present.length > 0)
  fail(
    `apps/web has ${present.join(', ')}; apps/web/vite.config.ts would read it. Move it away before building for e2e.`
  );

const envDir = mkdtempSync(join(tmpdir(), 'satway-e2e-env-'));
const startDir = process.cwd();
process.env.VITE_API_URL = API_ORIGIN;
process.chdir(webRoot);
try {
  await build({
    root: webRoot,
    configFile: join(webRoot, 'vite.config.ts'),
    envDir,
    mode: 'production',
    logLevel: 'warn',
    build: { outDir: WEB_BUILD_DIR, emptyOutDir: true },
  });
} finally {
  process.chdir(startDir);
  rmSync(envDir, { recursive: true, force: true });
}

const html = readFileSync(join(WEB_BUILD_DIR, 'index.html'), 'utf8');
if (
  !html.includes(`connect-src &#39;self&#39; ${API_ORIGIN} `) &&
  !html.includes(`connect-src 'self' ${API_ORIGIN} `)
)
  fail(`the built CSP does not allow the e2e API origin ${API_ORIGIN}`);
const assets = join(WEB_BUILD_DIR, 'assets');
const scripts = readdirSync(assets).filter(f => f.endsWith('.js'));
const bundle = scripts.map(f => readFileSync(join(assets, f), 'utf8')).join('\n');
if (!bundle.includes(API_ORIGIN)) fail(`the bundle does not call the e2e API origin ${API_ORIGIN}`);
if (bundle.includes('localhost:8787')) fail('the bundle still points at the default API origin');
process.stdout.write(
  `build-web: built ${scripts.length} scripts into ${WEB_BUILD_DIR} for ${API_ORIGIN}\n`
);
