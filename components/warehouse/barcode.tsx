import { canEncode128, code128Bars } from '@/lib/barcode128';

/**
 * Warehouse OS · W2b — Code 128 barcode as an inline SVG (crisp on any printer, no dependency).
 * The human-readable text is printed under the bars; screen readers get it as the image name.
 */
export function Barcode128({ value, height = 56, moduleWidth = 2, showText = true, testId }: {
  value: string; height?: number; moduleWidth?: number; showText?: boolean; testId?: string;
}) {
  if (!canEncode128(value)) {
    return <span className="text-[12px] text-bad" data-testid={testId}>Can’t print “{value}” as a barcode</span>;
  }
  const { bars, width } = code128Bars(value);
  return (
    <figure className="m-0 inline-flex flex-col items-center" data-testid={testId} data-barcode={value}>
      <svg role="img" aria-label={`Barcode ${value}`} viewBox={`0 0 ${width} ${height}`} width={width * moduleWidth} height={height}
        preserveAspectRatio="none" shapeRendering="crispEdges" className="max-w-full h-auto bg-white">
        {bars.map((b) => <rect key={b.x} x={b.x} y={0} width={b.w} height={height} fill="#000" />)}
      </svg>
      {showText && <figcaption className="font-mono text-[13px] tracking-[.08em] text-black mt-1" aria-hidden="true">{value}</figcaption>}
    </figure>
  );
}
