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
  | 'awaiting-notification'
  | 'minting'
  | 'done'
  | 'refunded'
  | 'swap-failed'
  | 'mint-failed'
  | 'reclaimable'
  | 'reclaimed';

export const MINT_UNKNOWN = 'unknown';

export type MintStatus = EmilyDepositStatus | typeof MINT_UNKNOWN | null;

export interface PayoutObservation {
  payout: Payout;
  spent?: boolean;
  spender?: PayoutSpender | null;
  mint: MintStatus;
}

export interface Observations {
  swap: OneClickSwapStatus | null;
  payouts: readonly PayoutObservation[];
  tipHeight: number | null;
  reclaimLockBlocks: number;
}

type PayoutContext = Pick<Observations, 'tipHeight' | 'reclaimLockBlocks'>;

export interface Progress {
  stage: Stage;
  message: string;
  terminal: boolean;
  needsNotification: boolean;
  blocksUntilReclaim: number | null;
}

function payoutProgress(ctx: PayoutContext, o: PayoutObservation): Progress {
  const payout = o.payout;
  const untilReclaim = blocksUntilReclaimFor(payout, ctx.tipHeight, ctx.reclaimLockBlocks);
  const base = { needsNotification: false, blocksUntilReclaim: untilReclaim };

  if (o.mint === 'confirmed') {
    return {
      ...base,
      stage: 'done',
      terminal: true,
      message: 'sBTC has been minted to your Stacks address.',
    };
  }
  if (o.spent === true) {
    if (o.mint === MINT_UNKNOWN && o.spender !== 'reclaim') {
      return {
        ...base,
        blocksUntilReclaim: null,
        stage: 'minting',
        terminal: false,
        message:
          'The BTC from this payout has been moved out of the deposit address. The sBTC signers’ API could not be reached, so whether they minted it is not known yet. Check again in a few minutes.',
      };
    }
    if (o.mint === null || o.mint === 'failed' || o.spender === 'reclaim') {
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
    if (o.mint === MINT_UNKNOWN) {
      return {
        ...base,
        stage: 'reclaimable',
        terminal: false,
        message:
          'The timelock has passed. The sBTC signers’ API could not be reached, so whether they have registered or minted this deposit is not known. You can reclaim your BTC now from the recovery page; until you do, the signers may still mint it.',
      };
    }
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
  if (o.mint === MINT_UNKNOWN) {
    return {
      ...base,
      stage: 'awaiting-notification',
      terminal: false,
      message:
        'BTC arrived. The sBTC signers’ API could not be reached, so this page cannot tell yet whether the deposit is registered. Check again in a few minutes.',
    };
  }
  return {
    ...base,
    stage: 'minting',
    terminal: false,
    message: 'BTC arrived and the deposit is registered. Waiting for the signers to mint sBTC.',
  };
}

const SWAP_IN_FLIGHT: ReadonlySet<OneClickSwapStatus> = new Set([
  'PENDING_DEPOSIT',
  'INCOMPLETE_DEPOSIT',
  'KNOWN_DEPOSIT_TX',
  'PROCESSING',
]);

function mintedEarlyNote(count: number): string {
  return count === 1
    ? 'sBTC was minted for a payment that reached your deposit address before this swap finished.'
    : `sBTC was minted for ${count} payments that reached your deposit address before this swap finished.`;
}

export function deriveProgress(o: Observations): Progress {
  if (o.payouts.length === 0) return swapProgress(o.swap);
  const each = o.payouts.map(p => payoutProgress(o, p));
  const allDone = each.every(p => p.stage === 'done');
  if (allDone && o.swap !== null && SWAP_IN_FLIGHT.has(o.swap)) {
    const waiting = swapProgress(o.swap);
    return { ...waiting, message: `${mintedEarlyNote(each.length)} ${waiting.message}` };
  }
  const [only] = each;
  if (only && each.length === 1) return only;
  if (allDone) {
    return {
      needsNotification: false,
      blocksUntilReclaim: null,
      stage: 'done',
      terminal: true,
      message: `sBTC has been minted for each of the ${each.length} payments that arrived at your deposit address.`,
    };
  }
  const primary = each.find(p => p.stage !== 'done') ?? only;
  if (!primary) return swapProgress(o.swap);
  return {
    ...primary,
    terminal: each.every(p => p.terminal),
    needsNotification: each.some(p => p.needsNotification),
    message: `${each.length} payments arrived at your deposit address. Each is handled on its own and listed below. ${primary.message}`,
  };
}

function swapProgress(swap: OneClickSwapStatus | null): Progress {
  const base = { needsNotification: false, blocksUntilReclaim: null };
  switch (swap) {
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
      throw new Error(`Unknown swap status: ${String(swap satisfies never)}`);
  }
}
