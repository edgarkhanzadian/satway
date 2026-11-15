import { describe, expect, it } from 'vitest';

import type { OneClickToken } from '@portage/core';

import {
  type Eip1193Provider,
  SendError,
  type SourceWallet,
  buildEvmTransfer,
  chainFamily,
  connectEvm,
  encodeErc20Transfer,
  evmTransactionState,
  isSentTxFor,
  isSolanaAddress,
  isSolanaSignature,
  isUserRejection,
  nextRefundField,
  sendFromEvm,
  solanaSenderOf,
  walletAddressFor,
  walletCovers,
  walletFailure,
} from '../src/source-wallet.js';

const SIG =
  '4QMdVtgtZcuygfB7RnGhZvrPxVDjXU7WgaKCaYEd2XSeQYMGKSrthoiV4GmL6pq2fu5gHaoiHofNEYTNSJuryyr';
const SOL_WALLET = 'DgrD34m4MdR1SWr7VYezeddN61i9ib14YUVXh5QvKG1H';
const FROM = '0x2527D02599Ba641c19FEa793cD0F167589a0f10D';
const SWAP = '0x4352589330E4Ab9c40B2eaFBc125F4eeA38e260D';
const USDC_BASE: OneClickToken = {
  assetId: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
  decimals: 6,
  blockchain: 'base',
  symbol: 'USDC',
  price: 1,
  contractAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
};
const ETH: OneClickToken = {
  assetId: 'nep141:eth.omft.near',
  decimals: 18,
  blockchain: 'eth',
  symbol: 'ETH',
  price: 3000,
};
const SOL: OneClickToken = {
  assetId: 'nep141:sol.omft.near',
  decimals: 9,
  blockchain: 'sol',
  symbol: 'SOL',
  price: 150,
};
const TRX: OneClickToken = {
  assetId: 'nep141:tron.omft.near',
  decimals: 6,
  blockchain: 'tron',
  symbol: 'TRX',
  price: 0.2,
};

describe('encodeErc20Transfer', () => {
  it('encodes transfer(address,uint256)', () => {
    expect(encodeErc20Transfer(SWAP, 12_003_925n)).toBe(
      '0xa9059cbb' +
        '0000000000000000000000004352589330e4ab9c40b2eafbc125f4eea38e260d' +
        '0000000000000000000000000000000000000000000000000000000000b72a55'
    );
  });

  it('rejects a bad recipient or amount', () => {
    expect(() => encodeErc20Transfer('0x1234', 1n)).toThrow();
    expect(() =>
      encodeErc20Transfer('bc1pytlwt3qfg4rdrk3yxtmdhcjvy0l63yp7qh3jra5xwq8yt6w4fvhqyjl7dx', 1n)
    ).toThrow();
    expect(() => encodeErc20Transfer(SWAP, 0n)).toThrow();
  });
});

describe('buildEvmTransfer', () => {
  it('sends a token through its contract, never to the swap address directly', () => {
    const t = buildEvmTransfer({ token: USDC_BASE, from: FROM, to: SWAP, amount: '12003925' });
    expect(t.chainId).toBe(8453);
    expect(t.tx.to).toBe(USDC_BASE.contractAddress);
    expect(t.tx.value).toBe('0x0');
    expect(t.tx.data).toBe(encodeErc20Transfer(SWAP, 12_003_925n));
  });

  it('sends a native coin as value with no calldata', () => {
    const t = buildEvmTransfer({ token: ETH, from: FROM, to: SWAP, amount: '4000000000000000' });
    expect(t).toEqual({ chainId: 1, tx: { from: FROM, to: SWAP, value: '0xe35fa931a0000' } });
  });

  it.each([
    ['a non-EVM chain', { token: SOL }],
    ['an unknown chain', { token: { ...ETH, blockchain: 'monad' } }],
    ['a malformed token contract', { token: { ...USDC_BASE, contractAddress: 'EPjFWdd5' } }],
    ['a non-EVM destination', { to: 'So11111111111111111111111111111111111111112' }],
    ['a decimal amount', { amount: '1.5' }],
    ['a zero amount', { amount: '0' }],
    ['a bad sender', { from: 'alice.near' }],
  ])('refuses %s', (_name, change) => {
    expect(() =>
      buildEvmTransfer({ token: USDC_BASE, from: FROM, to: SWAP, amount: '1000', ...change })
    ).toThrow();
  });
});

