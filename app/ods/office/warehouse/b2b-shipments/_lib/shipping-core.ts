// ODS T9
/**
 * ODS T9 · B2B shipments (Warehouse OS › B2B shipments, Part 7.6) — pure rules. Server + client safe.
 * Who sees what is today's `b2bShippingAccess` (lib/warehouse-retire, audit F-05), unchanged: carrier name, service, rate
 * and label only for admin / orders editors / Finance / warehouse:view; suppliers only with suppliers:view or Finance.
 * Shipments are created with today's `priceTrial` / `createShipment` server actions, unchanged.
 */
import { b2bShippingAccess } from '@/lib/warehouse-retire';

export { b2bShippingAccess };
export type B2bAccess = ReturnType<typeof b2bShippingAccess>;

/** CarrierAdapter rates have no currency field: they are USD (same constant as today's ShipmentCreator). */
export const RATE_CURRENCY = 'USD';

export type ShipEvent = { status: string; description: string | null; occurred_at: string };

export type ShipmentRow = {
  id: string;
  code: string;
  trackingNo: string | null;
  status: string;
  serviceCode: string | null;
  carrierName: string | null;
  labelUrl: string | null;
  rateCents: number | null;
  rateCurrency: string;
  at: string;
  order: { id: string; code: string } | null;
  dropshipOrder: string | null;
  isDropship: boolean;
  events: ShipEvent[];
};

export type ReadyRow = {
  id: string;
  code: string;
  title: string;
  buyer: string | null;
  buyerCountry: string | null;
  supplierCode: string | null;
  totalCents: number;
  currency: string;
  incoterm: string | null;
  readySince: string;
};

/**
 * Strip what this staff member may not see (defence in depth: the page also never loads carrier names / rates for
 * them, as today). Events are newest first.
 */
export function applyShippingAccess(r: ShipmentRow, a: B2bAccess): ShipmentRow {
  return {
    ...r,
    serviceCode: a.canSeeCarrier ? r.serviceCode : null,
    carrierName: a.canSeeCarrier ? r.carrierName : null,
    labelUrl: a.canDownloadLabels ? r.labelUrl : null,
    rateCents: a.canSeeRates ? r.rateCents : null,
    events: r.events.slice().sort((p, q) => q.occurred_at.localeCompare(p.occurred_at)),
  };
}

/** Grid columns this staff member gets (same column rules as today's table). */
export function shipmentColumnIds(a: B2bAccess): string[] {
  return ['code', 'order', ...(a.canSeeCarrier ? ['carrier', 'service'] : []), 'waybill', ...(a.canSeeRates ? ['rate'] : []), 'last', 'status', ...(a.canDownloadLabels ? ['label'] : [])];
}

/**
 * shipments.status → Appendix C name (same tones as today's badges: delivered green, exception / returned red,
 * moving blue, the rest neutral → Pending). The raw status is shown beside the pill.
 */
export function shipmentStatusName(status: string): 'Pending' | 'Shipped' | 'Delivered' | 'Failed' {
  if (status === 'delivered') return 'Delivered';
  if (status === 'exception' || status === 'returned') return 'Failed';
  if (['picked_up', 'in_transit', 'out_for_delivery'].includes(status)) return 'Shipped';
  return 'Pending';
}
export const humanStatus = (s: string) => {
  const t = s.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export type B2bView = 'shipments' | 'exceptions' | 'ready';
export const b2bView = (v: string | null | undefined, a: B2bAccess): B2bView =>
  v === 'exceptions' ? 'exceptions' : v === 'ready' && a.canSeeReadyToShip ? 'ready' : 'shipments';

/** Who pays shipping (today's ShipmentCreator text). */
export const billedTo = (incoterm: string | null) => (incoterm === 'DDP' || incoterm === 'DAP' ? `Seller (${incoterm})` : `Buyer (${incoterm ?? 'FOB'})`);

/** Same check as priceTrial: weight and pieces > 0. */
export function validateParcel(weightKg: number, pieces: number): string | null {
  return weightKg > 0 && pieces > 0 ? null : 'Enter the weight and number of pieces.';
}

/** Order cell target: the order record, the Warehouse OS search for Dropship (warehouse members only), else none (F-06). */
export function orderLink(r: Pick<ShipmentRow, 'order' | 'dropshipOrder' | 'isDropship'>, whMember: boolean, packFallback: (q: string | null) => string): { label: string; href: string | null } {
  if (r.order?.id) return { label: r.order.code, href: `/office/orders/${r.order.id}` };
  if (r.isDropship) return { label: r.dropshipOrder ?? '—', href: r.dropshipOrder && whMember ? packFallback(r.dropshipOrder) : null };
  return { label: '—', href: null };
}

/** Carrier connection badge text (today's rule). */
export const carrierStatusText = (mode: 'live' | string, staging: boolean) => (mode === 'live' ? 'Production' : staging ? 'Sandbox mode' : 'Carrier not connected');
