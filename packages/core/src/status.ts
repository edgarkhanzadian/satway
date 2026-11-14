import type { Payout } from './bitcoin.js';
import type { EmilyDepositStatus } from './emily.js';
import type { OneClickSwapStatus } from './oneclick.js';

export type Stage =
  | 'awaiting-funds'
  | 'swapping'
  | 'awaiting-payout'
  | 'payout-unconfirmed'
  | 'awaiting-notification'
  | 'minting'
  | 'done'
  | 'refunded'
  | 'swap-failed'
  | 'mint-failed'
  | 'reclaimable';

export interface Observations {
  swap: OneClickSwapStatus | null;
  payout: Payout | null;
  mint: EmilyDepositStatus | null;
  tipHeight: number | null;
  reclaimLockBlocks: number;
}

export interface Progress {
  stage: Stage;
  message: string;
  terminal: boolean;
  needsNotification: boolean;
  blocksUntilReclaim: number | null;
}

function blocksUntilReclaim(o: Observations): number | null {
  if (!o.payout?.confirmed || o.payout.blockHeight === null || o.tipHeight === null) return null;
  const confirmations = o.tipHeight - o.payout.blockHeight + 1;
  return Math.max(0, o.reclaimLockBlocks - confirmations);
}

export function deriveProgress(o: Observations): Progress {
  const untilReclaim = blocksUntilReclaim(o);
  const base = { needsNotification: false, blocksUntilReclaim: untilReclaim };

  if (o.payout) {
    if (o.mint === 'confirmed') {
      return {
        ...base,
        stage: 'done',
        terminal: true,
        message: 'sBTC has been minted to your Stacks address.',
      };
    }
    if (o.mint === 'failed') {
      if (untilReclaim === 0) {
        return {
          ...base,
          stage: 'reclaimable',
          terminal: true,
          message:
            'The sBTC signers rejected this deposit. You can reclaim your BTC now from the recovery page.',
        };
      }
      return {
        ...base,
        stage: 'mint-failed',
        terminal: true,
        message:
          untilReclaim === null
            ? 'The sBTC signers rejected this deposit. Your BTC can be reclaimed after the timelock.'
            : `The sBTC signers rejected this deposit. Your BTC can be reclaimed in about ${untilReclaim} blocks.`,
      };
    }
    if (!o.payout.confirmed) {
      return {
        ...base,
        needsNotification: o.mint === null,
        stage: 'payout-unconfirmed',
        terminal: false,
        message: 'BTC is on its way to your deposit address. Waiting for Bitcoin confirmations.',
      };
    }
    if (o.mint === null) {
      if (untilReclaim === 0) {
        return {
          ...base,
          needsNotification: false,
          stage: 'reclaimable',
          terminal: true,
          message:
            'This deposit was never processed. You can reclaim your BTC now from the recovery page.',
        };
      }
      return {
        ...base,
        needsNotification: true,
        stage: 'awaiting-notification',
        terminal: false,
        message: 'BTC arrived. Registering the deposit with the sBTC signers.',
      };
    }
    return {
      ...base,
      stage: 'minting',
      terminal: false,
      message: 'BTC arrived and the deposit is registered. Waiting for the signers to mint sBTC.',
    };
  }

  switch (o.swap) {
    case null:
    case 'PENDING_DEPOSIT':
      return {
        ...base,
        stage: 'awaiting-funds',
        terminal: false,
        message: 'Waiting for your funds to arrive at the swap address.',
      };
    case 'INCOMPLETE_DEPOSIT':
      return {
        ...base,
        stage: 'awaiting-funds',
        terminal: false,
        message:
          'Less than the quoted amount arrived. Send the rest before the deadline, or it will be refunded.',
      };
    case 'KNOWN_DEPOSIT_TX':
    case 'PROCESSING':
      return {
        ...base,
        stage: 'swapping',
        terminal: false,
        message: 'Funds received. Swapping to BTC.',
      };
    case 'SUCCESS':
      return {
        ...base,
        stage: 'awaiting-payout',
        terminal: false,
        message: 'Swap complete. Waiting for the BTC payout to appear on the Bitcoin network.',
      };
    case 'REFUNDED':
      return {
        ...base,
        stage: 'refunded',
        terminal: true,
        message: 'The swap did not complete and your funds were sent back to your refund address.',
      };
    case 'FAILED':
      return {
        ...base,
        stage: 'swap-failed',
        terminal: true,
        message:
          'The swap failed. Contact the swap provider with your swap deposit address to recover the funds.',
      };
    default:
      throw new Error(`Unknown swap status: ${String(o.swap satisfies never)}`);
  }
}
