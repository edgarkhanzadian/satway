import { useMemo, useState } from 'react';

import { styled } from 'portage-styles/jsx';
import { button, sheet } from 'portage-styles/recipes';

import type { SourceWallet } from '@portage/chains';

import { SourceWalletPanel } from '../features/chain-wallets/index.js';
import { Deposit } from '../features/deposit/index.js';
import { Recover } from '../features/recover/index.js';
import { StacksWalletPanel, signReclaimWithWallet } from '../features/stacks-wallet/index.js';
import { type Receipt, type WalletAccount, createBackend } from '../shared/index.js';
import { RouteMap, type RouteUpdate, routeState } from '../ui/index.js';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';

export function App() {
  const backend = useMemo(() => createBackend(API_URL), []);
  const [account, setAccount] = useState<WalletAccount | null>(null);
  const [source, setSource] = useState<SourceWallet | null>(null);
  const [tab, setTab] = useState<'deposit' | 'recover'>('deposit');
  const [resume, setResume] = useState<Receipt | null>(null);
  const [route, setRoute] = useState<RouteUpdate | null>(null);

  const state = routeState({
    sourceConnected: source !== null,
    stacksConnected: account !== null,
    deposit: route?.deposit ?? null,
  });

  const landing = account === null && tab === 'deposit';

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
            portage
          </styled.h1>
          <styled.nav aria-label="Page" display="flex" gap="space.02">
            <button
              className={button({ variant: 'tab' })}
              aria-pressed={tab === 'deposit'}
              onClick={() => setTab('deposit')}
            >
              Deposit
            </button>
            <button
              className={button({ variant: 'tab' })}
              aria-pressed={tab === 'recover'}
              onClick={() => setTab('recover')}
            >
              Recover
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
              <SourceWalletPanel wallet={source} onChange={setSource} />
              <RouteMap
                state={state}
                tracking={Boolean(route?.deposit)}
                origin={route?.origin ?? null}
              />
              <StacksWalletPanel account={account} onChange={setAccount} />
            </styled.div>
          </styled.div>

          {tab === 'deposit' &&
            (account ? (
              <Deposit
                key={resume?.depositAddress ?? 'new'}
                backend={backend}
                account={account}
                source={source}
                resume={resume}
                onRoute={setRoute}
              />
            ) : (
              <section className={sheet()}>
                <styled.h2 textStyle="heading" marginBottom="space.06">
                  Before you start
                </styled.h2>
                <p>
                  Send USDC, ETH, SOL and other assets from 30-plus chains and receive sBTC on
                  Stacks. Connect your Stacks wallet above to begin.
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
                    The swap is carried out by NEAR Intents; your BTC then goes through the sBTC
                    peg, run by the sBTC signers.
                  </li>
                  <li>
                    If a deposit is not minted, you can take the BTC back yourself after a timelock
                    of about a week.
                  </li>
                </styled.ul>
              </section>
            ))}

          {tab === 'recover' && (
            <Recover
              backend={backend}
              account={account}
              onTrack={receipt => {
                setResume(receipt);
                setTab('deposit');
              }}
              onRoute={setRoute}
              signReclaim={signReclaimWithWallet}
            />
          )}
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
            portage
          </styled.span>
          <styled.p margin="space.00" fontSize="sm" color="muted">
            Portage is an independent project, not affiliated with or endorsed by Stacks or the sBTC
            signers.
          </styled.p>
        </styled.footer>
      </styled.div>
    </styled.div>
  );
}
