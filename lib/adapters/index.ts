import 'server-only';
import crypto from 'node:crypto';

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

/** YunExpress adapter. Sandbox mode returns deterministic test data until YUNEXPRESS_APP_ID/KEY are configured (open decision #8). */
export class YunExpressAdapter implements CarrierAdapter {
  readonly code = 'yunexpress';
  readonly mode: 'sandbox' | 'live' = process.env.YUNEXPRESS_APP_ID && process.env.YUNEXPRESS_MODE === 'live' ? 'live' : 'sandbox';
  async priceTrial(i: RateRequest): Promise<RateQuote[]> {
    const base = Math.max(1, i.weightKg) * 100;
    return [
      { carrier: 'YunExpress', service: 'Global Direct Line (standard)', priceCents: Math.round(base * 6.2), days: '8–12' },
      { carrier: 'YunExpress', service: 'Global Express (tracked)', priceCents: Math.round(base * 8.9), days: '5–8' },
      { carrier: 'YunExpress', service: 'Economy', priceCents: Math.round(base * 4.6), days: '12–20' },
    ];
  }
  async createShipment(i: ShipmentRequest): Promise<ShipmentResult> {
    const trackingNo = 'YT' + (Date.now().toString().slice(-10) + Math.floor(Math.random() * 1e4)).padStart(14, '0');
    return { trackingNo, labelUrl: `/api/labels/${trackingNo}?order=${encodeURIComponent(i.orderCode)}` };
  }
  async getLabel(trackingNo: string) { return `/api/labels/${trackingNo}`; }
  async cancel() {}
  async subscribeTracking() {}
  async parseWebhook(body: unknown): Promise<TrackingEvent[]> {
    const b = body as { events?: { id: string; tracking_no: string; status: string; description: string; location?: string; time: string }[] };
    return (b.events ?? []).map((e) => ({ providerEventId: e.id, trackingNo: e.tracking_no, status: e.status, description: e.description, location: e.location, occurredAt: e.time }));
  }
}

export function getCarrier(code = 'yunexpress'): CarrierAdapter {
  switch (code) {
    case 'yunexpress': return new YunExpressAdapter();
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
    const id = 'pi_test_' + crypto.randomBytes(6).toString('hex');
    return { id, checkoutUrl: `/account/wallet?test_checkout=${id}&ref=${encodeURIComponent(i.reference)}&amount=${i.amountCents}&currency=${i.currency ?? 'USD'}` };
  }
  async refund() {}
  async parseWebhook(rawBody: string, headers: Headers): Promise<PaymentEvent[]> {
    if (!verifySignature(rawBody, headers.get('octopus-signature') ?? headers.get('x-signature'), process.env.PAYMENT_WEBHOOK_SECRET ?? process.env.WEBHOOK_SIGNING_SECRET ?? ''))
      throw new Error('BAD_SIGNATURE');
    const b = JSON.parse(rawBody);
    return [{ providerEventId: b.id, kind: b.type, reference: b.data?.reference, amountCents: b.data?.amount }];
  }
}
export function getPayment(): PaymentAdapter { return new TestPaymentAdapter(); }

/* ───────── Email (decision #3 open) ───────── */
export interface EmailAdapter {
  readonly mode: 'log' | 'live';
  send(m: { to: string; subject: string; html: string; attachments?: { filename: string; url: string }[] }): Promise<{ id: string }>;
}
export class LogEmailAdapter implements EmailAdapter {
  readonly mode = 'log' as const;
  async send(m: { to: string; subject: string }) { console.log('[email:log]', m.to, m.subject); return { id: 'log_' + Date.now() }; }
}
export class ResendEmailAdapter implements EmailAdapter {
  readonly mode = 'live' as const;
  async send(m: { to: string; subject: string; html: string }) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.EMAIL_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.EMAIL_FROM ?? 'Octopus B2B <support@octopusb2b.com>', to: m.to, subject: m.subject, html: m.html }),
    });
    if (!r.ok) throw new Error(`email failed ${r.status}`);
    return { id: (await r.json()).id };
  }
}
export function getEmail(): EmailAdapter { return process.env.EMAIL_API_KEY ? new ResendEmailAdapter() : new LogEmailAdapter(); }

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

