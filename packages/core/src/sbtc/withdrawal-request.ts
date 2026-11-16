import { hex } from '@scure/base';
import {
  Address,
  Cl,
  postConditionToHex,
  serializeCV,
  validateStacksAddress,
} from '@stacks/transactions';

import type { NetworkConfig, WithdrawalConfig } from '../shared/index.js';
import { bufferHexOf, fieldOf, parseClarityHex, safeUintOf, tupleOf } from './clarity-values.js';
import {
  type WithdrawalAddressKind,
  type WithdrawalRecipient,
  assertRecipientRoundTrip,
  encodeWithdrawalRecipient,
  sameRecipient,
} from './withdrawal-recipient.js';

export const SBTC_WITHDRAWAL_DUST_LIMIT_SATS = 546;

export type WithdrawalContractConfig = Pick<NetworkConfig, 'sbtcContract'> &
  Pick<
    WithdrawalConfig,
    | 'withdrawalContractName'
    | 'withdrawalFunctionName'
    | 'tokenContractName'
    | 'tokenAssetName'
    | 'minWithdrawalSats'
    | 'minFeeCapSats'
    | 'maxFeeCapSats'
  >;

export interface WithdrawalRequestInput {
  sender: string;
  amountSats: number;
  maxFeeSats: number;
  recipientAddress: string;
}

export type SbtcAssetIdentifier = `${string}.${string}::${string}`;

export interface WithdrawalPostCondition {
  type: 'ft-postcondition';
  address: string;
  condition: 'eq';
  asset: SbtcAssetIdentifier;
  amount: string;
}

export interface WithdrawalArguments {
  amount: string;
  recipient: WithdrawalRecipient;
  maxFee: string;
}

export interface WithdrawalContractCall {
  network: 'mainnet';
  contract: `${string}.${string}`;
  contractAddress: string;
  contractName: string;
  functionName: string;
  functionArgs: string[];
  arguments: WithdrawalArguments;
  postConditionMode: 'deny';
  postConditions: WithdrawalPostCondition[];
  postConditionsHex: string[];
  sender: string;
  amountSats: number;
  maxFeeSats: number;
  lockedSats: number;
  recipientAddress: string;
  recipientKind: WithdrawalAddressKind;
  recipientScriptPubKey: string;
}

const MAINNET_STANDARD_VERSIONS = new Set([22, 20]);

export function assertMainnetSender(sender: string): void {
  if (!validateStacksAddress(sender)) {
    throw new Error('The withdrawal sender is not a valid Stacks address');
  }
  const parsed = Address.parse(sender);
  if (parsed.contractName !== undefined) {
    throw new Error('The withdrawal sender must be a wallet address, not a contract');
  }
  if (!MAINNET_STANDARD_VERSIONS.has(parsed.version)) {
    throw new Error('The withdrawal sender must be a mainnet Stacks address (SP… or SM…)');
  }
}

export function sbtcAssetIdentifier(
  config: Pick<WithdrawalContractConfig, 'sbtcContract' | 'tokenContractName' | 'tokenAssetName'>
): SbtcAssetIdentifier {
  return `${config.sbtcContract}.${config.tokenContractName}::${config.tokenAssetName}`;
}

export function assertWithdrawalInvariants(amountSats: number, maxFeeSats: number): void {
  if (!Number.isSafeInteger(amountSats) || amountSats <= SBTC_WITHDRAWAL_DUST_LIMIT_SATS) {
    throw new Error(
      `The withdrawal amount must be a whole number of sats above ${SBTC_WITHDRAWAL_DUST_LIMIT_SATS}`
    );
  }
  if (!Number.isSafeInteger(maxFeeSats) || maxFeeSats <= 0) {
    throw new Error('The withdrawal fee cap must be a positive whole number of sats');
  }
  if (!Number.isSafeInteger(amountSats + maxFeeSats)) {
    throw new Error('The withdrawal amount plus its fee cap is too large');
  }
}

