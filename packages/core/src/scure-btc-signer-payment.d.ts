import type { P2TR } from '@scure/btc-signer/payment';

declare module '@scure/btc-signer/payment' {
  export type P2TROut = P2TR;
}
