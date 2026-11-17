import { type ProgressCondition, type Stage, z } from '@satway/core';

export const DEPOSIT_STAGES_KEY = 'satway.deposit-stages.v1';

export interface KnownStage {
  stage: Stage;
  terminal: boolean;
  final: boolean;
  reclaimable: boolean;
  condition?: ProgressCondition;
}

const CONDITIONS = [
  'awaiting-payout-hash',
  'payout-below-minimum',
  'payout-not-found',
] as const satisfies readonly ProgressCondition[];

const STAGES = [
  'awaiting-funds',
  'swapping',
  'awaiting-payout',
  'payout-unconfirmed',
  'awaiting-notification',
  'minting',
  'done',
  'refunded',
  'swap-failed',
  'mint-failed',
  'reclaimable',
  'reclaimed',
] as const satisfies readonly Stage[];

const knownSchema: z.ZodType<KnownStage> = z.object({
  stage: z.enum(STAGES),
  terminal: z.boolean(),
  final: z.boolean(),
  reclaimable: z.boolean(),
  condition: z.enum(CONDITIONS).optional(),
});

const storedSchema = z.record(z.string(), z.unknown());

type StageStore = Pick<Storage, 'getItem' | 'setItem'>;

function store(): StageStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readAll(from: StageStore): Record<string, unknown> {
  const raw = from.getItem(DEPOSIT_STAGES_KEY);
  if (raw === null) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {};
  }
  const parsed = storedSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

export function loadStages(from: StageStore | null = store()): Record<string, KnownStage> {
  const out: Record<string, KnownStage> = {};
  try {
    if (from === null) return out;
    for (const [id, value] of Object.entries(readAll(from))) {
      const parsed = knownSchema.safeParse(value);
      if (parsed.success) out[id] = parsed.data;
    }
  } catch {
    return out;
  }
  return out;
}

export function rememberStage(
  id: string,
  known: KnownStage,
  from: StageStore | null = store()
): boolean {
  try {
    if (from === null) return false;
    const all = { ...readAll(from), [id]: known };
    from.setItem(DEPOSIT_STAGES_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}
