export const WALLETCONNECT_PROJECT_ID = '78235ea93aa1c847fd6384cc920a44d1';

export const WALLETCONNECT_RELAY_URL = 'wss://relay.walletconnect.org';

export const WALLETCONNECT_STORAGE_PREFIX = 'portage-evm';

export const SOLANA_MAINNET_CAIP2 = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

export const SOLANA_RPC_URL = `https://rpc.walletconnect.org/v1/?chainId=${SOLANA_MAINNET_CAIP2}&projectId=${WALLETCONNECT_PROJECT_ID}`;

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
