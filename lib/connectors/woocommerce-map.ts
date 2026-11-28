/**
 * CONN S2 · WooCommerce formats (pure functions, no network calls; server code). Checked against the WooCommerce REST API v3 and the application
 * authentication endpoint (/wc-auth/v1/authorize) as documented by WooCommerce; items marked VERIFY are to be confirmed on the
 * owner's test store before go-live.
 *  - Connect: the merchant approves read_write on their OWN store; WooCommerce POSTs the generated keys to our callback with the
 *    user_id we sent (our single-use state), then sends the browser to return_url with success=1|0.
 *  - Webhooks: X-WC-Webhook-Signature = base64(HMAC-SHA256(raw body, webhook secret)); X-WC-Webhook-Topic / -Delivery-ID / -ID.
 *    When a webhook is created WooCommerce sends an unsigned ping whose body is "webhook_id=<n>" (VERIFY): answered 200, stored nowhere.
 *  - Orders: only "processing" / "completed" orders are taken (paid). "cancelled" / "refunded" / a deleted order → store cancellation.
 *    Lines are matched by SKU = our model number (DS-000000-00); other lines are counted, never stored. The customs value is the
 *    line total the buyer paid after discounts (line_items[].total, order currency, tax not included).
 */
import crypto from 'node:crypto';
import { decimalToMinor } from './formats';
import type { InternalOrder, InternalShipment, WebhookEvent } from './types';

export const WOO_API = '/wp-json/wc/v3';
export const WOO_TOPICS = ['order.created', 'order.updated', 'order.deleted'] as const;
const MODEL_NO = /^DS-\d{6}-\d{2}$/i;

/** Store base URL (https, no trailing slash; keeps a sub-folder install like https://example.com/shop). */
export const wooBase = (storeUrl: string) => storeUrl.replace(/\/+$/, '');

export function wooAuthorizeUrl(input: { storeUrl: string; appName: string; state: string; returnUrl: string; callbackUrl: string }): string {
  const q = new URLSearchParams({ app_name: input.appName, scope: 'read_write', user_id: input.state, return_url: input.returnUrl, callback_url: input.callbackUrl });
  return `${wooBase(input.storeUrl)}/wc-auth/v1/authorize?${q.toString()}`;
}

export type WooCallback = { keyId: string | null; state: string; consumerKey: string; consumerSecret: string; permissions: string };

/** The key callback body (JSON; form-encoded accepted too). Refuses anything that is not a read_write key pair. */
export function parseWooCallback(raw: string, contentType: string | null): WooCallback | { error: string } {
  let o: Record<string, unknown> = {};
  try {
    if ((contentType ?? '').includes('application/x-www-form-urlencoded')) o = Object.fromEntries(new URLSearchParams(raw));
    else o = JSON.parse(raw) as Record<string, unknown>;
  } catch { return { error: 'The body is not JSON.' }; }
  if (!o || typeof o !== 'object') return { error: 'The body is not JSON.' };
  const s = (k: string) => (typeof o[k] === 'string' || typeof o[k] === 'number' ? String(o[k]).trim() : '');
  const state = s('user_id');
  const ck = s('consumer_key');
  const cs = s('consumer_secret');
  const perm = s('key_permissions');
  if (!/^[0-9a-f]{64}$/.test(state)) return { error: 'Unknown connection request.' };
  if (!/^ck_[A-Za-z0-9]{20,64}$/.test(ck) || !/^cs_[A-Za-z0-9]{20,64}$/.test(cs)) return { error: 'The keys are not WooCommerce REST keys.' };
  if (perm !== 'read_write') return { error: 'Octopus needs read and write access.' };
  return { keyId: s('key_id') || null, state, consumerKey: ck, consumerSecret: cs, permissions: perm };
}

