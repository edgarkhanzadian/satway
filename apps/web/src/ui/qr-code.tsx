import { css } from 'portage-styles/css';

const QUIET_ZONE = 4;

const qr = css({
  display: 'block',
  width: 'full',
  maxWidth: 'qr',
  height: 'auto',
  marginTop: 'space.06',
});

export function qrPath(matrix: readonly (readonly boolean[])[]): string {
  const parts: string[] = [];
  matrix.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) parts.push(`M${x} ${y}h1v1h-1z`);
    });
  });
  return parts.join('');
}

export function QrCode(props: { matrix: boolean[][]; label: string }) {
  const size = props.matrix.length + QUIET_ZONE * 2;
  return (
    <svg
      className={qr}
      viewBox={`${-QUIET_ZONE} ${-QUIET_ZONE} ${size} ${size}`}
      role="img"
      aria-label={props.label}
      shapeRendering="crispEdges"
    >
      <rect x={-QUIET_ZONE} y={-QUIET_ZONE} width={size} height={size} fill="#ffffff" />
      <path d={qrPath(props.matrix)} fill="#000000" />
    </svg>
  );
}
