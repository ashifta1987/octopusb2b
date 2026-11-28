import 'server-only';
import { tokenBoxConfigured } from '@/lib/crypto/token-box';
import { BlockedAddressError } from './detect';
import { storeRequest, StoreUnreachableError, type StoreResponse } from './http';
import { cleanStr, MODEL_NO, storeAmountToMinor, utcSqlTime } from './key-common';
import { matchSignature } from './signatures';
import {
  ConnectorError, type Connector, type ConnectorStatus, type ConnectionRef, type InternalOrder, type InternalShipment, type PullResult, type PushResult,
  type StartConnectResult, type TestResult,
} from './types';

/**
 * CONN S3 · Magento 2 (Adobe Commerce / Magento Open Source) with an integration access token created by the merchant in admin
 * (System › Extensions › Integrations › Add New Integration, API access to Stores › Settings and Sales › Operations › Orders /
 * Shipments, Activate, copy the "Access Token"). REST under <store>/rest/V1 with header "Authorization: Bearer <token>".
 *
 * VERIFY every API endpoint, query param, request field and response field on the owner's test store before go-live (no official
 * Magento docs are in docs/):
 *  - Magento 2.4.4+ refuses integration tokens as standalone Bearer tokens unless "Stores › Configuration › Services › OAuth ›
 *    Consumer Settings › Allow OAuth Access Tokens to be used as standalone Bearer tokens" is set to Yes (detected below).
 *  - Test endpoint (VERIFY): GET /rest/V1/store/storeConfigs -> array of { base_currency_code, default_display_currency_code }.
 *  - Order pull (VERIFY): GET /rest/V1/orders with searchCriteria[filter_groups] on status=processing and updated_at>=since,
 *    sortOrders updated_at ASC, pageSize, currentPage -> { items, total_count }.
 *  - Order fields (VERIFY): entity_id, increment_id, status, order_currency_code, billing_address,
 *    extension_attributes.shipping_assignments[].shipping.address (firstname, lastname, street[], city, region, postcode,
 *    country_id, telephone), items[] (item_id, sku, name, qty_ordered, row_total, discount_amount, price, parent_item_id).
 *    Configurable parents carry the chosen child SKU; child rows (parent_item_id) are skipped.
 *  - Customs value = row_total − discount_amount (order currency, tax excluded) — VERIFY.
 *  - Tracking (VERIFY): POST /rest/V1/order/{entity_id}/ship with { items: [], notify: true, appendComment, comment: { comment,
 *    is_visible_on_front: 1 }, tracks: [{ track_number, title, carrier_code: 'custom' }] }.
 *  - Magento Open Source has no built-in webhooks: the hourly catch-up pull (S1) imports orders. Push / stock / price: NOT_BUILT.
 */
type MgAddress = { firstname?: string; lastname?: string; street?: string[]; city?: string; region?: string; postcode?: string; country_id?: string; telephone?: string }; // VERIFY
type MgItem = { item_id?: number; sku?: string; name?: string; qty_ordered?: number; row_total?: number; discount_amount?: number; price?: number; parent_item_id?: number | null; product_type?: string }; // VERIFY
export type MgOrder = {
  entity_id?: number; increment_id?: string; status?: string; order_currency_code?: string; items?: MgItem[]; billing_address?: MgAddress; // VERIFY
  extension_attributes?: { shipping_assignments?: { shipping?: { address?: MgAddress } }[] }; // VERIFY
};

