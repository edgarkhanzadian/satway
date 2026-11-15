import type { Payout } from '../bitcoin/index.js';
import type { OneClickSwapStatus } from '../oneclick/index.js';
import {
  type EmilyDepositStatus,
  type PayoutSpender,
  blocksUntilReclaimFor,
} from '../sbtc/index.js';

export type Stage =
  | 'awaiting-funds'
  | 'swapping'
  | 'awaiting-payout'
  | 'payout-unconfirmed'
  | 'payout-ambiguous'
  | 'awaiting-notification'
  | 'minting'
  | 'done'
  | 'refunded'
  | 'swap-failed'
  | 'mint-failed'
  | 'reclaimable'
  | 'reclaimed';

export interface Observations {
  swap: OneClickSwapStatus | null;
  payout: Payout | null;
  payoutSpent?: boolean;
  payoutSpender?: PayoutSpender | null;
  ambiguousMints?: readonly (EmilyDepositStatus | null)[];
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

function payoutProgress(o: Observations, payout: Payout): Progress {
  const untilReclaim = blocksUntilReclaimFor(payout, o.tipHeight, o.reclaimLockBlocks);
  const base = { needsNotification: false, blocksUntilReclaim: untilReclaim };

  if (o.mint === 'confirmed') {
    return {
      ...base,
      stage: 'done',
      terminal: true,
      message: 'sBTC has been minted to your Stacks address.',
    };
  }
  if (o.payoutSpent === true) {
    if (o.mint === null || o.mint === 'failed' || o.payoutSpender === 'reclaim') {
      return {
        ...base,
        blocksUntilReclaim: null,
        stage: 'reclaimed',
        terminal: true,
        message:
          'The BTC from this payout has already been moved out of the deposit address, most likely by a reclaim. Nothing is left to reclaim from it.',
      };
    }
    return {
      ...base,
      blocksUntilReclaim: null,
      stage: 'minting',
      terminal: false,
      message: 'The sBTC signers have taken in this deposit. Waiting for them to mint sBTC.',
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
  if (!payout.confirmed) {
    return {
      ...base,
      needsNotification: o.mint === null,
      stage: 'payout-unconfirmed',
      terminal: false,
      message: 'BTC is on its way to your deposit address. Waiting for Bitcoin confirmations.',
    };
  }
  if (untilReclaim === 0) {
    if (o.mint === null) {
      return {
        ...base,
        stage: 'reclaimable',
        terminal: true,
        message:
          'This deposit was never processed. You can reclaim your BTC now from the recovery page.',
      };
    }
    return {
      ...base,
      stage: 'reclaimable',
      terminal: false,
      message:
        'The timelock has passed and the sBTC signers have not minted this deposit. You can reclaim your BTC now from the recovery page; until you do, the signers may still mint it.',
    };
  }
  if (o.mint === null) {
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

function ambiguousProgress(mints: readonly (EmilyDepositStatus | null)[]): Progress {
  const base = { needsNotification: false, blocksUntilReclaim: null };
  if (mints.every(m => m === 'confirmed')) {
    return {
      ...base,
      stage: 'done',
      terminal: true,
      message: `sBTC has been minted for each of the ${mints.length} payments that arrived at your deposit address.`,
    };
  }
  return {
    ...base,
    stage: 'payout-ambiguous',
    terminal: false,
    message: `${mints.length} payments that could each be this deposit arrived at your deposit address, and the swap provider has not said which one is yours. Each is being registered with the sBTC signers; they are listed below.`,
  };
}

export function deriveProgress(o: Observations): Progress {
  if (o.payout) return payoutProgress(o, o.payout);
  if (o.ambiguousMints && o.ambiguousMints.length > 1) return ambiguousProgress(o.ambiguousMints);

  const base = { needsNotification: false, blocksUntilReclaim: null };
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
