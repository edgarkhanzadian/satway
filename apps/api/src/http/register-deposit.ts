import {
  type FetchLike,
  type NetworkConfig,
  depositAddressFromScripts,
  fetchSignersPublicKey,
  signerKeyOfDepositScript,
  snapshotOutpoints,
} from '@portage/core';

import {
  type KV,
  MAX_ACTIVE_WATCHES,
  MAX_REGISTRATIONS_PER_ADDRESS,
  type WatchRegistration,
  type WatchedDeposit,
  countRegistrations,
  getWatched,
  putWatched,
  registrationsOf,
} from '../store/index.js';
import { ApiError, BadRequest } from './errors.js';
import { type ScriptConfig, checkScriptShape } from './script-shape.js';
import { type SignerKeyState, isCurrentSignerKey, newSignerKeyState } from './signer-key.js';
import { type SwapConfig, swapDeadlineFor } from './swap-check.js';

const HEX = /^[0-9a-f]+$/;
const SWAP_ADDRESS = /^[\x21-\x7e]{1,200}$/;
const SNAPSHOT_PAGES = 4;

export const CAPACITY_RETRY_AFTER_SECONDS = 15 * 60;

export type RegisterConfig = ScriptConfig &
  SwapConfig &
  Pick<NetworkConfig, 'btcApiUrl' | 'stxApiUrl' | 'sbtcContract'>;

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
    super('This swap is already registered', 409, {}, { address });
    this.name = 'AlreadyRegistered';
  }
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

  const existing = await getWatched(kv, derived.address);
  const known =
    existing && existing.depositScript === deposit && existing.reclaimScript === reclaim
      ? existing
      : null;
  const previous = known ? registrationsOf(known) : [];
  if (previous.some(r => r.swapDepositAddress === swap)) {
    throw new AlreadyRegistered(derived.address);
  }

  const deadline = await swapDeadlineFor(swap, derived.address, {
    config,
    jwt: deps.oneClickJwt,
    fetchFn,
    now,
  });

  const active = await countRegistrations(kv);
  if (active >= (deps.maxWatches ?? MAX_ACTIVE_WATCHES)) {
    throw new ApiError(
      'Background tracking is at capacity. The open tab still registers the payout.',
      503,
      { 'retry-after': String(CAPACITY_RETRY_AFTER_SECONDS) }
    );
  }

  let snapshot: { outpoints: string[]; truncated: boolean } | null = null;
  try {
    snapshot = await snapshotOutpoints(config.btcApiUrl, derived.address, derived.scriptPubKey, {
      maxPages: SNAPSHOT_PAGES,
      fetchFn,
    });
  } catch {
    snapshot = null;
  }
  const alreadyRegistered = (known?.registered ?? []).map(r => r.outpoint);
  const registration: WatchRegistration = {
    createdAt: now.toISOString(),
    priorOutpoints: snapshot
      ? [...new Set([...snapshot.outpoints, ...alreadyRegistered])].sort()
      : null,
    ...(snapshot?.truncated ? { priorTruncated: true } : {}),
    swapDepositAddress: swap,
    deadline,
  };

  const record: WatchedDeposit = {
    depositScript: deposit,
    reclaimScript: reclaim,
    createdAt: known?.createdAt ?? registration.createdAt,
    registrations: [...previous, registration].slice(-MAX_REGISTRATIONS_PER_ADDRESS),
    registered: known?.registered ?? [],
  };
  await putWatched(kv, derived.address, record, now);
  return { address: derived.address, deadline };
}
