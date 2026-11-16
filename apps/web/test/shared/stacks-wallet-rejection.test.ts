import { JsonRpcError, JsonRpcErrorCode } from '@stacks/connect';
import { describe, expect, it } from 'vitest';

import { isUserRejection } from '@satway/chains';

import {
  StacksWalletDeclinedError,
  XVERSE_PROVIDER_ID,
  declinedOr,
  isStacksWalletRejection,
} from '../../src/shared/index.js';

const LEATHER = 'LeatherProvider';

describe('isStacksWalletRejection', () => {
  it('recognises a decline from Leather (4001), whichever wallet is selected', () => {
    const err = { code: 4001, message: 'User rejected the request.' };
    expect(isStacksWalletRejection(err, LEATHER)).toBe(true);
    expect(isStacksWalletRejection(err, null)).toBe(true);
  });

  it('treats -32000 as a decline only when Xverse is the selected wallet', () => {
    expect(JsonRpcErrorCode.UserRejection).toBe(-32000);
    const err = new JsonRpcError('User rejected request', -32000);
    expect(isStacksWalletRejection(err, XVERSE_PROVIDER_ID)).toBe(true);
    expect(isStacksWalletRejection(err, LEATHER)).toBe(false);
    expect(isStacksWalletRejection(err, null)).toBe(false);
  });

  it('recognises the Stacks Connect modal being closed (-31001)', () => {
    expect(JsonRpcErrorCode.UserCanceled).toBe(-31001);
    const err = new JsonRpcError('User canceled the request', -31001);
    expect(isStacksWalletRejection(err, null)).toBe(true);
    expect(isStacksWalletRejection(err, LEATHER)).toBe(true);
  });

  it('does not treat other wallet errors as a decline', () => {
    for (const code of [-32603, -32001, -32002, -31000]) {
      expect(isStacksWalletRejection({ code, message: 'x' }, XVERSE_PROVIDER_ID)).toBe(false);
    }
    expect(isStacksWalletRejection(new Error('User rejected the request'), LEATHER)).toBe(false);
    expect(isStacksWalletRejection(null, LEATHER)).toBe(false);
  });

  it('stays separate from the EVM check, where -32000 can follow a broadcast', () => {
    expect(isUserRejection({ code: -32000, message: 'execution reverted' })).toBe(false);
    expect(isUserRejection({ code: -31001, message: 'User canceled' })).toBe(false);
  });
});

describe('declinedOr', () => {
  it('wraps a decline and passes anything else through untouched', () => {
    const decline = { code: 4001, message: 'no' };
    const wrapped = declinedOr(decline, LEATHER);
    expect(wrapped).toBeInstanceOf(StacksWalletDeclinedError);
    expect(wrapped).toMatchObject({ cause: decline });
    const other = new JsonRpcError('Server error', -32000);
    expect(declinedOr(other, LEATHER)).toBe(other);
  });
});
