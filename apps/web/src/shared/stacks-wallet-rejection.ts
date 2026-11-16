export const LEATHER_USER_REJECTION = 4001;
export const XVERSE_USER_REJECTION = -32000;
export const STACKS_CONNECT_USER_CANCELED = -31001;

const STACKS_DECLINE_CODES: ReadonlySet<unknown> = new Set([
  LEATHER_USER_REJECTION,
  XVERSE_USER_REJECTION,
  STACKS_CONNECT_USER_CANCELED,
]);

export function isStacksWalletRejection(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('code' in err)) return false;
  return STACKS_DECLINE_CODES.has(err.code);
}
