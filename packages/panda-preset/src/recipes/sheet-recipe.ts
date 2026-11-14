import { defineRecipe } from '@pandacss/dev';

export const sheetRecipe = defineRecipe({
  description: 'The one surface on the page: where the deposit happens',
  className: 'sheet',
  base: {
    overflowWrap: 'anywhere',
    minWidth: 'zero',
    backgroundColor: 'surface',
    borderWidth: 'hairline',
    borderStyle: 'solid',
    borderColor: 'hairline',
    borderRadius: 'lg',
    boxShadow: 'sheet',
    paddingBlock: { base: 'space.10', md: 'space.12' },
    paddingInline: { base: 'space.08', md: 'space.14' },
    '& > p:not(.stxonector-notice--tone_status), & > ul': { maxWidth: 'measure' },
  },
});
