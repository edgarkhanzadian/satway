# Portage

Deposit to sBTC on Stacks from other chains in one flow.

The user sends an asset on any chain NEAR Intents (1Click) supports. 1Click
swaps it to native BTC and pays it to a per-user sBTC deposit address that is
built in the user's browser. The sBTC signers mint sBTC to the user's Stacks
address. This project holds no funds and no user keys.

## Layout

| Path            | What it is                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core` | Pure logic: deposit address, signer key verification, quote building and checking, payout detection, status, reclaim. No UI, no keys. |
| `apps/web`      | Browser app (Vite + React): deposit flow, status tracking, recovery page.                                                             |
| `apps/api`      | Cloudflare Worker: keeps the 1Click API key off the client, and notifies the sBTC signers of payouts if the user closed the tab.      |
| `scripts`       | Mainnet proof scripts and the bundle safety check.                                                                                    |

## Rules the code is built around

- Every address money is sent to is built locally from the user's own keys and
  can be recomputed by anyone from the receipt file.
- The Bitcoin chain decides whether BTC arrived. The swap provider's status and
  our own backend records are never the source of truth.
- The signer key is not trusted from one API: it must also appear in recent
  confirmed deposits and have swept one on Bitcoin recently.
- Fees and endpoints live in `packages/core/src/config.ts`, checked in, and
  cannot be changed by a request, a host page or a server response.
- The production page runs only bundled code (`script-src 'self'`).

## Commands

Requires Node 26.13.1 and pnpm 10.33.0 (`proto use` installs both from `.prototools`).

```sh
pnpm install
pnpm test            # unit tests for core, api and web
pnpm typecheck
pnpm build           # builds apps/web
pnpm check:bundle    # fails if the build could run un-bundled code

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
which writes the git-ignored `apps/web/portage-styles`; `lint`, `typecheck`, `build` and `dev`
run it again first. App code imports from `portage-styles/*` only: no `.css` files besides
`src/app.css` and Fontsource, no inline styles, no literal class names and no `[value]` escape
hatches (ESLint and dependency-cruiser enforce this).

Local development:

```sh
cp .env.example .env.local
pnpm --filter @portage/api dev      # http://localhost:8787
pnpm --filter @portage/web dev      # http://localhost:5173
```

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

## Notes

- The repo runs on Node 26.13.1 (the current LTS, "Lithium") and pnpm 10.33.0.
  Both are pinned in `.prototools` (read by proto), `.nvmrc` and `.node-version`
  (read by nvm, fnm and CI), `engines` and `packageManager` in `package.json`.
  `.npmrc` sets `engine-strict`, so an older Node refuses to install.
- Responses from 1Click, Hiro, Emily, mempool.space and the wallet are checked
  with zod schemas before use. The schemas keep unknown fields, so a stored quote
  response keeps every field the provider sent. zod runs in `jitless` mode (set in
  `packages/core/src/schema.ts`; import `z` from `@portage/core`), so it never
  needs `eval` under the page's CSP.
- `@stacks/connect` bundles WalletConnect, which is most of the bundle size.
