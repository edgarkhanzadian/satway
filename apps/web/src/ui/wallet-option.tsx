import type { ReactNode } from 'react';

import { styled } from 'satway-styles/jsx';

export function WalletName(props: { children: ReactNode }) {
  return <styled.span fontWeight="medium">{props.children}</styled.span>;
}

export function WalletNote(props: { children: ReactNode }) {
  return (
    <styled.span fontSize="sm" color="muted" fontWeight="regular">
      {props.children}
    </styled.span>
  );
}