export function magentoOrderToInternal(o: MgOrder): InternalOrder | { skip: string } {
  if (cleanStr(o.status) !== 'processing') return { skip: `order status ${cleanStr(o.status) || 'unknown'}` }; // VERIFY status='processing'
  if (!o.entity_id) return { skip: 'order without id' };
  const currency = cleanStr(o.order_currency_code).toUpperCase() || 'USD'; // VERIFY order_currency_code
  const shipCandidate = o.extension_attributes?.shipping_assignments?.[0]?.shipping?.address; // VERIFY shipping_assignments
  const ship = shipCandidate && (cleanStr(shipCandidate.country_id) || cleanStr(shipCandidate.street?.[0])) ? shipCandidate : o.billing_address ?? {};
  const name = [cleanStr(ship.firstname), cleanStr(ship.lastname)].filter(Boolean).join(' ') || null;
  let other = 0;
  const lines: InternalOrder['lines'] = [];
  for (const it of o.items ?? []) {
    if (it.parent_item_id) continue; // VERIFY: configurable parent carries chosen child SKU and price; child has parent_item_id
    const qty = Math.max(0, Math.trunc(Number(it.qty_ordered ?? 0))); // VERIFY qty_ordered
    if (!qty) continue;
    const sku = cleanStr(it.sku); // VERIFY sku
    if (!MODEL_NO.test(sku)) { other += qty; continue; }
    const row = storeAmountToMinor(it.row_total ?? null, currency); // VERIFY row_total
    const disc = storeAmountToMinor(it.discount_amount ?? 0, currency) ?? 0; // VERIFY discount_amount
    lines.push({
      modelNo: sku.toUpperCase(),
      qty,
      buyerPaidMinor: row == null ? null : Math.max(0, row - disc),
      buyerUnitPriceMinor: storeAmountToMinor(it.price ?? null, currency), // VERIFY price
      title: cleanStr(it.name).slice(0, 200) || null,
      externalLineId: it.item_id ? String(it.item_id) : null, // VERIFY item_id
    });
  }
  return {
    externalOrderId: String(o.entity_id), // VERIFY entity_id
    externalOrderName: cleanStr(o.increment_id) ? `#${cleanStr(o.increment_id)}` : `#${o.entity_id}`, // VERIFY increment_id
    currency,
    fxRateToUsd: null,
    buyerName: name,
    buyerPhone: cleanStr(ship.telephone) || null,
    address: {
      name,
      phone: cleanStr(ship.telephone) || null,
      line1: cleanStr(ship.street?.[0]) || null, // VERIFY street[]
      line2: cleanStr(ship.street?.slice(1).join(', ')) || null,
      city: cleanStr(ship.city) || null,
      region: cleanStr(ship.region) || null,
      postcode: cleanStr(ship.postcode) || null,
      country: cleanStr(ship.country_id).toUpperCase(), // VERIFY country_id
    },
    shippingMethod: null,
    lines,
    otherItems: other,
    risk: 'unknown',
  };
}

/** "since" in Magento's UTC filter format ("YYYY-MM-DD HH:MM:SS") — VERIFY. */
export const magentoTime = (iso: string) => utcSqlTime(iso);

/** Magento REST searchCriteria query string — VERIFY parameter names on test store. */
export function magentoOrdersQuery(since: string | null, page: number, pageSize = 50): string {
  const q = new URLSearchParams();
  q.set('searchCriteria[filter_groups][0][filters][0][field]', 'status'); // VERIFY
  q.set('searchCriteria[filter_groups][0][filters][0][value]', 'processing'); // VERIFY
  q.set('searchCriteria[filter_groups][0][filters][0][condition_type]', 'eq'); // VERIFY
  if (since) {
    q.set('searchCriteria[filter_groups][1][filters][0][field]', 'updated_at'); // VERIFY
    q.set('searchCriteria[filter_groups][1][filters][0][value]', magentoTime(since));
    q.set('searchCriteria[filter_groups][1][filters][0][condition_type]', 'gteq'); // VERIFY
  }
  q.set('searchCriteria[sortOrders][0][field]', 'updated_at'); // VERIFY
  q.set('searchCriteria[sortOrders][0][direction]', 'ASC'); // VERIFY
  q.set('searchCriteria[pageSize]', String(pageSize)); // VERIFY
  q.set('searchCriteria[currentPage]', String(page)); // VERIFY
  return q.toString();
}

