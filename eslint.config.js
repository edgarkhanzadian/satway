import { defineConfig } from 'eslint/config';

import baseConfig, {
  sharedRestrictedImportPaths,
  sharedRestrictedSyntax,
} from '@portage/eslint-config';
import reactConfig from '@portage/eslint-config/react';

const coreDeepImport = {
  group: ['@portage/core/*'],
  message: 'Import from the package entry @portage/core, not from its internal files.',
};

const zodThroughCore = {
  group: ['zod', 'zod/*'],
  message:
    "Import z from @portage/core (./schema.js inside core). It turns on zod's jitless mode before any schema exists, so no eval runs under the page's script-src 'self'.",
};

const stylesOnlyInWeb = {
  group: ['portage-styles', 'portage-styles/*'],
  message: 'The generated Panda styled-system belongs to apps/web. Nothing else may import it.',
};

const rawCssInWeb = {
  group: ['*.css', '!./app.css', '!@fontsource/*/*.css', '!@fontsource-variable/*/*.css'],
  message:
    'Style through Panda (css(), styled props or a recipe from @portage/panda-preset). The only CSS imports are ./app.css (the Panda entry) and Fontsource font files.',
};

const presetOnlyThroughPanda = {
  group: ['@portage/panda-preset', '@portage/panda-preset/*'],
  message:
    'The preset is consumed by panda.config.ts only. Use the generated portage-styles modules in app code.',
};

const pandaEscapeHatch = {
  selector: 'Literal[value=/^\\[.+\\]$/]',
  message:
    "Panda's [value] escape hatch bypasses the tokens. Add or reuse a token in @portage/panda-preset instead.",
};

const webRestrictedSyntax = [
  ...sharedRestrictedSyntax,
  pandaEscapeHatch,
  {
    selector: "JSXAttribute[name.name='style']",
    message: 'No inline styles. Style through Panda: css(), styled props or a recipe.',
  },
  {
    selector: "JSXAttribute[name.name='className'][value.type='Literal']",
    message: 'No literal class names. Use css(), cx() or a recipe from portage-styles.',
  },
  {
    selector:
      "JSXAttribute[name.name='className'] > JSXExpressionContainer > :matches(Literal, TemplateLiteral)",
    message: 'No literal class names. Use css(), cx() or a recipe from portage-styles.',
  },
];

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
      group: ['@portage/*'],
      message: 'packages/core must not import other workspace packages.',
    },
  ],
};

export default defineConfig([
  {
    files: ['{packages,apps,scripts}/**/*.{ts,tsx}'],
    extends: [baseConfig],
    rules: {
      'portage/no-same-package-barrel-import': 'error',
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/ban-ts-comment': 'off',
    },
  },
  {
    ignores: [
      '**/*.{js,cjs,mjs}',
      '**/node_modules/',
      '**/portage-styles/',
      '**/panda.config*.ts',
      '**/dist/',
      '**/.wrangler/',
      '**/.proofs/',
      '**/coverage/',
      '**/*.d.ts',
      '**/.env*',
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
    name: 'core-zod-entry',
    files: ['packages/core/src/schema.ts'],
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
          patterns: [coreDeepImport, zodThroughCore, stylesOnlyInWeb, presetOnlyThroughPanda],
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
          patterns: [coreDeepImport, zodThroughCore, presetOnlyThroughPanda, rawCssInWeb],
        },
      ],
      'no-restricted-syntax': ['error', ...webRestrictedSyntax],
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
              group: ['@portage/*'],
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