export function assertWithdrawalAmounts(
  config: Pick<WithdrawalContractConfig, 'minWithdrawalSats' | 'minFeeCapSats' | 'maxFeeCapSats'>,
  amountSats: number,
  maxFeeSats: number
): void {
  if (!Number.isSafeInteger(amountSats) || amountSats <= SBTC_WITHDRAWAL_DUST_LIMIT_SATS) {
    assertWithdrawalInvariants(amountSats, maxFeeSats);
  }
  if (amountSats < config.minWithdrawalSats) {
    throw new Error(`The withdrawal amount must be at least ${config.minWithdrawalSats} sats`);
  }
  if (
    !Number.isSafeInteger(maxFeeSats) ||
    maxFeeSats < config.minFeeCapSats ||
    maxFeeSats > config.maxFeeCapSats
  ) {
    throw new Error(
      `The withdrawal fee cap must be a whole number of sats between ${config.minFeeCapSats} and ${config.maxFeeCapSats}`
    );
  }
  assertWithdrawalInvariants(amountSats, maxFeeSats);
}

function recipientCV(recipient: WithdrawalRecipient) {
  return Cl.tuple({
    version: Cl.buffer(hex.decode(recipient.version)),
    hashbytes: Cl.buffer(hex.decode(recipient.hashbytes)),
  });
}

export function decodeWithdrawalArguments(functionArgs: readonly string[]): {
  amountSats: number;
  recipient: WithdrawalRecipient;
  maxFeeSats: number;
} {
  if (functionArgs.length !== 3) {
    throw new Error('A withdrawal request takes exactly three arguments');
  }
  const [amountHex, recipientHex, maxFeeHex] = functionArgs;
  if (amountHex === undefined || recipientHex === undefined || maxFeeHex === undefined) {
    throw new Error('A withdrawal request takes exactly three arguments');
  }
  const fields = tupleOf(parseClarityHex(recipientHex, 'recipient argument'), 'recipient argument');
  if (Object.keys(fields).length !== 2) {
    throw new Error('The recipient argument must have exactly version and hashbytes');
  }
  return {
    amountSats: safeUintOf(parseClarityHex(amountHex, 'amount argument'), 'amount argument'),
    recipient: {
      version: bufferHexOf(fieldOf(fields, 'version', 'recipient'), 'recipient version'),
      hashbytes: bufferHexOf(fieldOf(fields, 'hashbytes', 'recipient'), 'recipient hashbytes'),
    },
    maxFeeSats: safeUintOf(parseClarityHex(maxFeeHex, 'max-fee argument'), 'max-fee argument'),
  };
}

export function buildWithdrawalContractCall(
  config: WithdrawalContractConfig,
  input: WithdrawalRequestInput
): WithdrawalContractCall {
  assertMainnetSender(input.sender);
  assertWithdrawalAmounts(config, input.amountSats, input.maxFeeSats);
  const encoded = encodeWithdrawalRecipient(input.recipientAddress);
  assertRecipientRoundTrip(input.recipientAddress, encoded.recipient);

  const lockedSats = input.amountSats + input.maxFeeSats;
  const functionArgs = [
    serializeCV(Cl.uint(input.amountSats)),
    serializeCV(recipientCV(encoded.recipient)),
    serializeCV(Cl.uint(input.maxFeeSats)),
  ];
  const postCondition: WithdrawalPostCondition = {
    type: 'ft-postcondition',
    address: input.sender,
    condition: 'eq',
    asset: sbtcAssetIdentifier(config),
    amount: String(lockedSats),
  };

  const echoed = decodeWithdrawalArguments(functionArgs);
  if (
    echoed.amountSats !== input.amountSats ||
    echoed.maxFeeSats !== input.maxFeeSats ||
    !sameRecipient(echoed.recipient, encoded.recipient)
  ) {
    throw new Error('The serialised withdrawal arguments do not decode to the inputs');
  }
  assertRecipientRoundTrip(input.recipientAddress, echoed.recipient);

  return {
    network: 'mainnet',
    contract: `${config.sbtcContract}.${config.withdrawalContractName}`,
    contractAddress: config.sbtcContract,
    contractName: config.withdrawalContractName,
    functionName: config.withdrawalFunctionName,
    functionArgs,
    arguments: {
      amount: String(input.amountSats),
      recipient: encoded.recipient,
      maxFee: String(input.maxFeeSats),
    },
    postConditionMode: 'deny',
    postConditions: [postCondition],
    postConditionsHex: [postConditionToHex(postCondition)],
    sender: input.sender,
    amountSats: input.amountSats,
    maxFeeSats: input.maxFeeSats,
    lockedSats,
    recipientAddress: encoded.address,
    recipientKind: encoded.kind,
    recipientScriptPubKey: encoded.scriptPubKey,
  };
}
