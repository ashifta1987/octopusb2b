import 'server-only';
import { tokenBoxConfigured } from '@/lib/crypto/token-box';
import { matchSignature } from './signatures';
import { storeRequest, StoreUnreachableError, type StoreResponse } from './http';
import { BlockedAddressError } from './detect';
import {
  WOO_API, WOO_TOPICS, isWooPing, verifyWooSignature, wooBase, wooErrorMessage, wooOrderToInternal, wooTrackingNote, wooWebhookEvent, wooWebhookMeta,
  type WooOrder,
} from './woocommerce-map';
import {
  ConnectorError, type Connector, type ConnectorStatus, type ConnectionRef, type InternalOrder, type InternalShipment, type PullResult, type PushResult,
  type StartConnectResult, type TestResult,
} from './types';

/**
 * CONN S2 · WooCommerce connector (REST API v3 with the merchant-approved read_write key pair; no developer account needed).
 * Keys are read from store_credentials only inside this server module and sent only to the store's own https address through the
 * SSRF-guarded client (lib/connectors/http.ts). Switched on by the owner with CONNECTOR_WOOCOMMERCE=on (after the key callback and
 * webhook paths are reachable from merchants' servers) and CONNECTOR_TOKEN_KEY.
 * Product push / stock / price sync run through the push queue (CONN S2b); here they refuse with NOT_BUILT.
 */
export type WooKeys = { consumerKey: string; consumerSecret: string };
export type WooDeps = {
  keys: (connectionId: string) => Promise<WooKeys | null>;
  request?: typeof storeRequest;
  env?: NodeJS.ProcessEnv;
};

const MAX_PULL_PAGES = 4;

/** A REST answer outside 2xx (status kept so the push runner can tell "fix the product" from "try again"). */
export class WooApiError extends ConnectorError {
  constructor(readonly status: number, message: string) {
    super(status === 401 || status === 403 ? 'AUTH_FAILED' : status === 404 ? 'INVALID_INPUT' : 'PLATFORM_REFUSED', message);
    this.name = 'WooApiError';
  }
}
export type StockItem = { productGid: string; variantGid: string; status: 'instock' | 'outofstock' };
const WOO_GID = { product: /^woocommerce:product:(\d{1,20})$/, variation: /^woocommerce:variation:(\d{1,20})$/ };
const wooId = (gid: string | null | undefined, kind: 'product' | 'variation') => WOO_GID[kind].exec(gid ?? '')?.[1] ?? null;
export { wooId };

export class WooCommerceConnector implements Connector {
  readonly id = 'woocommerce' as const;
  readonly name = 'WooCommerce';
  constructor(private readonly deps: WooDeps) {}

  missingEnv(): string[] {
    const env = this.deps.env ?? process.env;
    const m: string[] = [];
    if (!tokenBoxConfigured(env)) m.push('CONNECTOR_TOKEN_KEY');
    if ((env.CONNECTOR_WOOCOMMERCE ?? '').toLowerCase() !== 'on') m.push('CONNECTOR_WOOCOMMERCE');
    return m;
  }
  status(): ConnectorStatus { return this.missingEnv().length ? 'not_configured' : 'ready'; }
  private ensureReady() {
    const m = this.missingEnv();
    if (m.length) throw new ConnectorError('NOT_CONFIGURED', `WooCommerce is not switched on on this server yet (missing: ${m.join(', ')}).`);
  }

  detect(page: Parameters<Connector['detect']>[0]): string[] | null {
    const m = matchSignature(page);
    return m && m.platform === 'woocommerce' ? m.evidence : null;
  }

  /** the redirect itself is built by the connect action (it needs the single-use state from the database) */
  async startConnect(): Promise<StartConnectResult> { throw new ConnectorError('NOT_SUPPORTED', 'Start the WooCommerce connection from Integrations.'); }
  async finishConnect(): Promise<ConnectionRef> { throw new ConnectorError('NOT_SUPPORTED', 'WooCommerce sends the keys to the key callback.'); }

