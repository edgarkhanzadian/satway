# Satway

Deposit to sBTC on Stacks from other chains in one flow.

The user sends an asset on an EVM chain NEAR Intents (1Click) supports. 1Click
swaps it to native BTC and pays it to a per-user sBTC deposit address that is
built in the user's browser. The sBTC signers mint sBTC to the user's Stacks
address. This project holds no funds and no user keys.

For now only EVM chains are offered, both as deposit origins and as withdrawal
destinations. The deposit asset list is limited by `SUPPORTED_ORIGIN_CHAINS` in
`packages/chains/src/metadata/chain-metadata.ts`; adding a chain there lists its
assets again (sent by hand, from the address, amount and memo the page shows).
Withdrawal destinations also need an address check for the chain, in
`destination-address.ts`.

## Layout

| Path              | What it is                                                                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core`   | Pure logic: deposit address, signer key verification, quote building and checking, payout detection, status, reclaim. No UI, no keys.                |
| `packages/chains` | The other chains: chain metadata and address checks, EVM transfer building, sending and send records. No UI and no browser globals.                  |
| `apps/web`        | Browser app (Vite + React): deposit flow, status tracking, recovery page.                                                                            |
| `apps/api`        | Cloudflare Worker: keeps the 1Click API key off the client, and notifies the sBTC signers of payouts if the user closed the tab.                     |
| `apps/e2e`        | Playwright end-to-end tests: the production web build and the real Worker code against a simulated world. See [End-to-end tests](#end-to-end-tests). |
| `scripts`         | Mainnet proof scripts and the bundle safety check.                                                                                                   |

### Structure inside the packages

Each directory below has an `index.ts` that is its public surface. Code outside a directory
imports only that `index.ts`; files inside a directory import their siblings directly.
`pnpm lint:deps` (dependency-cruiser) enforces every rule listed here, and ESLint adds the
ones it cannot see.

```
packages/core/src/
  shared/      http helpers, the zod wrapper (schema), errors, config
  bitcoin/     Esplora reads: address history, unspent outputs, transactions, tip height
  sbtc/        deposit address, signer keys, Emily, reclaim, deposit transaction check
  oneclick/    1Click client, quote and status schemas, quote checks, reading a status
  deposit/     the deposit flow: quote request, payout selection, observing, progress, amount checks
  index.ts     the package entry, the only file other packages import
packages/chains/src/
  metadata/    supported chains, EVM chain ids, native assets, address checks
  send/        wallet types, EVM transfers and sends, send records, send attempts
  index.ts     the package entry
apps/web/src/
  app/         main.tsx, app.tsx, app.css: composes the page
  features/    deposit, recover, chain-wallets (From panel), stacks-wallet (To panel)
  ui/          presentational components and shared panel styles
  shared/      backend client, receipts, progress checks, storage
apps/api/src/
  http/        routes, the 1Click proxy, POST /deposits
  notifier/    the scheduled signer notifier
  store/       the KV watch store, used by http and notifier
  index.ts     the Worker entry that wires http and notifier
