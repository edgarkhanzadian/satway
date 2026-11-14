import { base58, base64 } from '@scure/base';
import { describe, expect, it, vi } from 'vitest';

import type { OneClickToken } from '@portage/core';

import { SOLANA_MAINNET_CAIP2 } from '../src/config.js';
import {
  EVM_CHAIN_IDS,
  type SourceWallet,
  buildEvmTransfer,
  sendFromEvm,
  walletAddressFor,
} from '../src/source-wallet.js';
import {
  INITIAL_PAIRING,
  MISSING_SOLANA_MESSAGE,
  approvedChainIds,
  approvedSolana,
  endWalletSession,
  evmNamespaces,
  isPairingUri,
  missingChainMessage,
  pairingReducer,
  parseChainId,
  qrPath,
  readSession,
  registerSessionEnd,
  sessionKey,
  sessionWallet,
  solanaNamespaces,
  walletConnectErrorMessage,
  walletConnectProvider,
  walletConnectSolanaSender,
  withSignature,
} from '../src/walletconnect.js';

const SOL_WALLET = 'DgrD34m4MdR1SWr7VYezeddN61i9ib14YUVXh5QvKG1H';
const SOL_OTHER = 'oCMJgh2BEpNyWN4RBFnjXfaLG5NgMCGcqRkEomN6jo6';
const SIG =
  '4QMdVtgtZcuygfB7RnGhZvrPxVDjXU7WgaKCaYEd2XSeQYMGKSrthoiV4GmL6pq2fu5gHaoiHofNEYTNSJuryyr';

function solanaSession(accounts: string[], name?: unknown, methods: string[] = []) {
  return {
    topic: 't',
    namespaces: { solana: { accounts, methods, events: [] } },
    peer: { metadata: { name } },
  };
}

function fakeSolana(opts: { methods: string[]; accounts?: string[]; reply?: unknown }) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const accounts = opts.accounts ?? [`${SOLANA_MAINNET_CAIP2}:${SOL_WALLET}`];
  const sender = walletConnectSolanaSender(
    {
      namespaces: () => solanaSession(accounts, undefined, opts.methods).namespaces,
      request(args) {
        calls.push(args);
        return Promise.resolve(opts.reply);
      },
    },
    SOL_WALLET
  );
  return { calls, sender };
}

const FROM = '0x2527D02599Ba641c19FEa793cD0F167589a0f10D';
const SWAP = '0x4352589330E4Ab9c40B2eaFBc125F4eeA38e260D';
const HASH = '0x' + 'ab'.repeat(32);
const URI = `wc:${'c'.repeat(64)}@2?relay-protocol=irn&symKey=${'d'.repeat(64)}&expiryTimestamp=1`;
const USDC_BASE: OneClickToken = {
  assetId: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
  decimals: 6,
  blockchain: 'base',
  symbol: 'USDC',
  price: 1,
  contractAddress: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
};

function session(accounts: string[], chains?: string[], name?: unknown) {
  return {
    topic: 't',
    namespaces: { eip155: { accounts, chains, methods: [], events: [] } },
    peer: { metadata: { name } },
  };
}

function fakeTransport(opts: { approved: number[]; chain: number; accounts?: string[] }) {
  const calls: { method: string; params?: unknown[] }[] = [];
  let chain = opts.chain;
  const transport = {
    calls,
    approvedChainIds: () => opts.approved,
    request(args: { method: string; params?: unknown[] }): Promise<unknown> {
      calls.push(args);
      switch (args.method) {
        case 'eth_chainId':
          return Promise.resolve(chain);
        case 'eth_accounts':
          return Promise.resolve(opts.accounts ?? [FROM]);
        case 'wallet_switchEthereumChain': {
          const id = parseChainId(Reflect.get(Object(args.params?.[0]), 'chainId'));
          if (id !== null) chain = id;
          return Promise.resolve(null);
        }
        case 'eth_sendTransaction':
          return Promise.resolve(HASH);
        default:
          return Promise.reject(new Error(`unexpected ${args.method}`));
      }
    },
  };
  return transport;
}

