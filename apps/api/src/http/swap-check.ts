import {
  type FetchLike,
  HttpError,
  type NetworkConfig,
  OneClickClient,
  type OneClickStatusResponse,
  parseWith,
  z,
} from '@portage/core';

import { BadRequest, Unavailable, UnknownSwap } from './errors.js';
import { DEADLINE_MARGIN_MINUTES } from './proxy.js';

export type SwapConfig = Pick<
  NetworkConfig,
  'oneClickBaseUrl' | 'btcAssetId' | 'quoteDeadlineMinutes'
>;

export const DEADLINE_CLOCK_SKEW_MS = 5 * 60_000;

const ENDED: ReadonlySet<OneClickStatusResponse['status']> = new Set(['REFUNDED', 'FAILED']);

const echoedQuoteSchema = z.looseObject({
  quoteRequest: z.looseObject({
    recipient: z.string(),
    destinationAsset: z.string(),
    deadline: z.string(),
  }),
  quote: z.looseObject({ depositAddress: z.string().optional() }),
});

async function statusOf(
  client: OneClickClient,
  swapDepositAddress: string
): Promise<OneClickStatusResponse> {
  try {
    return await client.status(swapDepositAddress);
  } catch (err) {
    if (err instanceof HttpError && (err.status === 404 || err.status === 400)) {
      throw new UnknownSwap();
    }
    throw new Unavailable('The swap provider is unavailable. Try again later.');
  }
}

export async function swapDeadlineFor(
  swapDepositAddress: string,
  depositAddress: string,
  deps: { config: SwapConfig; jwt?: string; fetchFn?: FetchLike; now: Date }
): Promise<string> {
  const client = new OneClickClient(deps.config.oneClickBaseUrl, {
    jwt: deps.jwt,
    fetchFn: deps.fetchFn,
  });
  const status = await statusOf(client, swapDepositAddress);
  let echoed: z.infer<typeof echoedQuoteSchema>;
  try {
    echoed = parseWith(echoedQuoteSchema, Reflect.get(status, 'quoteResponse'), '1Click status');
  } catch {
    throw new Unavailable('The swap provider returned an unexpected answer. Try again later.');
  }
  const request = echoed.quoteRequest;
  if (request.recipient !== depositAddress) {
    throw new BadRequest('The swap does not pay this deposit address');
  }
  if (request.destinationAsset !== deps.config.btcAssetId) {
    throw new BadRequest('The swap does not pay out native BTC');
  }
  const quoted = echoed.quote.depositAddress;
  if (quoted !== undefined && quoted !== swapDepositAddress) {
    throw new BadRequest('The swap does not match "swapDepositAddress"');
  }
  if (ENDED.has(status.status)) throw new BadRequest('The swap has already ended');
  const deadlineMs = Date.parse(request.deadline);
  const nowMs = deps.now.getTime();
  const latestMs = nowMs + (deps.config.quoteDeadlineMinutes + DEADLINE_MARGIN_MINUTES) * 60_000;
  if (!Number.isFinite(deadlineMs) || deadlineMs > latestMs) {
    throw new BadRequest('The swap deadline is not one this app creates');
  }
  if (deadlineMs < nowMs - DEADLINE_CLOCK_SKEW_MS) {
    throw new BadRequest('The swap deadline has passed');
  }
  return new Date(deadlineMs).toISOString();
}
