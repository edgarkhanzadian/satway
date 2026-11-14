import { defineConfig } from '@pandacss/dev';

export default defineConfig({
  preflight: true,

  include: ['./src/**/*.{ts,tsx}'],
  exclude: [],

  presets: ['@portage/panda-preset/config'],

  jsxFramework: 'react',
  prefix: 'portage',

  strictTokens: true,
  strictPropertyValues: true,

  staticCss: {
    recipes: {
      routeLeg: ['*'],
      routeStop: ['*'],
    },
  },

  outdir: 'portage-styles',
});
