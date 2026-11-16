import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

import { isEvmChain } from './chain-metadata.js';

export type DestinationCheck = { ok: true; address: string } | { ok: false; message: string };

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const EVM_ZERO = `0x${'0'.repeat(40)}`;
const EVM_RESERVED_RANGE = /^0x0{36}[0-9a-f]{4}$/;
const EVM_BURN_ADDRESSES: ReadonlySet<string> = new Set([
  '0xdead000000000000000042069420694206942069',
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  `0x${'f'.repeat(40)}`,
]);

const OP_STACK_CHAINS: ReadonlySet<string> = new Set(['op', 'base']);
const OP_STACK_PREDEPLOYS = /^0x420{35}[0-7][0-9a-f]{2}$/;
const WRAPPED_NATIVE: Readonly<Record<string, string>> = Object.freeze({
  eth: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  arb: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
});

export interface DestinationToken {
  contractAddress?: string;
}

export function evmChecksumAddress(address: string): string {
  const lower = address.toLowerCase().replace(/^0x/, '');
  const hash = bytesToHex(keccak_256(utf8ToBytes(lower)));
  const chars = [...lower].map((c, i) =>
    /[a-f]/.test(c) && parseInt(hash.charAt(i), 16) >= 8 ? c.toUpperCase() : c
  );
  return `0x${chars.join('')}`;
}

function checkEvm(blockchain: string, address: string, token: DestinationToken): DestinationCheck {
  if (!EVM_ADDRESS.test(address)) {
    return {
      ok: false,
      message: 'This is not an EVM address. It should be 0x followed by 40 hex characters.',
    };
  }
  if (address.toLowerCase() === EVM_ZERO) {
    return { ok: false, message: 'This is the zero address. Funds sent there are lost.' };
  }
  const lower = address.toLowerCase();
  if (EVM_RESERVED_RANGE.test(lower) || EVM_BURN_ADDRESSES.has(lower)) {
    return {
      ok: false,
      message:
        'This is a reserved system or burn address, not a wallet. Funds sent there are lost.',
    };
  }
  if (OP_STACK_CHAINS.has(blockchain) && OP_STACK_PREDEPLOYS.test(lower)) {
    return {
      ok: false,
      message: `This is a system contract on ${blockchain}, not a wallet. Funds sent there are lost.`,
    };
  }
  if (Object.hasOwn(WRAPPED_NATIVE, blockchain) && WRAPPED_NATIVE[blockchain] === lower) {
    return {
      ok: false,
      message: `This is the wrapped-coin contract on ${blockchain}, not a wallet. Funds sent there are lost.`,
    };
  }
  if (token.contractAddress !== undefined && token.contractAddress.toLowerCase() === lower) {
    return {
      ok: false,
      message:
        'This is the contract of the token you receive, not a wallet. Funds sent there are lost. Enter an address you control.',
    };
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

export function checkDestinationAddress(
  blockchain: string,
  input: string,
  token: DestinationToken
): DestinationCheck {
  const address = input.trim();
  if (address === '') return { ok: false, message: 'Enter the address that receives the funds.' };
  if (address !== input || /\s/.test(address)) {
    return { ok: false, message: 'The address has spaces in it. Copy it again from your wallet.' };
  }
  if (!isEvmChain(blockchain)) {
    return {
      ok: false,
      message: `Withdrawals to ${blockchain} are not supported, because addresses on it cannot be checked here.`,
    };
  }
  return checkEvm(blockchain, address, token);
}
