/** Shared (server + client) quantity helpers for the product page. */
/** Order multiple from the free-text carton quantity ("75pcs/CTN", "186个/箱", "40") → 75 / 186 / 40; anything else → null. */
export function cartonQty(raw: string | null | undefined): number | null {
  const m = /^\s*(\d{1,6})(?!\s*[x×*\d])/.exec(raw ?? '');
  const n = m ? Number(m[1]) : 0;
  return n > 1 ? n : null;
}
