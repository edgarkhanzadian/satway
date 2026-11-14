import { base64 } from '@scure/base';
import { AccountState, getTokenEncoder } from '@solana-program/token';
import {
  address,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  none,
} from '@solana/kit';
import { describe, expect, it } from 'vitest';

import type { OneClickToken } from '@stxonector/core';

import type { RawAccount } from '../src/solana-rpc.js';
import {
  TOKEN_2022_PROGRAM,
  associatedTokenAccount,
  buildSolanaTransfer,
  checkSolanaTarget,
  checkSolanaTransfer,
  messageOf,
  recipientTokenAccountReady,
  sameMessage,
} from '../src/solana-transfer.js';

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SYSTEM = '11111111111111111111111111111111';
const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const SENDER = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';
const DEPOSIT = '2CXBDfuKKrEmmo5vXnYbCEbUbDyweZcbL12gXC4vHC4G';
const BLOCKHASH = 'BL2sQysVf3SYJqtmRgfXG6oUWf7RUSN4sHXM582sjJsZ';
const LATEST = { blockhash: BLOCKHASH, lastValidBlockHeight: 447417734n };

const USDC_MINT_DATA = base64.decode(
  'AQAAAJj+huiNm+Lqi8HMpIeLKYjCQPUrhCS/tA7Rot3LXhmbXgh2TQqfHwAGAQEAAABicKqKWcWUBbRShshncubNEm6bil06OFNtN/e0FOi2Zw=='
);

const USDC: OneClickToken = {
  assetId: 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near',
  decimals: 6,
  blockchain: 'sol',
  symbol: 'USDC',
  price: 1,
  contractAddress: USDC_MINT,
};
const SOL: OneClickToken = {
  assetId: 'nep141:sol.omft.near',
  decimals: 9,
  blockchain: 'sol',
  symbol: 'SOL',
  price: 150,
};

function systemAccount(lamports: bigint): RawAccount {
  return { owner: SYSTEM, lamports, data: new Uint8Array(0), executable: false };
}

function tokenAccount(
  mint: string,
  owner: string,
  amount: bigint,
  state: AccountState = AccountState.Initialized
): RawAccount {
  const data = Uint8Array.from(
    getTokenEncoder().encode({
      mint: address(mint),
      owner: address(owner),
      amount,
      delegate: none(),
      state,
      isNative: none(),
      delegatedAmount: 0n,
      closeAuthority: none(),
    })
  );
  return { owner: TOKEN_PROGRAM, lamports: 2039280n, data, executable: false };
}

function chain(accounts: Record<string, RawAccount | null>) {
  const asked: string[][] = [];
  async function read(addresses: readonly string[]) {
    asked.push([...addresses]);
    return Promise.resolve(addresses.map(a => accounts[a] ?? null));
  }
  return { asked, read };
}

function decode(transaction: Uint8Array) {
  const tx = getTransactionDecoder().decode(transaction);
  const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  if (message.version !== 'legacy') throw new Error('expected a legacy message');
  const keys = message.staticAccounts.map(String);
  return {
    tx,
    message,
    keys,
    instructions: message.instructions.map(ix => ({
      program: keys[ix.programAddressIndex],
      accounts: (ix.accountIndices ?? []).map(i => keys[i]),
      data: [...(ix.data ?? new Uint8Array(0))],
    })),
  };
}

function u64(value: bigint): number[] {
  const out: number[] = [];
  let rest = value;
  for (let i = 0; i < 8; i += 1) {
    out.push(Number(rest & 0xffn));
    rest >>= 8n;
  }
  return out;
}

describe('associatedTokenAccount', () => {
  it('derives the same addresses as real mainnet deposits', async () => {
    expect(
      await associatedTokenAccount('DgrD34m4MdR1SWr7VYezeddN61i9ib14YUVXh5QvKG1H', USDC_MINT)
    ).toBe('9Lrm1sf16EkQbuT2wMKsRrxFg8HUPmv3tVCopoe8WqWT');
    expect(
      await associatedTokenAccount('oCMJgh2BEpNyWN4RBFnjXfaLG5NgMCGcqRkEomN6jo6', USDT_MINT)
    ).toBe('5ktqRrn39qCfF4AG32T3VSroLKuJY1K1rsYiYRehCsf2');
  });
});

