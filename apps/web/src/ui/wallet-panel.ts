import { css, cva } from 'portage-styles/css';

export const end = cva({
  base: { maxWidth: 'end', overflowWrap: 'anywhere', minWidth: 'zero' },
  variants: {
    side: {
      from: { gridArea: 'from' },
      to: {
        gridArea: 'to',
        textAlign: { base: 'left', md: 'right' },
        justifySelf: { base: 'start', md: 'end' },
      },
    },
  },
});

export const endTitle = css({
  textStyle: 'title',
  margin: 'space.00',
});

export const endLede = css({
  textStyle: 'lede',
  marginTop: 'space.03',
  marginInline: 'space.00',
  marginBottom: 'space.06',
});

export const connected = css({ fontWeight: 'semibold', marginBottom: 'space.02' });

export function short(address: string): string {
  return address.length > 16 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address;
}
