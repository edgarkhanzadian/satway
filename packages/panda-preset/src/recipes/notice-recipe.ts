import { defineRecipe } from '@pandacss/dev';

export const noticeRecipe = defineRecipe({
  description: 'Messages: secondary notes, live status, warnings and errors',
  className: 'notice',
  base: {},
  variants: {
    tone: {
      muted: { color: 'muted', fontSize: 'sm', lineHeight: 'cosy' },
      status: {
        backgroundColor: 'stage',
        borderLeftWidth: 'accent',
        borderLeftStyle: 'solid',
        borderLeftColor: 'ink',
        borderRadius: 'sm',
        paddingBlock: 'space.06',
        paddingInline: 'space.08',
        fontWeight: 'medium',
      },
      warn: {
        gridColumn: '1 / -1',
        fontSize: 'sm',
        paddingBlock: 'space.04',
        paddingInline: 'space.06',
        borderRadius: 'sm',
        borderLeftWidth: 'accent',
        borderLeftStyle: 'solid',
        borderLeftColor: 'gold',
        backgroundColor: 'warn',
      },
      error: { color: 'danger', fontWeight: 'medium', marginTop: 'space.06' },
    },
  },
  defaultVariants: { tone: 'muted' },
});
