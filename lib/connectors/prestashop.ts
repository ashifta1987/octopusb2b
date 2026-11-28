import 'server-only';
import { tokenBoxConfigured } from '@/lib/crypto/token-box';
import { BlockedAddressError } from './detect';
import { storeRequest, StoreUnreachableError, type StoreResponse } from './http';
import { cleanStr, MODEL_NO, storeAmountToMinor, utcSqlTime } from './key-common';
import type { KeyDeps } from './magento';
import { matchSignature } from './signatures';
import {
  ConnectorError, type Connector, type ConnectorStatus, type ConnectionRef, type InternalOrder, type InternalShipment, type PullResult, type PushResult,
  type StartConnectResult, type TestResult,
} from './types';

/**
 * CONN S3 · PrestaShop (1.7 / 8) with a Webservice key created by the merchant in admin (Advanced Parameters › Webservice ›
 * Enable PrestaShop's webservice, Add new webservice key; permissions GET on orders, addresses, countries, currencies, configurations,
 * order_carriers, and PUT on order_carriers). Webservice under <store>/api with HTTP Basic auth "<key>:" and output_format=JSON.
 *
 * VERIFY every API endpoint, parameter, field and XML element on the owner's test store before go-live (no official PrestaShop
 * docs are in docs/):
 *  - Reads: output_format=JSON on /configurations, /currencies/{id}, /orders, /addresses/{id}, /countries/{id}, /order_carriers.
 *    Empty PrestaShop collections with output_format=JSON may return [] instead of { <resource>: [] } — handled safely.
 *  - "valid" = 1 means paid / accepted (order state ids differ per shop, so state ids are not hard-coded) — VERIFY.
 *  - Order fields (VERIFY): id, reference, valid, id_address_delivery, id_currency, associations.order_rows[]
 *    (id, product_reference, product_quantity, unit_price_tax_excl, product_name).
 *  - Line value: unit_price_tax_excl × quantity (order-level cart discounts are not spread across lines; rounded half-up from
 *    PrestaShop's 6-decimal precision to the currency exponent) — VERIFY.
 *  - Tracking write (VERIFY): GET /order_carriers?filter[id_order]=[{id}]&display=full then PUT /order_carriers/{id} with XML
 *    <prestashop><order_carrier>...<tracking_number>...</tracking_number></order_carrier></prestashop>.
 *  - Orders come from the hourly catch-up pull (S1). Push / stock / price: NOT_BUILT.
 */
type PsRow = { product_reference?: string; product_quantity?: string | number; unit_price_tax_excl?: string; product_name?: string; id?: string | number }; // VERIFY
export type PsOrder = { id?: number | string; reference?: string; valid?: string | number; id_address_delivery?: string | number; id_currency?: string | number; associations?: { order_rows?: PsRow[] } }; // VERIFY
export type PsAddress = { firstname?: string; lastname?: string; address1?: string; address2?: string; postcode?: string; city?: string; id_country?: string | number; phone?: string; phone_mobile?: string; id_state?: string | number }; // VERIFY

export function prestashopOrderToInternal(o: PsOrder, address: PsAddress | null, countryIso: string | null, currency: string | null): InternalOrder | { skip: string } {
  if (cleanStr(o.valid) !== '1') return { skip: 'order not valid (not paid yet)' }; // VERIFY valid=1
  if (!o.id) return { skip: 'order without id' };
  const cur = (currency ?? 'USD').toUpperCase();
  let other = 0;
  const lines: InternalOrder['lines'] = [];
  const rows = Array.isArray(o.associations?.order_rows) ? o.associations.order_rows : []; // VERIFY associations.order_rows
  for (const r of rows) {
    const qty = Math.max(0, Math.trunc(Number(r.product_quantity ?? 0))); // VERIFY product_quantity
    if (!qty) continue;
    const sku = cleanStr(r.product_reference); // VERIFY product_reference
    if (!MODEL_NO.test(sku)) { other += qty; continue; }
    const unit = storeAmountToMinor(r.unit_price_tax_excl ?? null, cur); // VERIFY unit_price_tax_excl
    lines.push({
      modelNo: sku.toUpperCase(),
      qty,
      buyerUnitPriceMinor: unit,
      buyerPaidMinor: unit == null ? null : unit * qty,
      title: cleanStr(r.product_name).slice(0, 200) || null, // VERIFY product_name
      externalLineId: r.id ? String(r.id) : null, // VERIFY row id
    });
  }
  const name = [cleanStr(address?.firstname), cleanStr(address?.lastname)].filter(Boolean).join(' ') || null;
  const phone = cleanStr(address?.phone_mobile) || cleanStr(address?.phone) || null; // VERIFY phone_mobile / phone
  return {
    externalOrderId: String(o.id),
    externalOrderName: cleanStr(o.reference) || `#${o.id}`, // VERIFY reference
    currency: cur,
    fxRateToUsd: null,
    buyerName: name,
    buyerPhone: phone,
    address: {
      name,
      phone,
      line1: cleanStr(address?.address1) || null, // VERIFY address1
      line2: cleanStr(address?.address2) || null, // VERIFY address2
      city: cleanStr(address?.city) || null,
      region: null,
      postcode: cleanStr(address?.postcode) || null,
      country: (countryIso ?? '').toUpperCase(),
    },
    shippingMethod: null,
    lines,
    otherItems: other,
    risk: 'unknown',
  };
}

