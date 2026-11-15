import {
  type CachedSignerKey,
  type KV,
  getCachedSignerKey,
  putCachedSignerKey,
} from '../store/index.js';
import { Unavailable } from './errors.js';

export const SIGNER_KEY_TTL_SECONDS = 10 * 60;
export const SIGNER_KEY_REREAD_AFTER_SECONDS = 60;

export interface SignerKeyState {
  memory: CachedSignerKey | null;
}

export function newSignerKeyState(): SignerKeyState {
  return { memory: null };
}

export interface SignerKeyDeps {
  kv: KV;
  state: SignerKeyState;
  nowMs: number;
  read(): Promise<string>;
}

function fresh(entry: CachedSignerKey | null, nowMs: number): CachedSignerKey | null {
  if (!entry) return null;
  const age = nowMs - entry.fetchedAt;
  return age >= 0 && age < SIGNER_KEY_TTL_SECONDS * 1000 ? entry : null;
}

async function cachedKey(deps: SignerKeyDeps): Promise<CachedSignerKey | null> {
  const inMemory = fresh(deps.state.memory, deps.nowMs);
  if (inMemory) return inMemory;
  let stored: CachedSignerKey | null = null;
  try {
    stored = fresh(await getCachedSignerKey(deps.kv), deps.nowMs);
  } catch {
    stored = null;
  }
  if (stored) deps.state.memory = stored;
  return stored;
}

async function readKey(deps: SignerKeyDeps, previous: CachedSignerKey | null): Promise<string> {
  let key: string;
  try {
    key = await deps.read();
  } catch {
    throw new Unavailable('The sBTC signer key could not be read. Try again later.');
  }
  const entry = { key, fetchedAt: deps.nowMs };
  deps.state.memory = entry;
  if (previous?.key !== key) await storeKey(deps.kv, entry);
  return key;
}

async function storeKey(kv: KV, entry: CachedSignerKey): Promise<boolean> {
  try {
    await putCachedSignerKey(kv, entry, SIGNER_KEY_TTL_SECONDS);
    return true;
  } catch {
    return false;
  }
}

export async function isCurrentSignerKey(candidate: string, deps: SignerKeyDeps): Promise<boolean> {
  const cached = await cachedKey(deps);
  if (cached?.key === candidate) return true;
  if (cached && deps.nowMs - cached.fetchedAt < SIGNER_KEY_REREAD_AFTER_SECONDS * 1000) {
    return false;
  }
  return (await readKey(deps, cached)) === candidate;
}