describe('evmNamespaces', () => {
  it('asks for every supported EVM chain, and only the methods and events we use', () => {
    const ns = evmNamespaces();
    expect(ns.eip155.chains).toEqual(Object.values(EVM_CHAIN_IDS).map(id => `eip155:${id}`));
    expect(ns.eip155.chains).toHaveLength(10);
    expect(ns.eip155.methods).toEqual(['eth_sendTransaction', 'wallet_switchEthereumChain']);
    expect(ns.eip155.events).toEqual(['chainChanged', 'accountsChanged']);
  });
});

describe('parseChainId', () => {
  it('reads numbers, hex and decimal strings', () => {
    expect(parseChainId(8453)).toBe(8453);
    expect(parseChainId('0x2105')).toBe(8453);
    expect(parseChainId('8453')).toBe(8453);
  });

  it('rejects anything else', () => {
    for (const bad of [0, -1, 1.5, '', '0x', 'base', '08', null, undefined, {}]) {
      expect(parseChainId(bad)).toBeNull();
    }
  });
});

describe('readSession', () => {
  it('maps a session to an address, its chains and the wallet name', () => {
    const s = session(
      [`eip155:8453:${FROM}`, `eip155:1:${FROM}`, `eip155:999:${FROM}`],
      ['eip155:8453', 'eip155:1', 'eip155:999'],
      'Rainbow'
    );
    expect(readSession(s)).toEqual({
      evm: { address: FROM, activeChainId: 8453, chainIds: [1, 8453] },
      solana: null,
      peerName: 'Rainbow',
    });
  });

  it('takes approved chains from accounts when the namespace lists no chains', () => {
    expect(approvedChainIds(session([`eip155:42161:${FROM}`]).namespaces)).toEqual([42161]);
  });

  it('skips malformed and unsupported accounts', () => {
    const s = session(['eip155:1:0x1234', `eip155:999:${FROM}`, 'solana:x:y', `eip155:10:${SWAP}`]);
    expect(readSession(s).evm).toEqual({ address: SWAP, activeChainId: 10, chainIds: [10] });
    expect(readSession(s).solana).toBeNull();
  });

  it('fails when the wallet shared no usable account', () => {
    expect(() => readSession(session([`eip155:999:${FROM}`]))).toThrow(/did not share an account/);
    expect(() =>
      readSession(solanaSession([`solana:4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZ:${SOL_WALLET}`]))
    ).toThrow(/did not share an account/);
    expect(() => readSession({})).toThrow();
    expect(() => readSession(null)).toThrow();
  });

  it('ignores a missing or non-string wallet name', () => {
    expect(readSession(session([`eip155:1:${FROM}`], undefined, 42)).peerName).toBeNull();
    expect(readSession(session([`eip155:1:${FROM}`], undefined, '  ')).peerName).toBeNull();
  });
});

describe('sessionWallet', () => {
  it('becomes an ordinary EVM source wallet', () => {
    const provider = walletConnectProvider(fakeTransport({ approved: [1], chain: 1 }));
    const info = readSession(session([`eip155:1:${FROM}`], undefined, 'Rainbow'));
    expect(sessionWallet(info, provider)).toEqual({
      kind: 'evm',
      name: 'Rainbow (WalletConnect)',
      address: FROM,
      provider,
    });
    expect(sessionWallet({ ...info, peerName: null }, provider).name).toBe('WalletConnect');
  });

  it('carries both accounts when the session has EVM and Solana', () => {
    const provider = walletConnectProvider(fakeTransport({ approved: [1], chain: 1 }));
    const both = {
      topic: 't',
      namespaces: {
        eip155: { accounts: [`eip155:1:${FROM}`], methods: [], events: [] },
        solana: {
          accounts: [`${SOLANA_MAINNET_CAIP2}:${SOL_WALLET}`],
          methods: ['solana_signAndSendTransaction'],
          events: [],
        },
      },
      peer: { metadata: { name: 'Both' } },
    };
    const info = readSession(both);
    expect(info.solana).toEqual({ address: SOL_WALLET });
    const sender = fakeSolana({ methods: ['solana_signAndSendTransaction'] }).sender;
    const wallet = sessionWallet(info, provider, sender);
    expect(wallet).toEqual({
      kind: 'evm',
      name: 'Both (WalletConnect)',
      address: FROM,
      provider,
      solana: { address: SOL_WALLET, sender },
    });
    expect(walletAddressFor(wallet, 'solana')).toBe(SOL_WALLET);
    expect(walletAddressFor(wallet, 'evm')).toBe(FROM);
    expect(sessionKey(wallet)).toBe(provider);
  });

  it('becomes a Solana source wallet when the session has only Solana', () => {
    const info = readSession(solanaSession([`${SOLANA_MAINNET_CAIP2}:${SOL_WALLET}`], 'Phantom'));
    expect(info).toEqual({ evm: null, solana: { address: SOL_WALLET }, peerName: 'Phantom' });
    const sender = fakeSolana({ methods: ['solana_signTransaction'] }).sender;
    const wallet = sessionWallet(info, null, sender);
    expect(wallet).toEqual({
      kind: 'solana',
      name: 'Phantom (WalletConnect)',
      address: SOL_WALLET,
      sender,
    });
    expect(sessionKey(wallet)).toBe(sender);
    expect(() => sessionWallet(info, null, null)).toThrow(/did not share an account/);
  });
});

