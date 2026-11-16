export interface PageScriptOptions {
  binding: string;
  evm: { name: string; uuid: string; rdns: string; icon: string } | null;
  stacks: { id: string; name: string; icon: string } | null;
}

export function installSatwayPage(options: PageScriptOptions): void {
  function read(value: unknown, key: string): unknown {
    if (typeof value !== 'object' || value === null || !(key in value)) return undefined;
    const out: unknown = Reflect.get(value, key);
    return out;
  }

  async function call(kind: string, payload: unknown): Promise<unknown> {
    const fn: unknown = Reflect.get(window, options.binding);
    if (typeof fn !== 'function') throw new Error('The e2e binding is not installed');
    const reply: unknown = await Reflect.apply(fn, window, [kind, payload]);
    return reply;
  }

  function plain(value: unknown): unknown {
    if (value === undefined) return null;
    const copy: unknown = JSON.parse(JSON.stringify(value));
    return copy;
  }

  async function walletCall(kind: string, payload: unknown): Promise<unknown> {
    const reply = await call(kind, payload);
    if (read(reply, 'ok') === true) return read(reply, 'value');
    const error = read(reply, 'error');
    const message = read(error, 'message');
    throw Object.assign(new Error(typeof message === 'string' ? message : 'Wallet error'), {
      code: read(error, 'code'),
    });
  }

  document.addEventListener('securitypolicyviolation', event => {
    void call('csp', {
      blockedURI: event.blockedURI,
      violatedDirective: event.violatedDirective,
      effectiveDirective: event.effectiveDirective,
      sourceFile: event.sourceFile,
      lineNumber: event.lineNumber,
      disposition: event.disposition,
      documentURI: event.documentURI,
    });
  });

  const evm = options.evm;
  if (evm) {
    const listeners = new Map<string, Set<(value: unknown) => void>>();
    const provider = Object.freeze({
      isSatwayTestWallet: true,
      request(args: unknown) {
        return walletCall('evm', plain(args));
      },
      on(event: unknown, listener: unknown) {
        if (typeof event !== 'string' || typeof listener !== 'function') return provider;
        const set = listeners.get(event) ?? new Set<(value: unknown) => void>();
        set.add(value => {
          Reflect.apply(listener, provider, [value]);
        });
        listeners.set(event, set);
        return provider;
      },
      removeListener() {
        return provider;
      },
      listenerCount(event: unknown) {
        return typeof event === 'string' ? (listeners.get(event)?.size ?? 0) : 0;
      },
    });
    Object.defineProperty(window, `${options.binding}EvmEmit`, {
      enumerable: false,
      value(event: string, value: unknown) {
        for (const listener of listeners.get(event) ?? []) listener(value);
      },
    });
    const info = Object.freeze({ uuid: evm.uuid, name: evm.name, icon: evm.icon, rdns: evm.rdns });
    function announce() {
      window.dispatchEvent(
        new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) })
      );
    }
    window.addEventListener('eip6963:requestProvider', announce);
    announce();
  }

  const stacks = options.stacks;
  if (stacks) {
    const provider = {
      async request(method: unknown, params: unknown) {
        const reply = await call('stacks', { method, params: plain(params) });
        return reply;
      },
    };
    Reflect.set(window, stacks.id, provider);
    const existing: unknown = Reflect.get(window, 'wbip_providers');
    const registered: unknown[] = Array.isArray(existing) ? existing : [];
    Reflect.set(window, 'wbip_providers', [
      ...registered,
      { id: stacks.id, name: stacks.name, icon: stacks.icon },
    ]);
  }
}
