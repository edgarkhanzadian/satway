import { SOLANA_MAINNET_CAIP2 } from '../config.js';
import { field, numberField, parseJson, stringField } from '../world/http.js';
import {
  type KeyPair,
  deriveSymKey,
  newKeyPair,
  open,
  seal,
  topicOf,
} from '../world/walletconnect-crypto.js';
import type { RelayMessage } from '../world/walletconnect-relay.js';
import type { World } from '../world/world.js';
import { Behaviour, WalletError } from './behaviour.js';

export const WALLETCONNECT_WALLET_NAME = 'Fake Mobile Wallet';

const TAG = {
  proposeResponse: 1101,
  settleRequest: 1102,
  sessionRequest: 1108,
  sessionRequestResponse: 1109,
  settleResponse: 1103,
} as const;

const EVM_METHODS = ['eth_sendTransaction', 'wallet_switchEthereumChain'];
const EVM_EVENTS = ['chainChanged', 'accountsChanged'];
const WEEK_SECONDS = 7 * 24 * 60 * 60;

export interface PairingUri {
  topic: string;
  symKey: string;
}

export function parsePairingUri(uri: string): PairingUri {
  const match = /^wc:([0-9a-f]{64})@2\?(.+)$/.exec(uri);
  if (!match?.[1] || !match[2]) throw new Error(`Not a WalletConnect pairing URI: ${uri}`);
  const symKey = new URLSearchParams(match[2]).get('symKey');
  if (!symKey) throw new Error(`The pairing URI has no symKey: ${uri}`);
  return { topic: match[1], symKey };
}

export interface ApprovalPlan {
  evmChainIds: readonly number[];
  solana: boolean;
}

export interface DecodedProposal {
  id: number;
  proposerPublicKey: string;
  optionalNamespaces: unknown;
  requiredNamespaces: unknown;
  metadata: unknown;
}

export interface SessionRequestLog {
  id: number;
  chainId: string;
  method: string;
  params: unknown;
}

export class WalletConnectWallet {
  readonly behaviour = new Behaviour();
  readonly evmAddress: string;
  readonly solanaAddress: string;
  readonly requests: SessionRequestLog[] = [];
  readonly settleReplies: unknown[] = [];
  sessionTopic: string | null = null;
  private sessionKey: string | null = null;
  private readonly keys: KeyPair = newKeyPair();
  private readonly world: World;

  constructor(world: World, solanaAddress: string) {
    this.world = world;
    this.evmAddress = world.rng.evmAddress();
    this.solanaAddress = solanaAddress;
  }

  readProposal(uri: string): DecodedProposal {
    const pairing = parsePairingUri(uri);
    const found = this.world.relay.proposals.find(p => p.pairingTopic === pairing.topic);
    if (!found) throw new Error(`The relay holds no proposal for pairing ${pairing.topic}`);
    const request = parseJson(open(pairing.symKey, found.message));
    const params = field(request, 'params');
    const id = numberField(request, 'id');
    const proposerPublicKey = stringField(field(params, 'proposer'), 'publicKey');
    if (id === undefined || proposerPublicKey === undefined)
      throw new Error('The session proposal has no id or proposer key');
    return {
      id,
      proposerPublicKey,
      optionalNamespaces: field(params, 'optionalNamespaces'),
      requiredNamespaces: field(params, 'requiredNamespaces'),
      metadata: field(field(params, 'proposer'), 'metadata'),
    };
  }