describe('buildSolanaTransfer for native SOL', () => {
  it('is one system transfer of exactly amountIn lamports', async () => {
    const { read } = chain({ [SENDER]: systemAccount(5_000_000_000n) });
    const out = await buildSolanaTransfer(
      { token: SOL, sender: SENDER, recipient: DEPOSIT, amount: '123456789' },
      read,
      LATEST
    );
    const { tx, message, keys, instructions } = decode(out.transaction);
    expect(out.transaction[0]).toBe(1);
    expect(Object.keys(tx.signatures)).toEqual([SENDER]);
    expect(message.version).toBe('legacy');
    expect(message.header).toEqual({
      numSignerAccounts: 1,
      numReadonlySignerAccounts: 0,
      numReadonlyNonSignerAccounts: 1,
    });
    expect(keys).toEqual([SENDER, DEPOSIT, SYSTEM]);
    expect(message.lifetimeToken).toBe(BLOCKHASH);
    expect(instructions).toEqual([
      { program: SYSTEM, accounts: [SENDER, DEPOSIT], data: [2, 0, 0, 0, ...u64(123456789n)] },
    ]);
    expect(out.createsRecipientTokenAccount).toBe(false);
  });

  it('refuses when the wallet holds less than the amount', async () => {
    const { read } = chain({ [SENDER]: systemAccount(100n) });
    await expect(
      buildSolanaTransfer(
        { token: SOL, sender: SENDER, recipient: DEPOSIT, amount: '101' },
        read,
        LATEST
      )
    ).rejects.toThrow(/holds 0.0000001 SOL, less than the 0.000000101 SOL/);
  });

  it('refuses a sender with no account', async () => {
    const { read } = chain({});
    await expect(
      buildSolanaTransfer(
        { token: SOL, sender: SENDER, recipient: DEPOSIT, amount: '1' },
        read,
        LATEST
      )
    ).rejects.toThrow(/no SOL/);
  });
});

