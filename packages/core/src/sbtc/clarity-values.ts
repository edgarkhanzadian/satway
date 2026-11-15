import { ClarityType, type ClarityValue, deserializeCV, serializeCV } from '@stacks/transactions';

export class ClarityShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClarityShapeError';
  }
}

const HEX = /^(?:[0-9a-f]{2})+$/;

export function parseClarityHex(text: string, what: string): ClarityValue {
  const clean = text.trim().toLowerCase().replace(/^0x/, '');
  if (!HEX.test(clean)) throw new ClarityShapeError(`${what} is not a hex Clarity value`);
  let value: ClarityValue;
  try {
    value = deserializeCV(clean);
  } catch {
    throw new ClarityShapeError(`${what} does not decode as a Clarity value`);
  }
  if (serializeCV(value) !== clean) {
    throw new ClarityShapeError(`${what} has trailing or non-canonical bytes`);
  }
  return value;
}

export function tupleOf(value: ClarityValue, what: string): Record<string, ClarityValue> {
  if (value.type !== ClarityType.Tuple) throw new ClarityShapeError(`${what} is not a tuple`);
  return value.value;
}

export function fieldOf(
  fields: Record<string, ClarityValue>,
  name: string,
  what: string
): ClarityValue {
  const value = fields[name];
  if (value === undefined) throw new ClarityShapeError(`${what} has no "${name}" field`);
  return value;
}

export function uintOf(value: ClarityValue, what: string): bigint {
  if (value.type !== ClarityType.UInt) throw new ClarityShapeError(`${what} is not a uint`);
  return BigInt(value.value);
}

export function safeUintOf(value: ClarityValue, what: string): number {
  const n = uintOf(value, what);
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ClarityShapeError(`${what} is too large to handle safely`);
  }
  return Number(n);
}

export function bufferHexOf(value: ClarityValue, what: string, length?: number): string {
  if (value.type !== ClarityType.Buffer) throw new ClarityShapeError(`${what} is not a buffer`);
  const data = value.value.toLowerCase();
  if (length !== undefined && data.length !== length * 2) {
    throw new ClarityShapeError(`${what} must be ${length} bytes`);
  }
  return data;
}

export function principalOf(value: ClarityValue, what: string): string {
  if (
    value.type === ClarityType.PrincipalStandard ||
    value.type === ClarityType.PrincipalContract
  ) {
    return value.value;
  }
  throw new ClarityShapeError(`${what} is not a principal`);
}

export function asciiOf(value: ClarityValue, what: string): string {
  if (value.type !== ClarityType.StringASCII) {
    throw new ClarityShapeError(`${what} is not an ASCII string`);
  }
  return value.value;
}

export function optionalOf(value: ClarityValue, what: string): ClarityValue | null {
  if (value.type === ClarityType.OptionalNone) return null;
  if (value.type === ClarityType.OptionalSome) return value.value;
  throw new ClarityShapeError(`${what} is not an optional`);
}

export function boolOf(value: ClarityValue, what: string): boolean {
  if (value.type === ClarityType.BoolTrue) return true;
  if (value.type === ClarityType.BoolFalse) return false;
  throw new ClarityShapeError(`${what} is not a bool`);
}

export interface ClarityResponse {
  ok: boolean;
  value: ClarityValue;
}

export function responseOf(value: ClarityValue, what: string): ClarityResponse {
  if (value.type === ClarityType.ResponseOk) return { ok: true, value: value.value };
  if (value.type === ClarityType.ResponseErr) return { ok: false, value: value.value };
  throw new ClarityShapeError(`${what} is not a response`);
}
