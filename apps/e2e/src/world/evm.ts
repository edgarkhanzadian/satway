import type { Rng } from './random.js';

export interface EvmTransaction {
  hash: string;
  chainId: number;
  from: string;
  to: string;
  value: bigint;
  data: string | null;
  blockNumber: number | null;
  reverted: boolean;
}

export type EvmTransfer =
  | { kind: 'native'; chainId: number; to: string; amount: bigint }
  | { kind: 'erc20'; chainId: number; contract: string; to: string; amount: bigint };

const TRANSFER_SELECTOR = '0xa9059cbb';

export function decodeEvmTransfer(
  tx: Pick<EvmTransaction, 'chainId' | 'to' | 'value' | 'data'>
): EvmTransfer | null {
  const data = (tx.data ?? '0x').toLowerCase();
  if (data === '0x' || data === '') {
    return { kind: 'native', chainId: tx.chainId, to: tx.to.toLowerCase(), amount: tx.value };
  }
  if (!data.startsWith(TRANSFER_SELECTOR) || data.length !== 10 + 128) return null;
  const recipientWord = data.slice(10, 74);
  const amountWord = data.slice(74, 138);
  if (!/^0{24}[0-9a-f]{40}$/.test(recipientWord)) return null;
  return {
    kind: 'erc20',
    chainId: tx.chainId,
    contract: tx.to.toLowerCase(),
    to: `0x${recipientWord.slice(24)}`,
    amount: BigInt(`0x${amountWord}`),
  };
}

export class EvmChains {
  readonly transactions = new Map<string, EvmTransaction>();
  autoMine = true;
  revertNext = 0;
  private block = 23_800_000;
  private readonly rng: Rng;
  private readonly onTransfer: (transfer: EvmTransfer, hash: string) => void;

  constructor(rng: Rng, onTransfer: (transfer: EvmTransfer, hash: string) => void) {
    this.rng = rng;
    this.onTransfer = onTransfer;
  }

  submit(tx: Omit<EvmTransaction, 'hash' | 'blockNumber' | 'reverted'>): EvmTransaction {
    const reverted = this.revertNext > 0;
    if (reverted) this.revertNext -= 1;
    const recorded: EvmTransaction = {
      ...tx,
      hash: `0x${this.rng.hex(32)}`,
      blockNumber: null,
      reverted,
    };
    this.transactions.set(recorded.hash, recorded);
    if (this.autoMine) this.include(recorded);
    return recorded;
  }

  pending(): EvmTransaction[] {
    return [...this.transactions.values()].filter(t => t.blockNumber === null);
  }

  mine(): EvmTransaction[] {
    const mined = this.pending();
    for (const tx of mined) this.include(tx);
    return mined;
  }

  private include(tx: EvmTransaction): void {
    this.block += 1;
    tx.blockNumber = this.block;
    if (tx.reverted) return;
    const transfer = decodeEvmTransfer(tx);
    if (transfer) this.onTransfer(transfer, tx.hash);
  }

  receipt(hash: string): Record<string, unknown> | null {
    const tx = this.transactions.get(hash.toLowerCase());
    if (!tx || tx.blockNumber === null) return null;
    return {
      transactionHash: tx.hash,
      blockNumber: `0x${tx.blockNumber.toString(16)}`,
      from: tx.from,
      to: tx.to,
      status: tx.reverted ? '0x0' : '0x1',
      gasUsed: tx.data ? '0xfde8' : '0x5208',
    };
  }

  byHash(hash: string): Record<string, unknown> | null {
    const tx = this.transactions.get(hash.toLowerCase());
    if (!tx) return null;
    return {
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: `0x${tx.value.toString(16)}`,
      input: tx.data ?? '0x',
      chainId: `0x${tx.chainId.toString(16)}`,
      blockNumber: tx.blockNumber === null ? null : `0x${tx.blockNumber.toString(16)}`,
    };
  }
}
