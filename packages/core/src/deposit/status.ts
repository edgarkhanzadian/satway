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

export type ObservedPayout = Payout & { blockTime?: number | null };

export interface PayoutObservation {
  payout: ObservedPayout;
  spent?: boolean;
  spender?: PayoutSpender | null;
  mint: MintStatus;
}

export interface Observations {
  swap: OneClickSwapStatus | null;
  payouts: readonly PayoutObservation[];
  payoutTxids?: readonly string[];
  belowMinimum?: readonly ObservedPayout[];
  foreignTxids?: readonly string[];
  vanishedTxids?: readonly string[];
  swapless?: boolean;
  swapStartedAt?: number | null;
  swapDeadline?: number | null;
  now?: number;
  tipHeight: number | null;
  reclaimLockBlocks: number;
}

type PayoutContext = Pick<Observations, 'tipHeight' | 'reclaimLockBlocks'>;

export type ProgressCondition =
  | 'awaiting-payout-hash'
  | 'payout-below-minimum'
  | 'payout-not-found';

export interface Progress {
  stage: Stage;
  message: string;
  terminal: boolean;
  needsNotification: boolean;
  blocksUntilReclaim: number | null;
  condition?: ProgressCondition;
}

export const PAYOUT_SEARCH_GRACE_MS = 24 * 60 * 60 * 1000;
export const BLOCK_TIME_SLACK_MS = 2 * 60 * 60 * 1000;

function arrivedAfterStart(o: Observations, payout: ObservedPayout): boolean {
  const started = o.swapStartedAt;
  if (started === undefined || started === null || !payout.confirmed) return true;
  if (deadlineLongPast(o)) return true;
  const time = payout.blockTime;
  if (time === undefined || time === null) return true;
  return time * 1000 >= started - BLOCK_TIME_SLACK_MS;
}

function deadlineLongPast(o: Observations): boolean {
  const deadline = o.swapDeadline;
  if (deadline === undefined || deadline === null || o.now === undefined) return false;
  return o.now > deadline + PAYOUT_SEARCH_GRACE_MS;
}

function belowMinimumProgress(ctx: PayoutContext, payout: Payout, found: boolean): Progress {
  const untilReclaim = blocksUntilReclaimFor(payout, ctx.tipHeight, ctx.reclaimLockBlocks);
  const what = found
    ? 'The BTC at this deposit address is below the sBTC minimum, so it cannot be minted.'
    : 'The BTC payout arrived but is below the sBTC minimum, so it cannot be minted.';
  return {
    needsNotification: false,
    blocksUntilReclaim: untilReclaim,
    stage: untilReclaim === 0 ? 'reclaimable' : 'mint-failed',
    terminal: true,
    condition: 'payout-below-minimum',
    message: `${what} ${reclaimWhen(untilReclaim)}`,
  };
}

function reclaimWhen(untilReclaim: number | null): string {
  if (untilReclaim === 0) return 'You can reclaim it now from the recovery page.';
  if (untilReclaim === null) return 'You can reclaim it after the timelock.';
  return `You can reclaim it in about ${untilReclaim} blocks, once the timelock passes.`;
}

const PAYOUT_NOT_FOUND: Progress = {
  needsNotification: false,
  blocksUntilReclaim: null,
  stage: 'awaiting-payout',
  terminal: true,
  condition: 'payout-not-found',
  message:
    '1Click reports a payout in a Bitcoin transaction that does not pay your deposit address, or that the Bitcoin network does not show. Do not rely on it: check the transaction in a block explorer and contact 1Click with your swap deposit address.',
};

const AWAITING_PAYOUT_HASH: Progress = {
  needsNotification: false,
  blocksUntilReclaim: null,
  stage: 'awaiting-payout',
  terminal: false,
  condition: 'awaiting-payout-hash',
  message:
    'Swap complete. 1Click has not named the Bitcoin payout yet, and the payments already at your deposit address arrived before this swap began, so this page waits for 1Click to name it.',
};

