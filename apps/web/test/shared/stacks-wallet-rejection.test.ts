import { JsonRpcError, JsonRpcErrorCode } from '@stacks/connect';
import { describe, expect, it } from 'vitest';

import { isUserRejection } from '@satway/chains';

import { isStacksWalletRejection } from '../../src/shared/index.js';

describe('isStacksWalletRejection', () => {
  it('recognises a decline from Leather (4001) and from Xverse (-32000)', () => {
    expect(isStacksWalletRejection({ code: 4001, message: 'User rejected the request.' })).toBe(
      true
    );
    expect(isStacksWalletRejection(new JsonRpcError('User rejected request', -32000))).toBe(true);
    expect(JsonRpcErrorCode.UserRejection).toBe(-32000);
  });

  it('recognises the Stacks Connect modal being closed (-31001)', () => {
    expect(JsonRpcErrorCode.UserCanceled).toBe(-31001);
    expect(isStacksWalletRejection(new JsonRpcError('User canceled the request', -31001))).toBe(
      true
    );
  });

  it('does not treat other wallet errors as a decline', () => {
    expect(isStacksWalletRejection({ code: -32603, message: 'Internal error' })).toBe(false);
    expect(isStacksWalletRejection({ code: -32001, message: 'Address mismatch' })).toBe(false);
    expect(isStacksWalletRejection(new Error('User rejected the request'))).toBe(false);
    expect(isStacksWalletRejection(null)).toBe(false);
  });

  it('stays separate from the EVM check, where -32000 can follow a broadcast', () => {
    expect(isUserRejection({ code: -32000, message: 'execution reverted' })).toBe(false);
    expect(isUserRejection({ code: -31001, message: 'User canceled' })).toBe(false);
  });
});
