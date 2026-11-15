import type { Eip1193Provider, EvmWalletOption, SourceWallet } from '@satway/chains';

interface Eip6963Detail {
  info: { uuid: string; name: string };
  provider: Eip1193Provider;
}

export async function discoverEvmWallets(waitMs = 300): Promise<EvmWalletOption[]> {
  const found = new Map<string, EvmWalletOption>();
  function onAnnounce(event: CustomEvent<Eip6963Detail>) {
    const detail = event.detail;
    if (detail?.info?.uuid && detail.provider) {
      found.set(detail.info.uuid, {
        id: detail.info.uuid,
        name: detail.info.name,
        provider: detail.provider,
      });
    }
  }
  window.addEventListener('eip6963:announceProvider', onAnnounce);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  await new Promise(resolve => setTimeout(resolve, waitMs));
  window.removeEventListener('eip6963:announceProvider', onAnnounce);

  if (found.size === 0) {
    const injected = window.ethereum;
    if (injected)
      found.set('injected', { id: 'injected', name: 'Browser wallet', provider: injected });
  }
  return [...found.values()];
}

interface SolanaProvider {
  connect(): Promise<{ publicKey: { toString(): string } }>;
}

export function findSolanaWallet(): SolanaProvider | null {
  return window.phantom?.solana ?? window.solana ?? null;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
    phantom?: { solana?: SolanaProvider };
    solana?: SolanaProvider;
  }
  interface WindowEventMap {
    'eip6963:announceProvider': CustomEvent<Eip6963Detail>;
  }
}

export async function connectSolana(): Promise<SourceWallet> {
  const provider = findSolanaWallet();
  if (!provider) throw new Error('No Solana wallet found in this browser');
  const { publicKey } = await provider.connect();
  const address = publicKey.toString();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))
    throw new Error('The wallet did not share an account');
  return { kind: 'solana', name: 'Solana wallet', address };
}
