import { defineRecipe } from '@pandacss/dev';

export const detailsRecipe = defineRecipe({
  description: 'Definition lists of labelled values: a two-column table, or a stacked list',
  className: 'details',
  base: {
    fontSize: 'sm',
    '& dt': { textStyle: 'label', color: 'muted' },
  },
  variants: {
    layout: {
      table: {
        display: 'grid',
        gridTemplateColumns: { base: 'minmax(0, 1fr)', md: 'minmax({sizes.quoteLabel}, auto) 1fr' },
        rowGap: { base: 'space.01', md: 'space.00' },
        columnGap: { base: 'space.01', md: 'space.09' },
        marginTop: 'space.10',
        marginBottom: 'space.00',
        marginInline: 'space.00',
        borderTopWidth: 'hairline',
        borderTopStyle: 'solid',
        borderTopColor: 'hairline',
        '& dt, & dd': {
          paddingTop: { base: 'space.00', md: 'space.04' },
          paddingBottom: { base: 'space.00', md: 'space.04' },
          borderBottomWidth: { base: 'none', md: 'hairline' },
          borderBottomStyle: 'solid',
          borderBottomColor: 'hairline',
        },
        '& dt': { paddingTop: { base: 'space.05', md: 'space.04' } },
        '& dd': {
          margin: 'space.00',
          paddingBottom: { base: 'space.05', md: 'space.04' },
          borderBottomWidth: 'hairline',
          minWidth: 'zero',
        },
        '& dd.portage-notice': {
          marginBlock: 'space.04',
          borderBottomWidth: 'none',
        },
      },
      stacked: {
        marginTop: 'space.04',
        marginBottom: 'space.00',
        marginInline: 'space.00',
        '& dd': { marginInline: 'space.00', marginTop: 'space.00', marginBottom: 'space.04' },
      },
    },
  },
  defaultVariants: { layout: 'table' },
});
