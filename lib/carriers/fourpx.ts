import 'server-only';
import crypto from 'node:crypto';
import { CarrierError, type CarrierAdapter, type CarrierTrackingEvent, type LabelRequest, type LabelResult } from './types';

/**
 * Warehouse OS · W4 — 4PX adapter SKELETON (4PX open platform, "router/api/service"). It calls 4PX ONLY when the account's
 * credentials exist on the server: `${prefix}_APP_KEY` and `${prefix}_APP_SECRET` (prefix = wh_carrier_accounts.credential_env,
 * e.g. FOURPX_FS01), optional `${prefix}_API_BASE` (defaults to the 4PX production router; point it at the 4PX test router while
 * testing a live account). Without them it refuses with "not connected" — it never invents a label.
 *
 * NOT VERIFIED against a real 4PX account (staging has no credentials). Before the first live label, check with 4PX: the sign
 * formula, the method names/versions (ds.xms.order.create, ds.xms.label.get, ds.xms.order.cancel, tr.order.tracking.get) and
 * the field names below; adjust here only — business code depends on CarrierAdapter.
 */
const DEFAULT_BASE = 'https://open.4px.com/router/api/service';

type FourPxCreds = { appKey: string; appSecret: string; base: string };

export function fourPxCredentials(prefix: string | null): FourPxCreds | null {
  if (!prefix) return null;
  const appKey = process.env[`${prefix}_APP_KEY`];
  const appSecret = process.env[`${prefix}_APP_SECRET`];
  if (!appKey || !appSecret) return null;
  return { appKey, appSecret, base: process.env[`${prefix}_API_BASE`] || DEFAULT_BASE };
}

/** 4PX open-platform signature: md5(app_key{k}format{f}method{m}timestamp{t}v{v}{body}{secret}) — confirm with 4PX. */
export function fourPxSign(p: { appKey: string; format: string; method: string; timestamp: string; v: string; body: string; appSecret: string }): string {
  const base = `app_key${p.appKey}format${p.format}method${p.method}timestamp${p.timestamp}v${p.v}${p.body}${p.appSecret}`;
  return crypto.createHash('md5').update(base, 'utf8').digest('hex');
}

/** 4PX tracking codes → our statuses (unknown codes become a plain update). */
export function fourPxStatus(code: string): CarrierTrackingEvent['status'] {
  const c = code.toUpperCase();
  if (/^(FPX_S_OK|DELIVERED|SIGNED)/.test(c)) return 'delivered';
  if (/^(FPX_D|OUT_FOR_DELIVERY|DELIVERING)/.test(c)) return 'out_for_delivery';
  if (/^(FPX_R|RETURN)/.test(c)) return 'returned';
  if (/^(FPX_E|EXCEPTION|FAIL)/.test(c)) return 'exception';
  if (/^(FPX_[A-Z]|IN_TRANSIT|DEPART|ARRIV)/.test(c)) return 'in_transit';
  return 'info';
}

/** C0 · DDP → 'P' (sender pays duties), DAP → 'U' (receiver pays). Domestic / unknown → 'U'. Confirm the codes with 4PX. */
export function fourPxDutyType(d: 'DDP' | 'DAP' | null | undefined): 'P' | 'U' {
  return d === 'DDP' ? 'P' : 'U';
}

/** Carrier customs fields take plain ASCII: "TEST – Lamp ×2" → "TEST - Lamp x2" (the database already refused non-Latin text). */
export function asciiText(s: string): string {
  return s.replace(/[\u2010-\u2015]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\u00d7/g, 'x')
    .normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim();
}

export class FourPxAdapter implements CarrierAdapter {
  readonly carrier = '4px' as const;
  readonly mode = 'live' as const;
  private readonly creds: FourPxCreds;
  constructor(prefix: string | null, private readonly fetchImpl: typeof fetch = fetch) {
    const c = fourPxCredentials(prefix);
    if (!c) throw new CarrierError('NOT_CONNECTED', `4PX is not connected: the server settings ${prefix ?? '(none named)'}_APP_KEY / _APP_SECRET are missing.`);
    this.creds = c;
  }