describe('chain matching', () => {
  const evm: SourceWallet = {
    kind: 'evm',
    name: 'W',
    address: FROM,
    provider: { request: () => Promise.resolve(null) },
  };
  const sol: SourceWallet = {
    kind: 'solana',
    name: 'S',
    address: 'So11111111111111111111111111111111111111112',
  };

  it('classifies chains', () => {
    expect(chainFamily('base')).toBe('evm');
    expect(chainFamily('sol')).toBe('solana');
    expect(chainFamily('tron')).toBe('other');
    expect(chainFamily('btc')).toBe('other');
  });

  it('a wallet only covers assets on its own kind of chain', () => {
    expect(walletCovers(evm, USDC_BASE)).toBe(true);
    expect(walletCovers(evm, SOL)).toBe(false);
    expect(walletCovers(sol, SOL)).toBe(true);
    expect(walletCovers(sol, ETH)).toBe(false);
    expect(walletCovers(evm, TRX)).toBe(false);
    expect(walletCovers(null, ETH)).toBe(false);
    expect(walletCovers(evm, undefined)).toBe(false);
  });
});

describe('nextRefundField', () => {
  const SOL_ADDR = 'So11111111111111111111111111111111111111112';

  it('fills in the wallet address when the wallet covers the token', () => {
    expect(nextRefundField({ value: '', autofilled: null }, FROM)).toEqual({
      value: FROM,
      autofilled: FROM,
    });
  });

  it('clears an auto-filled address once it no longer applies', () => {
    expect(nextRefundField({ value: FROM, autofilled: FROM }, null)).toEqual({
      value: '',
      autofilled: null,
    });
  });

  it('never clears an address the user typed', () => {
    expect(nextRefundField({ value: SOL_ADDR, autofilled: null }, null)).toEqual({
      value: SOL_ADDR,
      autofilled: null,
    });
    expect(nextRefundField({ value: SOL_ADDR, autofilled: FROM }, null)).toEqual({
      value: SOL_ADDR,
      autofilled: null,
    });
  });
});

