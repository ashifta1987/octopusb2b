/**
 * C0 · Connector interface and the internal formats every platform translates to / from (client-safe types; no platform calls).
 *
 * Rules every connector follows (STEP0 C10 / C11):
 *  - orders go IN only through ds_order_intake (channel = the platform key; dedupe on org + channel + external order id; only Octopus
 *    lines are kept; holds; quote lock). A connector never writes store_orders itself;
 *  - the customs value is the price the BUYER paid: every InternalOrderLine carries buyerUnitPriceMinor and / or buyerPaidMinor;
 *    a line without them is refused by intake (BUYER_PRICE_MISSING), never filled with a cost;
 *  - products go OUT through the push queue (dropship_push_batches / dropship_push_jobs) and are recorded in dropship_product_links /
 *    dropship_variant_links; tracking goes out through dropship_channel_tasks with the store tracking company from
 *    carrier_tracking_names and the merchant-branded /t/<token> link;
 *  - tokens / keys are sealed in store_credentials (lib/crypto/token-box.ts) and never leave the server.
 */
import type { StorePlatform } from './platforms';

export type ConnectorId = StorePlatform | 'csv';

/** Money in integer minor units of `currency` (KWD / BHD / OMR have 3 decimals, JPY 0). */
export type Minor = number;

export type InternalAddress = {
  name?: string | null; phone?: string | null; line1?: string | null; line2?: string | null; city?: string | null; region?: string | null;
  postcode?: string | null; country: string;
};

export type InternalOrderLine = {
  /** the DS variant model no. (DS-000001-01) or our variant id; anything else is counted as "not from Octopus" */
  modelNo?: string | null;
  variantId?: string | null;
  qty: number;
  /** what the buyer paid per unit, in the order currency (minor units) */
  buyerUnitPriceMinor?: Minor | null;
  /** the line total the buyer paid after discounts (minor units). When present it is the customs value. */
  buyerPaidMinor?: Minor | null;
  variantLabel?: string | null;
  title?: string | null;
  externalLineId?: string | null;
};

export type InternalOrder = {
  externalOrderId: string;
  externalOrderName?: string | null;
  currency: string;
  /** locked FX rate to USD at intake; required when currency ≠ USD */
  fxRateToUsd?: number | null;
  buyerName?: string | null;
  buyerPhone?: string | null;
  address: InternalAddress;
  shippingMethod?: 'economy' | 'standard' | 'express' | null;
  lines: InternalOrderLine[];
  /** lines of the same store order that are not Octopus products (counted only) */
  otherItems?: number;
  risk?: 'low' | 'medium' | 'high' | 'unknown';
  addressCheck?: 'ok' | 'failed';
  addressIssue?: string | null;
};

export type InternalProductVariant = { modelNo: string; sku: string; optionText: string | null; priceMinor: Minor | null; compareAtMinor: Minor | null; weightG: number | null };
export type InternalProduct = {
  modelNo: string; title: string; description: string; currency: string | null; productType?: string | null; vendor?: string | null; tags?: string[];
  variants: InternalProductVariant[];
};

export type InternalShipment = {
  storeOrderNumber: string; externalOrderId: string | null; externalOrderName: string | null;
  trackingNumbers: string[];
  /** from carrier_tracking_names ("Other" when not set); never the carrier's own name unless staff set it */
  trackingCompany: string;
  /** our merchant-branded /t/<token> page (absolute URL) */
  trackingUrl: string | null;
  shippedAt: string | null;
};

export type ConnectionRef = { id: string; orgId: string; platform: StorePlatform; shopDomain: string; storeUrl: string | null };

export type DetectResult =
  | { outcome: 'found'; platform: StorePlatform; host: string; url: string; evidence: string[] }
  | { outcome: 'marketplace'; platform: StorePlatform; host: string; url: string; evidence: string[] }
  | { outcome: 'unknown'; host: string; url: string; evidence: string[] }
  | { outcome: 'unreachable' | 'blocked'; host: string | null; url: string | null; reason: string };

export type StartConnectResult = { kind: 'redirect'; url: string } | { kind: 'form'; fields: { key: string; label: string; secret: boolean }[] };
export type TestResult = { ok: boolean; message: string; scopes?: string[] };
export type PushResult = { ok: boolean; externalProductId?: string; variantIds?: Record<string, string>; message?: string };
export type PullResult = { orders: InternalOrder[]; cursor: string | null; errors: { ref: string; message: string }[] };

export type ConnectorStatus = 'ready' | 'not_configured' | 'not_built';

export class ConnectorError extends Error {
  constructor(public readonly code: 'NOT_CONFIGURED' | 'NOT_BUILT' | 'NOT_SUPPORTED' | 'AUTH_FAILED' | 'PLATFORM_REFUSED' | 'UNREACHABLE' | 'INVALID_INPUT', message: string) {
    super(message);
    this.name = 'ConnectorError';
  }
}

/** One platform. Every method exists on every connector; a platform that can't do something throws NOT_SUPPORTED. */
export interface Connector {
  readonly id: ConnectorId;
  readonly name: string;
  status(): ConnectorStatus;
  /** env var names still missing on this server (names only) */
  missingEnv(): string[];
  /** does this page / host belong to this platform? (signature check on a page already fetched by the SSRF-guarded fetcher) */
  detect(page: { host: string; headers: Record<string, string>; html: string; cookies: string[] }): string[] | null;
  startConnect(input: { orgId: string; shopDomain: string; returnPath: string }): Promise<StartConnectResult>;
  finishConnect(input: { orgId: string; params: Record<string, string> }): Promise<ConnectionRef>;
  testConnection(conn: ConnectionRef): Promise<TestResult>;
  pushProduct(conn: ConnectionRef, product: InternalProduct): Promise<PushResult>;
  pullOrders(conn: ConnectionRef, since: string | null): Promise<PullResult>;
  sendTracking(conn: ConnectionRef, shipment: InternalShipment): Promise<{ ok: boolean; message?: string }>;
  syncStock(conn: ConnectionRef, items: { sku: string; available: number }[]): Promise<{ ok: boolean; failed: string[] }>;
  syncPrice(conn: ConnectionRef, items: { sku: string; priceMinor: Minor; compareAtMinor: Minor | null }[]): Promise<{ ok: boolean; failed: string[] }>;
  disconnect(conn: ConnectionRef, opts: { hideProducts: boolean }): Promise<void>;
}
