export const REAL_DEPOSIT = {
  txid: '5ab7ae554358d3ffdab7cc48db49ff144c5ae4fdd617b4140eac1b1936109bf5',
  vout: 0,
  amountSats: 20_000_774,
  blockHeight: 975_752,
  stacksAddress: 'SP1Q6W6VADA7V12SEVH6VNDNN4N7RX1PQ949EQPQ',
  reclaimPublicKey: '51b397d3ad5ab4f803565c0243d3c1fa9d5a8124b33547bb993ee1ebeb729ff2',
  signersPublicKey: 'd99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69',
  maxSignerFeeSats: 80_000,
  reclaimLockBlocks: 950,
  address: 'bc1pytlwt3qfg4rdrk3yxtmdhcjvy0l63yp7qh3jra5xwq8yt6w4fvhqyjl7dx',
  scriptPubKey: '512022fee5c4094546d1da2432f6dbe24c23ffa8903e05e321f686700e45e9d54b2e',
  depositScript:
    '1e00000000000138800516037370db53547d845976e26dd5b5a92a7c7436ba7520d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69ac',
  reclaimScript: '02b603b2752051b397d3ad5ab4f803565c0243d3c1fa9d5a8124b33547bb993ee1ebeb729ff2ac',
  changeScriptPubKey: '00142df601e9bf6db95982ff4579f18ca119f02c0531',
} as const;

export const LIMITS = {
  pegCap: 2_100_000_000_000_000,
  perDepositMinimum: 10_000,
  perDepositCap: 2_100_000_000_000_000,
} as const;

export const REGISTRY_RESULT =
  '0x020000002102d99ad0f0111a7e9aaa2ed22940efec98db0ece9b9475e61e1eec65a6e7f3af69';

export function defined<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error('Expected a value');
  return value;
}

export function bodyText(init: RequestInit | undefined): string {
  const body = init?.body;
  if (typeof body !== 'string') throw new Error('Expected a string body');
  return body;
}

export function jsonBody(init: RequestInit | undefined): unknown {
  const parsed: unknown = JSON.parse(bodyText(init));
  return parsed;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