describe('solanaNamespaces', () => {
  it('asks only for Solana mainnet and the two sending methods', () => {
    expect(solanaNamespaces()).toEqual({
      solana: {
        chains: ['solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'],
        methods: ['solana_signAndSendTransaction', 'solana_signTransaction'],
        events: [],
      },
    });
  });
});

describe('approvedSolana', () => {
  it('reads mainnet accounts and only the methods we use', () => {
    const s = solanaSession(
      [
        `${SOLANA_MAINNET_CAIP2}:${SOL_WALLET}`,
        `${SOLANA_MAINNET_CAIP2}:${SOL_WALLET}`,
        `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1:${SOL_OTHER}`,
        `${SOLANA_MAINNET_CAIP2}:0xnope`,
      ],
      undefined,
      ['solana_signMessage', 'solana_signTransaction']
    );
    expect(approvedSolana(s.namespaces)).toEqual({
      addresses: [SOL_WALLET],
      methods: ['solana_signTransaction'],
    });
    expect(approvedSolana(undefined)).toEqual({ addresses: [], methods: [] });
  });
});

describe('walletConnectSolanaSender', () => {
  const TX = Uint8Array.from([1, ...new Array<number>(64).fill(0), 9, 8, 7]);

  it('uses solana_signAndSendTransaction when approved and returns the signature', async () => {
    const fake = fakeSolana({
      methods: ['solana_signAndSendTransaction', 'solana_signTransaction'],
      reply: { signature: SIG },
    });
    expect(await fake.sender.send(TX)).toEqual({ kind: 'sent', signature: SIG });
    expect(fake.calls).toEqual([
      {
        method: 'solana_signAndSendTransaction',
        params: {
          transaction: base64.encode(TX),
          sendOptions: { preflightCommitment: 'confirmed' },
        },
      },
    ]);
  });

  it('falls back to solana_signTransaction and returns the signed bytes', async () => {
    const signed = Uint8Array.from([1, ...new Array<number>(64).fill(5), 9, 8, 7]);
    const fake = fakeSolana({
      methods: ['solana_signTransaction'],
      reply: { signature: SIG, transaction: base64.encode(signed) },
    });
    expect(await fake.sender.send(TX)).toEqual({ kind: 'signed', transaction: signed });
    expect(fake.calls.map(c => c.method)).toEqual(['solana_signTransaction']);
  });

  it('puts a bare signature into the transaction it was given', async () => {
    const fake = fakeSolana({ methods: ['solana_signTransaction'], reply: { signature: SIG } });
    const out = await fake.sender.send(TX);
    expect(out.kind).toBe('signed');
    if (out.kind !== 'signed') return;
    expect(base58.encode(out.transaction.subarray(1, 65))).toBe(SIG);
    expect([...out.transaction.subarray(65)]).toEqual([9, 8, 7]);
    expect([...TX.subarray(1, 65)].every(b => b === 0)).toBe(true);
  });

  it('refuses when the session did not approve Solana or a sending method', async () => {
    const none = fakeSolana({ methods: [], accounts: [] });
    await expect(none.sender.send(TX)).rejects.toThrow(MISSING_SOLANA_MESSAGE);
    const noMethods = fakeSolana({ methods: ['solana_signMessage'] });
    await expect(noMethods.sender.send(TX)).rejects.toThrow(MISSING_SOLANA_MESSAGE);
    expect(none.calls).toEqual([]);
    expect(noMethods.calls).toEqual([]);
  });

  it('refuses when the session account changed', async () => {
    const fake = fakeSolana({
      methods: ['solana_signAndSendTransaction'],
      accounts: [`${SOLANA_MAINNET_CAIP2}:${SOL_OTHER}`],
    });
    await expect(fake.sender.send(TX)).rejects.toThrow(/account changed/);
    expect(fake.calls).toEqual([]);
  });

  it('rejects a reply that is not a Solana signature', async () => {
    const hex = fakeSolana({
      methods: ['solana_signAndSendTransaction'],
      reply: { signature: '0x' + 'ab'.repeat(64) },
    });
    await expect(hex.sender.send(TX)).rejects.toThrow(/did not return a transaction signature/);
    const empty = fakeSolana({ methods: ['solana_signTransaction'], reply: {} });
    await expect(empty.sender.send(TX)).rejects.toThrow(/did not return a transaction signature/);
  });

  it('only fills in a signature for a single-signer transaction', () => {
    expect(() => withSignature(Uint8Array.from([2, 0]), SIG)).toThrow(/single-signer/);
  });
});

