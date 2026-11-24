/** Client-safe formula-injection sanitiser for CSV error/report downloads. */
export function sanitiseCsvCellClient(val: string | null | undefined): string {
  let s = String(val ?? '').replace(/[\t\r]/g, ' ').trim();
  while (s.length > 0 && /^[=+\-@]/.test(s)) {
    s = s.slice(1).trimStart();
  }
  return s;
}