describe('isSentTxFor', () => {
  const HASH = '0x' + 'cd'.repeat(32);

  it('accepts a Solana signature only for a Solana deposit, and a 0x hash only for EVM', () => {
    expect(isSentTxFor('solana', SIG)).toBe(true);
    expect(isSentTxFor('evm', SIG)).toBe(false);
    expect(isSentTxFor('evm', HASH)).toBe(true);
    expect(isSentTxFor('solana', HASH)).toBe(false);
    expect(isSentTxFor('other', SIG)).toBe(false);
    expect(isSentTxFor('evm', 'nonsense')).toBe(false);
  });

  it('rejects base58 values that are not 64 bytes as Solana signatures', () => {
    expect(isSentTxFor('solana', SIG)).toBe(true);
    expect(isSentTxFor('solana', SIG.slice(0, -2))).toBe(false);
    expect(isSentTxFor('solana', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBe(false);
    expect(isSentTxFor('solana', `${SIG.slice(0, -1)}0`)).toBe(false);
    expect(isSentTxFor('solana', '')).toBe(false);
  });
});

describe('where a wallet send failed', () => {
  it('recognises the user-rejection codes of EIP-1193 and WalletConnect only', () => {
    expect(isUserRejection({ code: 4001, message: 'User rejected the request.' })).toBe(true);
    expect(isUserRejection({ code: 5000, message: 'User rejected.' })).toBe(true);
    expect(isUserRejection({ code: -32603, message: 'User rejected' })).toBe(false);
    expect(isUserRejection(new Error('User rejected the request'))).toBe(false);
    expect(isUserRejection(null)).toBe(false);
  });

  it('classifies an unknown wallet error as uncertain, and keeps a typed one', () => {
    expect(walletFailure(new Error('socket hang up'), 'x').phase).toBe('uncertain');
    expect(walletFailure({ code: 4001, message: 'no' }, 'x').phase).toBe('rejected');
    const typed = new SendError('before', 'not-sent');
    expect(walletFailure(typed, 'x')).toBe(typed);
  });
});

describe('Solana address checks', () => {
  it('accepts 32-byte base58 keys only', () => {
    expect(isSolanaAddress('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBe(true);
    expect(isSolanaAddress('11111111111111111111111111111111')).toBe(true);
    expect(isSolanaAddress('EPjFWdd5AufqSSqeM2qN1xzybapC8G4')).toBe(false);
    expect(isSolanaAddress('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1vv')).toBe(false);
    expect(isSolanaAddress('0x2527D02599Ba641c19FEa793cD0F167589a0f10D')).toBe(false);
    expect(isSolanaAddress('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1l')).toBe(false);
    expect(isSolanaSignature(SIG)).toBe(true);
  });
});

describe('accounts in a wallet that covers two chain families', () => {
  const sender = { send: () => Promise.resolve({ kind: 'sent' as const, signature: SIG }) };
  const both: SourceWallet = {
    kind: 'evm',
    name: 'Both (WalletConnect)',
    address: FROM,
    provider: { request: () => Promise.resolve(null) },
    solana: { address: SOL_WALLET, sender },
  };

  it('picks the address for the selected asset’s chain family', () => {
    expect(walletAddressFor(both, 'evm')).toBe(FROM);
    expect(walletAddressFor(both, 'solana')).toBe(SOL_WALLET);
    expect(walletAddressFor(both, 'other')).toBeNull();
    expect(walletCovers(both, SOL)).toBe(true);
    expect(walletCovers(both, ETH)).toBe(true);
    expect(walletCovers(both, TRX)).toBe(false);
    expect(solanaSenderOf(both)).toEqual({ address: SOL_WALLET, sender });
  });

  it('only gives a Solana sender when the wallet can send', () => {
    const addressOnly: SourceWallet = { kind: 'solana', name: 'S', address: SOL_WALLET };
    expect(solanaSenderOf(addressOnly)).toBeNull();
    expect(walletAddressFor(addressOnly, 'solana')).toBe(SOL_WALLET);
    expect(walletAddressFor(addressOnly, 'evm')).toBeNull();
    expect(solanaSenderOf({ ...addressOnly, sender })).toEqual({ address: SOL_WALLET, sender });
    expect(
      solanaSenderOf({
        kind: 'evm',
        name: 'E',
        address: FROM,
        provider: { request: () => Promise.resolve(null) },
      })
    ).toBeNull();
    expect(solanaSenderOf(null)).toBeNull();
  });
});

describe('sendFromEvm', () => {
  const HASH = '0x' + 'ab'.repeat(32);
  const transfer = buildEvmTransfer({ token: USDC_BASE, from: FROM, to: SWAP, amount: '12003925' });

  function wallet(opts: {
    chain: string;
    switches?: boolean;
    accounts?: string[];
    hash?: unknown;
    sendError?: Error;
  }) {
    const calls: { method: string; params?: unknown[] }[] = [];
    let chain = opts.chain;
    function respond(args: { method: string; params?: unknown[] }): unknown {
      calls.push(args);
      switch (args.method) {
        case 'eth_chainId':
          return chain;
        case 'wallet_switchEthereumChain': {
          const target: unknown = args.params?.[0];
          if (
            opts.switches !== false &&
            typeof target === 'object' &&
            target !== null &&
            'chainId' in target &&
            typeof target.chainId === 'string'
          ) {
            chain = target.chainId;
          }
          return null;
        }
        case 'eth_accounts':
          return opts.accounts ?? [FROM.toLowerCase()];
        case 'eth_sendTransaction':
          if (opts.sendError !== undefined) throw opts.sendError;
          return 'hash' in opts ? opts.hash : HASH;
        default:
          throw new Error(`unexpected ${args.method}`);
      }
    }
    const provider: Eip1193Provider = {
      request(args) {
        return new Promise(resolve => resolve(respond(args)));
      },
    };
    return { provider, calls };
  }

  it('sends on the right chain without switching when already there', async () => {
    const w = wallet({ chain: '0x2105' });
    expect(await sendFromEvm(w.provider, transfer)).toBe(HASH);
    expect(w.calls.map(c => c.method)).toEqual([
      'eth_chainId',
      'eth_accounts',
      'eth_sendTransaction',
    ]);
    expect(w.calls.at(-1)?.params).toEqual([transfer.tx]);
  });

  it('switches network first when needed', async () => {
    const w = wallet({ chain: '0x1' });
    await sendFromEvm(w.provider, transfer);
    expect(w.calls[1]).toEqual({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x2105' }],
    });
  });

  it('does not send if the wallet stays on the wrong network', async () => {
    const w = wallet({ chain: '0x1', switches: false });
    await expect(sendFromEvm(w.provider, transfer)).rejects.toThrow(/network/);
    expect(w.calls.some(c => c.method === 'eth_sendTransaction')).toBe(false);
  });

  it('does not send if the wallet account changed', async () => {
    const w = wallet({ chain: '0x2105', accounts: ['0x000000000000000000000000000000000000dEaD'] });
    await expect(sendFromEvm(w.provider, transfer)).rejects.toThrow(/account changed/);
    expect(w.calls.some(c => c.method === 'eth_sendTransaction')).toBe(false);
  });

  it('rejects a reply that is not a transaction hash', async () => {
    const w = wallet({ chain: '0x2105', hash: null });
    await expect(sendFromEvm(w.provider, transfer)).rejects.toThrow(/hash/);
  });

  async function phaseOf(work: Promise<unknown>): Promise<string> {
    try {
      await work;
      return 'resolved';
    } catch (err) {
      return err instanceof SendError ? err.phase : 'untyped';
    }
  }

  it('says where a send failed: before the wallet, rejected, or after dispatch', async () => {
    expect(
      await phaseOf(sendFromEvm(wallet({ chain: '0x1', switches: false }).provider, transfer))
    ).toBe('not-sent');
    expect(
      await phaseOf(sendFromEvm(wallet({ chain: '0x2105', accounts: [SWAP] }).provider, transfer))
    ).toBe('not-sent');
    expect(
      await phaseOf(
        sendFromEvm(
          wallet({
            chain: '0x2105',
            sendError: Object.assign(new Error('User rejected'), { code: 4001 }),
          }).provider,
          transfer
        )
      )
    ).toBe('rejected');
    expect(
      await phaseOf(
        sendFromEvm(
          wallet({ chain: '0x2105', sendError: new Error('timed out') }).provider,
          transfer
        )
      )
    ).toBe('uncertain');
    expect(
      await phaseOf(sendFromEvm(wallet({ chain: '0x2105', hash: '0x12' }).provider, transfer))
    ).toBe('uncertain');
  });
});

describe('evmTransactionState', () => {
  const HASH = '0x' + 'ef'.repeat(32);

  function provider(receipt: unknown, transaction: unknown): Eip1193Provider {
    return {
      request(args) {
        expect(args.params).toEqual([HASH]);
        if (args.method === 'eth_getTransactionReceipt') return Promise.resolve(receipt);
        if (args.method === 'eth_getTransactionByHash') return Promise.resolve(transaction);
        return Promise.reject(new Error(`unexpected ${args.method}`));
      },
    };
  }

  it('reads the receipt status, then whether the transaction is known', async () => {
    expect(await evmTransactionState(provider({ status: '0x1' }, null), HASH)).toBe('succeeded');
    expect(await evmTransactionState(provider({ status: '0x0' }, null), HASH)).toBe('reverted');
    expect(await evmTransactionState(provider(null, { hash: HASH }), HASH)).toBe('pending');
    expect(await evmTransactionState(provider(null, null), HASH)).toBe('unknown');
  });
});

describe('malformed wallet RPC results', () => {
  const transfer = buildEvmTransfer({ token: USDC_BASE, from: FROM, to: SWAP, amount: '12003925' });

  function replying(results: Record<string, unknown>) {
    const methods: string[] = [];
    const provider: Eip1193Provider = {
      request(args) {
        methods.push(args.method);
        return new Promise(resolve => resolve(results[args.method]));
      },
    };
    return { provider, methods };
  }

  it.each([
    ['a numeric chain id', { eth_chainId: 8453, eth_accounts: [FROM] }, /eth_chainId/],
    ['no chain id', { eth_accounts: [FROM] }, /eth_chainId/],
    ['accounts that are not a list', { eth_chainId: '0x2105', eth_accounts: FROM }, /eth_accounts/],
    ['a non-text account', { eth_chainId: '0x2105', eth_accounts: [42] }, /eth_accounts/],
  ])('sendFromEvm refuses %s and sends nothing', async (_name, results, message) => {
    const w = replying(results);
    await expect(sendFromEvm(w.provider, transfer)).rejects.toThrow(message);
    expect(w.methods).not.toContain('eth_sendTransaction');
  });

  it.each([
    ['an object instead of a list', { 0: FROM }],
    ['a non-text account', [12345]],
    ['nothing', undefined],
  ])('connectEvm refuses %s', async (_name, accounts) => {
    const w = replying({ eth_requestAccounts: accounts });
    await expect(connectEvm({ id: 'x', name: 'X', provider: w.provider })).rejects.toThrow(
      /^Unexpected data from the wallet \(eth_requestAccounts\)/
    );
  });

  it('connectEvm still takes the first valid account', async () => {
    const w = replying({ eth_requestAccounts: [FROM, SWAP] });
    expect(await connectEvm({ id: 'x', name: 'X', provider: w.provider })).toMatchObject({
      kind: 'evm',
      address: FROM,
    });
  });
});
