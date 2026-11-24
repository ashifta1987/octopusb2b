import 'server-only';
import crypto from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/server';
import { logEmailDelivery, logIntegration, outboundTraceHeaders, traceAdapter } from './traced';

/* Adapter interfaces (SPEC §7). Business code depends only on these; providers are swappable. */

export type RateRequest = { fromCountry: string; toCountry: string; weightKg: number; parcels: number };
export type RateQuote = { carrier: string; service: string; priceCents: number; days: string };
export type ShipmentRequest = { orderCode: string; toCountry: string; toCity?: string; weightKg: number; parcels: number; service: string };
export type ShipmentResult = { trackingNo: string; labelUrl: string };
export type TrackingEvent = { providerEventId: string; trackingNo: string; status: string; description: string; location?: string; occurredAt: string };

export interface CarrierAdapter {
  readonly code: string;
  readonly mode: 'sandbox' | 'live';
  priceTrial(input: RateRequest): Promise<RateQuote[]>;
  createShipment(input: ShipmentRequest): Promise<ShipmentResult>;
  getLabel(trackingNo: string): Promise<string>;
  cancel(trackingNo: string): Promise<void>;
  subscribeTracking(trackingNo: string): Promise<void>;
  parseWebhook(body: unknown, headers: Headers): Promise<TrackingEvent[]>;
}

export type CarrierRateLoader = (input: RateRequest) => Promise<RateQuote[]>;

async function loadCarrierRateCardsFromDb(input: RateRequest): Promise<RateQuote[]> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return [];
  }
  const weightG = Math.max(1, Math.round((Number(input.weightKg) || 0) * 1000));
  const parcels = Math.max(1, Math.round(Number(input.parcels) || 1));
  const { data, error } = await createAdminClient().rpc('quote_carrier_rates', {
    p_carrier_code: 'yunexpress',
    p_country: (input.toCountry || '').trim().toUpperCase(),
    p_weight_g: weightG,
    p_parcels: parcels,
  });
  if (error || !data?.length) return [];
  return (data as {
    service_label: string;
    carrier_service_code: string;
    price_cents: number;
    days_min: number;
    days_max: number;
  }[]).map((r) => ({
    carrier: 'YunExpress',
    service: `${r.service_label} [${r.carrier_service_code}]`,
    priceCents: Number(r.price_cents),
    days: `${r.days_min}–${r.days_max}`,
  }));
}

/** YunExpress adapter.
 *  · priceTrial reads versioned 3PL shipping_rate_cards (never hardcoded rates; throws "No rate set" when empty/unmatched).
 *  · Waybill/label actions allow deterministic sandbox labels ONLY on staging (APP_ENVIRONMENT === 'staging');
 *    anywhere else without live YunExpress credentials, waybill calls fail closed with "Carrier not connected". */
export class YunExpressAdapter implements CarrierAdapter {
  readonly code = 'yunexpress';
  readonly mode: 'sandbox' | 'live';
  private readonly loadRates: CarrierRateLoader;
  constructor(rateLoader?: CarrierRateLoader) {
    const hasLiveKeys = Boolean(
      (process.env.YUNEXPRESS_CUSTOMER_NO || process.env.YUNEXPRESS_APP_ID) &&
      (process.env.YUNEXPRESS_API_SECRET || process.env.YUNEXPRESS_APP_KEY) &&
      process.env.YUNEXPRESS_MODE === 'live' &&
      process.env.YUNEXPRESS_SANDBOX !== 'true'
    );
    this.mode = hasLiveKeys ? 'live' : 'sandbox';
    this.loadRates = rateLoader ?? loadCarrierRateCardsFromDb;
  }
  private assertConnectedOrStaging() {
    if (process.env.APP_ENVIRONMENT === 'production' && (this.mode !== 'live' || process.env.YUNEXPRESS_SANDBOX === 'true')) {
      throw new Error('Carrier not connected');
    }
    if (this.mode !== 'live' && process.env.APP_ENVIRONMENT !== 'staging') {
      throw new Error('Carrier not connected');
    }
  }
  async priceTrial(i: RateRequest): Promise<RateQuote[]> {
    const quotes = await this.loadRates(i);
    if (!quotes.length) {
      throw new Error('No rate set');
    }
    return quotes;
  }
  async createShipment(i: ShipmentRequest): Promise<ShipmentResult> {
    this.assertConnectedOrStaging();
    if (process.env.APP_ENVIRONMENT !== 'staging') {
      throw new Error('Carrier not connected');
    }
    const trackingNo = 'YT' + (Date.now().toString().slice(-10) + Math.floor(Math.random() * 1e4)).padStart(14, '0');
    return { trackingNo, labelUrl: `/api/labels/${trackingNo}?order=${encodeURIComponent(i.orderCode)}` };
  }
  async getLabel(trackingNo: string) {
    this.assertConnectedOrStaging();
    if (process.env.APP_ENVIRONMENT !== 'staging') {
      throw new Error('Carrier not connected');
    }
    return `/api/labels/${trackingNo}`;
  }
  async cancel() {
    this.assertConnectedOrStaging();
    if (process.env.APP_ENVIRONMENT !== 'staging') {
      throw new Error('Carrier not connected');
    }
  }
  async subscribeTracking() {
    this.assertConnectedOrStaging();
    if (process.env.APP_ENVIRONMENT !== 'staging') {
      throw new Error('Carrier not connected');
    }
  }
  async parseWebhook(body: unknown): Promise<TrackingEvent[]> {
    const b = body as { events?: { id: string; tracking_no: string; status: string; description: string; location?: string; time: string }[] };
    return (b.events ?? []).map((e) => ({ providerEventId: e.id, trackingNo: e.tracking_no, status: e.status, description: e.description, location: e.location, occurredAt: e.time }));
  }
}