```

The rules, in plain words:

- `packages/core`: `shared` imports nothing else in core. `bitcoin` imports only `shared`.
  `sbtc` imports `shared` and `bitcoin`. `oneclick` imports only `shared`, so `sbtc` and
  `oneclick` never import each other. `deposit` is a flow directory: every core directory
  other than `shared`, `bitcoin`, `sbtc` and `oneclick` is a flow (a `withdrawal` flow would
  sit beside `deposit`). A flow may import the four base layers; sibling flows never import
  each other, base layers never import a flow, and only `index.ts` imports a flow from
  outside it. Nothing outside the package imports anything but `index.ts`.
- `packages/core` and `packages/chains` run outside a browser: no React, no wallet UI, no
  `window`, `document`, `localStorage`, `sessionStorage` or `navigator`. Storage and fetch
  are passed in.
- `packages/chains` imports only the `@satway/core` entry among workspace packages, and no
  React, `@stacks/connect`, WalletConnect, apps, scripts or Panda output. `metadata` never
  imports `send`.
- `apps/web`: `app` may import anything and nothing imports it. A feature may import `ui`,
  `shared`, `@satway/core` and `@satway/chains`, never another feature (any directory under
  `features/`, including future ones); `app` passes values and callbacks between them. `ui`
  imports types only from `shared`, never a feature or `app`, and never a network-reading export of `@satway/core`. `shared` never imports a feature,
  `ui` or `app`.
- `apps/api`: `http` and `notifier` never import each other; both use `store`, and only
  `index.ts` wires them. Nothing imports `index.ts`.
- The two apps never import each other, nothing imports `scripts/`, and `scripts/` uses only
  the `@satway/core` and `@satway/chains` entries.
- `apps/e2e` imports `@satway/core` and `@satway/chains` through their entries and
  `apps/api` only through its entry (`@satway/api`, `apps/api/src/index.ts`). It never imports
  `apps/web` (it tests the built app in a browser), and nothing imports `apps/e2e`.

## Rules the code is built around

- Every address money is sent to is built locally from the user's own keys and
  can be recomputed by anyone from the receipt file.
- The Bitcoin chain decides whether BTC arrived. The swap provider's status and
  our own backend records are never the source of truth.
- The signer key is not trusted from one API: Hiro and a second Stacks node
  (ALEX's) must return the same key, and at least two recent confirmed deposits
  locked to it must have been swept on Bitcoin by what looks like a signer sweep
  (a spend through the deposit leaf that carries the signers' own UTXO).
- Fees and endpoints live in `packages/core/src/shared/config.ts`, checked in, and
  cannot be changed by a request, a host page or a server response.
- The production page runs only bundled code (`script-src 'self'`).

## Commands

Requires Node 26.13.1 and pnpm 10.33.0 (`proto use` installs both from `.prototools`).

```sh
pnpm install
pnpm test            # unit tests for core, chains, api and web
pnpm typecheck
pnpm build           # builds apps/web
pnpm check:bundle    # fails if the build could run un-bundled code
pnpm test:e2e        # Playwright end-to-end suite (not part of pnpm test)

