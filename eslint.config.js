import { defineConfig } from 'eslint/config';

import baseConfig, {
  sharedRestrictedImportPaths,
  sharedRestrictedSyntax,
} from '@satway/eslint-config';
import reactConfig from '@satway/eslint-config/react';

const coreDeepImport = {
  group: ['@satway/core/*'],
  message: 'Import from the package entry @satway/core, not from its internal files.',
};

const chainsDeepImport = {
  group: ['@satway/chains/*', '!@satway/chains/solana'],
  message:
    'Import from the package entry @satway/chains, or @satway/chains/solana for the lazily loaded Solana send code, not from its internal files.',
};

const zodThroughCore = {
  group: ['zod', 'zod/*'],
  message:
    "Import z from @satway/core (../shared/index.js inside core). It turns on zod's jitless mode before any schema exists, so no eval runs under the page's script-src 'self'.",
};

const apiDeepImport = {
  group: ['@satway/api/*', '**/api/src/**'],
  message:
    'apps/e2e runs the Worker through its entry only: import @satway/api, not files inside apps/api.',
};

const webSourceInE2e = {
  group: ['@satway/web', '@satway/web/*', '**/web/src/**'],
  message:
    'apps/e2e tests the built web app through the browser. It must not import apps/web source.',
};

const browserGlobals = ['window', 'document', 'localStorage', 'sessionStorage', 'navigator'];

const noBrowserGlobals = {
  'no-restricted-globals': [
    'error',
    ...browserGlobals.map(name => ({
      name,
      message: `${name} is a browser global. This package runs outside a browser too: take the dependency as a parameter and let the web app pass the browser implementation.`,
    })),
  ],
  'no-restricted-properties': [
    'error',
    ...browserGlobals.flatMap(property =>
      ['globalThis', 'self'].map(object => ({
        object,
        property,
        message: `${property} is a browser global. This package runs outside a browser too: take the dependency as a parameter.`,
      }))
    ),
  ],
};

const coreNetworkExports = [
  'OneClickClient',
  'broadcastTransaction',
  'assertActiveWithdrawalContract',
  'callReadOnly',
  'fetchActiveWithdrawalContract',
  'fetchAddressHistory',
  'fetchAndVerifyWithdrawalPayout',
  'fetchDeposit',
  'fetchDepositOutputs',
  'fetchEmilyWithdrawal',
  'fetchFeeEstimate',
  'fetchLimits',
  'fetchOnChainWithdrawalRequest',
  'fetchPayoutSpender',
  'fetchReclaimFeeRate',
  'fetchSbtcBalance',
  'fetchSignersPublicKey',
  'fetchSignersPublicKeyVar',
  'fetchStacksTransaction',
  'fetchTipHeight',
  'fetchTransaction',
  'fetchTransactionHex',
  'fetchUnspentOutputs',
  'fetchVerifiedSigners',
  'fetchWithdrawalLimits',
  'fetchWithdrawalStatus',
  'fetchWithdrawalSweepData',
  'isOutputSpent',
  'notifyDeposit',
  'observeDeposit',
  'observeWithdrawal',
  'prepareWithdrawal',
  'previewWithdrawal',
  'registerOutputs',
  'snapshotOutpoints',
];

const stylesOnlyInWeb = {
  group: ['satway-styles', 'satway-styles/*'],
  message: 'The generated Panda styled-system belongs to apps/web. Nothing else may import it.',
};

const rawCssInWeb = {
  group: ['*.css', '!./app.css', '!@fontsource/*/*.css', '!@fontsource-variable/*/*.css'],
  message:
    'Style through Panda (css(), styled props or a recipe from @satway/panda-preset). The only CSS imports are ./app.css (the Panda entry) and Fontsource font files.',
};

const presetOnlyThroughPanda = {
  group: ['@satway/panda-preset', '@satway/panda-preset/*'],
  message:
    'The preset is consumed by panda.config.ts only. Use the generated satway-styles modules in app code.',
};

const pandaEscapeHatch = {
  selector: 'Literal[value=/^\\[.+\\]$/]',
  message:
    "Panda's [value] escape hatch bypasses the tokens. Add or reuse a token in @satway/panda-preset instead.",
};

const webRestrictedPatterns = [
  coreDeepImport,
  chainsDeepImport,
  zodThroughCore,
  presetOnlyThroughPanda,
  rawCssInWeb,
];

const webRestrictedSyntax = [
  ...sharedRestrictedSyntax,
  pandaEscapeHatch,
  {
    selector: "JSXAttribute[name.name='style']",
    message: 'No inline styles. Style through Panda: css(), styled props or a recipe.',
  },
  {
    selector: "JSXAttribute[name.name='className'][value.type='Literal']",
    message: 'No literal class names. Use css(), cx() or a recipe from satway-styles.',
  },
  {
    selector:
      "JSXAttribute[name.name='className'] > JSXExpressionContainer > :matches(Literal, TemplateLiteral)",
    message: 'No literal class names. Use css(), cx() or a recipe from satway-styles.',
  },
];

