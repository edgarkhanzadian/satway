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
  SIGNAL_REFRESH_SECONDS,
  getLoad,
  getRegisteredAt,
  putRegisteredAt,
  putRegistration,
  registrationExists,
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

async function signalRegistration(kv: KV, now: Date): Promise<void> {
  const last = await getRegisteredAt(kv);
  if (last !== null && last >= now.getTime() - SIGNAL_REFRESH_SECONDS * 1000) return;
  await putRegisteredAt(kv, now.getTime());
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
  const deadline = await check();

  const address = derived.address;
  if (await registrationExists(kv, address, swap)) throw new AlreadyRegistered(address);
  const load = (await getLoad(kv)) ?? { addresses: [], full: [] };
  if (load.full.includes(address)) throw new SwapLimitReached(address);
  if (
    !load.addresses.includes(address) &&
    load.addresses.length >= (deps.maxWatches ?? MAX_ACTIVE_WATCHES)
  ) {
    throw new ApiError(
      'Background tracking is at capacity. The open tab still registers the payout.',
      503,
      { 'retry-after': String(CAPACITY_RETRY_AFTER_SECONDS) }
    );
  }

  await signalRegistration(kv, now);
  await putRegistration(kv, address, {
    depositScript: deposit,
    reclaimScript: reclaim,
    swapDepositAddress: swap,
    deadline,
    createdAt: now.toISOString(),
  });
  return { address, deadline };
}
