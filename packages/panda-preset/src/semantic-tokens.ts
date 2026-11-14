import { defineSemanticTokens } from '@pandacss/dev';

function themed(name: string) {
  return { value: { base: `{colors.light.${name}}`, _osDark: `{colors.dark.${name}}` } };
}

export const semanticTokens = defineSemanticTokens({
  colors: {
    paper: themed('paper'),
    stage: themed('stage'),
    surface: themed('surface'),
    sand: {
      DEFAULT: themed('sand'),
      raised: themed('sandRaised'),
    },
    ink: themed('ink'),
    muted: themed('muted'),
    hairline: themed('hairline'),
    edge: themed('edge'),
    accentText: themed('accentText'),
    danger: themed('danger'),
    onInk: themed('onInk'),
    focus: { value: '{colors.ink}' },
    band: {
      DEFAULT: { value: '{colors.orange}' },
      ink: { value: '{colors.black}' },
      chip: { value: '{colors.white}' },
      wash: { value: 'color-mix(in srgb, {colors.white} 35%, transparent)' },
    },
    action: {
      DEFAULT: { value: '{colors.orange}' },
      raised: { value: 'color-mix(in srgb, {colors.orange} 85%, {colors.white})' },
      ink: { value: '{colors.black}' },
    },
    warn: { value: 'color-mix(in srgb, {colors.gold} 16%, {colors.surface})' },
    gold: themed('gold'),
    route: {
      origin: themed('violet'),
      swap: themed('gold'),
      bitcoin: themed('ember'),
      faint: { value: 'color-mix(in srgb, currentColor 25%, transparent)' },
    },
  },
  shadows: {
    sheet: { value: { base: '0 10px 30px {colors.glow}', _osDark: 'none' } },
    mark: {
      current: { value: '0 0 0 4px {colors.stage}, 0 0 0 7px {colors.ink}' },
      failed: { value: '0 0 0 4px {colors.stage}, 0 0 0 7px {colors.danger}' },
    },
  },
  gradients: {
    mark: {
      current: { value: 'radial-gradient(circle, {colors.ink} 0 5px, {colors.stage} 6px)' },
    },
  },
});
