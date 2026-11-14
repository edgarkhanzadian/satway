// Copied from leather-io/mono packages/eslint-config/rules/no-enum.js (MIT).
export const noEnumSyntax = {
  selector: 'TSEnumDeclaration',
  message: 'Do not use enums. Use an `as const` object or a union type instead.',
};