export function magentoErrorMessage(status: number, body: string): string {
  let msg = '';
  try { msg = String((JSON.parse(body) as { message?: string }).message ?? ''); } catch { /* not JSON */ }
  // Magento 2.4.4+ standalone Bearer token disabled typically answers 401 "The consumer isn't authorized to access %resources." — VERIFY
  if (status === 401 && /consumer|isn'?t authorized|not authorized|authoriz|bearer|standalone/i.test(msg)) {
    return 'Magento refused the token. Check that the integration is active, and on Magento 2.4.4 or later set "Allow OAuth Access Tokens to be used as standalone Bearer tokens" to Yes (Stores › Configuration › Services › OAuth › Consumer Settings).';
  }
  if (status === 401 || status === 403) return 'Magento refused the token. Create a new integration token and paste it again.';
  if (status === 404) return 'The Magento REST API was not found at this address. Use the store\'s main address.';
  if (status >= 500) return `The store had an error (HTTP ${status}). We will try again.`;
  return `Magento refused the request (HTTP ${status})${msg ? `: ${msg.replace(/<[^>]*>/g, '').slice(0, 160)}` : '.'}`;
}

export type KeyDeps = { key: (connectionId: string) => Promise<string | null>; request?: typeof storeRequest; env?: NodeJS.ProcessEnv };

export class MagentoConnector implements Connector {
  readonly id = 'magento' as const;
  readonly name = 'Magento (Adobe Commerce)';
  constructor(private readonly deps: KeyDeps) {}

  missingEnv(): string[] {
    const env = this.deps.env ?? process.env;
    return [
      ...(tokenBoxConfigured(env) ? [] : ['CONNECTOR_TOKEN_KEY']),
      ...((env.CONNECTOR_MAGENTO ?? '').toLowerCase() === 'on' ? [] : ['CONNECTOR_MAGENTO']),
    ];
  }
  status(): ConnectorStatus { return this.missingEnv().length ? 'not_configured' : 'ready'; }
  detect(page: Parameters<Connector['detect']>[0]): string[] | null {
    const m = matchSignature(page);
    return m && m.platform === 'magento' ? m.evidence : null;
  }
  async startConnect(): Promise<StartConnectResult> {
    return { kind: 'form', fields: [{ key: 'store_url', label: 'Store address', secret: false }, { key: 'access_token', label: 'Integration access token', secret: true }] };
  }
  async finishConnect(): Promise<ConnectionRef> { throw new ConnectorError('NOT_SUPPORTED', 'Magento connects with a pasted token (Integrations).'); }

