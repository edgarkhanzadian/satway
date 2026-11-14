import { defineRecipe } from '@pandacss/dev';

export const linkRecipe = defineRecipe({
  description: 'Text links in the ink colour, underlined, with an accent underline on hover',
  className: 'link',
  base: {
    color: 'ink',
    textDecoration: 'underline',
    textDecorationThickness: 'rule',
    textUnderlineOffset: 'space.02',
    cursor: 'pointer',
    _hover: { textDecorationColor: 'band' },
  },
});
