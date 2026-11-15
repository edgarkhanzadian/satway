import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

import { chainFamily, isSolanaAddress } from './chain-metadata.js';

export type DestinationCheck = { ok: true; address: string } | { ok: false; message: string };

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const EVM_ZERO = `0x${'0'.repeat(40)}`;
const SOLANA_SYSTEM_PROGRAM = '11111111111111111111111111111111';

export function destinationSupported(blockchain: string): boolean {
  return chainFamily(blockchain) !== 'other';
}

export function evmChecksumAddress(address: string): string {
  const lower = address.toLowerCase().replace(/^0x/, '');
  const hash = bytesToHex(keccak_256(utf8ToBytes(lower)));
  const chars = [...lower].map((c, i) =>
    /[a-f]/.test(c) && parseInt(hash.charAt(i), 16) >= 8 ? c.toUpperCase() : c
  );
  return `0x${chars.join('')}`;
}

function checkEvm(address: string): DestinationCheck {
  if (!EVM_ADDRESS.test(address)) {
    return {
      ok: false,
      message: 'This is not an EVM address. It should be 0x followed by 40 hex characters.',
    };
  }
  if (address.toLowerCase() === EVM_ZERO) {
    return { ok: false, message: 'This is the zero address. Funds sent there are lost.' };
  }
  const body = address.slice(2);
  const mixed = body !== body.toLowerCase() && body !== body.toUpperCase();
  if (mixed && evmChecksumAddress(address) !== address) {
    return {
      ok: false,
      message:
        'This address has a capitalisation error (its checksum does not match). Copy it again from your wallet.',
    };
  }
  return { ok: true, address };
}

function checkSolana(address: string): DestinationCheck {
  if (!isSolanaAddress(address)) {
    return { ok: false, message: 'This is not a Solana address.' };
  }
  if (address === SOLANA_SYSTEM_PROGRAM) {
    return { ok: false, message: 'This is a Solana program address, not a wallet.' };
  }
  return { ok: true, address };
}

export function checkDestinationAddress(blockchain: string, input: string): DestinationCheck {
  const address = input.trim();
  if (address === '') return { ok: false, message: 'Enter the address that receives the funds.' };
  if (address !== input || /\s/.test(address)) {
    return { ok: false, message: 'The address has spaces in it. Copy it again from your wallet.' };
  }
  const family = chainFamily(blockchain);
  switch (family) {
    case 'evm':
      return checkEvm(address);
    case 'solana':
      return checkSolana(address);
    case 'other':
      return {
        ok: false,
        message: `Withdrawals to ${blockchain} are not supported, because addresses on it cannot be checked here.`,
      };
    default:
      throw new Error(`Unknown chain family ${String(family satisfies never)}`);
  }
}
