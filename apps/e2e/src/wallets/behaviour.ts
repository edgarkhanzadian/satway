import { realNow } from '../world/clock.js';

export const USER_REJECTED = 4001;
export const XVERSE_USER_REJECTION = -32000;
export const STACKS_CONNECT_USER_CANCELED = -31001;

export type Reaction =
  | { kind: 'approve' }
  | { kind: 'reject'; code: number; message: string }
  | { kind: 'hang' }
  | { kind: 'late'; gate: Promise<void>; then: 'approve' | { code: number; message: string } }
  | { kind: 'malformed'; value: unknown }
  | { kind: 'lost'; then: 'hang' | { code: number; message: string } };

export interface Gate {
  release(): void;
}

export interface WalletRequest {
  method: string;
  params: unknown;
  at: number;
}

export type WalletReply =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: number; message: string } };

class Deferred implements Gate {
  readonly promise: Promise<void>;
  private resolve: (() => void) | null = null;

  constructor() {
    this.promise = new Promise<void>(resolve => {
      this.resolve = resolve;
    });
  }

  release(): void {
    this.resolve?.();
  }
}

interface Scripted {
  reaction: Reaction;
  remaining: number;
}

export class Behaviour {
  private readonly scripted = new Map<string, Scripted[]>();
  readonly requests: WalletRequest[] = [];
  readonly lostReplies: { method: string; reply: WalletReply }[] = [];

  private add(method: string, reaction: Reaction, times: number): void {
    const list = this.scripted.get(method) ?? [];
    list.push({ reaction, remaining: times });
    this.scripted.set(method, list);
  }

  reject(method: string, options: { code?: number; message?: string; times?: number } = {}): void {
    this.add(
      method,
      {
        kind: 'reject',
        code: options.code ?? USER_REJECTED,
        message: options.message ?? 'User rejected the request.',
      },
      options.times ?? 1
    );
  }

  hang(method: string, options: { times?: number } = {}): void {
    this.add(method, { kind: 'hang' }, options.times ?? 1);
  }

  late(method: string, options: { reject?: { code: number; message?: string } } = {}): Gate {
    const gate = new Deferred();
    const reject = options.reject;
    const then = reject
      ? { code: reject.code, message: reject.message ?? 'User rejected the request.' }
      : 'approve';
    this.add(method, { kind: 'late', gate: gate.promise, then }, 1);
    return gate;
  }

  malformed(method: string, value: unknown, options: { times?: number } = {}): void {
    this.add(method, { kind: 'malformed', value }, options.times ?? 1);
  }

  loseReply(
    method: string,
    then: 'hang' | { code: number; message: string },
    options: { times?: number } = {}
  ): void {
    this.add(method, { kind: 'lost', then }, options.times ?? 1);
  }

  calls(method: string): WalletRequest[] {
    return this.requests.filter(r => r.method === method);
  }

  async run(method: string, params: unknown, approve: () => unknown): Promise<WalletReply> {
    this.requests.push({ method, params, at: realNow() });
    const list = this.scripted.get(method) ?? [];
    const next = list.find(s => s.remaining > 0);
    if (next) next.remaining -= 1;
    const reaction: Reaction = next?.reaction ?? { kind: 'approve' };
    switch (reaction.kind) {
      case 'approve':
        return this.settle(approve);
      case 'reject':
        return { ok: false, error: { code: reaction.code, message: reaction.message } };
      case 'hang':
        return new Promise<never>(() => undefined);
      case 'late':
        await reaction.gate;
        if (reaction.then !== 'approve') return { ok: false, error: reaction.then };
        return this.settle(approve);
      case 'malformed':
        return { ok: true, value: reaction.value };
      case 'lost': {
        const reply = await this.settle(approve);
        this.lostReplies.push({ method, reply });
        if (reaction.then === 'hang') return new Promise<never>(() => undefined);
        return { ok: false, error: reaction.then };
      }
      default:
        throw new Error(`Unknown reaction ${String(reaction satisfies never)}`);
    }
  }

  private async settle(approve: () => unknown): Promise<WalletReply> {
    try {
      return { ok: true, value: await approve() };
    } catch (err) {
      if (err instanceof WalletError)
        return { ok: false, error: { code: err.code, message: err.message } };
      throw err;
    }
  }
}

export class WalletError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}