function othersNote(count: number): string {
  return count === 1
    ? 'Another payment at your deposit address is listed below.'
    : `${count} other payments at your deposit address are listed below.`;
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
    if (o.mint === null && o.spender !== 'reclaim') {
      return {
        ...base,
        blocksUntilReclaim: null,
        stage: o.spender === 'signers' ? 'minting' : 'awaiting-notification',
        terminal: false,
        message:
          o.spender === 'signers'
            ? 'The sBTC signers have taken in this payout, but their API does not list it yet. Check again in a few minutes.'
            : 'The Bitcoin API lists this payout as moved out of the deposit address, but who moved it could not be confirmed yet. This page keeps checking.',
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
          'The sBTC signers rejected this deposit. You can reclaim your BTC now under “Your deposits” on the Deposit tab.',
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
          'The timelock has passed. The sBTC signers’ API could not be reached, so whether they have registered or minted this deposit is not known. You can reclaim your BTC now under “Your deposits” on the Deposit tab; until you do, the signers may still mint it.',
      };
    }
    if (o.mint === null) {
      return {
        ...base,
        stage: 'reclaimable',
        terminal: true,
        message:
          'This deposit was never processed. You can reclaim your BTC now under “Your deposits” on the Deposit tab.',
      };
    }
    return {
      ...base,
      stage: 'reclaimable',
      terminal: false,
      message:
        'The timelock has passed and the sBTC signers have not minted this deposit. You can reclaim your BTC now under “Your deposits” on the Deposit tab; until you do, the signers may still mint it.',
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

const SWAP_IN_FLIGHT: ReadonlySet<OneClickSwapStatus> = new Set(['KNOWN_DEPOSIT_TX', 'PROCESSING']);

export const SWAP_AWAITING_FUNDS: ReadonlySet<OneClickSwapStatus> = new Set([
  'PENDING_DEPOSIT',
  'INCOMPLETE_DEPOSIT',
]);

function mintedEarlyNote(count: number): string {
  return count === 1
    ? 'sBTC was minted for a payment that reached your deposit address before this swap finished.'
    : `sBTC was minted for ${count} payments that reached your deposit address before this swap finished.`;
}

function arrivedEarlyNote(count: number): string {
  return count === 1
    ? 'A payment arrived at this address before your swap paid out. It is listed below.'
    : `${count} payments arrived at this address before your swap paid out. They are listed below.`;
}

function arrivedAnywayNote(each: readonly Progress[]): string {
  const minted = each.filter(p => p.stage === 'done').length;
  if (each.length === 1) {
    return minted === 1
      ? 'sBTC was minted for a payment that reached your deposit address. It is listed below.'
      : 'A payment arrived at your deposit address anyway. It is listed below.';
  }
  const arrived = `${each.length} payments arrived at your deposit address anyway. Each is handled on its own and listed below.`;
  return minted === 0 ? arrived : `${arrived} sBTC was minted for ${minted} of them.`;
}

function alongside(swap: Progress, each: readonly Progress[], note: string): Progress {
  return {
    ...swap,
    terminal: swap.terminal && each.every(p => p.terminal),
    needsNotification: each.some(p => p.needsNotification),
    message: `${swap.message} ${note}`,
  };
}

interface Assessed {
  observed: PayoutObservation;
  progress: Progress;
}

function headlineOf(o: Observations, assessed: readonly Assessed[]): Progress | undefined {
  const named = o.payoutTxids ?? [];
  const ours = assessed.find(a => named.includes(a.observed.payout.txid));
  if (ours) return ours.progress;
  const relevant = assessed.filter(a => arrivedAfterStart(o, a.observed.payout));
  return (
    relevant.find(a => !a.progress.terminal)?.progress ??
    assessed.find(a => !a.progress.terminal)?.progress ??
    assessed.find(a => a.progress.stage !== 'done')?.progress ??
    assessed[0]?.progress
  );
}

function combined(o: Observations, assessed: readonly Assessed[]): Progress | null {
  const each = assessed.map(a => a.progress);
  const [only] = each;
  if (only && each.length === 1) return only;
  if (each.every(p => p.stage === 'done')) {
    return {
      needsNotification: false,
      blocksUntilReclaim: null,
      stage: 'done',
      terminal: true,
      message: `sBTC has been minted for each of the ${each.length} payments that arrived at your deposit address.`,
    };
  }
  const primary = headlineOf(o, assessed);
  if (!primary) return null;
  return {
    ...primary,
    terminal: each.every(p => p.terminal),
    needsNotification: each.some(p => p.needsNotification),
    message: `${each.length} payments arrived at your deposit address. Each is handled on its own and listed below. ${primary.message}`,
  };
}

function swapPaidOut(o: Observations): boolean {
  const named = o.payoutTxids ?? [];
  if (named.length > 0) return o.payouts.some(p => named.includes(p.payout.txid));
  return o.payouts.some(p => arrivedAfterStart(o, p.payout));
}

function withOthers(base: Progress, o: Observations): Progress {
  if (o.payouts.length === 0) return base;
  return alongside(
    base,
    o.payouts.map(p => payoutProgress(o, p)),
    othersNote(o.payouts.length)
  );
}

function namedPayoutMissing(o: Observations): Progress | null {
  const named = o.payoutTxids ?? [];
  if (o.swap !== 'SUCCESS' || named.length === 0) return null;
  if (o.payouts.some(p => named.includes(p.payout.txid))) return null;
  const small = (o.belowMinimum ?? []).find(p => named.includes(p.txid));
  if (small) return withOthers(belowMinimumProgress(o, small, false), o);
  if (!deadlineLongPast(o)) return null;
  const foreign = (o.foreignTxids ?? []).some(t => named.includes(t));
  return withOthers({ ...PAYOUT_NOT_FOUND, terminal: foreign }, o);
}

const STATUS_UNKNOWN_NOTE = 'The swap status could not be read, so this page keeps checking.';
const STATUS_GONE_NOTE =
  'The swap status can no longer be read and its deadline passed more than a day ago, so these results are final.';

export const REPLACED_PAYOUT_NOTE =
  '1Click names a Bitcoin payout transaction that the Bitcoin network no longer shows, most likely because it was replaced, so the payment that arrived at your deposit address is followed instead.';

function namedAllVanished(o: Observations): boolean {
  const named = o.payoutTxids ?? [];
  const vanished = o.vanishedTxids ?? [];
  if (named.length === 0 || !named.every(t => vanished.includes(t))) return false;
  return o.payouts.some(p => arrivedAfterStart(o, p.payout));
}

export function deriveProgress(o: Observations): Progress {
  if (!namedAllVanished(o)) return deriveNamed(o);
  const followed = deriveNamed({ ...o, payoutTxids: [] });
  return { ...followed, message: `${followed.message} ${REPLACED_PAYOUT_NOTE}` };
}

function deriveNamed(o: Observations): Progress {
  const missing = namedPayoutMissing(o);
  if (missing) return missing;
  if (o.payouts.length === 0) {
    const [small] = o.belowMinimum ?? [];
    if (small && o.swap === null && o.swapless === true) {
      return belowMinimumProgress(o, small, true);
    }
    return swapProgress(o.swap);
  }
  const assessed = o.payouts.map(p => ({ observed: p, progress: payoutProgress(o, p) }));
  const each = assessed.map(a => a.progress);
  if (o.swap === 'REFUNDED' || o.swap === 'FAILED') {
    return alongside(swapProgress(o.swap), each, arrivedAnywayNote(each));
  }
  if (o.swap !== null && SWAP_AWAITING_FUNDS.has(o.swap)) {
    return alongside(swapProgress(o.swap), each, arrivedEarlyNote(each.length));
  }
  const allDone = each.every(p => p.stage === 'done');
  if (allDone && o.swap !== null && SWAP_IN_FLIGHT.has(o.swap)) {
    const waiting = swapProgress(o.swap);
    return { ...waiting, message: `${mintedEarlyNote(each.length)} ${waiting.message}` };
  }
  if (o.swap === 'SUCCESS' && !swapPaidOut(o)) {
    const waiting = (o.payoutTxids ?? []).length > 0 ? swapProgress(o.swap) : AWAITING_PAYOUT_HASH;
    return alongside(waiting, each, arrivedEarlyNote(each.length));
  }
  const all = combined(o, assessed) ?? swapProgress(o.swap);
  if (o.swap === 'SUCCESS' || (o.swap === null && o.swapless === true)) return all;
  if (o.swap === null && all.terminal) {
    if (deadlineLongPast(o)) return { ...all, message: `${all.message} ${STATUS_GONE_NOTE}` };
    return { ...all, terminal: false, message: `${all.message} ${STATUS_UNKNOWN_NOTE}` };
  }
  return { ...all, terminal: false };
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
