import { useMemo, useState } from 'react';

import { styled } from 'satway-styles/jsx';
import { button } from 'satway-styles/recipes';

import type { SourceWallet } from '@satway/chains';

import { SourceWalletPanel } from '../features/chain-wallets/index.js';
import { Deposit } from '../features/deposit/index.js';
import {
  StacksWalletPanel,
  requestWithdrawalWithWallet,
  signReclaimWithWallet,
} from '../features/stacks-wallet/index.js';
import { Withdraw, storedActiveWithdrawal } from '../features/withdraw/index.js';
import {
  type ActiveDeposit,
  type ActiveWithdrawal,
  type WalletAccount,
  createBackend,
  createWithdrawalBackend,
} from '../shared/index.js';
import {
  RouteMap,
  type RouteUpdate,
  WithdrawalRouteMap,
  type WithdrawalRouteUpdate,
  routeState,
  withdrawalRouteState,
} from '../ui/index.js';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';

export function App() {
  const backend = useMemo(() => createBackend(API_URL), []);
  const [account, setAccount] = useState<WalletAccount | null>(null);
  const [source, setSource] = useState<SourceWallet | null>(null);
  const [tab, setTab] = useState<'deposit' | 'withdraw'>('deposit');
  const [withdrawOpened, setWithdrawOpened] = useState(false);
  function openTab(next: 'deposit' | 'withdraw') {
    if (next === 'withdraw') setWithdrawOpened(true);
    setTab(next);
  }
  const quotes = useMemo(() => createWithdrawalBackend(API_URL), []);
  const [withdrawRoute, setWithdrawRoute] = useState<WithdrawalRouteUpdate | null>(null);
  const [activeWithdrawal, setActiveWithdrawal] = useState<ActiveWithdrawal | null>(
    storedActiveWithdrawal
  );
  const withdraw = tab === 'withdraw';
  const [active, setActive] = useState<ActiveDeposit | null>(null);
  const [route, setRoute] = useState<RouteUpdate | null>(null);

  const state = routeState({
    sourceConnected: source !== null,
    stacksConnected: account !== null,
    deposit: route?.deposit ?? null,
  });

  const landing = account === null && active === null && tab === 'deposit';

  return (
    <styled.div backgroundGradient={{ base: 'band.narrow', md: 'band.wide' }}>
      <styled.div
        maxWidth="page"
        marginInline="auto"
        paddingInline={{ base: 'space.08', md: 'space.10' }}
      >
        <styled.header
          display="flex"
          alignItems="center"
          gap="space.08"
          flexWrap="wrap"
          paddingBlock={{ base: 'space.08', md: 'space.10' }}
          color="band.ink"
        >
          <styled.h1 textStyle="wordmark" margin="space.00" marginRight="auto">
            satway
          </styled.h1>
          <styled.nav aria-label="Page" display="flex" gap="space.02">
            <button
              className={button({ variant: 'tab' })}
              aria-pressed={tab === 'deposit'}
              aria-controls="deposit-panel"
              onClick={() => openTab('deposit')}
            >
              Deposit
            </button>
            <button
              className={button({ variant: 'tab' })}
              aria-pressed={tab === 'withdraw'}
              aria-controls="withdraw-panel"
              onClick={() => openTab('withdraw')}
            >
              Withdraw
            </button>
          </styled.nav>
        </styled.header>

        <styled.main paddingBottom={{ base: 'space.13', md: 'space.14' }}>
          <styled.div
            backgroundColor="stage"
            borderRadius="xl"
            paddingTop={{ base: 'space.10', md: 'space.13' }}
            paddingBottom={{ base: 'space.10', md: 'space.12' }}
            paddingInline={{ base: 'space.08', md: 'space.14' }}
            marginBottom={{ base: 'space.10', md: 'space.12' }}
          >
            {landing && (
              <styled.div marginBottom={{ base: 'space.11', md: 'space.14' }}>
                <styled.p textStyle="display" maxWidth="measure" marginBottom="space.06">
                  Send from any chain, receive sBTC on Stacks.
                </styled.p>
                <styled.p
                  fontFamily="mono"
                  fontSize={{ base: 'lg', md: 'xl' }}
                  color="accentText"
                  margin="space.00"
                >
                  One deposit, tracked from start to finish.
                </styled.p>
              </styled.div>
            )}
            <styled.div
              display="grid"
              gridTemplateColumns={{
                base: 'minmax(0, 1fr)',
                md: 'minmax(0, 1fr) minmax(0, 1fr)',
              }}
              gridTemplateAreas={{ base: "'from' 'route' 'to'", md: "'from to' 'route route'" }}
              rowGap={{ base: 'space.10', md: 'space.12' }}
              columnGap={{ base: 'space.10', md: 'space.13' }}
            >
              <SourceWalletPanel
                wallet={source}
                onChange={setSource}
                direction={withdraw ? 'withdraw' : 'deposit'}
              />
              {withdraw ? (
                <WithdrawalRouteMap
                  state={withdrawalRouteState({
                    stacksConnected: account !== null,
                    destinationConnected: source !== null,
                    milestones: withdrawRoute?.milestones ?? null,
                  })}
                  tracking={Boolean(withdrawRoute?.milestones)}
                  destination={withdrawRoute?.destination ?? null}
                />
              ) : (
                <RouteMap
                  state={state}
                  tracking={Boolean(route?.deposit)}
                  origin={route?.origin ?? null}
                />
              )}
              <StacksWalletPanel
                account={account}
                onChange={setAccount}
                direction={withdraw ? 'withdraw' : 'deposit'}
              />
            </styled.div>
          </styled.div>

          <div id="deposit-panel" hidden={tab !== 'deposit'}>
            <Deposit
              backend={backend}
              account={account}
              source={source}
              active={active}
              onActive={setActive}
              onRoute={setRoute}
              signReclaim={signReclaimWithWallet}
              shown={tab === 'deposit'}
            />
          </div>

          <div id="withdraw-panel" hidden={tab !== 'withdraw'}>
            {withdrawOpened && (
              <Withdraw
                backend={backend}
                quotes={quotes}
                account={account}
                destinationWallet={source}
                active={activeWithdrawal}
                onActive={setActiveWithdrawal}
                requestWithdrawal={requestWithdrawalWithWallet}
                onRoute={setWithdrawRoute}
                shown={tab === 'withdraw'}
              />
            )}
          </div>
        </styled.main>

        <styled.footer
          display="flex"
          flexWrap="wrap"
          alignItems="baseline"
          columnGap="space.08"
          rowGap="space.02"
          paddingBlock="space.10"
          borderTopWidth="hairline"
          borderTopStyle="solid"
          borderTopColor="hairline"
        >
          <styled.span fontSize="lg" fontWeight="medium" letterSpacing="wordmark">
            satway
          </styled.span>
          <styled.p margin="space.00" fontSize="sm" color="muted">
            Satway is an independent project, not affiliated with or endorsed by Stacks or the sBTC
            signers.
          </styled.p>
        </styled.footer>
      </styled.div>
    </styled.div>
  );
}