pnpm dry-quote 25    # live mainnet check, moves no funds
```

## Code quality

The layout and tooling follow [leather-io/mono](https://github.com/leather-io/mono). Shared
configs live in `packages/eslint-config`, `packages/prettier-config` and
`packages/tsconfig-config`. CI (`.github/workflows/code-checks.yml`) runs all of these:

```sh
pnpm lint            # ESLint, type-aware, zero warnings, no comments allowed
pnpm lint:fix
pnpm format          # Prettier, with import sorting
pnpm format:check
pnpm lint:deps       # dependency-cruiser architecture rules
pnpm lint:filenames  # ls-lint: kebab-case file names
pnpm syncpack:lint   # exact, consistent dependency versions
pnpm typecheck
```

Styling uses [PandaCSS](https://panda-css.com), structured like leather-io/mono. Design values
(colour, type, spacing, radii, keyframes), recipes and global styles live in
`packages/panda-preset`; `apps/web/panda.config.ts` loads it with `strictTokens` and
`strictPropertyValues` on. `pnpm install` runs `panda codegen` (the web app's `prepare` script),
which writes the git-ignored `apps/web/satway-styles`; `lint`, `typecheck`, `build` and `dev`
run it again first. App code imports from `satway-styles/*` only: no `.css` files besides
`src/app/app.css` and Fontsource, no inline styles, no literal class names and no `[value]` escape
hatches (ESLint and dependency-cruiser enforce this).

Local development:

```sh
cp .env.example .env.local
pnpm --filter @satway/api dev      # http://localhost:8787
pnpm --filter @satway/web dev      # http://localhost:5173
```

## End-to-end tests

`apps/e2e` drives the production build of the web app in a real browser against the real
Worker code, with every outside service replaced by a simulated "world". Nothing touches a
real network, wallet or signer.

```sh
pnpm --filter @satway/e2e exec playwright install chromium webkit   # once
pnpm test:e2e                                  # builds the app for e2e, then runs the suite
pnpm test:e2e:ui                               # the same in Playwright's UI mode
pnpm --filter @satway/e2e exec playwright test tests/d-manual-send.spec.ts   # one file, reusing the last build
```

Failures keep a trace, a screenshot and `world-log.json` (every request the world, the
Worker and the wallets saw) in `apps/e2e/test-results`; the HTML report is in
`apps/e2e/playwright-report`.

### What runs for real

- **The web app**: `build:web` (`apps/e2e/scripts/build-web.ts`) builds `apps/web` with Vite's
  API, its own `vite.config.ts` and its real CSP, into the git-ignored `apps/e2e/.web-build`,
  with `VITE_API_URL=http://127.0.0.1:4392`. Vite's `envDir` is an empty temporary directory
  and the build refuses to run if `apps/web` has `.env` files the config would read, so no
  `.env*` file is ever loaded. `apps/web/dist` and `check:bundle` are untouched. A tiny static
  server (`scripts/serve-web.ts`, Playwright's `webServer`) serves it on `127.0.0.1:4391`.
- **The Worker**: `src/worker/worker.ts` calls the exported
  `handle(request, env, fetchFn, options)` from `@satway/api` with an in-memory KV
  (`src/worker/kv.ts`: key metadata on `put` and in `list`, 1,000 keys per `list` page like
  Cloudflare), fake rate-limit bindings on the world clock with the `wrangler.toml` limits
  (`src/worker/rate-limiter.ts`, `api.limiters`; `deny = true` refuses), a signer-key cache and
  fallback limiters of its own (the module-level ones would leak between tests in one process)
  and a `fetchFn` that goes to the world. `api.runScheduled()` calls the Worker's real
  `scheduled` handler; for that one awaited call the test process's global `fetch` points at
  the world (the handler uses the global) and the logged report is captured. This exercises
  the handler, CORS, the proxy sanitising, `POST /deposits`, the KV store and the notifier,
  but **not the workerd runtime** (it runs on Node). Requests from the page to the API origin
  never reach a socket: the routing layer hands them to `handle` in-process, so each test has
  its own Worker and KV and tests can run in parallel. Browsers do not apply CORS to responses
  a test fulfils, so the harness checks it like a browser would (preflight for non-simple
  requests, then `access-control-allow-origin` on the response) and fails the test otherwise.

### The world (`src/world`)

One `World` per test, seeded from the test title, so values are deterministic and tests are
isolated. Tests drive it through typed methods:

| Service                         | File          | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1Click                          | `oneclick.ts` | Token list (USDC on Base, ETH, USDT on Tron as a non-EVM asset the app must not offer, BTC, plus `extraTokens` a test adds), dry and live quotes that echo the request like the real API (truncated deadline, provider fee entry, signature), one deposit address per live quote, status PENDING_DEPOSIT → PROCESSING → SUCCESS (and INCOMPLETE_DEPOSIT, REFUNDED, FAILED). `tamper` rewrites quote responses; `completeSwap({ reportHash: false })` withholds the payout hash until `revealPayout(swap)`.                                                                                                                                                                                                                                                                                                                   |
| Bitcoin (mempool.space Esplora) | `bitcoin.ts`  | A chain of blocks, mempool, address utxo and history paging, tx, hex, outspend, fee estimates and `POST /tx`. Payouts are real signed transactions from a treasury wallet; the signers' sweep is a real taproot script-path spend. Every spend is validated (`script-check.ts`): the output exists and is unspent, fee ≥ 1 sat/vB, BIP68 relative locks against the output's confirmation height (`non-BIP68-final`), p2wpkh and taproot key-path signatures, and for script paths the control block commitment, the sBTC deposit or reclaim leaf, the reclaim leaf's CSV against nSequence, and the Schnorr signature for the leaf's key. Rejections use Esplora's `sendrawtransaction RPC error: {"code":…,"message":…}` form. Blocks are mined only on command; `hexOverrides` serves a wrong raw transaction for a txid. |
| Emily                           | `emily.ts`    | `/limits`, `GET /deposit?status=…`, `GET /deposit/:txid/:vout`, `POST /deposit` validating `transactionHex`, txid, output script and the deposit and reclaim scripts like the real service; statuses are set by the test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Hiro                            | `hiro.ts`     | The sBTC registry read of the current aggregate key, which the world generates (`keyOverride` replaces it). The world also seeds two confirmed deposits swept recently, which the app needs as evidence for that key: each sweep is a real signer sweep, spending the signers' own UTXO (120 BTC, taproot key path) as input 0 and the deposit through its deposit leaf as input 1, and carrying the UTXO forward to output 0, like `world.signers.sweep`. `world.replaceEvidence('unswept' \| 'only-one-swept' \| 'other-signer-key' \| 'without-signer-utxo')` swaps them; `world.evidence` lists them.                                                                                                                                                                                                                    |
| ALEX Stacks node                | `alex.ts`     | The second Stacks source the app reads the same key from (`GET /v2/data_var/…/sbtc-registry/current-aggregate-pubkey?proof=0`); `world.alex.keyOverride` makes it disagree.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| EVM                             | `evm.ts`      | Only reached through the wallet: records sent transactions and decodes native and ERC-20 transfers. With `autoMine = false` a transaction stays pending (no receipt) until `evm.mine()`, and only then credits 1Click; `revertNext` mines a reverted (`status: 0x0`) one that credits nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

Deposits reach 1Click the way they do in reality: an EVM wallet send landing credits the
swap deposit address. Useful controls: `world.reportDeposit()` (a manual
send), `world.completeSwap()` (pays BTC and reports SUCCESS), `world.mine(n)`,
`world.signers.accept|sweep|confirm|fail|mint(outpoint)`, `world.payTo(address, sats)` (dust
and outsiders), `world.addFault({ service, method, path, rpcMethod, bodyIncludes, callers,
outcome: reply | 'hang' | 'network-error', times, skip })` (`skip` lets that many matching
requests through first), `world.liveSwapFor(address)` (a live 1Click quote made outside the
page, for registering a watch directly), `world.hold(rule)` (answers the matching
request normally once the returned gate is released; `harness.idle()` does not wait for held
requests), and `world.log`, `world.requestsTo(service, filter)` for assertions.

### Network isolation

Every browser request goes through one route handler (`src/browser/harness.ts`): the app
origin passes through to the static server, the API origin goes to the in-process Worker,
Hiro, the ALEX Stacks node, mempool.space and Emily go to the world, and anything else (including
1Click from the page and every WebSocket) is aborted and recorded. On top of that the browser
runs behind a proxy that does not exist
(`127.0.0.1:9`, loopback excluded), so a request that escaped the routing layer would fail,
and each test process replaces the global `fetch` with a trap. After every test the fixture
fails it on any blocked request, CSP violation, CORS failure, uncaught page error, console
error, world request without a route, or real `fetch` from the test process. The only console
errors allowed by default are 404s on `/favicon.ico` and on Emily's `GET /deposit/:txid/:vout`
(the app reads a 404 as "not registered yet"). A test can allow more with
`test.use({ allow: { hosts, consoleErrors, worldUnexpected } })`. `tests/harness-*.spec.ts`
prove that each guard fires.

`harness.backendDown({ method, path, mode: 'refused' | 'hang', times })` takes our Worker
off the network for matching requests (connection refused, or held until `backendUp()`).

### Wallets (`src/wallets`, `src/browser/page-script.ts`)

An init script installs two wallets in every page and forwards each call to Node through one
binding, where the wallet logic, keys and request log live:

- **Test EVM Wallet**: an EIP-1193 provider announced through EIP-6963 (`eth_requestAccounts`,
  `eth_chainId`, `wallet_switchEthereumChain`, `eth_sendTransaction`, receipts). It starts on
  chain 1 (`test.use({ evmStartChainId })`).
- **Test Stacks Wallet**: a WBIP004 provider registered in `window.wbip_providers`, so the
  `@stacks/connect` 8.2.7 modal lists it as installed. `connect()` always shows that modal
  (`forceWalletSelect`), so `app.connectStacksWallet()` clicks the wallet's "Connect" button
  in it. It answers `getAddresses` with a mainnet Stacks address and BTC payment (p2wpkh) and
  taproot addresses from real keys, and signs PSBTs for real (`signPsbt`).

Script any wallet per test through `wallets.<evm|stacks>.behaviour`: `reject(method,
{ code: 4001 })`, `hang(method)`, `late(method)` (returns a gate to `release()`),
`malformed(method, value)`, `loseReply(method, 'hang' | { code, message })` (the wallet does
the work, for example broadcasts, and then the reply never comes or is an error); every request
is in `behaviour.requests`. The EVM wallet also has `switchMode = 'ignore'` (answers
`wallet_switchEthereumChain` but stays on its chain), `changeAccount()` and `changeChain(id)`,
which emit `accountsChanged` / `chainChanged` to listeners on the injected provider.

### Time

The context runs on Playwright's clock, installed at the world's time and flowing normally.
The world clock is the real clock plus an offset. `app.fastForward(ms)` waits until no request
is open, moves the world clock and then the page clock by `ms` (timers fire at most once) and
waits again; `app.tick()` is a 20-second fast-forward, the app's poll interval.
`app.waitForProgress(message)` checks the page and ticks until the message shows (at most 8
ticks). Bitcoin blocks only advance with `world.mine()`. The fake clock reports an error thrown in a timer as a console error, or as a failed
`tick()` when the jump ran it, so both still fail the test.

The Worker code reads `new Date()` and `Date.now()` itself (the e2e Worker also passes the world
clock as `handle()`'s `now` option, but the proxy and the scheduled handler read it directly), so for
each awaited Worker call (`dispatch`, `runScheduled`) `src/worker/worker.ts` replaces the
global `Date` with one that reads the world clock, and puts the real one back when the last
overlapping call ends (the fixture also resets it between tests). Code in the test process
that must not see world time uses `realNow()` from `src/world/clock.ts`; the harness measures
quiet periods with `performance.now()`. The in-memory KV keeps each entry's `expirationTtl`,
refuses one below 60 seconds like Cloudflare KV, and drops the entry once the world clock
passes it, so the 14-day watch TTL, the end of a watch 24 hours after its quote deadline,
the quote deadline window and the 15-minute wallet prompt
window all behave as they would after that much real time.

### Adding a scenario

Add `tests/<name>.spec.ts` and import `test` and `expect` from `../src/fixtures.js`. The
fixtures give `app` (page object: `open`, `connectStacksWallet`, `connectEvmWallet`,
`fillDeposit`, `getQuote`, `continue`, `sendFromWallet`, `clickSend`,
`waitForProgress`, `tick`, `openRecover`, `pickSavedReceipt`, `uploadReceipt`, `followDeposit`,
`newTab`, `expectComplete`), `world`, `api` (the Worker: `requests`, `kv`, `watch()`,
`runScheduled()`), `wallets` and `harness`. Assert both what the page says and what the world
saw; `src/scenario/checks.ts` has receipt, watch and Emily registration checks,
`src/scenario/journeys.ts` drives a deposit to "awaiting funds", payout or done and holds the
app's copy, and `src/scenario/reclaim.ts` drives and inspects reclaims. Prefer roles, labels
and visible text; the app has no `data-testid` attributes. A test tagged `@webkit` also runs in
the WebKit project. A console error a scenario causes on purpose (a 5xx the world returns) is
allowed per test with `harness.allowConsoleErrors(pattern)`.

### Scenarios

- `a-…` to `f-…`: the happy paths (phase 1).
- `m1-…` to `m10-…`: money safety: unknown swap status, lost EVM wallet replies, wallet
  rejections, two tabs, tampered quotes, unverifiable
  signer keys, network and account guards, tokens the wallet must not send, dust and outsiders
  on the deposit address.
- `r1-…` to `r8-…`: failure and recovery: refunded and failed swaps, short deposits, Emily
  registration failures, reclaims and their targeting, receipt files, receipt storage, the
  Worker watch lifecycle.
- `harness-…`: self-checks for the guards and for every simulated behaviour the scenarios rely
  on (spend validation, world clock and KV expiry, EVM pending/reverted/lost replies and events,
  faults, held requests).
- `s1-…` to `s6-…` (phase 3, resilience): our backend down at each step, each upstream down,
  hanging or malformed while a deposit is tracked, browser storage blocked or full, reloads,
  history and tab switches mid-flow, and a deposit left open for hours (requests and timers per poll stay constant; terminal states
  stop polling).
- `q1-…` to `q7-…` (phase 3, quality gates): axe (`@axe-core/playwright`, serious and critical
  fail) plus structure, names, route `aria-current`, live regions and visible focus in every
  main state in both themes; keyboard-only deposit and reclaim; 390x844 and 360x640 with touch;
  reduced motion and theme tokens; WebKit download and reclaim; the CSP,
  `eval`/`Function`, allowed origins, referrer and secrets of the production build.

### Live canary (real services, read-only, not part of `pnpm test:e2e`)

```sh
pnpm test:e2e:canary          # CANARY_ONECLICK_JWT=… optional; never printed
```

`playwright.canary.config.ts` runs `apps/e2e/canary` against the real Hiro, the ALEX Stacks node, mempool.space,
Emily and 1Click, with the production build and the real Worker
`handle` in-process (real `fetch`). It checks that signer verification, Emily limits and
mempool.space tip and fees parse, that the token list loads through the Worker, and that dry
quotes for EVM assets pass the app's own verification. The fake wallets
only hand out placeholder addresses. Safety rails in `src/canary/canary-fixtures.ts`: a click
on Continue, Send, Reclaim or “I checked my wallet” is swallowed and fails the test; a non-dry
quote or any other `POST` to the backend is aborted before it reaches the Worker; any
`POST` to Emily or `POST /tx` is aborted; wallet
calls other than address requests are refused; every such attempt fails the test. The canary
proves its own rails at the end of a run by pressing Continue and posting a non-dry quote.
`.github/workflows/canary.yml` runs it daily and on manual dispatch, never on pull requests.

### Real-wallet smoke test (manual, unverified, never in CI)

```sh
SMOKE_METAMASK_EXTENSION=/path/to/unpacked/metamask \
SMOKE_LEATHER_EXTENSION=/path/to/unpacked/leather \
pnpm test:e2e:smoke           # optional SMOKE_PROFILE_DIR keeps the wallets between runs
```

`playwright.smoke.config.ts` refuses to load when `CI` is set or the extension directories are
missing. It opens a headed persistent Chromium with both extensions against the production
build and real services, checks that the wallets are discovered, waits for you to approve the
connections in the extensions, gets a dry quote, then asks you to press Continue and the send
button yourself and to reject the request in MetaMask; it passes when the app shows the
rejection and no send record is left. It never clicks Continue or a send button, never types
into or approves anything in an extension, and blocks Emily registrations and `POST /tx`. It has not been run by its author (no extensions, no human at hand).

Where the app does something that looks wrong, the test asserts the correct behaviour and is
marked `test.fail` with a title starting `APP ISSUE:`; it starts failing the suite (as an
unexpected pass) once the app is fixed, and should then become a normal test.

### Not covered

workerd and Cloudflare KV semantics beyond TTL expiry, real wallets and their UIs (only the
manual smoke test), real 1Click, Emily and signer behaviour
beyond what the read-only canary sees (no live quote, no payout), Bitcoin scripts other than
p2wpkh, taproot key paths and the two sBTC deposit leaves, absolute locktimes, RBF,
cross-process `localStorage` timing beyond what Chromium does locally, Firefox, visual
regressions (there are no screenshot tests), and screen-reader output (axe and role checks only).

## Mainnet proof (moves real funds, small amounts)

There is no testnet for the swap leg, so the real path is tested on mainnet at
minimum size. Use a throwaway wallet. Set `TEST_STX_ADDRESS` and `TEST_BTC_WIF`
in `.env.local` first.

```sh
# 1. Does a 1Click payout get accepted as an sBTC deposit?
pnpm deposit-proof quote base USDC 12 0xYourBaseAddress
#    ...send the funds it asks for from your own wallet, then:
pnpm deposit-proof watch

# 2. Can an unprocessed deposit be reclaimed? Takes about a week (950 blocks).
pnpm deposit-proof quote base USDC 12 0xYourBaseAddress --no-notify
pnpm deposit-proof watch
pnpm reclaim --to bc1YourAddress              # prints the signed transaction
pnpm reclaim --to bc1YourAddress --broadcast  # once the timelock has passed
```

Proof records are written to `.proofs/` (git-ignored). They contain no secrets.

## Deploying the API

```sh
cd apps/api
npx wrangler kv namespace create DEPOSITS   # paste the id into wrangler.toml
npx wrangler secret put ONECLICK_JWT        # from partners.near-intents.org
# set ALLOWED_ORIGINS in wrangler.toml to the web app's origin
npx wrangler deploy
```

Build the web app with `VITE_API_URL` set to the deployed API's URL; the
Content-Security-Policy is generated from it.

The two rate-limit bindings in `wrangler.toml` (`DEPOSIT_RATE_LIMITER`,
`PROXY_RATE_LIMITER`) need no setup beyond the file: pick `namespace_id`s
that no other Worker on the account uses. They are written as
`[[unsafe.bindings]]` because the pinned Wrangler 3 predates the
`[[ratelimits]]` key. Their limits must match `DEPOSIT_RATE` and `PROXY_RATE`
in `apps/api/src/http/rate-limit.ts`. Without the bindings the Worker falls
back to a per-isolate counter, which is much weaker.

What `POST /deposits` accepts, and what it costs:

- Body: `{ depositScript, reclaimScript, swapDepositAddress }`, at most 2 KiB
  (413 above). `swapDepositAddress` (the 1Click deposit address) is required.
- Checked in this order, cheapest first: script shape (the deposit script
  carries `maxSignerFeeSats` and a standard principal, the reclaim script
  carries `reclaimLockBlocks`), then the per-IP rate limit (429 with
  `Retry-After`), then the signer key (it must be the current aggregate key
  from the sBTC registry; cached 10 minutes in memory and in KV), then
  duplicates (409), then `GET /v0/status` at 1Click with the Worker's key
  (the swap must pay the derived address in native BTC, not be refunded or
  failed, and its deadline must not have passed), then the cap on watched
  swaps (`MAX_ACTIVE_WATCHES`, counted per swap from KV key metadata in one
  list call; 503 with `Retry-After` when full), then the mempool.space snapshot
  and one KV write. Invalid requests make no outbound call; 503 means an
  upstream (Hiro, 1Click) could not be read. When 1Click does not know the swap
  the 400 body carries `code: "unknown-swap"`; the web app retries that one
  answer five times in the background, after 5 s, 20 s, 1 min, 2 min and 4 min
  (about seven and a half minutes in all), since 1Click's status can lag behind
  the quote it just created.
- The scheduled run visits at most `MAX_ADDRESSES_PER_RUN` watches, in a window
  that rotates over the sorted keys each run, and makes at most
  `RUN_SUBREQUEST_BUDGET` fetch and KV calls (under the Workers Free limit of
  50 subrequests). A watch ends when its payout is registered, or when every
  swap on it is 24 hours past its deadline with no eligible payout unregistered,
  and in any case after 14 days (the KV TTL). The constants live in
  `apps/api/src/store/limits.ts`.

## Notes

- The repo runs on Node 26.13.1 (the current LTS, "Lithium") and pnpm 10.33.0.
  Both are pinned in `.prototools` (read by proto), `.nvmrc` and `.node-version`
  (read by nvm, fnm and CI), `engines` and `packageManager` in `package.json`.
  `.npmrc` sets `engine-strict`, so an older Node refuses to install.
- Responses from 1Click, Hiro, Emily, mempool.space and the wallet are checked
  with zod schemas before use. The schemas keep unknown fields, so a stored quote
  response keeps every field the provider sent. zod runs in `jitless` mode (set in
  `packages/core/src/shared/schema.ts`; import `z` from `@satway/core`), so it never
  needs `eval` under the page's CSP.
- `@stacks/connect` bundles WalletConnect, which is most of the bundle size.
