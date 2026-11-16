import {
  type FetchLike,
  type NetworkConfig,
  depositAddressFromScripts,
  fetchSignersPublicKey,
  signerKeyOfDepositScript,
} from '@satway/core';

import {
  type KV,
  MAX_ACTIVE_WATCHES,
  MAX_EXTRA_SWAPS,
  type WatchedDeposit,
  countWatches,
  getWatched,
  listExtraSwaps,
  putExtraSwap,
  putWatched,
} from '../store/index.js';
import { ApiError, BadRequest } from './errors.js';
import { type ScriptConfig, checkScriptShape } from './script-shape.js';
import { type SignerKeyState, isCurrentSignerKey, newSignerKeyState } from './signer-key.js';
import { type SwapConfig, swapDeadlineFor } from './swap-check.js';

const HEX = /^[0-9a-f]+$/;
const SWAP_ADDRESS = /^[\x21-\x7e]{1,200}$/;

export const CAPACITY_RETRY_AFTER_SECONDS = 15 * 60;

export type RegisterConfig = ScriptConfig &
  SwapConfig &
  Pick<NetworkConfig, 'stxApiUrl' | 'sbtcContract'>;

export interface RegisterDeps {
  config: RegisterConfig;
  fetchFn?: FetchLike;
  oneClickJwt?: string;
  now?: Date;
  signerState?: SignerKeyState;
  maxWatches?: number;
  afterShapeChecks?(): Promise<void>;
}

export interface Registered {
  address: string;
  deadline: string;
}

function hexScript(name: string, value: unknown): string {
  if (typeof value !== 'string' || value.length < 12 || value.length > 400 || !HEX.test(value)) {
    throw new BadRequest(`"${name}" must be lowercase hex`);
  }
  return value;
}

function swapAddressOf(value: unknown): string {
  if (typeof value !== 'string' || !SWAP_ADDRESS.test(value)) {
    throw new BadRequest('"swapDepositAddress" is required: the 1Click deposit address');
  }
  return value;
}

export class AlreadyRegistered extends ApiError {
  constructor(address: string) {
    super('This deposit is already registered', 409, {}, { address });
    this.name = 'AlreadyRegistered';
  }
}

export const SWAP_LIMIT_CODE = 'swap-limit';

export class SwapLimitReached extends ApiError {
  constructor(address: string) {
    super(
      'This deposit address already has as many swaps as background tracking follows',
      409,
      {},
      { address, code: SWAP_LIMIT_CODE }
    );
    this.name = 'SwapLimitReached';
  }
}

function newRecord(
  deposit: string,
  reclaim: string,
  swap: string,
  deadline: string,
  now: Date
): WatchedDeposit {
  return {
    depositScript: deposit,
    reclaimScript: reclaim,
    createdAt: now.toISOString(),
    swapDepositAddress: swap,
    deadline,
    registered: [],
  };
}

async function addSwap(
  kv: KV,
  existing: WatchedDeposit,
  address: string,
  swap: string,
  check: () => Promise<string>,
  now: Date
): Promise<Registered> {
  if (existing.swapDepositAddress === swap) throw new AlreadyRegistered(address);
  const extras = await listExtraSwaps(kv, address, existing.createdAt);
  if (extras.some(e => e.swapDepositAddress === swap)) throw new AlreadyRegistered(address);
  const deadline = await check();
  if (extras.length >= MAX_EXTRA_SWAPS) throw new SwapLimitReached(address);
  await putExtraSwap(
    kv,
    address,
    { swapDepositAddress: swap, deadline, createdAt: now.toISOString() },
    now
  );
  if (!(await getWatched(kv, address))) {
    await putWatched(
      kv,
      address,
      newRecord(existing.depositScript, existing.reclaimScript, swap, deadline, now),
      now
    );
  }
  return { address, deadline };
}

export async function registerDeposit(
  kv: KV,
  body: unknown,
  deps: RegisterDeps
): Promise<Registered> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequest('Body must be a JSON object');
  }
  const { depositScript, reclaimScript, swapDepositAddress }: Record<string, unknown> = {
    ...body,
  };
  const deposit = hexScript('depositScript', depositScript);
  const reclaim = hexScript('reclaimScript', reclaimScript);
  const swap = swapAddressOf(swapDepositAddress);
  if (!signerKeyOfDepositScript(deposit))
    throw new BadRequest('"depositScript" is not an sBTC deposit script');
  const { signerKey } = checkScriptShape(deposit, reclaim, deps.config);

  let derived: { address: string; scriptPubKey: string };
  try {
    derived = depositAddressFromScripts(deposit, reclaim);
  } catch {
    throw new BadRequest('Scripts do not form a valid deposit address');
  }

  await deps.afterShapeChecks?.();

  const now = deps.now ?? new Date();
  const { config, fetchFn } = deps;
  const current = await isCurrentSignerKey(signerKey, {
    kv,
    state: deps.signerState ?? newSignerKeyState(),
    nowMs: now.getTime(),
    read: () => fetchSignersPublicKey(config.stxApiUrl, config.sbtcContract, fetchFn),
  });
  if (!current) throw new BadRequest('"depositScript" is not locked to the current sBTC signers');

  function check(): Promise<string> {
    return swapDeadlineFor(swap, derived.address, { config, jwt: deps.oneClickJwt, fetchFn, now });
  }
  const existing = await getWatched(kv, derived.address);
  if (existing) return addSwap(kv, existing, derived.address, swap, check, now);

  const deadline = await check();

  const active = await countWatches(kv);
  if (active >= (deps.maxWatches ?? MAX_ACTIVE_WATCHES)) {
    throw new ApiError(
      'Background tracking is at capacity. The open tab still registers the payout.',
      503,
      { 'retry-after': String(CAPACITY_RETRY_AFTER_SECONDS) }
    );
  }

  await putWatched(kv, derived.address, newRecord(deposit, reclaim, swap, deadline, now), now);
  return { address: derived.address, deadline };
}
