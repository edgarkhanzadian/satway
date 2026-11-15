import { field, parseJson, stringField } from './http.js';
import type { Rng } from './random.js';

export const RELAY_ORIGIN = 'wss://relay.walletconnect.org';
export const VERIFY_ORIGIN = 'https://verify.walletconnect.org';

export interface RelaySocket {
  send(text: string): void;
  close(): void;
}

export interface RelayMessage {
  topic: string;
  message: string;
  tag: number;
  publishedAt: number;
  source: 'page' | 'wallet';
}

export interface RelayFrame {
  connection: number;
  direction: 'to-relay' | 'from-relay';
  body: unknown;
}

export interface RelayRequestLog {
  connection: number;
  method: string;
  params: unknown;
}

type Listener = (message: RelayMessage) => void;

interface Connection {
  id: number;
  socket: RelaySocket;
  url: string;
  topics: Map<string, string>;
  open: boolean;
}

export type RelayMode = 'up' | 'unreachable';

export class FakeRelay {
  mode: RelayMode = 'up';
  readonly frames: RelayFrame[] = [];
  readonly requests: RelayRequestLog[] = [];
  readonly urls: string[] = [];
  readonly verifyLoads: string[] = [];
  readonly proposals: { pairingTopic: string; message: string }[] = [];
  readonly published: RelayMessage[] = [];
  private readonly connections: Connection[] = [];
  private readonly mailbox = new Map<string, RelayMessage[]>();
  private readonly listeners = new Map<string, Listener[]>();
  private readonly proposalListeners: ((proposal: {
    pairingTopic: string;
    message: string;
  }) => void)[] = [];
  private readonly rng: Rng;
  private readonly now: () => number;
  private sequence = 0;

  constructor(rng: Rng, now: () => number) {
    this.rng = rng;
    this.now = now;
  }

  get openConnections(): number {
    return this.connections.filter(c => c.open).length;
  }

  accept(socket: RelaySocket, url: string): ((text: string) => void) | null {
    this.urls.push(url);
    if (this.mode === 'unreachable') {
      socket.close();
      return null;
    }
    const connection: Connection = {
      id: this.connections.length + 1,
      socket,
      url,
      topics: new Map(),
      open: true,
    };
    this.connections.push(connection);
    return text => this.onFrame(connection, text);
  }

  closed(socket: RelaySocket): void {
    for (const c of this.connections) if (c.socket === socket) c.open = false;
  }

  dropAll(): void {
    for (const c of this.connections) {
      if (!c.open) continue;
      c.open = false;
      c.socket.close();
    }
  }

  onProposal(listener: (proposal: { pairingTopic: string; message: string }) => void): void {
    this.proposalListeners.push(listener);
    for (const p of this.proposals) listener(p);
  }

  subscribe(topic: string, listener: Listener): void {
    const list = this.listeners.get(topic) ?? [];
    list.push(listener);
    this.listeners.set(topic, list);
    for (const m of this.published.filter(p => p.topic === topic && p.source === 'page'))
      listener(m);
  }

  publish(topic: string, message: string, tag: number, from: number | null = null): void {
    const entry: RelayMessage = {
      topic,
      message,
      tag,
      publishedAt: this.now(),
      source: from === null ? 'wallet' : 'page',
    };
    this.published.push(entry);
    if (from !== null) {
      for (const listener of this.listeners.get(topic) ?? []) listener(entry);
      return;
    }
    const subscribed = this.connections.filter(c => c.open && c.topics.has(topic));
    if (subscribed.length === 0) {
      const queued = this.mailbox.get(topic) ?? [];
      queued.push(entry);
      this.mailbox.set(topic, queued);
      return;
    }
    for (const c of subscribed) this.deliver(c, entry);
  }

  private nextId(): number {
    this.sequence += 1;
    return this.now() * 1000 + this.sequence;
  }

  private deliver(connection: Connection, entry: RelayMessage): void {
    const id = connection.topics.get(entry.topic);
    if (id === undefined) return;
    this.send(connection, {
      id: this.nextId(),
      jsonrpc: '2.0',
      method: 'irn_subscription',
      params: {
        id,
        data: {
          topic: entry.topic,
          message: entry.message,
          publishedAt: entry.publishedAt,
          tag: entry.tag,
          attestation: '',
        },
      },
    });
  }

  private send(connection: Connection, body: unknown): void {
    if (!connection.open) return;
    this.frames.push({ connection: connection.id, direction: 'from-relay', body });
    connection.socket.send(JSON.stringify(body));
  }

  private subscribeConnection(connection: Connection, topic: string): string {
    const existing = connection.topics.get(topic);
    if (existing !== undefined) return existing;
    const id = this.rng.hex(32);
    connection.topics.set(topic, id);
    const queued = this.mailbox.get(topic) ?? [];
    this.mailbox.delete(topic);
    queueMicrotask(() => {
      for (const entry of queued) this.deliver(connection, entry);
    });
    return id;
  }

  private onFrame(connection: Connection, text: string): void {
    const body = parseJson(text);
    this.frames.push({ connection: connection.id, direction: 'to-relay', body });
    const id = field(body, 'id');
    const method = stringField(body, 'method');
    if (method === undefined) return;
    const params = field(body, 'params');
    this.requests.push({ connection: connection.id, method, params });
    const reply = (result: unknown) => this.send(connection, { id, jsonrpc: '2.0', result });
    switch (method) {
      case 'irn_subscribe': {
        const topic = stringField(params, 'topic');
        reply(topic === undefined ? null : this.subscribeConnection(connection, topic));
        return;
      }
      case 'irn_batchSubscribe': {
        const topics = field(params, 'topics');
        const list: unknown[] = Array.isArray(topics) ? topics : [];
        reply(
          list.flatMap(t =>
            typeof t === 'string' ? [this.subscribeConnection(connection, t)] : []
          )
        );
        return;
      }
      case 'irn_unsubscribe': {
        const topic = stringField(params, 'topic');
        if (topic !== undefined) connection.topics.delete(topic);
        reply(true);
        return;
      }
      case 'irn_batchFetchMessages':
        reply({ messages: [], hasMore: false });
        return;
      case 'irn_publish': {
        const topic = stringField(params, 'topic');
        const message = stringField(params, 'message');
        const tag = field(params, 'tag');
        if (topic !== undefined && message !== undefined)
          this.publish(topic, message, typeof tag === 'number' ? tag : 0, connection.id);
        reply(true);
        return;
      }
      case 'wc_proposeSession': {
        const pairingTopic = stringField(params, 'pairingTopic');
        const message = stringField(params, 'sessionProposal');
        if (pairingTopic !== undefined && message !== undefined) {
          this.subscribeConnection(connection, pairingTopic);
          const proposal = { pairingTopic, message };
          this.proposals.push(proposal);
          for (const listener of this.proposalListeners) listener(proposal);
        }
        reply(true);
        return;
      }
      default:
        reply(true);
    }
  }
}
