import { describe, expect, it } from 'vitest';

import * as entry from '../src/worker.js';

describe('worker entry module', () => {
  it('exports only the default handler, as the Workers runtime requires', () => {
    expect(Object.keys(entry)).toEqual(['default']);
    expect(typeof entry.default.fetch).toBe('function');
    expect(typeof entry.default.scheduled).toBe('function');
  });
});
