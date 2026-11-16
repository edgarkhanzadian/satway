import { useEffect, useRef, useState } from 'react';

import { type SourceWallet, nextRefundField, walletAddressFor, walletCovers } from '@satway/chains';
import { type OneClickToken, MAINNET_CONFIG as config, errorMessage } from '@satway/core';

import {
  type ActiveDeposit,
  type Backend,
  type WalletAccount,
  downloadReceipt,
  rememberReceipt,
  useFlow,
} from '../../shared/index.js';
import { firstRegistration } from './background-registration.js';
import { claimDepositIndex, prepareDeposit } from './flow.js';
import {
  type FormEffect,
  type FormView,
  INITIAL_FORM,
  formMachine,
  formView,
} from './form-state.js';

export const INDEX_IN_USE =
  'Another deposit in this browser already uses this Bitcoin deposit address. Get a new quote to continue.';

export interface DepositFormDeps {
  backend: Backend;
  account: WalletAccount | null;
  source: SourceWallet | null;
  tokens: readonly OneClickToken[];
  onActive(active: ActiveDeposit): void;
}

export interface DepositForm {
  view: FormView;
  token: OneClickToken | undefined;
  assetId: string;
  amount: string;
  refundTo: string;
  covered: boolean;
  chooseAsset(assetId: string): void;
  typeAmount(amount: string): void;
  typeRefund(refundTo: string): void;
  getQuote(): void;
  continueLive(): void;
  acceptRepriced(): void;
  declineRepriced(): void;
}

function pickAsset(
  current: string,
  tokens: readonly OneClickToken[],
  source: SourceWallet | null
): string {
  const base = current || (tokens[0]?.assetId ?? current);
  if (!source) return base;
  const now = tokens.find(t => t.assetId === base);
  if (now && walletCovers(source, now)) return base;
  return tokens.find(t => walletCovers(source, t))?.assetId ?? base;
}

export function useDepositForm(deps: DepositFormDeps): DepositForm {
  const { backend, account, source, tokens } = deps;
  const onActiveRef = useRef(deps.onActive);
  onActiveRef.current = deps.onActive;
  const [assetId, setAssetId] = useState('');
  const [amount, setAmount] = useState('');
  const [refundTo, setRefundTo] = useState('');
  const flow = useFlow(formMachine, () => INITIAL_FORM, run);
  const { dispatch } = flow;

  async function quote(effect: Extract<FormEffect, { type: 'quote' }>) {
    try {
      const prepared = await prepareDeposit(config, backend, effect.inputs, { dry: effect.dry });
      dispatch({ type: 'quoted', request: effect.request, prepared });
    } catch (err) {
      dispatch({
        type: 'quote-failed',
        request: effect.request,
        message: errorMessage(err) ?? null,
      });
    }
  }

  async function activate(effect: Extract<FormEffect, { type: 'activate' }>) {
    const { receipt } = effect.prepared;
    try {
      if (!claimDepositIndex(receipt)) throw new Error(INDEX_IN_USE);
      const remembered = rememberReceipt(receipt);
      downloadReceipt(receipt);
      const swapAddress = receipt.quoteResponse.quote.depositAddress;
      const first = swapAddress
        ? await firstRegistration(() =>
            backend.register(receipt.depositScript, receipt.reclaimScript, swapAddress)
          )
        : undefined;
      onActiveRef.current({
        receipt,
        receiptUnsaved: !remembered,
        ...(first === undefined ? {} : { firstRegistration: first }),
      });
      dispatch({ type: 'activated', request: effect.request });
    } catch (err) {
      dispatch({
        type: 'activation-failed',
        request: effect.request,
        message: errorMessage(err) ?? null,
      });
    }
  }

  function run(effect: FormEffect) {
    switch (effect.type) {
      case 'quote':
        void quote(effect);
        return;
      case 'activate':
        void activate(effect);
        return;
      default:
        throw new Error(`Unknown form effect ${String(effect satisfies never)}`);
    }
  }

  const token = tokens.find(t => t.assetId === assetId);
  const assetRef = useRef(assetId);
  assetRef.current = assetId;

  useEffect(() => {
    const current = assetRef.current;
    const next = pickAsset(current, tokens, source);
    if (next === current) return;
    setAssetId(next);
    if (current) dispatch({ type: 'autofilled' });
  }, [source, tokens, dispatch]);

  const refundRef = useRef(refundTo);
  refundRef.current = refundTo;
  const autofilledRefund = useRef<string | null>(null);
  const walletRefund = walletAddressFor(source, token?.blockchain);

  useEffect(() => {
    const next = nextRefundField(
      { value: refundRef.current, autofilled: autofilledRefund.current },
      walletRefund
    );
    autofilledRefund.current = next.autofilled;
    if (next.value !== refundRef.current) {
      setRefundTo(next.value);
      dispatch({ type: 'autofilled' });
    }
  }, [walletRefund, dispatch]);

  const stacksAddress = account?.stacksAddress;
  const reclaimPublicKey = account?.reclaimPublicKey;
  useEffect(() => {
    dispatch({ type: 'autofilled' });
  }, [stacksAddress, reclaimPublicKey, dispatch]);

  return {
    view: formView(flow.state.step),
    token,
    assetId,
    amount,
    refundTo,
    covered: walletCovers(source, token),
    chooseAsset(next) {
      setAssetId(next);
      dispatch({ type: 'edited' });
    },
    typeAmount(next) {
      setAmount(next);
      dispatch({ type: 'edited' });
    },
    typeRefund(next) {
      autofilledRefund.current = null;
      setRefundTo(next);
      dispatch({ type: 'edited' });
    },
    getQuote() {
      if (!token || !account) return;
      dispatch({
        type: 'preview-requested',
        inputs: { ...account, token, amount, refundTo },
      });
    },
    continueLive() {
      dispatch({ type: 'live-requested' });
    },
    acceptRepriced() {
      dispatch({ type: 'reprice-accepted', now: new Date() });
    },
    declineRepriced() {
      dispatch({ type: 'reprice-declined' });
    },
  };
}
