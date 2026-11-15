export interface PageScriptOptions {
  binding: string;
  evm: { name: string; uuid: string; rdns: string; icon: string } | null;
  solana: {
    name: string;
    icon: string;
    address: string;
    publicKey: string;
    features: readonly ('signAndSend' | 'sign')[];
  } | null;
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

  function toBase64(bytes: Uint8Array): string {
    let binary = '';
    bytes.forEach(byte => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }

  function fromBase64(text: unknown): Uint8Array {
    if (typeof text !== 'string') throw new Error('The wallet returned no bytes');
    const binary = atob(text);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  function bytesOf(value: unknown): Uint8Array {
    if (value instanceof Uint8Array) return value;
    throw new Error('Expected transaction bytes');
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

  const solana = options.solana;
  if (solana) {
    const chains = Object.freeze(['solana:mainnet']);
    const featureNames = [
      ...(solana.features.includes('signAndSend') ? ['solana:signAndSendTransaction'] : []),
      ...(solana.features.includes('sign') ? ['solana:signTransaction'] : []),
    ];
    const account = Object.freeze({
      address: solana.address,
      publicKey: fromBase64(solana.publicKey),
      chains,
      features: Object.freeze(featureNames),
      label: solana.name,
    });
    let accounts: readonly object[] = [];
    const features: Record<string, unknown> = {
      'standard:connect': {
        version: '1.0.0',
        async connect() {
          await walletCall('solana', { method: 'connect' });
          accounts = [account];
          return { accounts };
        },
      },
      'standard:events': {
        version: '1.0.0',
        on() {
          return () => undefined;
        },
      },
    };
    if (solana.features.includes('signAndSend')) {
      features['solana:signAndSendTransaction'] = {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0],
        async signAndSendTransaction(...inputs: unknown[]) {
          const outputs: { signature: Uint8Array }[] = [];
          for (const input of inputs) {
            const signature = await walletCall('solana', {
              method: 'signAndSendTransaction',
              transaction: toBase64(bytesOf(read(input, 'transaction'))),
              chain: read(input, 'chain'),
              options: plain(read(input, 'options')),
            });
            outputs.push({ signature: fromBase64(signature) });
          }
          return outputs;
        },
      };
    }
    if (solana.features.includes('sign')) {
      features['solana:signTransaction'] = {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0],
        async signTransaction(...inputs: unknown[]) {
          const outputs: { signedTransaction: Uint8Array }[] = [];
          for (const input of inputs) {
            const signed = await walletCall('solana', {
              method: 'signTransaction',
              transaction: toBase64(bytesOf(read(input, 'transaction'))),
              chain: read(input, 'chain'),
            });
            outputs.push({ signedTransaction: fromBase64(signed) });
          }
          return outputs;
        },
      };
    }
    const wallet = {
      version: '1.0.0',
      name: solana.name,
      icon: solana.icon,
      chains,
      features,
      get accounts() {
        return accounts;
      },
    };
    function register(api: unknown) {
      const fn = read(api, 'register');
      if (typeof fn === 'function') Reflect.apply(fn, api, [wallet]);
    }
    window.addEventListener('wallet-standard:app-ready', event => register(read(event, 'detail')));
    window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: register }));
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