  private async raw(storeUrl: string, token: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<StoreResponse> {
    const m = this.missingEnv();
    if (m.length) throw new ConnectorError('NOT_CONFIGURED', `Magento is not switched on on this server yet (missing: ${m.join(', ')}).`);
    try {
      return await (this.deps.request ?? storeRequest)({
        method,
        url: `${storeUrl.replace(/\/+$/, '')}/rest/V1${path}`, // VERIFY /rest/V1 base path
        headers: { authorization: `Bearer ${token}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      if (e instanceof BlockedAddressError) throw new ConnectorError('PLATFORM_REFUSED', e.message);
      if (e instanceof StoreUnreachableError) throw new ConnectorError('UNREACHABLE', e.message);
      throw new ConnectorError('UNREACHABLE', 'The store could not be reached.');
    }
  }

  private async json<T>(storeUrl: string, token: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await this.raw(storeUrl, token, method, path, body);
    if (res.status === 401 || res.status === 403) throw new ConnectorError('AUTH_FAILED', magentoErrorMessage(res.status, res.body));
    if (res.status < 200 || res.status >= 300) throw new ConnectorError('PLATFORM_REFUSED', magentoErrorMessage(res.status, res.body));
    try { return JSON.parse(res.body) as T; }
    catch { throw new ConnectorError('PLATFORM_REFUSED', 'The store answered with something that is not Magento data.'); }
  }

  private async conn(conn: ConnectionRef) {
    if (!conn.storeUrl) throw new ConnectorError('INVALID_INPUT', 'The store address is missing. Connect Magento again.');
    const token = await this.deps.key(conn.id);
    if (!token) throw new ConnectorError('AUTH_FAILED', 'The Magento token is missing. Connect Magento again.');
    return { url: conn.storeUrl, token };
  }

  /** Tests a pasted token server-side before anything is stored (storeConfigs currency + order read permission). */
  async testKey(storeUrl: string, token: string): Promise<{ ok: boolean; message: string; currency: string | null }> {
    const cfg = await this.json<{ base_currency_code?: string; default_display_currency_code?: string }[]>(storeUrl, token, 'GET', '/store/storeConfigs'); // VERIFY
    if (!Array.isArray(cfg)) throw new ConnectorError('PLATFORM_REFUSED', 'The store answered with something that is not Magento data.');
    const cur = cleanStr(cfg[0]?.default_display_currency_code || cfg[0]?.base_currency_code).toUpperCase(); // VERIFY
    const currency = /^[A-Z]{3}$/.test(cur) ? cur : null;
    // The token must also read orders (what we pull every hour) — VERIFY
    await this.json(storeUrl, token, 'GET', `/orders?${magentoOrdersQuery(null, 1, 1)}`);
    return { ok: true, message: currency ? `Connected. Store currency ${currency}.` : 'Connected.', currency };
  }

  async testConnection(conn: ConnectionRef): Promise<TestResult> {
    const c = await this.conn(conn);
    const r = await this.testKey(c.url, c.token);
    return { ok: r.ok, message: r.message };
  }

  async pullOrders(conn: ConnectionRef, since: string | null): Promise<PullResult> {
    const c = await this.conn(conn);
    const orders: InternalOrder[] = [];
    for (let page = 1; page <= 4; page++) {
      const data = await this.json<{ items?: MgOrder[]; total_count?: number }>(c.url, c.token, 'GET', `/orders?${magentoOrdersQuery(since, page)}`); // VERIFY
      const items = Array.isArray(data.items) ? data.items : [];
      for (const o of items) {
        const r = magentoOrderToInternal(o);
        if (!('skip' in r) && r.lines.length) orders.push(r);
      }
      if (items.length < 50 || page * 50 >= Number(data.total_count ?? 0)) break;
    }
    return { orders, cursor: null, errors: [] };
  }

  /** Ships the order in Magento with our tracking number(s) and branded /t/ link (VERIFY POST /order/{id}/ship). */
  async sendTracking(conn: ConnectionRef, s: InternalShipment): Promise<{ ok: boolean; message?: string }> {
    if (!s.externalOrderId || !/^\d{1,20}$/.test(s.externalOrderId)) return { ok: false, message: 'This order has no Magento order id.' };
    const c = await this.conn(conn);
    const title = s.trackingCompany && s.trackingCompany !== 'Other' ? s.trackingCompany : 'Tracking';
    await this.json(c.url, c.token, 'POST', `/order/${s.externalOrderId}/ship`, { // VERIFY endpoint & body fields
      items: [], // VERIFY: empty array ships all unshipped items
      notify: true, // VERIFY
      ...(s.trackingUrl ? { appendComment: true, comment: { comment: `Track your order: ${s.trackingUrl}`, is_visible_on_front: 1 } } : {}), // VERIFY
      tracks: (s.trackingNumbers.length ? s.trackingNumbers : ['-']).slice(0, 10).map((n) => ({ track_number: n, title, carrier_code: 'custom' })), // VERIFY
    });
    return { ok: true };
  }

  async pushProduct(): Promise<PushResult> { throw new ConnectorError('NOT_BUILT', 'Pushing products to Magento comes later. Use the product file for now.'); }
  async syncStock(): Promise<{ ok: boolean; failed: string[] }> { throw new ConnectorError('NOT_BUILT', 'Stock sync to Magento comes later.'); }
  async syncPrice(): Promise<{ ok: boolean; failed: string[] }> { throw new ConnectorError('NOT_BUILT', 'Price sync to Magento comes later.'); }
  async disconnect(): Promise<void> { /* the merchant revokes the integration in Magento › System › Extensions › Integrations */ }
}