describe('buildSolanaTransfer for an SPL token', () => {
  async function accounts(withDeposit: boolean, held = 50_000_000n) {
    const senderAta = await associatedTokenAccount(SENDER, USDC_MINT);
    const depositAta = await associatedTokenAccount(DEPOSIT, USDC_MINT);
    const map: Record<string, RawAccount | null> = {
      [SENDER]: systemAccount(10_000_000n),
      [USDC_MINT]: { owner: TOKEN_PROGRAM, lamports: 1n, data: USDC_MINT_DATA, executable: false },
      [senderAta]: tokenAccount(USDC_MINT, SENDER, held),
      [depositAta]: withDeposit ? tokenAccount(USDC_MINT, DEPOSIT, 0n) : null,
    };
    return { map, senderAta, depositAta };
  }

  it('creates the deposit token account, then transferChecked of exactly amountIn', async () => {
    const { map, senderAta, depositAta } = await accounts(false);
    const out = await buildSolanaTransfer(
      { token: USDC, sender: SENDER, recipient: DEPOSIT, amount: '25000000' },
      chain(map).read,
      LATEST
    );
    const { message, keys, instructions } = decode(out.transaction);
    expect(out.createsRecipientTokenAccount).toBe(true);
    expect(out.recipientTokenAccount).toBe(depositAta);
    expect(keys[0]).toBe(SENDER);
    expect(message.header.numSignerAccounts).toBe(1);
    expect(instructions).toEqual([
      {
        program: ATA_PROGRAM,
        accounts: [SENDER, depositAta, DEPOSIT, USDC_MINT, SYSTEM, TOKEN_PROGRAM],
        data: [1],
      },
      {
        program: TOKEN_PROGRAM,
        accounts: [senderAta, USDC_MINT, depositAta, SENDER],
        data: [12, ...u64(25_000_000n), 6],
      },
    ]);
  });

  it('skips the create instruction when the deposit token account exists', async () => {
    const { map, senderAta, depositAta } = await accounts(true);
    const out = await buildSolanaTransfer(
      { token: USDC, sender: SENDER, recipient: DEPOSIT, amount: '25000000' },
      chain(map).read,
      LATEST
    );
    expect(out.createsRecipientTokenAccount).toBe(false);
    expect(decode(out.transaction).instructions).toEqual([
      {
        program: TOKEN_PROGRAM,
        accounts: [senderAta, USDC_MINT, depositAta, SENDER],
        data: [12, ...u64(25_000_000n), 6],
      },
    ]);
  });

  it('refuses a sender without the token account, or with too little', async () => {
    const { map, senderAta } = await accounts(false, 1_000_000n);
    await expect(
      buildSolanaTransfer(
        { token: USDC, sender: SENDER, recipient: DEPOSIT, amount: '25000000' },
        chain(map).read,
        LATEST
      )
    ).rejects.toThrow('Your wallet holds 1 USDC, less than the 25 USDC this deposit needs');
    await expect(
      buildSolanaTransfer(
        { token: USDC, sender: SENDER, recipient: DEPOSIT, amount: '25000000' },
        chain({ ...map, [senderAta]: null }).read,
        LATEST
      )
    ).rejects.toThrow(/no USDC token account/);
  });

  it('refuses a frozen or mismatched token account', async () => {
    const { map, senderAta, depositAta } = await accounts(true);
    const frozen = {
      ...map,
      [senderAta]: tokenAccount(USDC_MINT, SENDER, 50_000_000n, AccountState.Frozen),
    };
    await expect(
      buildSolanaTransfer(
        { token: USDC, sender: SENDER, recipient: DEPOSIT, amount: '1' },
        chain(frozen).read,
        LATEST
      )
    ).rejects.toThrow(/sender token account is frozen/);
    const wrong = { ...map, [depositAta]: tokenAccount(USDT_MINT, DEPOSIT, 0n) };
    await expect(
      buildSolanaTransfer(
        { token: USDC, sender: SENDER, recipient: DEPOSIT, amount: '1' },
        chain(wrong).read,
        LATEST
      )
    ).rejects.toThrow(/deposit token account does not match/);
  });

  it('refuses when chain decimals differ from the token list', async () => {
    const { map } = await accounts(true);
    await expect(
      buildSolanaTransfer(
        { token: { ...USDC, decimals: 9 }, sender: SENDER, recipient: DEPOSIT, amount: '1' },
        chain(map).read,
        LATEST
      )
    ).rejects.toThrow(/token list says 9 decimals but the mint on Solana has 6/);
  });

  it('refuses Token-2022 mints and accounts that are not mints', async () => {
    const { map } = await accounts(true);
    const t22 = {
      ...map,
      [USDC_MINT]: {
        owner: TOKEN_2022_PROGRAM,
        lamports: 1n,
        data: USDC_MINT_DATA,
        executable: false,
      },
    };
    await expect(
      buildSolanaTransfer(
        { token: USDC, sender: SENDER, recipient: DEPOSIT, amount: '1' },
        chain(t22).read,
        LATEST
      )
    ).rejects.toThrow(/Token-2022/);
    const notMint = { ...map, [USDC_MINT]: systemAccount(1n) };
    await expect(
      buildSolanaTransfer(
        { token: USDC, sender: SENDER, recipient: DEPOSIT, amount: '1' },
        chain(notMint).read,
        LATEST
      )
    ).rejects.toThrow(/not an SPL token/);
    const missing = { ...map, [USDC_MINT]: null };
    await expect(
      buildSolanaTransfer(
        { token: USDC, sender: SENDER, recipient: DEPOSIT, amount: '1' },
        chain(missing).read,
        LATEST
      )
    ).rejects.toThrow(/does not exist/);
  });
});

