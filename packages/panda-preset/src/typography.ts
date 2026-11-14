import { defineTextStyles } from '@pandacss/dev';

export const textStyles = defineTextStyles({
  wordmark: {
    value: {
      fontSize: '2xl',
      fontWeight: 'medium',
      letterSpacing: 'wordmark',
      lineHeight: 'tight',
    },
  },
  display: {
    value: {
      fontSize: { base: '3xl', md: '5xl' },
      fontWeight: 'regular',
      letterSpacing: 'display',
      lineHeight: 'display',
    },
  },
  title: {
    value: {
      fontSize: { base: '2xl', md: '3xl' },
      fontWeight: 'regular',
      letterSpacing: 'heading',
      lineHeight: 'tight',
    },
  },
  heading: {
    value: {
      fontSize: '2xl',
      fontWeight: 'regular',
      letterSpacing: 'heading',
      lineHeight: 'tight',
    },
  },
  lede: { value: { fontSize: 'lg', fontWeight: 'regular', lineHeight: 'cosy' } },
  emphasis: { value: { fontSize: 'lg', fontWeight: 'medium' } },
  caption: { value: { fontSize: 'sm' } },
  label: {
    value: {
      fontFamily: 'mono',
      fontSize: 'xs',
      fontWeight: 'regular',
      letterSpacing: 'body',
      lineHeight: 'cosy',
    },
  },
  caps: {
    value: {
      fontSize: 'xs',
      fontWeight: 'medium',
      letterSpacing: 'caps',
      lineHeight: 'tight',
      textTransform: 'uppercase',
    },
  },
});
