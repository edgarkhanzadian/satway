import { type WithdrawalStage, z } from '@satway/core';

export const ENTRY_STATUSES_KEY = 'satway.withdrawals.status.v1';

export interface KnownStatus {
  stage: WithdrawalStage;
  message: string;
  warning: boolean;
}

const STAGES = [
  'awaiting-stacks-tx',
  'tx-replaced',
  'request-failed',
  'awaiting-signers',
  'rejected',
  'payout-broadcast',
  'payout-confirmed',
  'swapping',
  'done',
  'refunded',
  'swap-failed',
  'needs-support',
  'deadline-passed',
  'rechecking',
  'mismatch',
] as const satisfies readonly WithdrawalStage[];

const knownSchema = z.record(
  z.string(),
  z.looseObject({ stage: z.enum(STAGES), message: z.string(), warning: z.boolean() })
);

function storage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadKnownStatuses(): Record<string, KnownStatus> {
  try {
    const raw = storage()?.getItem(ENTRY_STATUSES_KEY) ?? null;
    if (raw === null) return {};
    const parsed = knownSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

export function rememberKnownStatus(id: string, status: KnownStatus | null): void {
  try {
    const s = storage();
    if (!s) return;
    const all = loadKnownStatuses();
    if (status === null) delete all[id];
    else all[id] = status;
    s.setItem(ENTRY_STATUSES_KEY, JSON.stringify(all));
  } catch {
    return;
  }
}
