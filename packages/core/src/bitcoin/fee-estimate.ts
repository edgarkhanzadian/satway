import { type FetchLike, defaultFetch, requestJson, z } from '../shared/index.js';

const feeEstimatesSchema: z.ZodType<Record<string, number>> = z.record(
  z.string(),
  z.number().positive()
);

export async function fetchFeeEstimate(
  btcApiUrl: string,
  targetBlocks = 1,
  fetchFn: FetchLike = defaultFetch
): Promise<number> {
  const estimates = await requestJson(fetchFn, `${btcApiUrl}/fee-estimates`, feeEstimatesSchema);
  const rate = estimates[String(targetBlocks)];
  if (rate === undefined) {
    throw new Error(`The Bitcoin API has no fee estimate for ${targetBlocks} block(s)`);
  }
  return rate;
}
