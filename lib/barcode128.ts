/**
 * Warehouse OS · W2b — a tiny Code 128 (set B) encoder for printed labels. No dependency, client-safe.
 * Set B covers printable ASCII (space … ~), which is enough for PAL-00001, A-01-03, LOT-00012, ASN-0091-01.
 * Each symbol is 6 alternating bar/space widths (11 modules); the stop symbol is 7 widths (13 modules).
 */
export const CODE128_PATTERNS: readonly string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
export const START_B = 104;
export const STOP = 106;

/** True when every character can be encoded in Code 128 set B. */
export function canEncode128(text: string) {
  return text.length > 0 && text.length <= 80 && /^[\x20-\x7E]+$/.test(text);
}

/** Symbol values: start B, data, checksum, stop. Throws for text set B can't encode. */
export function code128Values(text: string): number[] {
  if (!canEncode128(text)) throw new Error('Code 128: use 1 to 80 printable ASCII characters');
  const data = [...text].map((c) => c.charCodeAt(0) - 32);
  const check = data.reduce((sum, v, i) => sum + v * (i + 1), START_B) % 103;
  return [START_B, ...data, check, STOP];
}

/** Alternating bar/space widths in modules, starting with a bar (no quiet zone). */
export function code128Widths(text: string): number[] {
  return code128Values(text).flatMap((v) => [...CODE128_PATTERNS[v]].map(Number));
}

/** Bars as {x, w} in modules plus the total width (for an SVG viewBox), with a 10-module quiet zone each side. */
export function code128Bars(text: string, quiet = 10): { bars: { x: number; w: number }[]; width: number } {
  const widths = code128Widths(text);
  const bars: { x: number; w: number }[] = [];
  let x = quiet;
  widths.forEach((w, i) => {
    if (i % 2 === 0) bars.push({ x, w });
    x += w;
  });
  return { bars, width: x + quiet };
}
