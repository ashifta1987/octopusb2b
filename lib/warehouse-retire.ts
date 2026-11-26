/**
 * Warehouse OS · W7 — retiring the legacy shipping / pack screens (programme decision D10).
 * Pure helpers (no server imports) so they are unit-tested: where each retired URL goes now that Warehouse OS is the only
 * 3PL (owner, 26 Nov 2026: "remove the old, follow the new"). /office/shipping and /request/3pl are next.config.ts redirects.
 */

/** B2B Sourcing orders (orders → shipments, shipped by the supplier with the YunExpress B2B adapter) inside Warehouse OS. */
export const B2B_SHIPMENTS_PATH = '/office/warehouse/b2b-shipments';
export const WH_ORDERS_PATH = '/office/warehouse/orders';
export const WH_PACK_PATH = '/office/warehouse/pack';
export const WH_DROPSHIP_ORDERS_PATH = `${WH_ORDERS_PATH}?source=dropship`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WO = /^WO-\d{6,}$/i;
/** Dropship store order numbers (DSO-…) and other short references the Warehouse OS order search accepts. */
const REF = /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/;

export const isUuid = (v: string | null | undefined): v is string => typeof v === 'string' && UUID.test(v);

/** /office/dropship/queue[?status=packing] → Warehouse OS orders (Dropship source) or the packing station. */
export function dropshipQueueTarget(sp: { status?: string | string[] | undefined }): string {
  return sp.status === 'packing' ? WH_PACK_PATH : WH_DROPSHIP_ORDERS_PATH;
}

export type PackRef =
  | { kind: 'wo'; code: string }
  | { kind: 'store_order_id'; id: string }
  | { kind: 'number'; q: string }
  | { kind: 'none' };

/** What /office/dropship/pack/[order] was given: a Warehouse OS order code, a store order id, a store order number, or junk. */
export function classifyPackRef(raw: string | null | undefined): PackRef {
  const ref = decodeURIComponentSafe(String(raw ?? '')).trim();
  if (WO.test(ref)) return { kind: 'wo', code: ref.toUpperCase() };
  if (UUID.test(ref)) return { kind: 'store_order_id', id: ref.toLowerCase() };
  if (REF.test(ref)) return { kind: 'number', q: ref.toUpperCase() };
  return { kind: 'none' };
}

export const whOrderPath = (code: string) => `${WH_ORDERS_PATH}/${encodeURIComponent(code.toUpperCase())}`;

/** Where a store order number goes when it does not resolve to exactly one warehouse order: the Dropship list searched by it. */
export function packFallback(q: string | null): string {
  return q ? `${WH_DROPSHIP_ORDERS_PATH}&q=${encodeURIComponent(q)}` : WH_DROPSHIP_ORDERS_PATH;
}

/** Picks the redirect from the Warehouse OS order search (wh_orders_board, any status, Dropship source). */
export function packTargetFromMatches(q: string | null, codes: string[]): string {
  const unique = [...new Set(codes.filter(Boolean))];
  return unique.length === 1 ? whOrderPath(unique[0]) : packFallback(q);
}

function decodeURIComponentSafe(v: string) {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

/** Staff who may see carrier names, rates and label links on the B2B shipments screen (never Support alone: F-05). */
export function b2bShippingAccess(s: { isAdmin: boolean; can: (area: string, action: string) => boolean }) {
  const canEdit = s.can('orders', 'edit');
  const finance = s.can('finance', 'view');
  const warehouse = s.can('warehouse', 'view');
  const canSeeSuppliers = s.isAdmin || s.can('suppliers', 'view') || finance;
  return {
    canEdit,
    canSeeRates: s.isAdmin || canEdit || finance,
    canSeeSuppliers,
    canDownloadLabels: s.isAdmin || canEdit || warehouse,
    canSeeCarrier: s.isAdmin || canEdit || finance || warehouse,
    canSeeReadyToShip: canEdit || canSeeSuppliers,
  };
}
