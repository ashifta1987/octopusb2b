/**
 * Warehouse OS · W4 — carrier adapter interface (lib/carriers). Business code depends only on this; YunExpress / 4PX / sandbox
 * are swappable per warehouse account. Credentials are never in the database: an account names the server environment-variable
 * PREFIX (e.g. FOURPX_FS01) and the adapter reads `${prefix}_APP_KEY` / `${prefix}_APP_SECRET` at call time.
 */
export type CarrierCode = 'yunexpress' | '4px';
export type AccountMode = 'sandbox' | 'live';

export type CarrierAccountRef = { id: string; carrier: CarrierCode; name: string; mode: AccountMode; credentialEnv: string | null };

export type LabelAddress = { name: string; phone?: string | null; line1?: string | null; line2?: string | null; city?: string | null; region?: string | null; postcode?: string | null; country: string };

export type LabelRequest = {
  orderCode: string;
  /** client / store order reference shown on the label (never a supplier name) */
  reference: string;
  parcelSeq: number;
  parcelCount: number;
  weightG: number | null;
  serviceCode: string;
  serviceName: string;
  dangerousGoods: string[];
  shipTo: LabelAddress;
  shipFrom: { name: string; city: string; province?: string | null; country: string; address?: string | null; phone?: string | null };
  items: { sku: string; name: string; qty: number; unitWeightG: number | null }[];
};

export type LabelResult = { trackingNo: string; pdf: Uint8Array; carrierRef?: string };

export type CarrierTrackingEvent = {
  providerEventId: string;
  status: 'in_transit' | 'out_for_delivery' | 'delivered' | 'exception' | 'returned' | 'info';
  description: string;
  location?: string | null;
  occurredAt: string;
};

export interface CarrierAdapter {
  readonly carrier: CarrierCode;
  readonly mode: AccountMode;
  createLabel(req: LabelRequest): Promise<LabelResult>;
  cancelLabel(trackingNo: string): Promise<void>;
  fetchTracking(trackingNo: string): Promise<CarrierTrackingEvent[]>;
}

/** A carrier problem in words for staff (never contains credentials). */
export class CarrierError extends Error {
  constructor(public readonly code: 'NOT_CONNECTED' | 'SANDBOX_STAGING_ONLY' | 'NOT_BUILT' | 'CARRIER_REFUSED' | 'CARRIER_UNREACHABLE', message: string) {
    super(message);
    this.name = 'CarrierError';
  }
}

export const CARRIER_NAME: Record<CarrierCode, string> = { yunexpress: 'YunExpress', '4px': '4PX' };
