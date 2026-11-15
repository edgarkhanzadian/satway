import { base58, base64 } from '@scure/base';

import { stringField } from '../world/http.js';
import { type SolanaKey, signEd25519, solanaKey } from '../world/keys.js';
import {
  type DecodedTransaction,
  RpcError,
  decodeTransaction,
  effectsOf,
} from '../world/solana.js';
import type { World } from '../world/world.js';
import { Behaviour, WalletError } from './behaviour.js';

export const SOLANA_WALLET_NAME = 'Test Solana Wallet';

export type SolanaFeature = 'signAndSend' | 'sign';

export interface SolanaSignRequest {
  method: string;
  transaction: DecodedTransaction;
  simulationsBefore: number;
}

export class SolanaWallet {
  readonly behaviour = new Behaviour();
  readonly key: SolanaKey;
  readonly signRequests: SolanaSignRequest[] = [];
  private readonly world: World;

  constructor(world: World) {
    this.world = world;
    this.key = solanaKey(world.rng);
    world.solana.fund(this.key.address, 25_000_000_000n);
  }

  get address(): string {
    return this.key.address;
  }

  handle(payload: unknown): Promise<unknown> {
    const method = stringField(payload, 'method') ?? '';
    return this.behaviour.run(method, payload, () => this.approve(method, payload));
  }

  private sign(method: string, wireBase64: string): Uint8Array {
    const wire = base64.decode(wireBase64);
    const tx = decodeTransaction(wire);
    effectsOf(tx);
    this.signRequests.push({
      method,
      transaction: tx,
      simulationsBefore: this.world.solana.simulations.length,
    });
    const index = tx.accountKeys.slice(0, tx.requiredSignatures).indexOf(this.key.address);
    if (index < 0) throw new WalletError(-32602, 'The transaction is not for this account');
    const signature = signEd25519(this.key, tx.message);
    const signed = Uint8Array.from(wire);
    signed.set(signature, 1 + index * 64);
    return signed;
  }

  private approve(method: string, payload: unknown): unknown {
    const transaction = stringField(payload, 'transaction');
    switch (method) {
      case 'connect':
        return null;
      case 'signTransaction':
        if (transaction === undefined) throw new WalletError(-32602, 'Missing transaction');
        return base64.encode(this.sign(method, transaction));
      case 'signAndSendTransaction': {
        if (transaction === undefined) throw new WalletError(-32602, 'Missing transaction');
        const signed = this.sign(method, transaction);
        let signature: string;
        try {
          signature = this.world.solana.submit(signed, 'wallet');
        } catch (err) {
          if (err instanceof RpcError) throw new WalletError(err.code, err.message);
          throw err;
        }
        return base64.encode(base58.decode(signature));
      }
      default:
        throw new WalletError(4200, `The wallet does not support ${method}`);
    }
  }
}
