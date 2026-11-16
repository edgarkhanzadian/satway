// Fails the build if the web bundle could run code that was not bundled.
//
// The page builds Bitcoin addresses in the browser, so any script loaded at
// runtime could swap an address. This checks the built output for the ways
// that happens: remote scripts or styles in the HTML, a missing or weakened
// Content-Security-Policy, eval-style code loading in the bundle, and
// dependencies that are not pinned to an exact version. It also pins the
// CSP's connect-src and frame-src to the hosts the app is known to need.
// Lazily loaded chunks in dist/assets are fine: they are bundled, served from
// 'self' and scanned here like every other script.
//
// Usage: pnpm build && pnpm check:bundle
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'apps', 'web', 'dist');
const problems = [];

if (!existsSync(dist)) {
  console.error('apps/web/dist not found. Run "pnpm build" first.');
  process.exit(1);
}

const html = readFileSync(join(dist, 'index.html'), 'utf8');

for (const match of html.matchAll(
  /<(script|link|iframe|img)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi
)) {
  const [, tag, url] = match;
  if (/^(https?:)?\/\//i.test(url)) problems.push(`index.html loads a remote ${tag}: ${url}`);
}
if (/<script(?![^>]*\bsrc=)[^>]*>\s*\S/i.test(html)) {
  problems.push('index.html contains an inline script');
}

// The build tool writes quotes inside the attribute as HTML entities; the
// browser decodes them, so decode them the same way before checking.
const csp = /http-equiv="Content-Security-Policy"[^>]*content="([^"]+)"/is
  .exec(html)?.[1]
  ?.replaceAll('&#39;', "'")
  .replaceAll('&quot;', '"')
  .replaceAll('&amp;', '&');
if (!csp) {
  problems.push('index.html has no Content-Security-Policy');
} else {
  const scriptSrc = /script-src([^;]*)/.exec(csp)?.[1] ?? '';
  if (!scriptSrc.trim()) problems.push('CSP has no script-src');
  for (const bad of ["'unsafe-inline'", "'unsafe-eval'", 'http:', 'https:', '*']) {
    if (scriptSrc.split(/\s+/).includes(bad)) problems.push(`CSP script-src allows ${bad}`);
  }
  if (scriptSrc.trim() !== "'self'")
    problems.push(`CSP script-src must be exactly 'self' (found: ${scriptSrc.trim()})`);
  if (!/object-src\s+'none'/.test(csp)) problems.push("CSP must set object-src 'none'");
  if (!/base-uri\s+'self'/.test(csp)) problems.push("CSP must set base-uri 'self'");

  // The app frames nothing.
  const frameSrc = /frame-src([^;]*)/.exec(csp)?.[1]?.trim() ?? '';
  if (frameSrc !== "'none'")
    problems.push(`CSP frame-src must be exactly 'none' (found: ${frameSrc})`);
  if (/(?:^|;)\s*child-src/.test(csp)) problems.push('CSP must not set child-src');

  // Connections go to a fixed list, plus the backend API origin from VITE_API_URL.
  // stacks-node.alexlab.co is the second Stacks node (run by ALEX, not Hiro) that
  // must agree with api.hiro.so on the sBTC signer key before an address is built.
  const allowedConnect = new Set([
    "'self'",
    'https://api.hiro.so',
    'https://stacks-node.alexlab.co',
    'https://mempool.space',
    'https://sbtc-emily.com',
    'https://rpc.walletconnect.org',
  ]);
  const connectSrc = (/connect-src([^;]*)/.exec(csp)?.[1] ?? '').trim().split(/\s+/);
  // Solana sends read and simulate through Reown's RPC at rpc.walletconnect.org.
  if (!connectSrc.includes('https://rpc.walletconnect.org'))
    problems.push('CSP connect-src must allow the Solana RPC https://rpc.walletconnect.org');
  const extra = connectSrc.filter(source => !allowedConnect.has(source));
  const apiOrigin =
    /^(?:https:\/\/[a-z0-9.-]+(?::\d+)?|http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?)$/;
  if (extra.length > 1 || extra.some(source => !apiOrigin.test(source)))
    problems.push(`CSP connect-src has sources outside the allowlist: ${extra.join(' ')}`);
}

// Eval-style code. The CSP already blocks it at runtime, but blocked code is a
// broken feature and a CSP violation report, so it must not ship at all.
// zod has two Function sites: a feature probe that returns early when
// `jitless` is set, and the object JIT compiler, which only runs when the probe
// succeeded. packages/core/src/shared/schema.ts sets `z.config({ jitless: true })`
// before any schema exists, so neither runs. They are allowed only while that
// config call is in the bundle.
const directEval = /(?<![\w$.])eval\s*\(/;
const functionCall = /(?<![\w$.])(?:new\s+)?Function\s*\(/;
const stringTimer = /(?<![\w$.])set(?:Timeout|Interval)\s*\(\s*["'`]/;
const functionAlias = /(?<![\w$.])[\w$]+\s*=\s*Function\s*[;,)]/g;
const zodFunctionSites = [
  /\.jitless\|\|[^{}]{0,120}\)\)return!1;try\{const ([\w$]+)=Function;return new \1\(""\),!0\}/g,
  /compile\(\)\{const ([\w$]+)=Function,[^}]{0,80}return new \1\(\.\.\.Object\.keys\(this\.closed\)/g,
];
let zodSites = 0;
let jitlessConfigured = false;

const assets = join(dist, 'assets');
const scripts = existsSync(assets) ? readdirSync(assets).filter(f => f.endsWith('.js')) : [];
if (scripts.length === 0) problems.push('no bundled scripts found in dist/assets');
for (const file of scripts) {
  const code = readFileSync(join(assets, file), 'utf8');
  if (/\bimport\s*\(\s*["'`]https?:/.test(code))
    problems.push(`${file} dynamically imports a remote module`);
  if (/createElement\(\s*["']script["']\s*\)/.test(code))
    problems.push(`${file} creates script elements at runtime`);
  if (/\bimportScripts\s*\(/.test(code)) problems.push(`${file} calls importScripts`);
  if (directEval.test(code)) problems.push(`${file} calls eval`);
  if (functionCall.test(code)) problems.push(`${file} builds code with Function()`);
  if (stringTimer.test(code)) problems.push(`${file} passes a string to setTimeout/setInterval`);
  const aliases = code.match(functionAlias)?.length ?? 0;
  const known = zodFunctionSites.reduce((n, site) => n + (code.match(site)?.length ?? 0), 0);
  if (aliases !== known)
    problems.push(
      `${file} aliases Function ${aliases - known} time(s) outside zod's guarded sites`
    );
  zodSites += known;
  if (/\(\{jitless:!0\}\)/.test(code)) jitlessConfigured = true;
}
if (zodSites > 0 && !jitlessConfigured)
  problems.push("the bundle contains zod's JIT but not the z.config({ jitless: true }) call");

for (const pkgPath of ['packages/core', 'packages/chains', 'apps/web', 'apps/api']) {
  const pkg = JSON.parse(readFileSync(join(root, pkgPath, 'package.json'), 'utf8'));
  for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
    if (version.startsWith('workspace:')) continue;
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      problems.push(
        `${pkgPath}: runtime dependency ${name} is not pinned to an exact version (${version})`
      );
    }
  }
}
if (!existsSync(join(root, 'pnpm-lock.yaml'))) problems.push('pnpm-lock.yaml is missing');

if (problems.length > 0) {
  console.error('Bundle check failed:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(
  `Bundle check passed: ${scripts.length} script(s), no remote or runtime-loaded code, CSP locked to 'self', dependencies pinned.`
);
