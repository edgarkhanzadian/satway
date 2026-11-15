export const WALLETCONNECT_RELAY_URL = 'wss://relay.walletconnect.org';

export const WALLETCONNECT_STORAGE_PREFIX = 'portage-evm';

export interface WalletConnectMetadata {
  name: string;
  description: string;
  url: string;
  icons: string[];
}

export function walletConnectMetadata(origin: string): WalletConnectMetadata {
  return {
    name: 'Portage',
    description: 'Deposit to sBTC on Stacks from other chains in one flow',
    url: origin,
    icons: [],
  };
}
