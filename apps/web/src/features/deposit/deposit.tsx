import { useEffect, useState } from 'react';

import type { SourceWallet } from '@satway/chains';
import { type OneClickToken, MAINNET_CONFIG as config, errorMessage } from '@satway/core';

import {
  type ActiveDeposit,
  type Backend,
  type WalletAccount,
  receiptId,
} from '../../shared/index.js';
import type { RouteUpdate } from '../../ui/index.js';
import { DepositForm } from './deposit-form.js';
import { depositOrigins } from './flow.js';
import { Tracking } from './tracking.js';
import { useDepositForm } from './use-deposit-form.js';

export function Deposit(props: {
  backend: Backend;
  account: WalletAccount | null;
  source: SourceWallet | null;
  active: ActiveDeposit | null;
  onActive(active: ActiveDeposit | null): void;
  onRoute(route: RouteUpdate | null): void;
}) {
  const { backend, account, source, active, onActive, onRoute } = props;
  const [tokens, setTokens] = useState<OneClickToken[]>([]);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [tokenAttempt, setTokenAttempt] = useState(0);

  useEffect(() => {
    async function loadTokens() {
      try {
        const all = await backend.tokens();
        setTokens(depositOrigins(all, config.btcAssetId));
        setTokenError(null);
      } catch (err) {
        setTokenError(`Could not load the asset list: ${errorMessage(err)}`);
      }
    }
    void loadTokens();
  }, [backend, tokenAttempt]);

  const form = useDepositForm({ backend, account, source, tokens, onActive });
  const token = form.token;

  useEffect(() => {
    if (active) return;
    onRoute({ origin: token ? `${token.symbol} on ${token.blockchain}` : null, deposit: null });
  }, [onRoute, token, active]);
  useEffect(() => () => onRoute(null), [onRoute]);

  if (active) {
    return (
      <Tracking
        key={receiptId(active.receipt)}
        backend={backend}
        receipt={active.receipt}
        receiptUnsaved={active.receiptUnsaved}
        firstRegistration={active.firstRegistration}
        source={source}
        token={tokens.find(t => t.assetId === active.receipt.origin.assetId)}
        onRoute={onRoute}
        onDone={() => onActive(null)}
      />
    );
  }

  if (!account) return null;

  return (
    <DepositForm
      account={account}
      tokens={tokens}
      tokenError={tokenError}
      onRetryTokens={() => {
        setTokenError(null);
        setTokenAttempt(attempt => attempt + 1);
      }}
      form={form}
    />
  );
}
