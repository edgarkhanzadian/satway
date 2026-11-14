import { defineConfig } from '@pandacss/dev';

export default defineConfig({
  preflight: true,

  include: ['./src/**/*.{ts,tsx}'],
  exclude: [],

  presets: ['@stxonector/panda-preset/config'],

  jsxFramework: 'react',
  prefix: 'stxonector',

  strictTokens: true,
  strictPropertyValues: true,

  staticCss: {
    recipes: {
      routeLeg: ['*'],
      routeStop: ['*'],
    },
  },

  outdir: 'stxonector-styles',
});
