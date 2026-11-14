import { HDKey } from '@scure/bip32';
import { generateMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import * as btc from '@scure/btc-signer';
import { privateKeyToAddress } from '@stacks/transactions';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MAINNET } from 'sbtc';

import { repoRoot } from './lib/env.js';

const path = resolve(repoRoot, '.env.local');
if (existsSync(path)) {
  console.error(
    '.env.local already exists. Not overwriting it; move it aside first if you really want a new wallet.'
  );
  process.exit(1);
}

const mnemonic = generateMnemonic(wordlist, 256);
const root = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic));

const stxKey = root.derive("m/44'/5757'/0'/0/0").privateKey;
const btcNode = root.derive("m/84'/0'/0'/0/0");
const btcKey = btcNode.privateKey;
if (!stxKey || !btcKey || !btcNode.publicKey) throw new Error('Key derivation failed');

const stacksAddress = privateKeyToAddress(Buffer.from(stxKey).toString('hex') + '01', 'mainnet');
const wif = btc.WIF(MAINNET).encode(btcKey);
const bitcoinAddress = btc.p2wpkh(btcNode.publicKey, MAINNET).address;

writeFileSync(
  path,
  [
    '# Throwaway wallet for mainnet proofs. Small amounts only. Never commit.',
    `# Created ${new Date().toISOString()}`,
    '#',
    '# Seed phrase. Import into Leather to reach the sBTC and the Bitcoin account.',
    `TEST_MNEMONIC="${mnemonic}"`,
    '',
    '# Stacks address that receives the sBTC (account 1 of the seed above).',
    `TEST_STX_ADDRESS=${stacksAddress}`,
    '',
    `# Reclaim key: the private key of ${bitcoinAddress}.`,
    `TEST_BTC_WIF=${wif}`,
    '',
    '# Optional: 1Click partner key, removes the 0.2% keyless fee.',
    'ONECLICK_JWT=',
    '',
  ].join('\n'),
  { mode: 0o600 }
);

console.log('Throwaway wallet written to .env.local (readable only by you).');
console.log(`  Stacks address   ${stacksAddress}`);
console.log(`  Bitcoin address  ${bitcoinAddress}`);
console.log('The seed phrase and private key are in the file only; they were not printed.');
