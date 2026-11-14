import { defineGlobalStyles } from '@pandacss/dev';

export const globalCss = defineGlobalStyles({
  ':root': {
    colorScheme: 'light',
    fontFamily: 'sans',
    fontSize: 'md',
    lineHeight: 'normal',
    letterSpacing: 'body',
    color: 'ink',
    backgroundColor: 'paper',
    WebkitFontSmoothing: 'antialiased',
    MozOsxFontSmoothing: 'grayscale',
    _osDark: { colorScheme: 'dark' },
  },
  'p, h1, h2': {
    textWrap: 'inherit',
    overflowWrap: 'inherit',
  },
  body: {
    margin: 'space.00',
    backgroundColor: 'paper',
    color: 'ink',
  },
  p: {
    marginTop: 'space.00',
    marginInline: 'space.00',
    marginBottom: 'space.06',
  },
  ':focus-visible': {
    outlineWidth: 'focus',
    outlineStyle: 'solid',
    outlineColor: 'focus',
    outlineOffset: 'space.01',
  },
  code: {
    fontFamily: 'mono',
    fontSize: 'sm',
    letterSpacing: 'body',
    overflowWrap: 'anywhere',
  },
});
