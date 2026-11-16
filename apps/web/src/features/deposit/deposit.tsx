import { useEffect, useState } from 'react';

import { styled } from 'satway-styles/jsx';
import { actions, button, notice, sheet } from 'satway-styles/recipes';

import { SUPPORTED_ORIGIN_CHAINS, type SourceWallet } from '@satway/chains';
import { type OneClickToken, MAINNET_CONFIG as config, errorMessage } from '@satway/core';

import {
  type ActiveDeposit,
  type Backend,
  type Receipt,
  type WalletAccount,
  receiptId,
} from '../../shared/index.js';
import type { RouteUpdate } from '../../ui/index.js';
import { DepositForm } from './deposit-form.js';
import { depositOrigins } from './flow.js';
import { Tracking } from './tracking.js';
import { useDepositForm } from './use-deposit-form.js';
import { YourDeposits, entryLabelOf } from './your-deposits.js';

function BeforeYouStart() {
  return (
    <section className={sheet()}>
      <styled.h2 textStyle="heading" marginBottom="space.06">
        Before you start
      </styled.h2>
      <p>
        Send USDC, ETH and other assets from {SUPPORTED_ORIGIN_CHAINS.size} EVM chains and receive
        sBTC on Stacks. Connect your Stacks wallet above to begin.
      </p>
      <styled.ul
        marginTop="space.08"
        marginInline="space.00"
        marginBottom="space.00"
        paddingLeft="space.09"
        color="muted"
        fontSize="sm"
        listStyleType="disc"
        css={{ '& > li + li': { marginTop: 'space.02' } }}
      >
        <li>This site never holds your funds or keys.</li>
        <li>
          The swap is carried out by NEAR Intents; your BTC then goes through the sBTC peg, run by
          the sBTC signers.
        </li>
        <li>
          If a deposit is not minted, you can take the BTC back yourself after a timelock of about a
          week.
        </li>
      </styled.ul>
    </section>
  );
}

export function Deposit(props: {
  backend: Backend;
  account: WalletAccount | null;
  source: SourceWallet | null;
  active: ActiveDeposit | null;
  onActive(active: ActiveDeposit | null): void;
  onRoute(route: RouteUpdate | null): void;
  signReclaim(psbtHex: string, account: WalletAccount): Promise<Uint8Array>;
}) {
  const { backend, account, source, active, onActive, onRoute } = props;
  const [tokens, setTokens] = useState<OneClickToken[]>([]);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [tokenAttempt, setTokenAttempt] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [listRoute, setListRoute] = useState<RouteUpdate | null>(null);

  const wanted = account !== null || active !== null;

  useEffect(() => {
    if (!wanted) return;
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
  }, [backend, tokenAttempt, wanted]);

  function follow(next: ActiveDeposit) {
    setHidden(false);
    onActive(next);
  }

  const form = useDepositForm({ backend, account, source, tokens, onActive: follow });
  const token = form.token;
  const tracked = active !== null && !hidden ? active : null;
  const origin = account !== null && token ? `${token.symbol} on ${token.blockchain}` : null;

  useEffect(() => {
    if (tracked) return;
    onRoute(listRoute ?? { origin, deposit: null });
  }, [onRoute, origin, tracked, listRoute]);
  useEffect(() => () => onRoute(null), [onRoute]);

  const list = (
    <styled.div marginTop="space.10" hidden={tracked !== null}>
      <YourDeposits
        backend={backend}
        account={account}
        signReclaim={props.signReclaim}
        onFollow={(receipt: Receipt) => follow({ receipt, receiptUnsaved: false })}
        onRoute={setListRoute}
        visible={tracked === null}
      />
    </styled.div>
  );

  return (
    <>
      {tracked && (
        <Tracking
          key={receiptId(tracked.receipt)}
          backend={backend}
          receipt={tracked.receipt}
          receiptUnsaved={tracked.receiptUnsaved}
          firstRegistration={tracked.firstRegistration}
          source={source}
          token={tokens.find(t => t.assetId === tracked.receipt.origin.assetId)}
          onRoute={onRoute}
          onHide={() => setHidden(true)}
          onDone={() => onActive(null)}
        />
      )}
      {!tracked && active && (
        <styled.div marginBottom="space.10">
          <p className={notice()}>
            The deposit of {entryLabelOf(active.receipt)} is hidden. This page checks on it again
            when you show it.
          </p>
          <div className={actions()}>
            <button className={button({ variant: 'primary' })} onClick={() => setHidden(false)}>
              Show progress
            </button>
          </div>
        </styled.div>
      )}
      {!tracked && account && (
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
      )}
      {!tracked && !account && <BeforeYouStart />}
      {list}
    </>
  );
}