/** Outbound carrier calls are logged to integration_logs with trace id + body SHAs (SPEC §7, §21). */
export function getCarrier(code = 'yunexpress'): CarrierAdapter {
  switch (code) {
    case 'yunexpress': {
      const a = new YunExpressAdapter();
      const base = a.mode === 'live' ? 'https://api.yunexpress.com' : 'sandbox://yunexpress';
      const paths: Record<string, string> = { priceTrial: '/api/WayBill/GetPriceTrial', createShipment: '/api/WayBill/CreateOrder', getLabel: '/api/Label/Print', cancel: '/api/WayBill/Delete', subscribeTracking: '/api/Tracking/Subscribe' };
      return traceAdapter('yunexpress', a, ['priceTrial', 'createShipment', 'getLabel', 'cancel', 'subscribeTracking'], (m) => base + (paths[m] ?? `/${m}`));
    }
    default: throw new Error(`No carrier adapter for ${code}`);
  }
}

/* ───────── Payment (decision #1 open) ───────── */
export type PaymentEvent = { providerEventId: string; kind: 'topup.succeeded' | 'payment.succeeded' | 'payment.failed'; reference: string; amountCents: number };
export interface PaymentAdapter {
  readonly mode: 'test' | 'live';
  createIntent(i: { amountCents: number; currency?: string; reference: string; description: string }): Promise<{ id: string; checkoutUrl: string }>;
  refund(r: { paymentId: string; amountCents: number }): Promise<void>;
  parseWebhook(rawBody: string, headers: Headers): Promise<PaymentEvent[]>;
}
export class TestPaymentAdapter implements PaymentAdapter {
  readonly mode = 'test' as const;
  async createIntent(i: { amountCents: number; currency?: string; reference: string }) {
    if (process.env.APP_ENVIRONMENT !== 'staging') throw new Error('Not available');
    const id = 'pi_test_' + crypto.randomBytes(6).toString('hex');
    return { id, checkoutUrl: `/account/wallet?test_checkout=${id}&ref=${encodeURIComponent(i.reference)}&amount=${i.amountCents}&currency=${i.currency ?? 'USD'}` };
  }
  async refund() {
    if (process.env.APP_ENVIRONMENT !== 'staging') throw new Error('Not available');
  }
  async parseWebhook(rawBody: string, headers: Headers): Promise<PaymentEvent[]> {
    if (!verifySignature(rawBody, headers.get('octopus-signature') ?? headers.get('x-signature'), process.env.PAYMENT_WEBHOOK_SECRET ?? process.env.WEBHOOK_SIGNING_SECRET ?? ''))
      throw new Error('BAD_SIGNATURE');
    const b = JSON.parse(rawBody);
    return [{ providerEventId: b.id, kind: b.type, reference: b.data?.reference, amountCents: b.data?.amount }];
  }
}
export function getPayment(): PaymentAdapter {
  return traceAdapter('payment', new TestPaymentAdapter(), ['createIntent', 'refund'], (m) => `sandbox://payment/${m}`);
}