/** Sanitises text for a CDATA section: strips control chars and splits any "]]>" sequence. */
const cdataSafe = (s: string) => s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').replace(/\]\]>/g, ']]]]><![CDATA[>');

/** The order_carrier PUT XML body: existing carrier fields + our tracking number — VERIFY XML fields on test store. */
export function orderCarrierXml(oc: Record<string, unknown>, trackingNumber: string): string {
  const keep = ['id', 'id_order', 'id_carrier', 'id_order_invoice', 'weight', 'shipping_cost_tax_excl', 'shipping_cost_tax_incl']; // VERIFY
  const fields = keep
    .filter((k) => oc[k] != null && oc[k] !== '')
    .map((k) => `<${k}><![CDATA[${cdataSafe(String(oc[k]))}]]></${k}>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><prestashop xmlns:xlink="http://www.w3.org/1999/xlink"><order_carrier>${fields}<tracking_number><![CDATA[${cdataSafe(trackingNumber.trim().slice(0, 64))}]]></tracking_number></order_carrier></prestashop>`; // VERIFY tracking_number
}

export function prestashopErrorMessage(status: number): string {
  if (status === 401) return 'PrestaShop refused the key. Check that the webservice is on and the key is active.';
  if (status === 403) return 'The PrestaShop key is missing a permission (orders, addresses, countries, currencies, configurations, order_carriers).';
  if (status === 404) return 'The PrestaShop webservice was not found at this address. Use the shop\'s main address and turn on the webservice.';
  if (status >= 500) return `The store had an error (HTTP ${status}). We will try again.`;
  return `PrestaShop refused the request (HTTP ${status}).`;
}

const isPositiveIntId = (v: string) => /^\d{1,20}$/.test(v) && v !== '0';

export class PrestaShopConnector implements Connector {
  readonly id = 'prestashop' as const;
  readonly name = 'PrestaShop';
  constructor(private readonly deps: KeyDeps) {}

  missingEnv(): string[] {
    const env = this.deps.env ?? process.env;
    return [
      ...(tokenBoxConfigured(env) ? [] : ['CONNECTOR_TOKEN_KEY']),
      ...((env.CONNECTOR_PRESTASHOP ?? '').toLowerCase() === 'on' ? [] : ['CONNECTOR_PRESTASHOP']),
    ];
  }
  status(): ConnectorStatus { return this.missingEnv().length ? 'not_configured' : 'ready'; }
  detect(page: Parameters<Connector['detect']>[0]): string[] | null {
    const m = matchSignature(page);
    return m && m.platform === 'prestashop' ? m.evidence : null;
  }
  async startConnect(): Promise<StartConnectResult> {
    return { kind: 'form', fields: [{ key: 'store_url', label: 'Shop address', secret: false }, { key: 'api_key', label: 'Webservice key', secret: true }] };
  }
  async finishConnect(): Promise<ConnectionRef> { throw new ConnectorError('NOT_SUPPORTED', 'PrestaShop connects with a pasted key (Integrations).'); }

  private async raw(storeUrl: string, key: string, method: 'GET' | 'PUT', path: string, xml?: string): Promise<StoreResponse> {
    const m = this.missingEnv();
    if (m.length) throw new ConnectorError('NOT_CONFIGURED', `PrestaShop is not switched on on this server yet (missing: ${m.join(', ')}).`);
    const sep = path.includes('?') ? '&' : '?';
    try {
      return await (this.deps.request ?? storeRequest)({
        method,
        url: `${storeUrl.replace(/\/+$/, '')}/api${path}${method === 'GET' ? `${sep}output_format=JSON` : ''}`, // VERIFY /api + output_format=JSON
        headers: {
          authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`,
          ...(xml ? { 'content-type': 'application/xml' } : {}),
        },
        body: xml,
      });
    } catch (e) {
      if (e instanceof BlockedAddressError) throw new ConnectorError('PLATFORM_REFUSED', e.message);
      if (e instanceof StoreUnreachableError) throw new ConnectorError('UNREACHABLE', e.message);
      throw new ConnectorError('UNREACHABLE', 'The store could not be reached.');
    }
  }

  private async get<T>(storeUrl: string, key: string, path: string): Promise<T> {
    const res = await this.raw(storeUrl, key, 'GET', path);
    if (res.status === 401 || res.status === 403) throw new ConnectorError('AUTH_FAILED', prestashopErrorMessage(res.status));
    if (res.status < 200 || res.status >= 300) throw new ConnectorError('PLATFORM_REFUSED', prestashopErrorMessage(res.status));
    try { return JSON.parse(res.body || '{}') as T; }
    catch { throw new ConnectorError('PLATFORM_REFUSED', 'The shop answered with something that is not PrestaShop data.'); }
  }

  private async conn(conn: ConnectionRef) {
    if (!conn.storeUrl) throw new ConnectorError('INVALID_INPUT', 'The shop address is missing. Connect PrestaShop again.');
    const key = await this.deps.key(conn.id);
    if (!key) throw new ConnectorError('AUTH_FAILED', 'The PrestaShop key is missing. Connect PrestaShop again.');
    return { url: conn.storeUrl, key };
  }

  /** Tests a pasted Webservice key server-side before anything is stored (currency + orders + order_carriers permissions). */
  async testKey(storeUrl: string, key: string): Promise<{ ok: boolean; message: string; currency: string | null }> {
    const cfg = await this.get<{ configurations?: { value?: string }[] } | unknown[]>(
      storeUrl, key, '/configurations?filter[name]=[PS_CURRENCY_DEFAULT]&display=[value]', // VERIFY
    );
    const curId = !Array.isArray(cfg) ? cleanStr(cfg.configurations?.[0]?.value) : '';
    let currency: string | null = null;
    if (isPositiveIntId(curId)) {
      const c = await this.get<{ currency?: { iso_code?: string } }>(storeUrl, key, `/currencies/${curId}`); // VERIFY
      const iso = cleanStr(c.currency?.iso_code).toUpperCase(); // VERIFY iso_code
      currency = /^[A-Z]{3}$/.test(iso) ? iso : null;
    }
    await this.get(storeUrl, key, '/orders?display=[id]&limit=1'); // VERIFY
    await this.get(storeUrl, key, '/order_carriers?display=[id]&limit=1'); // VERIFY
    return { ok: true, message: currency ? `Connected. Shop currency ${currency}.` : 'Connected.', currency };
  }

  async testConnection(conn: ConnectionRef): Promise<TestResult> {
    const c = await this.conn(conn);
    const r = await this.testKey(c.url, c.key);
    return { ok: r.ok, message: r.message };
  }

  async pullOrders(conn: ConnectionRef, since: string | null): Promise<PullResult> {
    const c = await this.conn(conn);
    const from = utcSqlTime(since ?? new Date(Date.now() - 3 * 86400_000).toISOString());
    const to = utcSqlTime(new Date(Date.now() + 60_000).toISOString());
    const data = await this.get<{ orders?: PsOrder[] } | unknown[]>(
      c.url, c.key,
      `/orders?display=full&date=1&filter[valid]=[1]&filter[date_upd]=[${encodeURIComponent(from)},${encodeURIComponent(to)}]&sort=[date_upd_ASC]&limit=0,100`, // VERIFY
    );
    const list = !Array.isArray(data) && Array.isArray(data.orders) ? data.orders : [];
    const orders: InternalOrder[] = [];
    const errors: { ref: string; message: string }[] = [];
    const addrCache = new Map<string, PsAddress | null>();
    const countryCache = new Map<string, string | null>();
    const curCache = new Map<string, string | null>();

    for (const o of list) {
      try {
        const rows = Array.isArray(o.associations?.order_rows) ? o.associations.order_rows : [];
        if (!rows.some((r) => MODEL_NO.test(cleanStr(r.product_reference)))) continue;
        const aid = cleanStr(o.id_address_delivery); // VERIFY id_address_delivery
        if (isPositiveIntId(aid) && !addrCache.has(aid)) {
          addrCache.set(aid, (await this.get<{ address?: PsAddress }>(c.url, c.key, `/addresses/${aid}`)).address ?? null); // VERIFY
        }
        const addr = isPositiveIntId(aid) ? (addrCache.get(aid) ?? null) : null;
        const cid = cleanStr(addr?.id_country); // VERIFY id_country
        if (isPositiveIntId(cid) && !countryCache.has(cid)) {
          countryCache.set(cid, cleanStr((await this.get<{ country?: { iso_code?: string } }>(c.url, c.key, `/countries/${cid}`)).country?.iso_code) || null); // VERIFY
        }
        const curId = cleanStr(o.id_currency); // VERIFY id_currency
        if (isPositiveIntId(curId) && !curCache.has(curId)) {
          curCache.set(curId, cleanStr((await this.get<{ currency?: { iso_code?: string } }>(c.url, c.key, `/currencies/${curId}`)).currency?.iso_code) || null); // VERIFY
        }
        const r = prestashopOrderToInternal(o, addr, countryCache.get(cid) ?? null, curCache.get(curId) ?? null);
        if (!('skip' in r) && r.lines.length) orders.push(r);
      } catch (e) {
        if (e instanceof ConnectorError && e.code === 'AUTH_FAILED') throw e;
        errors.push({ ref: cleanStr(o.reference) || cleanStr(o.id), message: e instanceof Error ? e.message : 'could not be read' });
      }
    }
    return { orders, cursor: null, errors };
  }

  /** Writes our tracking number onto the order's order_carrier row via XML PUT (VERIFY /order_carriers). */
  async sendTracking(conn: ConnectionRef, s: InternalShipment): Promise<{ ok: boolean; message?: string }> {
    if (!s.externalOrderId || !isPositiveIntId(s.externalOrderId)) return { ok: false, message: 'This order has no PrestaShop order id.' };
    if (!s.trackingNumbers.length) return { ok: false, message: 'No tracking number yet.' };
    const c = await this.conn(conn);
    const list = await this.get<{ order_carriers?: Record<string, unknown>[] } | unknown[]>(
      c.url, c.key, `/order_carriers?filter[id_order]=[${s.externalOrderId}]&display=full`, // VERIFY
    );
    const oc = !Array.isArray(list) ? list.order_carriers?.[0] : undefined;
    const ocId = cleanStr(oc?.id);
    if (!oc || !isPositiveIntId(ocId)) return { ok: false, message: 'The order has no carrier line in PrestaShop.' };
    const res = await this.raw(c.url, c.key, 'PUT', `/order_carriers/${ocId}`, orderCarrierXml(oc, s.trackingNumbers[0])); // VERIFY
    if (res.status === 401 || res.status === 403) throw new ConnectorError('AUTH_FAILED', prestashopErrorMessage(res.status));
    if (res.status < 200 || res.status >= 300) return { ok: false, message: prestashopErrorMessage(res.status) };
    return {
      ok: true,
      message: s.trackingNumbers.length > 1 ? 'PrestaShop keeps one tracking number per order; the first was sent.' : undefined,
    };
  }

  async pushProduct(): Promise<PushResult> { throw new ConnectorError('NOT_BUILT', 'Pushing products to PrestaShop comes later. Use the product file for now.'); }
  async syncStock(): Promise<{ ok: boolean; failed: string[] }> { throw new ConnectorError('NOT_BUILT', 'Stock sync to PrestaShop comes later.'); }
  async syncPrice(): Promise<{ ok: boolean; failed: string[] }> { throw new ConnectorError('NOT_BUILT', 'Price sync to PrestaShop comes later.'); }
  async disconnect(): Promise<void> { /* the merchant deletes the webservice key in PrestaShop › Advanced Parameters › Webservice */ }
}
