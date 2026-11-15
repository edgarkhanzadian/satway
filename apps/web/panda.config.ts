import { defineConfig } from '@pandacss/dev';

export default defineConfig({
  preflight: true,

  include: ['./src/**/*.{ts,tsx}'],
  exclude: [],

  presets: ['@satway/panda-preset/config'],

  jsxFramework: 'react',
  prefix: 'satway',

  strictTokens: true,
  strictPropertyValues: true,

  staticCss: {
    recipes: {
      routeLeg: ['*'],
      routeStop: ['*'],
    },
  },

  outdir: 'satway-styles',
});
