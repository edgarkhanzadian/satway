import { defineSlotRecipe } from '@pandacss/dev';

export const routeStopRecipe = defineSlotRecipe({
  description: 'One stop of the route: its mark, name, note and state',
  className: 'route-stop',
  slots: ['root', 'mark', 'name', 'note', 'state'],
  base: {
    root: {
      position: 'relative',
      minWidth: 'zero',
      paddingTop: { base: 'space.01', md: 'route.clearance' },
      paddingRight: { base: 'space.00', md: 'space.09' },
      paddingBottom: { base: 'space.10', md: 'space.00' },
      paddingLeft: { base: 'route.indent', md: 'space.00' },
      minHeight: { base: 'route.stop', md: 'auto' },
      _last: {
        paddingRight: 'space.00',
        paddingBottom: 'space.00',
        minHeight: { base: 'zero', md: 'auto' },
      },
    },
    mark: {
      position: 'absolute',
      top: 'space.00',
      left: 'space.00',
      zIndex: 'raised',
      width: 'route.mark',
      height: 'route.mark',
      borderRadius: 'round',
      borderWidth: 'mark',
      borderStyle: 'solid',
      borderColor: 'ink',
      backgroundColor: 'stage',
    },
    name: {
      display: 'block',
      fontWeight: 'regular',
      fontSize: 'lg',
      letterSpacing: 'heading',
      lineHeight: 'snug',
    },
    note: { display: 'block', textStyle: 'label', color: 'muted', marginTop: 'space.01' },
    state: {
      display: 'block',
      fontSize: 'sm',
      fontWeight: 'semibold',
      marginTop: 'space.03',
    },
  },
  variants: {
    status: {
      pending: {},
      ready: { mark: { backgroundColor: 'ink' } },
      done: { mark: { backgroundColor: 'ink' } },
      current: {
        mark: {
          backgroundColor: 'transparent',
          backgroundGradient: 'mark.current',
          boxShadow: 'mark.current',
        },
      },
      failed: {
        mark: { borderColor: 'danger', backgroundColor: 'danger', boxShadow: 'mark.failed' },
        state: { color: 'danger' },
      },
    },
    mode: {
      idle: {},
      tracking: {},
    },
  },
  compoundVariants: [
    {
      status: 'pending',
      mode: 'tracking',
      css: { mark: { borderColor: 'edge' }, name: { color: 'muted' } },
    },
  ],
  defaultVariants: { status: 'pending', mode: 'idle' },
});
