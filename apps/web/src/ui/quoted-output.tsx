function sats(text: string): string {
  return /^\d+$/.test(text) ? `${Number(text).toLocaleString('en-US')} sats` : `${text} sats`;
}

export function QuotedOutput(props: { quote: { amountOut: string; minAmountOut: string } }) {
  const { quote } = props;
  return (
    <>
      <dt>Quoted to receive</dt>
      <dd>
        about {sats(quote.amountOut)} as sBTC, at least {sats(quote.minAmountOut)} before the
        signers’ Bitcoin fee
      </dd>
    </>
  );
}
