import { describe, expect, it } from 'vitest';

import { ResponseShapeError, fetchFeeEstimate } from '../../src/index.js';
import { jsonResponse } from '../fixtures.js';

function served(body: unknown) {
  const urls: string[] = [];
  return {
    urls,
    fetchFn(url: string) {
      urls.push(url);
      return Promise.resolve(jsonResponse(body));
    },
  };
}

describe('fetchFeeEstimate', () => {
  it('reads the requested confirmation target', async () => {
    const api = served({ '1': 3.2, '2': 2.5, '144': 1 });
    expect(await fetchFeeEstimate('https://mempool.space/api', 1, api.fetchFn)).toBe(3.2);
    expect(await fetchFeeEstimate('https://mempool.space/api', 144, api.fetchFn)).toBe(1);
    expect(api.urls[0]).toBe('https://mempool.space/api/fee-estimates');
  });

  it('refuses a missing target and malformed data', async () => {
    await expect(fetchFeeEstimate('x', 3, served({ '1': 3 }).fetchFn)).rejects.toThrow(
      /no fee estimate for 3/
    );
    await expect(fetchFeeEstimate('x', 1, served({ '1': -1 }).fetchFn)).rejects.toThrow(
      ResponseShapeError
    );
    await expect(fetchFeeEstimate('x', 1, served({ '1': '3' }).fetchFn)).rejects.toThrow(
      ResponseShapeError
    );
  });
});
