import { definePreset } from '@pandacss/dev';

import { breakpoints } from './breakpoints.js';
import { globalCss } from './global-css.js';
import { keyframes } from './keyframes.js';
import { actionsRecipe } from './recipes/actions-recipe.js';
import { buttonRecipe } from './recipes/button-recipe.js';
import { detailsRecipe } from './recipes/details-recipe.js';
import { fieldRecipe } from './recipes/field-recipe.js';
import { linkRecipe } from './recipes/link-recipe.js';
import { noticeRecipe } from './recipes/notice-recipe.js';
import { routeLegRecipe } from './recipes/route-leg-recipe.js';
import { routeStopRecipe } from './recipes/route-stop-recipe.js';
import { sheetRecipe } from './recipes/sheet-recipe.js';
import { semanticTokens } from './semantic-tokens.js';
import { tokens } from './tokens.js';
import { textStyles } from './typography.js';

export default definePreset({
  name: 'stxonector',
  globalCss,
  theme: {
    extend: {
      semanticTokens,
      tokens,
      keyframes,
      textStyles,
      breakpoints,
      recipes: {
        actions: actionsRecipe,
        button: buttonRecipe,
        details: detailsRecipe,
        link: linkRecipe,
        notice: noticeRecipe,
        routeLeg: routeLegRecipe,
        sheet: sheetRecipe,
      },
      slotRecipes: {
        field: fieldRecipe,
        routeStop: routeStopRecipe,
      },
    },
  },
});
