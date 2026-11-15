import {
  type FetchLike,
  MAX_FEE_RATE_SATS_PER_VBYTE,
  defaultFetch,
  errorMessage,
  feeRateAboveCapMessage,
  requestJson,
  z,
} from '../shared/index.js';

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

const recommendedFeesSchema = z.looseObject({ halfHourFee: z.number() });

export class FeeRateUnavailableError extends Error {
  constructor(reason: string, options?: ErrorOptions) {
    super(
      `Could not read the current Bitcoin fee rate (${reason}), so no reclaim was built and nothing was signed or sent. Try again in a moment.`,
      options
    );
    this.name = 'FeeRateUnavailableError';
  }
}

export class FeeRateTooHighError extends Error {
  readonly feeRate: number;

  constructor(feeRate: number) {
    super(feeRateAboveCapMessage(feeRate));
    this.name = 'FeeRateTooHighError';
    this.feeRate = feeRate;
  }
}

export async function fetchReclaimFeeRate(
  btcApiUrl: string,
  fetchFn: FetchLike = defaultFetch
): Promise<number> {
  let rate: number;
  try {
    const fees = await requestJson(
      fetchFn,
      `${btcApiUrl}/v1/fees/recommended`,
      recommendedFeesSchema
    );
    rate = Math.max(1, fees.halfHourFee);
  } catch (err) {
    throw new FeeRateUnavailableError(errorMessage(err) ?? 'no answer', { cause: err });
  }
  if (rate > MAX_FEE_RATE_SATS_PER_VBYTE) throw new FeeRateTooHighError(rate);
  return rate;
}
