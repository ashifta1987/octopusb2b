import 'server-only';
import crypto from 'node:crypto';
import { buildPdf, LABEL_H, LABEL_W, type PdfOp } from './pdf';
import { CARRIER_NAME, CarrierError, type CarrierAdapter, type CarrierCode, type CarrierTrackingEvent, type LabelRequest, type LabelResult } from './types';

/**
 * Warehouse OS · W4 — SANDBOX carrier adapter (staging only). Returns a realistic 100 × 150 mm label PDF and a tracking number
 * that is clearly a test: it starts with "SBX" (the database refuses a sandbox label without it and a live label with it) and
 * the label says "SANDBOX — NOT A REAL LABEL" in a black band. No carrier is called. Anywhere but staging it refuses.
 */
const TAG: Record<CarrierCode, string> = { yunexpress: 'YT', '4px': 'PX' };

export function sandboxTrackingNo(carrier: CarrierCode): string {
  let digits = '';
  for (let i = 0; i < 12; i++) digits += crypto.randomInt(0, 10).toString();
  return `SBX${TAG[carrier]}${digits}`;
}

export function sandboxLabelOps(carrier: CarrierCode, trackingNo: string, req: LabelRequest): PdfOp[] {
  const m = 12;
  const W = LABEL_W - 2 * m;
  const ops: PdfOp[] = [];
  let y = LABEL_H - m - 34;
  ops.push({ t: 'rect', x: m, y, w: W, h: 34 });
  ops.push({ t: 'text', x: m + 8, y: y + 19, size: 13, bold: true, white: true, text: 'SANDBOX - NOT A REAL LABEL' });
  ops.push({ t: 'text', x: m + 8, y: y + 6, size: 8, white: true, text: 'Staging test only. Do not hand this parcel to a carrier.' });
  y -= 22;
  ops.push({ t: 'text', x: m, y, size: 12, bold: true, text: `${CARRIER_NAME[carrier]} · ${req.serviceName}` });
  ops.push({ t: 'text', x: m, y: y - 12, size: 8, text: `Service ${req.serviceCode} · parcel ${req.parcelSeq} of ${req.parcelCount}${req.weightG ? ` · ${req.weightG.toLocaleString('en-US')} g` : ''}` });
  y -= 34;
  ops.push({ t: 'stroke', x: m, y: y - 70, w: W, h: 80 });
  ops.push({ t: 'text', x: m + 6, y: y - 2, size: 7, text: 'SHIP TO' });
  const to = req.shipTo;
  const toLines = [to.name, to.line1, to.line2, [to.postcode, to.city].filter(Boolean).join(' '), [to.region, to.country].filter(Boolean).join(', '), to.phone ? `Tel ${to.phone}` : null]
    .filter((l): l is string => Boolean(l && l.trim()));
  toLines.slice(0, 6).forEach((l, i) => ops.push({ t: 'text', x: m + 6, y: y - 14 - i * 10, size: i === 0 ? 10 : 8.5, bold: i === 0, text: l.slice(0, 48) }));
  y -= 84;
  ops.push({ t: 'text', x: m, y, size: 7, text: 'FROM' });
  ops.push({ t: 'text', x: m, y: y - 10, size: 8.5, text: `${req.shipFrom.name} warehouse, ${req.shipFrom.city}, ${req.shipFrom.country}`.slice(0, 60) });
  y -= 26;
  ops.push({ t: 'text', x: m, y, size: 8.5, text: `Order ${req.reference} · ${req.orderCode}`.slice(0, 60) });
  if (req.dangerousGoods.includes('battery')) {
    y -= 14;
    ops.push({ t: 'text', x: m, y, size: 9, bold: true, text: 'Contains lithium battery' });
  }
  ops.push({ t: 'barcode', x: m + 6, y: 58, w: W - 12, h: 64, value: trackingNo });
  ops.push({ t: 'text', x: m + 6, y: 42, size: 12, bold: true, text: trackingNo });
  ops.push({ t: 'text', x: m + 6, y: 26, size: 7, text: 'SANDBOX tracking number - not known to any carrier.' });
  return ops;
}

export class SandboxCarrierAdapter implements CarrierAdapter {
  readonly mode = 'sandbox' as const;
  constructor(readonly carrier: CarrierCode) {
    if (process.env.APP_ENVIRONMENT !== 'staging') {
      throw new CarrierError('SANDBOX_STAGING_ONLY', 'Sandbox carrier accounts work only on staging.');
    }
  }
  async createLabel(req: LabelRequest): Promise<LabelResult> {
    const trackingNo = sandboxTrackingNo(this.carrier);
    const pdf = buildPdf(sandboxLabelOps(this.carrier, trackingNo, req), `SANDBOX label ${trackingNo}`);
    return { trackingNo, pdf };
  }
  async cancelLabel(): Promise<void> {
    // nothing exists at a carrier
  }
  async validateCredentials(): Promise<{ ok: boolean; message: string }> {
    return { ok: true, message: 'Sandbox account: test labels only (staging). No carrier is called.' };
  }
  async fetchTracking(): Promise<CarrierTrackingEvent[]> {
    // sandbox steps are added by staff on staging (wh_tracking_sandbox_next), never invented by polling
    return [];
  }
}
