import { defineRecipe } from '@pandacss/dev';

export const actionsRecipe = defineRecipe({
  description: 'A row of buttons and links',
  className: 'actions',
  base: {
    display: 'flex',
    gap: 'space.04',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: 'space.10',
  },
});