describe('walletConnectProvider with sendFromEvm', () => {
  const transfer = buildEvmTransfer({ token: USDC_BASE, from: FROM, to: SWAP, amount: '12003925' });

  it('reports the chain id as hex', async () => {
    const provider = walletConnectProvider(fakeTransport({ approved: [8453], chain: 8453 }));
    expect(await provider.request({ method: 'eth_chainId' })).toBe('0x2105');
  });

  it('sends on an approved chain without switching', async () => {
    const transport = fakeTransport({ approved: [1, 8453], chain: 8453 });
    expect(await sendFromEvm(walletConnectProvider(transport), transfer)).toBe(HASH);
    expect(transport.calls.map(c => c.method)).not.toContain('wallet_switchEthereumChain');
    expect(transport.calls.at(-1)).toEqual({
      method: 'eth_sendTransaction',
      params: [transfer.tx],
    });
  });

  it('switches to another approved chain, then sends', async () => {
    const transport = fakeTransport({ approved: [1, 8453], chain: 1 });
    expect(await sendFromEvm(walletConnectProvider(transport), transfer)).toBe(HASH);
    expect(transport.calls).toContainEqual({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x2105' }],
    });
  });

  it('refuses when the target chain is not in the session, and sends nothing', async () => {
    const transport = fakeTransport({ approved: [1], chain: 1 });
    await expect(sendFromEvm(walletConnectProvider(transport), transfer)).rejects.toThrow(
      missingChainMessage(8453)
    );
    const methods = transport.calls.map(c => c.method);
    expect(methods).not.toContain('wallet_switchEthereumChain');
    expect(methods).not.toContain('eth_sendTransaction');
  });

  it('refuses to send while the active chain is not approved', async () => {
    const transport = fakeTransport({ approved: [1], chain: 8453 });
    const provider = walletConnectProvider(transport);
    await expect(
      provider.request({ method: 'eth_sendTransaction', params: [transfer.tx] })
    ).rejects.toThrow(/did not approve Base/);
    expect(transport.calls.map(c => c.method)).not.toContain('eth_sendTransaction');
  });

  it('keeps the account check of sendFromEvm', async () => {
    const transport = fakeTransport({ approved: [8453], chain: 8453, accounts: [SWAP] });
    await expect(sendFromEvm(walletConnectProvider(transport), transfer)).rejects.toThrow(
      /account changed/
    );
  });

  it('rejects a switch request without a valid chain id', async () => {
    const provider = walletConnectProvider(fakeTransport({ approved: [1], chain: 1 }));
    await expect(
      provider.request({ method: 'wallet_switchEthereumChain', params: [{}] })
    ).rejects.toThrow(/No network/);
  });
});

