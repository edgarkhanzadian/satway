import {
  PostConditionMode,
  addressToString,
  deserializeTransaction,
  serializeCV,
  serializePostConditionWire,
  wireToPostCondition,
} from '@stacks/transactions';
import { describe, expect, it } from 'vitest';

import {
  MAINNET_WITHDRAWAL_FLOW_CONFIG as C,
  type WithdrawalContractConfig,
  buildWithdrawalContractCall,
  decodeWithdrawalArguments,
  decodeWithdrawalRecipient,
  parseWith,
  sbtcAssetIdentifier,
  stacksTransactionSchema,
} from '../../src/index.js';
import { defined } from '../fixtures.js';
import { REAL_WITHDRAWALS } from '../real-withdrawals.js';

const DIRECT = REAL_WITHDRAWALS.filter(w => w.direct);
const REAL_INPUTS: WithdrawalContractConfig = { ...C, minWithdrawalSats: 547, minFeeCapSats: 1 };

function strip0x(text: string): string {
  return text.replace(/^0x/, '');
}

function contractCallOf(raw: string) {
  const tx = deserializeTransaction(strip0x(raw));
  const payload = tx.payload;
  if (!('functionArgs' in payload)) throw new Error('Not a contract call');
  return { tx, payload };
}

describe('buildWithdrawalContractCall against real mainnet withdrawal requests', () => {
  it('has real direct requests for P2SH, P2WPKH and P2TR', () => {
    expect(new Set(DIRECT.map(w => w.kind))).toEqual(new Set(['p2sh', 'p2wpkh', 'p2tr']));
    expect(DIRECT.length).toBeGreaterThanOrEqual(8);
  });

  it.each(DIRECT.map(w => [w.id, w.kind, w] as const))(
    'request %i (%s): arguments are byte-identical to the signed transaction',
    (_id, _kind, w) => {
      const call = buildWithdrawalContractCall(REAL_INPUTS, {
        sender: w.sender,
        amountSats: w.amountSats,
        maxFeeSats: w.maxFeeSats,
        recipientAddress: w.address ?? decodeAddress(w),
      });
      const tx = parseWith(stacksTransactionSchema, w.requestTx, 'fixture');
      const real = defined(tx.contract_call?.function_args).map(a => strip0x(a.hex));
      expect(call.functionArgs).toEqual(real);

      const { payload } = contractCallOf(w.requestRawTx);
      expect(payload.functionArgs.map(a => serializeCV(a))).toEqual(call.functionArgs);
      expect(`${addressToString(payload.contractAddress)}.${payload.contractName.content}`).toBe(
        call.contract
      );
      expect(payload.functionName.content).toBe(call.functionName);
      expect(decodeWithdrawalArguments(real)).toEqual({
        amountSats: w.amountSats,
        recipient: { version: w.version, hashbytes: w.hashbytes },
        maxFeeSats: w.maxFeeSats,
      });
    }
  );

  it.each(DIRECT.map(w => [w.id, w] as const))(
    'request %i: the post-condition matches the real one in meaning and, for "equal", in bytes',
    (_id, w) => {
      const call = buildWithdrawalContractCall(REAL_INPUTS, {
        sender: w.sender,
        amountSats: w.amountSats,
        maxFeeSats: w.maxFeeSats,
        recipientAddress: w.address ?? decodeAddress(w),
      });
      const { tx } = contractCallOf(w.requestRawTx);
      expect(tx.postConditionMode).toBe(PostConditionMode.Deny);
      expect(call.postConditionMode).toBe('deny');
      expect(tx.postConditions.values).toHaveLength(1);
      const wire = defined(tx.postConditions.values[0]);
      const realPc = wireToPostCondition(wire);
      const ours = defined(call.postConditions[0]);
      if (realPc.type !== 'ft-postcondition') throw new Error('Expected a fungible condition');
      expect(realPc.address).toBe(ours.address);
      expect(realPc.asset).toBe(ours.asset);
      expect(String(realPc.amount)).toBe(ours.amount);
      expect(ours.amount).toBe(String(w.amountSats + w.maxFeeSats));
      const realHex = serializePostConditionWire(wire);
      if (realPc.condition === 'eq') {
        expect(call.postConditionsHex[0]).toBe(realHex);
        expect(strip0x(w.requestRawTx)).toContain(call.postConditionsHex[0]);
      } else {
        expect(realPc.condition).toBe('lte');
        const oursHex = defined(call.postConditionsHex[0]);
        const differing = [...oursHex].filter((ch, i) => ch !== realHex[i]).length;
        expect(oursHex).toHaveLength(realHex.length);
        expect(differing).toBe(1);
      }
    }
  );

  it('uses deny mode with exactly one "equal" condition on the sBTC token', () => {
    const w = defined(DIRECT[0]);
    const call = buildWithdrawalContractCall(REAL_INPUTS, {
      sender: w.sender,
      amountSats: w.amountSats,
      maxFeeSats: w.maxFeeSats,
      recipientAddress: defined(w.address),
    });
    expect(call).toMatchObject({
      network: 'mainnet',
      contract: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal',
      contractAddress: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4',
      contractName: 'sbtc-withdrawal',
      functionName: 'initiate-withdrawal-request',
      postConditionMode: 'deny',
      lockedSats: w.amountSats + w.maxFeeSats,
      recipientKind: w.kind,
      recipientScriptPubKey: w.scriptPubKey,
    });
    expect(call.postConditions).toEqual([
      {
        type: 'ft-postcondition',
        address: w.sender,
        condition: 'eq',
        asset: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token',
        amount: String(w.amountSats + w.maxFeeSats),
      },
    ]);
    expect(sbtcAssetIdentifier(C)).toBe(
      'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token'
    );
  });
});

