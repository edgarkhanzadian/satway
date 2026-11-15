export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly headers: Record<string, string> = {},
    readonly extra: Record<string, string> = {}
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class BadRequest extends ApiError {
  constructor(message: string) {
    super(message, 400);
    this.name = 'BadRequest';
  }
}

export const UNKNOWN_SWAP_CODE = 'unknown-swap';

export class UnknownSwap extends ApiError {
  constructor() {
    super('"swapDepositAddress" is not a known 1Click swap', 400, {}, { code: UNKNOWN_SWAP_CODE });
    this.name = 'UnknownSwap';
  }
}

export class Unavailable extends ApiError {
  constructor(message: string, retryAfterSeconds = 60) {
    super(message, 503, { 'retry-after': String(retryAfterSeconds) });
    this.name = 'Unavailable';
  }
}