describe('checkSolanaTransfer', () => {
  const base = { token: USDC, sender: SENDER, recipient: DEPOSIT, amount: '1' };

  it('refuses ambiguous input', () => {
    expect(() =>
      checkSolanaTransfer({ ...base, recipient: '0x4352589330E4Ab9c40B2eaFBc125F4eeA38e260D' })
    ).toThrow(/not a Solana address/);
    expect(() =>
      checkSolanaTransfer({ ...base, sender: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4' })
    ).toThrow(/Sender is not/);
    expect(() => checkSolanaTransfer({ ...base, recipient: SENDER })).toThrow(/your own wallet/);
    expect(() => checkSolanaTransfer({ ...base, amount: '0' })).toThrow(/positive integer/);
    expect(() => checkSolanaTransfer({ ...base, amount: '1.5' })).toThrow(/positive integer/);
    expect(() => checkSolanaTransfer({ ...base, amount: '18446744073709551616' })).toThrow(
      /too large/
    );
    expect(() => checkSolanaTransfer({ ...base, memo: '42' })).toThrow(/deposit memo/);
    expect(() => checkSolanaTransfer({ ...base, token: { ...USDC, blockchain: 'eth' } })).toThrow(
      /not supported on eth/
    );
    expect(() =>
      checkSolanaTransfer({ ...base, token: { ...USDC, contractAddress: 'nope' } })
    ).toThrow(/mint address is not valid/);
    expect(() =>
      checkSolanaTransfer({ ...base, token: { ...USDC, contractAddress: undefined } })
    ).toThrow(/no mint address/);
    expect(() =>
      checkSolanaTransfer({
        ...base,
        token: { ...USDC, assetId: `1cs_v1:sol:spl:${USDT_MINT}` },
      })
    ).toThrow(/two different mints/);
    expect(() => checkSolanaTransfer({ ...base, token: { ...SOL, decimals: 6 } })).toThrow(
      /wrong number of decimals/
    );
  });

  it('accepts an empty memo and a matching 1cs asset id', () => {
    expect(checkSolanaTransfer({ ...base, memo: '' }).kind).toBe('spl');
    expect(
      checkSolanaTransfer({ ...base, token: { ...USDC, assetId: `1cs_v1:sol:spl:${USDC_MINT}` } })
        .kind
    ).toBe('spl');
    expect(checkSolanaTarget({ token: SOL, recipient: DEPOSIT, amount: '5' })).toEqual({
      kind: 'native',
      recipient: DEPOSIT,
      amount: 5n,
      symbol: 'SOL',
    });
  });
});

describe('recipientTokenAccountReady', () => {
  it('is true only when the deposit token account already exists', async () => {
    const depositAta = await associatedTokenAccount(DEPOSIT, USDC_MINT);
    const mint = { owner: TOKEN_PROGRAM, lamports: 1n, data: USDC_MINT_DATA, executable: false };
    const target = checkSolanaTarget({ token: USDC, recipient: DEPOSIT, amount: '1' });
    if (target.kind !== 'spl') throw new Error('expected spl');
    expect(await recipientTokenAccountReady(target, chain({ [USDC_MINT]: mint }).read)).toBe(false);
    expect(
      await recipientTokenAccountReady(
        target,
        chain({ [USDC_MINT]: mint, [depositAta]: tokenAccount(USDC_MINT, DEPOSIT, 0n) }).read
      )
    ).toBe(true);
  });
});

describe('messageOf and sameMessage', () => {
  it('compares the signed message, ignoring signatures', () => {
    const a = Uint8Array.from([1, ...new Array<number>(64).fill(0), 4, 5, 6]);
    const b = Uint8Array.from([1, ...new Array<number>(64).fill(7), 4, 5, 6]);
    const c = Uint8Array.from([1, ...new Array<number>(64).fill(7), 4, 5, 7]);
    expect([...messageOf(a)]).toEqual([4, 5, 6]);
    expect(sameMessage(a, b)).toBe(true);
    expect(sameMessage(a, c)).toBe(false);
    expect(() => messageOf(Uint8Array.from([0]))).toThrow(/single-signer/);
  });
});