  /** One REST call with the connection's keys (Basic auth over https; query-string keys once when the host strips Authorization). */
  async api(conn: ConnectionRef, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<StoreResponse> {
    this.ensureReady();
    if (!conn.storeUrl) throw new ConnectorError('INVALID_INPUT', 'The store address is missing. Reconnect WooCommerce.');
    const keys = await this.deps.keys(conn.id);
    if (!keys) throw new ConnectorError('AUTH_FAILED', 'The store keys are missing. Reconnect WooCommerce.');
    const req = this.deps.request ?? storeRequest;
    const url = `${wooBase(conn.storeUrl)}${WOO_API}${path}`;
    const payload = body === undefined ? undefined : JSON.stringify(body);
    try {
      const basic = `Basic ${Buffer.from(`${keys.consumerKey}:${keys.consumerSecret}`).toString('base64')}`;
      let res = await req({ method, url, headers: { authorization: basic }, body: payload });
      if (res.status === 401) {
        const u = new URL(url);
        u.searchParams.set('consumer_key', keys.consumerKey);
        u.searchParams.set('consumer_secret', keys.consumerSecret);
        res = await req({ method, url: u.toString(), body: payload });
      }
      if (res.status === 401 || res.status === 403) throw new ConnectorError('AUTH_FAILED', wooErrorMessage(res.status, res.body));
      return res;
    } catch (e) {
      if (e instanceof ConnectorError) throw e;
      if (e instanceof BlockedAddressError) throw new ConnectorError('PLATFORM_REFUSED', e.message);
      if (e instanceof StoreUnreachableError) throw new ConnectorError('UNREACHABLE', e.message);
      throw new ConnectorError('UNREACHABLE', 'The store could not be reached.');
    }
  }

  async json<T>(conn: ConnectionRef, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<{ data: T; headers: Record<string, string> }> {
    const res = await this.api(conn, method, path, body);
    if (res.status < 200 || res.status >= 300) throw new WooApiError(res.status, wooErrorMessage(res.status, res.body));
    try { return { data: JSON.parse(res.body) as T, headers: res.headers }; }
    catch { throw new ConnectorError('PLATFORM_REFUSED', 'The store answered with something that is not WooCommerce data.'); }
  }

  async testConnection(conn: ConnectionRef): Promise<TestResult & { currency: string | null }> {
    const { data } = await this.json<{ value?: string }>(conn, 'GET', '/settings/general/woocommerce_currency');
    const currency = typeof data.value === 'string' && /^[A-Z]{3}$/.test(data.value) ? data.value : null;
    return { ok: true, message: currency ? `Connected. Store currency ${currency}.` : 'Connected.', scopes: ['read_write'], currency };
  }

  async pullOrders(conn: ConnectionRef, since: string | null): Promise<PullResult> {
    const orders: InternalOrder[] = [];
    const errors: { ref: string; message: string }[] = [];
    for (let page = 1; page <= MAX_PULL_PAGES; page++) {
      const q = new URLSearchParams({ status: 'processing', per_page: '50', page: String(page), orderby: 'date', order: 'asc', dates_are_gmt: 'true' });
      if (since) q.set('modified_after', since);
      const { data, headers } = await this.json<WooOrder[]>(conn, 'GET', `/orders?${q.toString()}`);
      for (const o of Array.isArray(data) ? data : []) {
        const r = wooOrderToInternal(o);
        if ('skip' in r) continue;
        if (!r.lines.length) continue;
        orders.push(r);
      }
      const pages = Number(headers['x-wp-totalpages'] ?? '1');
      if (!Array.isArray(data) || data.length < 50 || page >= pages) break;
    }
    return { orders, cursor: null, errors };
  }

  /** Customer-facing order note with the tracking number(s) and our branded /t/ link, then the order is marked completed. */
  async sendTracking(conn: ConnectionRef, s: InternalShipment): Promise<{ ok: boolean; message?: string }> {
    if (!s.externalOrderId || !/^\d{1,20}$/.test(s.externalOrderId)) return { ok: false, message: 'This order has no WooCommerce order id.' };
    await this.json(conn, 'POST', `/orders/${s.externalOrderId}/notes`, { note: wooTrackingNote(s), customer_note: true });
    // the note is the part that matters (a retry would repeat it); completing the order is best effort
    try { await this.json(conn, 'PUT', `/orders/${s.externalOrderId}`, { status: 'completed' }); }
    catch (e) { if (e instanceof ConnectorError && e.code === 'AUTH_FAILED') throw e; return { ok: true, message: 'Tracking sent; the order could not be marked completed.' }; }
    return { ok: true };
  }

  async registerWebhooks(conn: ConnectionRef, deliveryUrl: string, secret: string): Promise<string[]> {
    const ids: string[] = [];
    for (const topic of WOO_TOPICS) {
      const { data } = await this.json<{ id?: number }>(conn, 'POST', '/webhooks', { name: `Octopus ${topic}`, topic, delivery_url: deliveryUrl, secret, status: 'active' });
      if (data.id) ids.push(String(data.id));
    }
    return ids;
  }

  async deleteWebhooks(conn: ConnectionRef, ids: string[]): Promise<number> {
    let gone = 0;
    for (const id of ids.filter((x) => /^\d{1,20}$/.test(x))) {
      try { const r = await this.api(conn, 'DELETE', `/webhooks/${id}?force=true`); if (r.status < 300 || r.status === 404) gone++; } catch { /* best effort */ }
    }
    return gone;
  }

  /** CONN S2b: products go out through the push queue (lib/connectors/woocommerce-push.ts), never one by one from here. */
  async pushProduct(): Promise<PushResult> { throw new ConnectorError('NOT_SUPPORTED', 'Products go to WooCommerce through Push to store.'); }
  async syncStock(): Promise<{ ok: boolean; failed: string[] }> { throw new ConnectorError('NOT_SUPPORTED', 'Stock follows Octopus automatically (setStockStatus).'); }
  /** prices change by re-pushing the product (the pricing engine re-pushes approved prices) */
  async syncPrice(): Promise<{ ok: boolean; failed: string[] }> { throw new ConnectorError('NOT_SUPPORTED', 'Prices go out with Push / Re-push.'); }

  /**
   * CONN S2b: stock as WooCommerce "in stock / out of stock" (we never manage quantities in the merchant's store). Simple products
   * are updated on the product, variations in one batch per product. Answers per item; an auth refusal stops the whole call.
   */
  async setStockStatus(conn: ConnectionRef, items: StockItem[]): Promise<{ item: StockItem; ok: boolean; error?: string }[]> {
    const out: { item: StockItem; ok: boolean; error?: string }[] = [];
    const byProduct = new Map<string, StockItem[]>();
    for (const it of items) { const pid = wooId(it.productGid, 'product'); if (!pid) { out.push({ item: it, ok: false, error: 'Not a WooCommerce product.' }); continue; } byProduct.set(pid, [...(byProduct.get(pid) ?? []), it]); }
    for (const [pid, list] of byProduct) {
      const variations = list.filter((x) => wooId(x.variantGid, 'variation'));
      const simple = list.filter((x) => !wooId(x.variantGid, 'variation'));
      try {
        if (simple.length) {
          await this.json(conn, 'PUT', `/products/${pid}`, { manage_stock: false, stock_status: simple[simple.length - 1].status });
          for (const it of simple) out.push({ item: it, ok: true });
        }
        if (variations.length) {
          const { data } = await this.json<{ update?: { id?: number; error?: { message?: string } }[] }>(conn, 'POST', `/products/${pid}/variations/batch`,
            { update: variations.map((x) => ({ id: Number(wooId(x.variantGid, 'variation')), manage_stock: false, stock_status: x.status })) });
          variations.forEach((it, i) => {
            const r = data.update?.[i];
            out.push(r && !r.error ? { item: it, ok: true } : { item: it, ok: false, error: (r?.error?.message ?? 'The store did not accept the stock update.').slice(0, 200) });
          });
        }
      } catch (e) {
        if (e instanceof ConnectorError && e.code === 'AUTH_FAILED') throw e;
        const msg = e instanceof Error ? e.message : 'The store did not accept the stock update.';
        for (const it of list) if (!out.some((o) => o.item === it)) out.push({ item: it, ok: false, error: msg.slice(0, 200) });
      }
    }
    return out;
  }
  async disconnect(): Promise<void> { /* webhooks are removed by the disconnect action before the keys are wiped; the merchant revokes the key in WooCommerce › Settings › Advanced › REST API */ }

  verifyWebhook(input: { headers: Record<string, string>; rawBody: string; secret: string }): boolean {
    return verifyWooSignature(input.rawBody, input.headers['x-wc-webhook-signature'], input.secret);
  }
  isPing(input: { headers: Record<string, string>; rawBody: string }): boolean { return isWooPing(input.rawBody, input.headers); }
  webhookMeta(input: { headers: Record<string, string>; rawBody: string }) { return wooWebhookMeta(input.headers, input.rawBody); }
  webhookEvent(input: { topic: string | null; payload: unknown }) { return wooWebhookEvent(input.topic, input.payload); }
}
