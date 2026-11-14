import { defineTokens } from '@pandacss/dev';

import { colors } from './colors.js';

export const tokens = defineTokens({
  colors,
  fonts: {
    sans: { value: "'Instrument Sans', ui-sans-serif, system-ui, sans-serif" },
    mono: { value: "'DM Mono', ui-monospace, Menlo, monospace" },
  },
  fontSizes: {
    smaller: { value: 'smaller' },
    xs: { value: '13px' },
    sm: { value: '14px' },
    md: { value: '16px' },
    lg: { value: '18px' },
    xl: { value: '24px' },
    '2xl': { value: '28px' },
    '3xl': { value: '40px' },
    '4xl': { value: '48px' },
    '5xl': { value: '64px' },
  },
  fontWeights: {
    regular: { value: '400' },
    medium: { value: '500' },
    semibold: { value: '600' },
  },
  lineHeights: {
    display: { value: '1.06' },
    tight: { value: '1.15' },
    snug: { value: '1.3' },
    cosy: { value: '1.4' },
    normal: { value: '1.5' },
  },
  letterSpacings: {
    display: { value: '-0.035em' },
    heading: { value: '-0.025em' },
    wordmark: { value: '-0.03em' },
    body: { value: '-0.005em' },
    caps: { value: '0.04em' },
  },
  spacing: {
    'space.00': { value: '0' },
    'space.01': { value: '2px' },
    'space.02': { value: '4px' },
    'space.03': { value: '6px' },
    'space.04': { value: '8px' },
    'space.05': { value: '10px' },
    'space.06': { value: '12px' },
    'space.07': { value: '14px' },
    'space.08': { value: '16px' },
    'space.09': { value: '20px' },
    'space.10': { value: '24px' },
    'space.11': { value: '32px' },
    'space.12': { value: '40px' },
    'space.13': { value: '48px' },
    'space.14': { value: '64px' },
    'space.15': { value: '72px' },
    route: {
      mark: { value: '{sizes.route.mark}' },
      legInset: { value: 'calc(({sizes.route.mark} - {sizes.route.leg}) / 2)' },
      clearance: { value: '40px' },
      indent: { value: '44px' },
    },
  },
  sizes: {
    zero: { value: '0' },
    full: { value: '100%' },
    page: { value: '1152px' },
    measure: { value: '680px' },
    field: { value: '560px' },
    end: { value: '420px' },
    control: { value: '44px' },
    input: { value: '48px' },
    fileButton: { value: '32px' },
    qr: { value: '240px' },
    qrCompact: { value: '200px' },
    quoteLabel: { value: '160px' },
    route: {
      mark: { value: '26px' },
      leg: { value: '8px' },
      stop: { value: '72px' },
    },
  },
  radii: {
    none: { value: '0' },
    sm: { value: '6px' },
    md: { value: '8px' },
    lg: { value: '12px' },
    xl: { value: '20px' },
    round: { value: '50%' },
  },
  borderWidths: {
    none: { value: '0' },
    hairline: { value: '1px' },
    rule: { value: '2px' },
    focus: { value: '3px' },
    accent: { value: '4px' },
    mark: { value: '5px' },
  },
  zIndex: {
    raised: { value: 1 },
  },
  durations: {
    travel: { value: '1.1s' },
  },
  animations: {
    legAcross: { value: 'legAcross {durations.travel} linear infinite' },
    legDown: { value: 'legDown {durations.travel} linear infinite' },
  },
  gradients: {
    band: {
      narrow: { value: 'linear-gradient(180deg, {colors.orange} 0 220px, transparent 220px)' },
      wide: { value: 'linear-gradient(180deg, {colors.orange} 0 320px, transparent 320px)' },
    },
    leg: {
      across: {
        value: 'repeating-linear-gradient(90deg, currentColor 0 16px, transparent 16px 28px)',
      },
      down: {
        value: 'repeating-linear-gradient(180deg, currentColor 0 16px, transparent 16px 28px)',
      },
    },
  },
});
