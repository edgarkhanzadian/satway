import { field, stringField } from '../world/http.js';
import type { World } from '../world/world.js';
import { Behaviour, WalletError } from './behaviour.js';

export const EVM_WALLET_NAME = 'Test EVM Wallet';

const SUPPORTED_CHAINS: ReadonlySet<number> = new Set([1, 10, 56, 137, 8453, 42161]);

function hexQuantity(value: unknown, what: string): bigint {
  if (value === undefined) return 0n;
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]*$/.test(value))
    throw new WalletError(-32602, `Invalid ${what}`);
  return value === '0x' ? 0n : BigInt(value);
}

export type SwitchMode = 'switch' | 'ignore';

export type EvmEmitter = (event: string, payload: unknown) => Promise<void>;

export class EvmWallet {
  readonly behaviour = new Behaviour();
  readonly accounts: string[];
  chainId: number;
  switchMode: SwitchMode = 'switch';
  private emitter: EvmEmitter | null = null;
  private readonly world: World;

  constructor(world: World, options: { chainId?: number } = {}) {
    this.world = world;
    this.accounts = [world.rng.evmAddress()];
    this.chainId = options.chainId ?? 1;
  }

  get address(): string {
    const first = this.accounts[0];
    if (!first) throw new Error('The test EVM wallet has no account');
    return first;
  }

  attach(emitter: EvmEmitter): void {
    this.emitter = emitter;
  }

  async changeAccount(): Promise<string> {
    const next = this.world.rng.evmAddress();
    this.accounts.splice(0, this.accounts.length, next);
    await this.emitter?.('accountsChanged', [next]);
    return next;
  }

  async changeChain(chainId: number): Promise<void> {
    this.chainId = chainId;
    await this.emitter?.('chainChanged', `0x${chainId.toString(16)}`);
  }

  handle(payload: unknown): Promise<unknown> {
    const method = stringField(payload, 'method') ?? '';
    const params = field(payload, 'params');
    return this.behaviour.run(method, params ?? null, () => this.approve(method, params));
  }

  private async approve(method: string, params: unknown): Promise<unknown> {
    const list: unknown[] = Array.isArray(params) ? params : [];
    switch (method) {
      case 'eth_requestAccounts':
      case 'eth_accounts':
        return [...this.accounts];
      case 'eth_chainId':
        return `0x${this.chainId.toString(16)}`;
      case 'wallet_switchEthereumChain': {
        const wanted = stringField(list[0], 'chainId');
        if (!wanted) throw new WalletError(-32602, 'Missing chainId');
        const id = Number(BigInt(wanted));
        if (!SUPPORTED_CHAINS.has(id))
          throw new WalletError(4902, `Unrecognized chain ID "${wanted}".`);
        if (this.switchMode === 'switch') await this.changeChain(id);
        return null;
      }
      case 'eth_sendTransaction': {
        const tx = list[0];
        const from = stringField(tx, 'from');
        const to = stringField(tx, 'to');
        if (!from || !this.accounts.some(a => a.toLowerCase() === from.toLowerCase()))
          throw new WalletError(4100, 'The requested account has not been authorized');
        if (!to || !/^0x[0-9a-fA-F]{40}$/.test(to)) throw new WalletError(-32602, 'Invalid "to"');
        const data = stringField(tx, 'data') ?? null;
        const sent = this.world.evm.submit({
          chainId: this.chainId,
          from,
          to,
          value: hexQuantity(field(tx, 'value'), 'value'),
          data,
        });
        return sent.hash;
      }
      case 'eth_getTransactionReceipt':
        return this.world.evm.receipt(String(list[0]));
      case 'eth_getTransactionByHash':
        return this.world.evm.byHash(String(list[0]));
      default:
        throw new WalletError(4200, `The wallet does not support ${method}`);
    }
  }
}