/** Constant-time check of X-WC-Webhook-Signature over the RAW body. */
export function verifyWooSignature(rawBody: string, header: string | undefined, secret: string): boolean {
  if (!header || !secret) return false;
  const want = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest();
  let got: Buffer;
  try { got = Buffer.from(header.trim(), 'base64'); } catch { return false; }
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/** WooCommerce's creation ping: unsigned, body "webhook_id=<n>". */
export const isWooPing = (rawBody: string, headers: Record<string, string>) => !headers['x-wc-webhook-signature'] && /^webhook_id=\d{1,12}$/.test(rawBody.trim());

export function wooWebhookMeta(headers: Record<string, string>, rawBody: string): { eventId: string | null; topic: string | null } {
  const delivery = headers['x-wc-webhook-delivery-id']?.trim();
  const hook = headers['x-wc-webhook-id']?.trim() ?? '';
  const eventId = delivery ? `${hook}:${delivery}`.slice(0, 200) : `${hook}:${crypto.createHash('sha256').update(rawBody).digest('hex').slice(0, 40)}`;
  const topic = headers['x-wc-webhook-topic']?.trim().slice(0, 120) || null;
  return { eventId, topic };
}

type WooAddress = { first_name?: string; last_name?: string; company?: string; address_1?: string; address_2?: string; city?: string; state?: string; postcode?: string; country?: string; phone?: string; email?: string };
type WooLine = { id?: number; name?: string; sku?: string | null; quantity?: number; subtotal?: string; total?: string; variation_id?: number; product_id?: number; meta_data?: { key?: string; display_key?: string; display_value?: unknown }[] };
export type WooOrder = {
  id?: number; number?: string; status?: string; currency?: string; billing?: WooAddress; shipping?: WooAddress; line_items?: WooLine[];
  shipping_lines?: { method_title?: string }[]; customer_note?: string;
};

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const fullName = (a?: WooAddress) => [str(a?.first_name), str(a?.last_name)].filter(Boolean).join(' ') || null;

/** A paid WooCommerce order → our internal order; null for orders we must not take (not paid yet, no address). */
export function wooOrderToInternal(o: WooOrder): InternalOrder | { skip: string } {
  const status = str(o.status);
  if (!['processing', 'completed'].includes(status)) return { skip: `order status ${status || 'unknown'} (only paid orders are taken)` };
  if (!o.id) return { skip: 'order without id' };
  const currency = str(o.currency).toUpperCase() || 'USD';
  const ship = o.shipping && str(o.shipping.address_1) ? o.shipping : o.billing;
  const country = str(ship?.country).toUpperCase();
  let other = 0;
  const lines: InternalOrder['lines'] = [];
  for (const l of o.line_items ?? []) {
    const qty = Math.max(0, Math.trunc(Number(l.quantity ?? 0)));
    if (!qty) continue;
    const sku = str(l.sku);
    // CONN S2b: a product we pushed is matched by its WooCommerce id even when the merchant changed the SKU
    const ref = Number(l.variation_id ?? 0) > 0 ? `woocommerce:variation:${l.variation_id}` : Number(l.product_id ?? 0) > 0 ? `woocommerce:product:${l.product_id}` : null;
    if (!MODEL_NO.test(sku) && !ref) { other += qty; continue; }
    const paid = decimalToMinor(l.total ?? null, currency);
    const sub = decimalToMinor(l.subtotal ?? null, currency);
    const label = (l.meta_data ?? []).filter((m) => m.display_key && typeof m.display_value === 'string' && !String(m.key ?? '').startsWith('_'))
      .map((m) => `${m.display_key}: ${m.display_value as string}`).join(' / ') || null;
    lines.push({
      modelNo: MODEL_NO.test(sku) ? sku.toUpperCase() : null, storeVariantRef: ref, qty, buyerPaidMinor: paid, buyerUnitPriceMinor: sub == null ? null : Math.round(sub / qty),
      variantLabel: label ? label.slice(0, 120) : null, title: str(l.name).slice(0, 200) || null, externalLineId: l.id ? String(l.id) : null,
    });
  }
  return {
    externalOrderId: String(o.id),
    externalOrderName: str(o.number) ? `#${str(o.number)}` : `#${o.id}`,
    currency,
    fxRateToUsd: null,
    buyerName: fullName(o.shipping) ?? fullName(o.billing),
    buyerPhone: str(o.shipping?.phone) || str(o.billing?.phone) || null,
    address: {
      name: fullName(ship), phone: str(ship?.phone) || str(o.billing?.phone) || null, line1: str(ship?.address_1) || null, line2: str(ship?.address_2) || null,
      city: str(ship?.city) || null, region: str(ship?.state) || null, postcode: str(ship?.postcode) || null, country,
    },
    shippingMethod: null,
    lines,
    otherItems: other,
    risk: 'unknown',
  };
}

/** A verified webhook → what the runtime does. */
export function wooWebhookEvent(topic: string | null, payload: unknown): WebhookEvent {
  const o = (payload && typeof payload === 'object' ? payload : {}) as WooOrder;
  if (topic === 'order.deleted') return o.id ? { kind: 'order_cancelled', externalOrderId: String(o.id) } : { kind: 'ignored', reason: 'deleted order without id' };
  if (topic !== 'order.created' && topic !== 'order.updated') return { kind: 'ignored', reason: `topic ${topic ?? 'none'}` };
  const status = str(o.status);
  if ((status === 'cancelled' || status === 'refunded') && o.id) return { kind: 'order_cancelled', externalOrderId: String(o.id) };
  const r = wooOrderToInternal(o);
  if ('skip' in r) return { kind: 'ignored', reason: r.skip };
  if (!r.lines.length) return { kind: 'ignored', reason: 'no Octopus products in this order' };
  return { kind: 'order', order: r };
}

/** The customer-facing order note with the tracking (the buyer gets it by e-mail from the merchant's store). */
export function wooTrackingNote(s: InternalShipment): string {
  const parts = ['Your order is on its way.'];
  if (s.trackingNumbers.length) parts.push(`Tracking number${s.trackingNumbers.length > 1 ? 's' : ''}: ${s.trackingNumbers.join(', ')}${s.trackingCompany && s.trackingCompany !== 'Other' ? ` (${s.trackingCompany})` : ''}.`);
  if (s.trackingUrl) parts.push(`Track it here: ${s.trackingUrl}`);
  return parts.join(' ');
}

/** WooCommerce REST errors in merchant words (never the raw body). */
export function wooErrorMessage(status: number, body: string): string {
  let code = '';
  try { code = String((JSON.parse(body) as { code?: string }).code ?? ''); } catch { /* not JSON */ }
  if (status === 401 || status === 403) return 'The store refused our keys. Reconnect WooCommerce.';
  if (status === 404 && /rest_no_route/.test(code)) return 'The WooCommerce REST API was not found. Check that WooCommerce is active and permalinks are not "Plain".';
  if (status === 404) return 'Not found in the store.';
  if (status === 429) return 'The store is busy. We will try again.';
  if (status >= 500) return `The store had an error (HTTP ${status}). We will try again.`;
  let detail = '';
  try { detail = String((JSON.parse(body) as { message?: string }).message ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 160); } catch { /* not JSON */ }
  return `The store refused the request (HTTP ${status}${code ? `, ${code.slice(0, 60)}` : ''})${detail ? `: ${detail}` : '.'}`;
}
