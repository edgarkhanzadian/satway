const directivePatterns = [
  /^\s*eslint-(disable|enable)(-next-line|-line)?(\s|$)/,
  /^\s*@ts-expect-error(\s|$)/,
];
const tripleSlashReference = /^\/\s*<reference\s[^>]*\/>\s*$/;

function isAllowed(comment) {
  if (comment.type === 'Shebang') return true;
  if (comment.type === 'Line' && tripleSlashReference.test(comment.value)) return true;
  return directivePatterns.some(pattern => pattern.test(comment.value));
}

export const noCommentsRule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow comments. Only shebangs, eslint-disable/eslint-enable directives, @ts-expect-error and /// <reference /> directives are allowed.',
    },
    messages: {
      comment: 'Comments are not allowed. Express intent through names, types and tests instead.',
    },
    schema: [],
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (isAllowed(comment)) continue;
          context.report({ loc: comment.loc, messageId: 'comment' });
        }
      },
    };
  },
};