describe('pairingReducer', () => {
  const matrix = [[true]];

  it('shows the code for the current attempt', () => {
    const started = pairingReducer(INITIAL_PAIRING, { type: 'start', attempt: 1 });
    expect(started).toEqual({ status: 'starting', attempt: 1 });
    expect(pairingReducer(started, { type: 'uri', attempt: 1, uri: URI, matrix })).toEqual({
      status: 'pairing',
      attempt: 1,
      uri: URI,
      matrix,
    });
  });

  it('ignores codes and errors from an earlier attempt', () => {
    const started = pairingReducer(INITIAL_PAIRING, { type: 'start', attempt: 2 });
    expect(pairingReducer(started, { type: 'uri', attempt: 1, uri: URI, matrix })).toBe(started);
    expect(pairingReducer(started, { type: 'fail', attempt: 1, message: 'x' })).toBe(started);
    expect(pairingReducer(started, { type: 'connected', attempt: 1 })).toBe(started);
  });

  it('ignores a code after cancel, and anything that is not a pairing URI', () => {
    const started = pairingReducer(INITIAL_PAIRING, { type: 'start', attempt: 1 });
    const cancelled = pairingReducer(started, { type: 'cancel' });
    expect(cancelled).toEqual({ status: 'idle', attempt: 1 });
    expect(pairingReducer(cancelled, { type: 'uri', attempt: 1, uri: URI, matrix })).toBe(
      cancelled
    );
    expect(pairingReducer(cancelled, { type: 'fail', attempt: 1, message: 'x' })).toBe(cancelled);
    expect(
      pairingReducer(started, { type: 'uri', attempt: 1, uri: 'https://evil.example', matrix })
    ).toBe(started);
  });

  it('shows a failure, and returns to idle once connected', () => {
    const started = pairingReducer(INITIAL_PAIRING, { type: 'start', attempt: 1 });
    expect(pairingReducer(started, { type: 'fail', attempt: 1, message: 'nope' })).toEqual({
      status: 'failed',
      attempt: 1,
      message: 'nope',
    });
    expect(pairingReducer(started, { type: 'connected', attempt: 1 })).toEqual({
      status: 'idle',
      attempt: 1,
    });
  });
});

describe('isPairingUri', () => {
  it('accepts only WalletConnect v2 pairing URIs', () => {
    expect(isPairingUri(URI)).toBe(true);
    expect(isPairingUri(`wc:${'c'.repeat(64)}@1?bridge=x`)).toBe(false);
    expect(isPairingUri('javascript:alert(1)')).toBe(false);
    expect(isPairingUri(undefined)).toBe(false);
  });
});

describe('qrPath', () => {
  it('draws one unit square per dark module', () => {
    expect(
      qrPath([
        [true, false],
        [false, true],
      ])
    ).toBe('M0 0h1v1h-1zM1 1h1v1h-1z');
    expect(qrPath([])).toBe('');
  });
});

describe('walletConnectErrorMessage', () => {
  it('explains rejection, expiry and an unreachable relay', () => {
    expect(walletConnectErrorMessage({ code: 5000, message: 'User rejected.' })).toBe(
      'The wallet rejected the connection.'
    );
    expect(walletConnectErrorMessage(new Error('Proposal expired'))).toMatch(/expired/);
    expect(walletConnectErrorMessage(new Error('Pairing expired'))).toMatch(/Start again/);
    expect(walletConnectErrorMessage(new Error('Timed out reaching the relay'))).toMatch(
      /Could not reach the WalletConnect relay/
    );
    expect(walletConnectErrorMessage(new Error('WebSocket connection failed'))).toMatch(
      /Could not reach/
    );
    expect(walletConnectErrorMessage(new Error('boom'))).toBe('WalletConnect failed: boom');
    expect(walletConnectErrorMessage(undefined)).toBe('WalletConnect failed.');
  });
});

describe('endWalletSession', () => {
  it('ends the registered WalletConnect session once', async () => {
    const provider = walletConnectProvider(fakeTransport({ approved: [1], chain: 1 }));
    const end = vi.fn(() => Promise.resolve());
    registerSessionEnd(provider, end);
    const wallet: SourceWallet = { kind: 'evm', name: 'WalletConnect', address: FROM, provider };
    await endWalletSession(wallet);
    await endWalletSession(wallet);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('does nothing for other wallets', async () => {
    await expect(endWalletSession(null)).resolves.toBeUndefined();
    await expect(
      endWalletSession({ kind: 'solana', name: 'Solana wallet', address: 'x' })
    ).resolves.toBeUndefined();
  });

  it('ends a Solana-only WalletConnect session through its sender', async () => {
    const sender = fakeSolana({ methods: [] }).sender;
    const end = vi.fn(() => Promise.resolve());
    registerSessionEnd(sender, end);
    await endWalletSession({ kind: 'solana', name: 'WalletConnect', address: SOL_WALLET, sender });
    expect(end).toHaveBeenCalledTimes(1);
  });
});
