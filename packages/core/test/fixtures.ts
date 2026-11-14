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

export const REAL_DEPOSIT_TX_HEX =
  '020000000001028ef08f51a0401825af15c238d7b2136d2405abd9bf02e0c1c8a697db2aeb296c0100000000fdffffff1e6ad5fd73606f585163f958b617134804bf611c2a0a7ffb175fded4280b3d1d0a00000000fdffffff02063031010000000022512022fee5c4094546d1da2432f6dbe24c23ffa8903e05e321f686700e45e9d54b2ecc0a0000000000001600142df601e9bf6db95982ff4579f18ca119f02c053102473044022045ec482d45a32b8f761cd402687ce8f9e6cc2d9b8ed5bba2c71a31fc099e77cd02200a644600d7174977f7185d630323b1f0dda4b5b81b2017bc8000639015bdd23501210251b397d3ad5ab4f803565c0243d3c1fa9d5a8124b33547bb993ee1ebeb729ff20247304402204c18dfb4eb01af4da5f1c66e9c0f79696e55803ec7c257cc7e34014af2c2d97a02202df05db704cbd99c121dd18cb908d5c2a5bd63baca86ad09dbd9c0ad82749b9c01210251b397d3ad5ab4f803565c0243d3c1fa9d5a8124b33547bb993ee1ebeb729ff200000000';

export const OTHER_TX = {
  txid: '2f00c1314c251e6f45ba2707deb85e7eb3b8cd47383bd75d2412e3c5c77f9015',
  hex: '02000000018ef08f51a0401825af15c238d7b2136d2405abd9bf02e0c1c8a697db2aeb296c010000000151fdffffff030100000000000000160014111111111111111111111111111111111111111101000000000000001600141111111111111111111111111111111111111111ac8a00000000000022512022fee5c4094546d1da2432f6dbe24c23ffa8903e05e321f686700e45e9d54b2e00000000',
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
