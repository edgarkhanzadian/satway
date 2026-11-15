import { base64 } from '@scure/base';
import * as btc from '@scure/btc-signer';

import { field, numberField, stringField } from '../world/http.js';
import { type BitcoinKey, bitcoinKey, p2trOf, p2wpkhOf, stacksAddressOf } from '../world/keys.js';
import type { World } from '../world/world.js';
import { Behaviour, WalletError } from './behaviour.js';
import { type CapturedContractCall, approveContractCall } from './stacks-contract-call.js';

export const STACKS_WALLET_ID = 'SatwayTestStacksWallet';
export const STACKS_WALLET_NAME = 'Test Stacks Wallet';

export interface StacksAccount {
  stacksAddress: string;
  paymentAddress: string;
  taprootAddress: string;
  paymentKey: BitcoinKey;
  taprootKey: BitcoinKey;
  stacksKey: BitcoinKey;
}

export class StacksWallet {
  readonly behaviour = new Behaviour();
  readonly account: StacksAccount;
  readonly signedPsbts: { psbt: string; signInputs: unknown }[] = [];
  readonly contractCalls: CapturedContractCall[] = [];
  private readonly world: World;

  constructor(world: World) {
    this.world = world;
    const stacksKey = bitcoinKey(world.rng);
    const paymentKey = bitcoinKey(world.rng);
    const taprootKey = bitcoinKey(world.rng);
    this.account = {
      stacksAddress: stacksAddressOf(stacksKey),
      paymentAddress: p2wpkhOf(paymentKey).address,
      taprootAddress: p2trOf(taprootKey).address,
      paymentKey,
      taprootKey,
      stacksKey,
    };
  }

  get reclaimPublicKey(): string {
    return this.account.paymentKey.xOnly;
  }

  async handle(payload: unknown): Promise<unknown> {
    const method = stringField(payload, 'method') ?? '';
    const params = field(payload, 'params');
    const reply = await this.behaviour.run(method, params ?? null, () =>
      this.approve(method, params)
    );
    const id = `e2e-${this.behaviour.requests.length}`;
    if (reply.ok) return { jsonrpc: '2.0', id, result: reply.value };
    return { jsonrpc: '2.0', id, error: reply.error };
  }

  addresses(): Record<string, unknown>[] {
    const a = this.account;
    return [
      {
        symbol: 'BTC',
        type: 'p2wpkh',
        addressType: 'p2wpkh',
        purpose: 'payment',
        address: a.paymentAddress,
        publicKey: a.paymentKey.publicKey,
        derivationPath: "m/84'/0'/0'/0/0",
      },
      {
        symbol: 'BTC',
        type: 'p2tr',
        addressType: 'p2tr',
        purpose: 'ordinals',
        address: a.taprootAddress,
        publicKey: a.taprootKey.xOnly,
        derivationPath: "m/86'/0'/0'/0/0",
      },
      {
        symbol: 'STX',
        purpose: 'stacks',
        address: a.stacksAddress,
        publicKey: a.stacksKey.publicKey,
        derivationPath: "m/44'/5757'/0'/0/0",
      },
    ];
  }

  private keyFor(address: string | undefined): BitcoinKey {
    if (address === this.account.paymentAddress) return this.account.paymentKey;
    if (address === this.account.taprootAddress) return this.account.taprootKey;
    throw new WalletError(-32602, `The wallet has no key for ${address ?? 'that input'}`);
  }

  private signPsbt(params: unknown): unknown {
    const psbt = stringField(params, 'psbt');
    if (!psbt) throw new WalletError(-32602, 'Missing psbt');
    const signInputs = field(params, 'signInputs');
    const tx = btc.Transaction.fromPSBT(base64.decode(psbt), {
      allowUnknownInputs: true,
      allowUnknownOutputs: true,
    });
    const inputs: unknown[] = Array.isArray(signInputs) ? signInputs : [];
    for (const input of inputs) {
      const index = typeof input === 'number' ? input : numberField(input, 'index');
      if (index === undefined) throw new WalletError(-32602, 'Bad signInputs entry');
      const key = this.keyFor(
        typeof input === 'number' ? this.account.paymentAddress : stringField(input, 'address')
      );
      if (!tx.signIdx(key.privateKey, index))
        throw new WalletError(-32603, `Input ${index} could not be signed with that key`);
    }
    this.signedPsbts.push({ psbt, signInputs });
    if (field(params, 'broadcast') === true)
      throw new WalletError(-32603, 'This test wallet does not broadcast');
    return { psbt: base64.encode(tx.toPSBT()) };
  }

  private approve(method: string, params: unknown): unknown {
    switch (method) {
      case 'getAddresses':
      case 'stx_getAddresses':
        return { addresses: this.addresses() };
      case 'signPsbt':
        return this.signPsbt(params);
      case 'stx_callContract':
        return approveContractCall(
          this.world,
          this.account.stacksAddress,
          params,
          this.contractCalls
        );
      default:
        throw new WalletError(-32601, `The wallet does not support ${method}`);
    }
  }
}