  private async call<T>(method: string, payload: unknown, v = '1.0.0'): Promise<T> {
    const body = JSON.stringify(payload);
    const timestamp = String(Date.now());
    const sign = fourPxSign({ appKey: this.creds.appKey, format: 'json', method, timestamp, v, body, appSecret: this.creds.appSecret });
    const qs = new URLSearchParams({ method, app_key: this.creds.appKey, v, timestamp, format: 'json', sign, language: 'en' });
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.creds.base}?${qs.toString()}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new CarrierError('CARRIER_UNREACHABLE', '4PX did not answer. Try again in a minute.');
    }
    const json = (await res.json().catch(() => null)) as { result?: string | number; msg?: string; errors?: { error_msg?: string }[]; data?: T } | null;
    if (!res.ok || !json || String(json.result) !== '1') {
      const msg = json?.errors?.[0]?.error_msg || json?.msg || `HTTP ${res.status}`;
      throw new CarrierError('CARRIER_REFUSED', `4PX refused: ${String(msg).slice(0, 200)}`);
    }
    return json.data as T;
  }

  async createLabel(req: LabelRequest): Promise<LabelResult> {
    const to = req.shipTo;
    const c = req.customs;
    // C0: a Dropship label always carries the customs declaration (declared value = what the buyer paid, HS code, duty type).
    // Client (3PL) orders: Warehouse OS has no customer price yet (open question) → items without a value, as before.
    if (!c || (c.scope === 'dropship' && (c.declaredValueCents == null || !c.dutyType || c.items.length === 0))) {
      throw new CarrierError('CARRIER_REFUSED', 'The customs declaration is missing for this parcel. Run the customs check again.');
    }
    const usd = (cents: number | null) => (cents == null ? undefined : (cents / 100).toFixed(2));
    const created = await this.call<{ '4px_tracking_no'?: string; logistics_channel_no?: string; ds_consignment_no?: string }>('ds.xms.order.create', {
      ref_no: `${req.orderCode}-P${req.parcelSeq}`,
      business_type: 'BDS',
      // 4PX duty type: P = duties paid by the sender (DDP), U = unpaid / paid by the receiver (DAP). Field values NOT verified — confirm with 4PX.
      duty_type: fourPxDutyType(c.dutyType),
      logistics_service_info: { logistics_product_code: req.serviceCode },
      is_insure: 'N',
      parcel_list: [{
        weight: req.weightG ?? undefined,
        parcel_value: usd(c.declaredValueCents),
        currency: c.currency,
        include_battery: req.dangerousGoods.includes('battery') ? 'Y' : 'N',
        declare_product_info: c.items.map((i) => ({
          declare_product_name_en: asciiText(i.descriptionEn).slice(0, 100),
          declare_product_code_qty: i.qty,
          declare_unit_price_export: usd(i.unitValueCents),
          currency_export: c.currency,
          hscode_export: i.hsCode ?? undefined,
          origin_country: i.originCountry ?? undefined,
          unit_net_weight: i.unitWeightG ?? undefined,
          sku: i.sku,
        })),
      }],
      recipient_info: {
        first_name: to.name, phone: to.phone ?? '', country: to.country, state: to.region ?? '', city: to.city ?? '',
        street: [to.line1, to.line2].filter(Boolean).join(' '), post_code: to.postcode ?? '',
      },
      sender: { first_name: `${req.shipFrom.name} warehouse`, country: req.shipFrom.country, city: req.shipFrom.city, street: req.shipFrom.address ?? '', phone: req.shipFrom.phone ?? '' },
      deliver_type_info: { deliver_type: '1' },
    });
    const trackingNo = (created['4px_tracking_no'] || created.logistics_channel_no || '').toUpperCase();
    if (!trackingNo) throw new CarrierError('CARRIER_REFUSED', '4PX created the order but returned no tracking number.');
    const label = await this.call<{ label_url_info?: { logistics_label?: string } }>('ds.xms.label.get', { request_no: trackingNo, response_label_format: 'PDF', label_size: 'label_100x150' });
    const url = label.label_url_info?.logistics_label;
    if (!url) throw new CarrierError('CARRIER_REFUSED', '4PX returned no label file.');
    const pdfRes = await this.fetchImpl(url, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (!pdfRes || !pdfRes.ok) throw new CarrierError('CARRIER_UNREACHABLE', 'The 4PX label file could not be downloaded.');
    return { trackingNo, pdf: new Uint8Array(await pdfRes.arrayBuffer()), carrierRef: created.ds_consignment_no };
  }

  async cancelLabel(trackingNo: string): Promise<void> {
    await this.call('ds.xms.order.cancel', { request_no: trackingNo, cancel_reason: 'Label voided at the warehouse' });
  }

  async fetchTracking(trackingNo: string): Promise<CarrierTrackingEvent[]> {
    const data = await this.call<{ trackingList?: { businessLinkCode?: string; trackingContent?: string; occurDatetime?: string; occurLocation?: string }[] }>(
      'tr.order.tracking.get', { deliveryOrderNo: trackingNo });
    return (data.trackingList ?? []).filter((t) => t.occurDatetime).map((t) => ({
      providerEventId: `${trackingNo}:${t.businessLinkCode ?? ''}:${t.occurDatetime}`,
      status: fourPxStatus(t.businessLinkCode ?? ''),
      description: (t.trackingContent || 'Tracking update').slice(0, 300),
      location: t.occurLocation ?? null,
      occurredAt: new Date(t.occurDatetime!).toISOString(),
    }));
  }
}
