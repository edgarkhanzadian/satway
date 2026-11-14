import { defineRecipe } from '@pandacss/dev';

export const routeLegRecipe = defineRecipe({
  description: 'The line between two stops of the route, one colour per leg',
  className: 'route-leg',
  base: {
    position: 'absolute',
    top: { base: 'route.mark', md: 'route.legInset' },
    bottom: { base: 'space.00', md: 'auto' },
    left: { base: 'route.legInset', md: 'route.mark' },
    right: { base: 'auto', md: 'space.00' },
    width: { base: 'route.leg', md: 'auto' },
    height: { base: 'auto', md: 'route.leg' },
    backgroundColor: 'current',
  },
  variants: {
    leg: {
      origin: { color: 'route.origin' },
      swap: { color: 'route.swap' },
      bitcoin: { color: 'route.bitcoin' },
    },
    status: {
      idle: {},
      done: {},
      pending: { backgroundColor: 'route.faint' },
      active: {
        backgroundColor: 'route.faint',
        backgroundGradient: { base: 'leg.down', md: 'leg.across' },
        backgroundSize: { base: '100% 28px', md: '28px 100%' },
        animation: { base: 'legDown', md: 'legAcross' },
        _motionReduce: { animation: 'none' },
      },
    },
  },
  defaultVariants: { leg: 'origin', status: 'idle' },
});