const chainsRestrictedImports = {
  paths: [
    ...sharedRestrictedImportPaths,
    { name: 'react', message: 'packages/chains is UI-free. Keep React in apps/web.' },
    { name: 'react-dom', message: 'packages/chains is UI-free. Keep React in apps/web.' },
    {
      name: '@stacks/connect',
      message: 'packages/chains holds no wallet UI. Stacks wallet connection lives in apps/web.',
    },
  ],
  patterns: [
    { group: ['react/*', 'react-dom/*'], message: 'packages/chains is UI-free.' },
    {
      group: ['@walletconnect/*', '@reown/*'],
      message: 'packages/chains does not connect wallets. That lives in apps/web.',
    },
    stylesOnlyInWeb,
    {
      group: ['@satway/*', '!@satway/core'],
      message: 'packages/chains may import @satway/core only among workspace packages.',
    },
    coreDeepImport,
    zodThroughCore,
  ],
};

const coreRestrictedImports = {
  paths: [
    ...sharedRestrictedImportPaths,
    { name: 'react', message: 'packages/core is UI-free. Keep React in apps/web.' },
    { name: 'react-dom', message: 'packages/core is UI-free. Keep React in apps/web.' },
    {
      name: '@stacks/connect',
      message: 'packages/core holds no wallet UI. Wallet connection lives in apps/web.',
    },
  ],
  patterns: [
    { group: ['react/*', 'react-dom/*'], message: 'packages/core is UI-free.' },
    stylesOnlyInWeb,
    {
      group: ['@satway/*'],
      message: 'packages/core must not import other workspace packages.',
    },
  ],
};

export default defineConfig([
  {
    files: ['{packages,apps,scripts}/**/*.{ts,tsx}'],
    extends: [baseConfig],
    rules: {
      'satway/no-same-package-barrel-import': 'error',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/ban-ts-comment': 'off',
    },
  },
  {
    ignores: [
      '**/*.{js,cjs,mjs}',
      '**/node_modules/',
      '**/satway-styles/',
      '**/panda.config*.ts',
      '**/dist/',
      '**/.wrangler/',
      '**/.proofs/',
      '**/coverage/',
      '**/*.d.ts',
      '**/.env*',
      '.claude/',
      'apps/e2e/.web-build/',
      'apps/e2e/test-results/',
      'apps/e2e/playwright-report/',
      'apps/e2e/blob-report/',
      'apps/e2e/.playwright/',
    ],
  },
  {
    name: 'core',
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          ...coreRestrictedImports,
          patterns: [...coreRestrictedImports.patterns, zodThroughCore],
        },
      ],
    },
  },
  {
    name: 'core-and-chains-run-outside-a-browser',
    files: ['packages/core/**/*.ts', 'packages/chains/**/*.ts'],
    rules: noBrowserGlobals,
  },
  {
    name: 'chains',
    files: ['packages/chains/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', chainsRestrictedImports],
    },
  },
  {
    name: 'core-zod-entry',
    files: ['packages/core/src/shared/schema.ts'],
    rules: {
      'no-restricted-imports': ['error', coreRestrictedImports],
    },
  },
  {
    name: 'apps-and-scripts-use-core-entry',
    files: ['apps/**/*.{ts,tsx}', 'scripts/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: sharedRestrictedImportPaths,
          patterns: [
            coreDeepImport,
            chainsDeepImport,
            zodThroughCore,
            stylesOnlyInWeb,
            presetOnlyThroughPanda,
          ],
        },
      ],
    },
  },
  {
    name: 'web',
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [reactConfig],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: sharedRestrictedImportPaths,
          patterns: webRestrictedPatterns,
        },
      ],
      'no-restricted-syntax': ['error', ...webRestrictedSyntax],
    },
  },
  {
    name: 'web-ui-reads-no-network',
    files: ['apps/web/src/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...sharedRestrictedImportPaths,
            {
              name: '@satway/core',
              importNames: coreNetworkExports,
              message:
                'apps/web/src/ui is presentational. Read from the network in a feature or in shared, and pass the result down.',
            },
          ],
          patterns: [
            ...webRestrictedPatterns,
            {
              group: ['@satway/chains/solana'],
              message:
                'apps/web/src/ui is presentational. The Solana send code reads the Solana RPC; call it from a feature.',
            },
          ],
        },
      ],
    },
  },
  {
    name: 'panda-preset',
    files: ['packages/panda-preset/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: sharedRestrictedImportPaths,
          patterns: [
            stylesOnlyInWeb,
            {
              group: ['@satway/*'],
              message:
                'The preset holds design values only. It must not import app code or other workspace packages.',
            },
          ],
        },
      ],
      'no-restricted-syntax': ['error', ...sharedRestrictedSyntax, pandaEscapeHatch],
    },
  },
  {
    name: 'e2e',
    files: ['apps/e2e/**/*.ts'],
    rules: {
      'no-empty-pattern': ['error', { allowObjectPatternsAsParameters: true }],
      'no-restricted-imports': [
        'error',
        {
          paths: sharedRestrictedImportPaths,
          patterns: [
            coreDeepImport,
            chainsDeepImport,
            zodThroughCore,
            stylesOnlyInWeb,
            presetOnlyThroughPanda,
            apiDeepImport,
            webSourceInE2e,
          ],
        },
      ],
    },
  },
  {
    name: 'e2e-worker-captures-the-notifier-log',
    files: ['apps/e2e/src/worker/worker.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    name: 'api-worker-entry-logs',
    files: ['apps/api/src/index.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    name: 'scripts',
    files: ['scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
]);