function decodeAddress(w: { version: string; hashbytes: string }): string {
  return decodeWithdrawalRecipient({ version: w.version, hashbytes: w.hashbytes }).address;
}

describe('buildWithdrawalContractCall refusals', () => {
  const good = {
    sender: 'SP2RY5ESETDZAXQ7XWEGN7Q4X7VFAQ13VWHY7CCQ6',
    amountSats: 20_000,
    maxFeeSats: 3_000,
    recipientAddress: 'bc1q4tqyf2eqk5jhuw3tpame0gdec53k7ft5khap86',
  };

  it('builds with the production limits', () => {
    expect(buildWithdrawalContractCall(C, good).lockedSats).toBe(23_000);
  });

  it.each([
    [{ sender: 'ST2RY5ESETDZAXQ7XWEGN7Q4X7VFAQ13VWJ0YH4EM' }, /mainnet Stacks address|valid/],
    [{ sender: 'SP2RY5ESETDZAXQ7XWEGN7Q4X7VFAQ13VWHY7CCQ7' }, /not a valid Stacks address/],
    [
      { sender: 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-withdrawal' },
      /not a valid Stacks address|not a contract/,
    ],
    [{ sender: '' }, /not a valid Stacks address/],
    [{ amountSats: 546 }, /above 546/],
    [{ amountSats: 0 }, /above 546/],
    [{ amountSats: 9_999 }, /at least 10000/],
    [{ amountSats: 20_000.5 }, /whole number/],
    [{ amountSats: Number.NaN }, /whole number/],
    [{ maxFeeSats: 2_999 }, /between 3000 and 100000/],
    [{ maxFeeSats: 100_001 }, /between 3000 and 100000/],
    [{ maxFeeSats: 3_000.5 }, /between/],
    [{ amountSats: Number.MAX_SAFE_INTEGER }, /too large/],
    [{ recipientAddress: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx' }, /testnet/],
    [{ recipientAddress: 'bc1q4tqyf2eqk5jhuw3tpame0gdec53k7ft5khap87' }, /checksum/],
  ])('refuses %j', (patch, message) => {
    expect(() => buildWithdrawalContractCall(C, { ...good, ...patch })).toThrow(message);
  });
});

describe('decodeWithdrawalArguments', () => {
  it('refuses the wrong number of arguments', () => {
    expect(() => decodeWithdrawalArguments(['0100'])).toThrow(/exactly three/);
  });

  it('refuses arguments of the wrong Clarity type', () => {
    const w = defined(DIRECT[0]);
    const tx = parseWith(stacksTransactionSchema, w.requestTx, 'fixture');
    const [amount, recipient, maxFee] = defined(tx.contract_call?.function_args).map(a => a.hex);
    expect(() =>
      decodeWithdrawalArguments([defined(recipient), defined(amount), defined(maxFee)])
    ).toThrow(/not a uint|not a tuple/);
    expect(() =>
      decodeWithdrawalArguments([defined(amount), defined(recipient), `${defined(maxFee)}00`])
    ).toThrow(/trailing|decode/);
  });
});