/* ───────── Email (decision #3 open) ───────── */
export interface EmailAdapter {
  readonly mode: 'log' | 'live';
  /** `meta.template` names the template/event for the delivery log; `meta.eventId` links it to the outbox event. */
  send(m: { to: string; subject: string; html: string; attachments?: { filename: string; url: string }[] }, meta?: EmailMeta): Promise<{ id: string }>;
}
export type EmailMeta = { template?: string; eventId?: string | null };
export class LogEmailAdapter implements EmailAdapter {
  readonly mode = 'log' as const;
  async send(m: { to: string; subject: string }) { console.log('[email:log]', m.to, m.subject); return { id: 'log_' + Date.now() }; }
}
export class ResendEmailAdapter implements EmailAdapter {
  readonly mode = 'live' as const;
  async send(m: { to: string; subject: string; html: string }) {
    const r = await fetch(process.env.EMAIL_API_URL || 'https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.EMAIL_API_KEY}`, 'Content-Type': 'application/json', ...outboundTraceHeaders() },
      body: JSON.stringify({ from: process.env.EMAIL_FROM ?? 'Octopus B2B <support@octopusb2b.com>', to: m.to, subject: m.subject, html: m.html }),
    });
    if (!r.ok) throw new Error(`email failed ${r.status}`);
    return { id: (await r.json()).id };
  }
}
/**
 * Every message is recorded in email_deliveries (trace id, template, recipient hash, provider message id) and
 * integration_logs (code 'email', body SHAs) — SPEC §21.4 steps 4–5.
 */
class TracedEmail implements EmailAdapter {
  constructor(private inner: EmailAdapter) {}
  get mode() { return this.inner.mode; }
  async send(m: Parameters<EmailAdapter['send']>[0], meta: EmailMeta = {}) {
    const t0 = Date.now();
    const provider = this.inner.mode === 'live' ? 'resend' : 'log';
    const endpoint = this.inner.mode === 'live' ? process.env.EMAIL_API_URL || 'https://api.resend.com/emails' : 'log://email';
    const template = meta.template ?? 'adhoc';
    try {
      const r = await this.inner.send(m, meta);
      const ms = Date.now() - t0;
      await logEmailDelivery({ template, to: m.to, provider, messageId: r.id, status: this.inner.mode === 'live' ? 'sent' : 'logged', eventId: meta.eventId, durationMs: ms });
      await logIntegration({ code: 'email', direction: 'out', endpoint, status: 200, summary: `${template} → ${provider} ${r.id}`, request: { to: m.to, subject: m.subject, html: m.html }, response: r, durationMs: ms, eventId: meta.eventId });
      return r;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const ms = Date.now() - t0;
      await logEmailDelivery({ template, to: m.to, provider, messageId: null, status: 'failed', error: msg, eventId: meta.eventId, durationMs: ms });
      await logIntegration({ code: 'email', direction: 'out', endpoint, status: 502, summary: `${template} failed: ${msg}`, request: { to: m.to, subject: m.subject, html: m.html }, response: msg, durationMs: ms, eventId: meta.eventId });
      throw e;
    }
  }
}
export function getEmail(): EmailAdapter { return new TracedEmail(process.env.EMAIL_API_KEY ? new ResendEmailAdapter() : new LogEmailAdapter()); }

/* ───────── Dropship / Source / Channel / Bank (stubs until APIs exist, SPEC §7) ───────── */
export interface DropshipAdapter { pushProduct(p: { id: string }): Promise<string>; createOrder(o: { id: string }): Promise<string>; syncStock(ids: string[]): Promise<void>; }
export interface SourceAdapter { search(q: string): Promise<{ id: string; title: string }[]>; getProduct(id: string): Promise<{ id: string; title: string }>; syncPrices(ids: string[]): Promise<void>; }
export interface BankAdapter { createVirtualAccount(orgId: string): Promise<{ iban: string; reference: string }>; listIncoming(since: Date): Promise<{ ref: string; amountCents: number }[]>; sendPayout(p: { supplierId: string; amountCents: number }): Promise<{ reference: string }>; }

export class ManualDropshipAdapter implements DropshipAdapter {
  async pushProduct() { throw new Error('Octopus Dropship API not configured (open decision #7) — handled as a service request'); return ''; }
  async createOrder() { throw new Error('Octopus Dropship API not configured'); return ''; }
  async syncStock() {}
}
export class Official1688Adapter implements SourceAdapter {
  // Official 1688 Open Platform only (AppKey required) — no scraping (SPEC §7)
  async search() { if (!process.env.SOURCE_1688_APP_KEY) throw new Error('1688 AppKey not configured'); return []; }
  async getProduct(id: string) { if (!process.env.SOURCE_1688_APP_KEY) throw new Error('1688 AppKey not configured'); return { id, title: '' }; }
  async syncPrices() {}
}
export class ManualBankAdapter implements BankAdapter {
  async createVirtualAccount(orgId: string) { return { iban: '[Bank details from CMS]', reference: 'OCT-' + orgId.slice(0, 8).toUpperCase() }; }
  async listIncoming() { return []; }
  async sendPayout() { return { reference: 'MANUAL-' + Date.now() }; }
}

/* ───────── Webhook signing (HMAC-SHA256, "t=…,v1=…", 5 min replay window) ───────── */
export function signPayload(body: string, secret: string, t = Math.floor(Date.now() / 1000)) {
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${v1}`;
}
export function verifySignature(body: string, header: string | null, secret: string, toleranceSec = 300) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1 ?? '')); } catch { return false; }
}