  approve(uri: string, plan: ApprovalPlan): void {
    const pairing = parsePairingUri(uri);
    const proposal = this.readProposal(uri);
    const sessionKey = deriveSymKey(this.keys.privateKey, proposal.proposerPublicKey);
    const sessionTopic = topicOf(sessionKey);
    this.sessionKey = sessionKey;
    this.sessionTopic = sessionTopic;
    this.world.relay.subscribe(sessionTopic, message => this.onSessionMessage(message));

    const relay = this.world.relay;
    relay.publish(
      pairing.topic,
      seal(
        pairing.symKey,
        JSON.stringify({
          id: proposal.id,
          jsonrpc: '2.0',
          result: { relay: { protocol: 'irn' }, responderPublicKey: this.keys.publicKey },
        })
      ),
      TAG.proposeResponse
    );

    const namespaces: Record<string, unknown> = {};
    if (plan.evmChainIds.length > 0) {
      namespaces.eip155 = {
        chains: plan.evmChainIds.map(id => `eip155:${id}`),
        accounts: plan.evmChainIds.map(id => `eip155:${id}:${this.evmAddress}`),
        methods: EVM_METHODS,
        events: EVM_EVENTS,
      };
    }
    if (plan.solana) {
      namespaces.solana = {
        chains: [SOLANA_MAINNET_CAIP2],
        accounts: [`${SOLANA_MAINNET_CAIP2}:${this.solanaAddress}`],
        methods: ['solana_signAndSendTransaction', 'solana_signTransaction'],
        events: [],
      };
    }
    const nowSeconds = Math.floor(this.world.now().getTime() / 1000);
    relay.publish(
      sessionTopic,
      seal(
        sessionKey,
        JSON.stringify({
          id: this.nextId(),
          jsonrpc: '2.0',
          method: 'wc_sessionSettle',
          params: {
            relay: { protocol: 'irn' },
            namespaces,
            requiredNamespaces: proposal.requiredNamespaces,
            optionalNamespaces: proposal.optionalNamespaces,
            pairingTopic: pairing.topic,
            controller: {
              publicKey: this.keys.publicKey,
              metadata: {
                name: WALLETCONNECT_WALLET_NAME,
                description: 'A WalletConnect wallet played by the e2e world',
                url: 'https://wallet.example',
                icons: [],
              },
            },
            expiry: nowSeconds + WEEK_SECONDS,
          },
        })
      ),
      TAG.settleRequest
    );
  }

  private sequence = 0;

  private nextId(): number {
    this.sequence += 1;
    return this.world.now().getTime() * 1000 + this.sequence;
  }

  private onSessionMessage(message: RelayMessage): void {
    if (this.sessionKey === null) return;
    if (message.tag !== TAG.sessionRequest && message.tag !== TAG.settleResponse) return;
    const body = parseJson(open(this.sessionKey, message.message));
    if (message.tag === TAG.settleResponse) {
      this.settleReplies.push(body);
      return;
    }
    void this.onRequest(body);
  }

  private async onRequest(body: unknown): Promise<void> {
    const id = numberField(body, 'id');
    const params = field(body, 'params');
    const chainId = stringField(params, 'chainId') ?? '';
    const request = field(params, 'request');
    const method = stringField(request, 'method') ?? '';
    const requestParams = field(request, 'params');
    if (id === undefined) return;
    this.requests.push({ id, chainId, method, params: requestParams });
    const reply = await this.behaviour.run(method, requestParams ?? null, () =>
      this.answer(chainId, method, requestParams)
    );
    const payload = reply.ok
      ? { id, jsonrpc: '2.0', result: reply.value }
      : { id, jsonrpc: '2.0', error: reply.error };
    const topic = this.sessionTopic;
    const key = this.sessionKey;
    if (topic === null || key === null) return;
    this.world.relay.publish(topic, seal(key, JSON.stringify(payload)), TAG.sessionRequestResponse);
  }

  private answer(chainId: string, method: string, params: unknown): unknown {
    const list: unknown[] = Array.isArray(params) ? params : [];
    switch (method) {
      case 'wallet_switchEthereumChain':
        return null;
      case 'eth_sendTransaction': {
        const tx = list[0];
        const from = stringField(tx, 'from');
        const to = stringField(tx, 'to');
        const value = stringField(tx, 'value');
        if (!from || from.toLowerCase() !== this.evmAddress.toLowerCase())
          throw new WalletError(4100, 'The requested account has not been authorized');
        if (!to) throw new WalletError(-32602, 'Invalid "to"');
        const id = Number(chainId.split(':')[1]);
        const sent = this.world.evm.submit({
          chainId: id,
          from,
          to,
          value: value === undefined || value === '0x' ? 0n : BigInt(value),
          data: stringField(tx, 'data') ?? null,
        });
        return sent.hash;
      }
      default:
        throw new WalletError(5101, `The wallet does not support ${method}`);
    }
  }
}
