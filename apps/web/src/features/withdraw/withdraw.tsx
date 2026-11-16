import { useEffect, useState } from 'react';

import { styled } from 'satway-styles/jsx';
import { sheet } from 'satway-styles/recipes';

import type { SourceWallet } from '@satway/chains';
import {
  type WithdrawalContractCall,
  MAINNET_WITHDRAWAL_FLOW_CONFIG as config,
} from '@satway/core';

import {
  type ActiveWithdrawal,
  type Backend,
  type WalletAccount,
  type WithdrawalBackend,
  activeWithdrawal,
  setActiveWithdrawal,
} from '../../shared/index.js';
import type { WithdrawalRouteUpdate } from '../../ui/index.js';
import { WithdrawalTracking } from './tracking.js';
import { WithdrawForm } from './withdraw-form.js';

export interface WithdrawProps {
  backend: Backend;
  quotes: WithdrawalBackend;
  account: WalletAccount | null;
  destinationWallet: SourceWallet | null;
  active: ActiveWithdrawal | null;
  onActive(update: (current: ActiveWithdrawal | null) => ActiveWithdrawal | null): void;
  requestWithdrawal(call: WithdrawalContractCall): Promise<string>;
  onRoute(route: WithdrawalRouteUpdate | null): void;
}

export function storedActiveWithdrawal(): ActiveWithdrawal | null {
  const receipt = activeWithdrawal(config);
  return receipt ? { receipt, receiptUnsaved: false, walletPrompt: false } : null;
}

export function Withdraw(props: WithdrawProps) {
  const { active, onActive, onRoute } = props;
  const [signingHere, setSigningHere] = useState(false);
  useEffect(() => () => onRoute(null), [onRoute]);

  if (active && !(active.walletPrompt && signingHere)) {
    return (
      <WithdrawalTracking
        backend={props.backend}
        active={active}
        onActive={onActive}
        onRoute={onRoute}
        onDone={() => {
          setActiveWithdrawal(null);
          onActive(() => null);
        }}
      />
    );
  }

  if (!props.account) {
    return (
      <section className={sheet()}>
        <styled.h2 textStyle="heading" marginBottom="space.06">
          Withdraw sBTC to another chain
        </styled.h2>
        <p>
          Turn sBTC on Stacks into USDC, ETH and other assets on EVM chains. Connect your Stacks
          wallet above to begin.
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
            The sBTC signers pay your sBTC out as BTC to a swap address, and NEAR Intents swaps it
            and delivers it to your address.
          </li>
          <li>
            If the signers reject the withdrawal, your sBTC comes back. If the swap cannot complete,
            the BTC is refunded to your Bitcoin address.
          </li>
        </styled.ul>
      </section>
    );
  }

  return (
    <WithdrawForm
      {...props}
      account={props.account}
      walletPromptOpen={active?.walletPrompt === true}
      onSigning={setSigningHere}
    />
  );
}
