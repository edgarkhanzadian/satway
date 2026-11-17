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
  type WithdrawalReceiptFile,
  activeWithdrawal,
  rememberWithdrawal,
  setActiveWithdrawal,
} from '../../shared/index.js';
import type { WithdrawalRouteUpdate } from '../../ui/index.js';
import { storedWithdrawal } from './stored-withdrawal.js';
import { WithdrawalTracking } from './tracking.js';
import { WithdrawForm } from './withdraw-form.js';
import { WithdrawalList } from './withdrawal-list.js';

export interface WithdrawProps {
  backend: Backend;
  quotes: WithdrawalBackend;
  account: WalletAccount | null;
  destinationWallet: SourceWallet | null;
  active: ActiveWithdrawal | null;
  onActive(update: (current: ActiveWithdrawal | null) => ActiveWithdrawal | null): void;
  requestWithdrawal(call: WithdrawalContractCall): Promise<string>;
  onRoute(route: WithdrawalRouteUpdate | null): void;
  shown: boolean;
}

export function storedActiveWithdrawal(): ActiveWithdrawal | null {
  const receipt = activeWithdrawal(config);
  return receipt ? { receipt, receiptUnsaved: false, walletPrompt: false } : null;
}

function WithdrawIntro() {
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
          The sBTC signers pay your sBTC out as BTC to a swap address, and NEAR Intents swaps it and
          delivers it to your address.
        </li>
        <li>
          If the signers reject the withdrawal, your sBTC comes back. If the swap cannot complete,
          the BTC is refunded to your Bitcoin address.
        </li>
      </styled.ul>
    </section>
  );
}

export function Withdraw(props: WithdrawProps) {
  const { active, onActive, onRoute } = props;
  const [signingHere, setSigningHere] = useState(false);
  useEffect(() => () => onRoute(null), [onRoute]);

  function follow(receipt: WithdrawalReceiptFile) {
    setActiveWithdrawal(receipt);
    onActive(() => ({ receipt, receiptUnsaved: false, walletPrompt: false }));
  }

  if (active && !(active.walletPrompt && signingHere)) {
    return (
      <WithdrawalTracking
        shown={props.shown}
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

  return (
    <>
      {props.account ? (
        <WithdrawForm
          {...props}
          account={props.account}
          walletPromptOpen={active?.walletPrompt === true}
          onSigning={setSigningHere}
        />
      ) : (
        <WithdrawIntro />
      )}
      {active === null && (
        <styled.div marginTop="space.10">
          <WithdrawalList
            visible={props.shown}
            backend={props.backend}
            onFollow={receipt => follow(storedWithdrawal(receipt) ?? receipt)}
            onLoaded={receipt => {
              rememberWithdrawal(config, receipt);
              follow(receipt);
            }}
          />
        </styled.div>
      )}
    </>
  );
}
