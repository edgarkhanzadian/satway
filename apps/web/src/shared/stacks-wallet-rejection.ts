export const LEATHER_USER_REJECTION = 4001;
export const XVERSE_USER_REJECTION = -32000;
export const STACKS_CONNECT_USER_CANCELED = -31001;
export const XVERSE_PROVIDER_ID = 'XverseProviders.BitcoinProvider';

const DECLINE_CODES: ReadonlySet<unknown> = new Set([
  LEATHER_USER_REJECTION,
  STACKS_CONNECT_USER_CANCELED,
]);

export function isStacksWalletRejection(err: unknown, providerId: string | null): boolean {
  if (typeof err !== 'object' || err === null || !('code' in err)) return false;
  if (err.code === XVERSE_USER_REJECTION) return providerId === XVERSE_PROVIDER_ID;
  return DECLINE_CODES.has(err.code);
}

export class StacksWalletDeclinedError extends Error {
  constructor(options?: ErrorOptions) {
    super('You declined the request in your wallet.', options);
    this.name = 'StacksWalletDeclinedError';
  }
}

export function declinedOr(err: unknown, providerId: string | null): unknown {
  return isStacksWalletRejection(err, providerId)
    ? new StacksWalletDeclinedError({ cause: err })
    : err;
}
