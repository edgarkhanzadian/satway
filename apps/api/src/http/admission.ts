import {
  ADMISSION_STALE_MINUTES,
  LIST_LAG_MARGIN_MINUTES,
  LOAD_MAX_AGE_HOURS,
  MAX_ACTIVE_WATCHES,
  MAX_SWAPS_PER_WATCH,
  MAX_UNFOLDED_ADMITTED,
  RECENT_WINDOW_MINUTES,
  type RecentRegistration,
  type WatchLoad,
} from '../store/index.js';

const MINUTE_MS = 60_000;
export const ADMISSION_STALE_MS = ADMISSION_STALE_MINUTES * MINUTE_MS;
export const LIST_LAG_MARGIN_MS = LIST_LAG_MARGIN_MINUTES * MINUTE_MS;
export const LOAD_MAX_AGE_MS = LOAD_MAX_AGE_HOURS * 60 * MINUTE_MS;
export const RECENT_WINDOW_MS = RECENT_WINDOW_MINUTES * MINUTE_MS;

export type Admission = 'ok' | 'swap-limit' | 'capacity';

export interface AdmissionLimits {
  maxWatches: number;
  maxUnfolded: number;
}

export const DEFAULT_ADMISSION_LIMITS: AdmissionLimits = {
  maxWatches: MAX_ACTIVE_WATCHES,
  maxUnfolded: MAX_UNFOLDED_ADMITTED,
};

export function recentWithin(
  recent: readonly RecentRegistration[],
  nowMs: number
): RecentRegistration[] {
  return recent.filter(r => r.at >= nowMs - RECENT_WINDOW_MS && r.at <= nowMs + MINUTE_MS);
}

export function admissionOf(
  load: WatchLoad | null,
  recent: readonly RecentRegistration[],
  address: string,
  nowMs: number,
  limits: AdmissionLimits = DEFAULT_ADMISSION_LIMITS
): Admission {
  const listedAt = load?.listedAt ?? 0;
  const unlisted = recentWithin(recent, nowMs).filter(r => r.at >= listedAt - LIST_LAG_MARGIN_MS);
  if (unlisted.some(r => r.at > listedAt && r.at < nowMs - ADMISSION_STALE_MS)) return 'capacity';
  if (load !== null && nowMs - load.publishedAt > LOAD_MAX_AGE_MS) return 'capacity';
  const counts = new Map(Object.entries(load?.counts ?? {}));
  for (const r of unlisted) counts.set(r.address, (counts.get(r.address) ?? 0) + 1);
  const mine = counts.get(address) ?? 0;
  if (mine >= MAX_SWAPS_PER_WATCH) return 'swap-limit';
  const unfolded = (load?.pending ?? 0) + unlisted.length;
  if (unfolded >= limits.maxUnfolded) return 'capacity';
  if (mine === 0 && counts.size >= limits.maxWatches) return 'capacity';
  return 'ok';
}
