/**
 * CONN S4 · commercial invoice (A4 PDF) for a cross-border parcel, from c4_commercial_invoice() — the customs snapshot saved with
 * the label: declared value = what the buyer paid (locked; never the cost), English description, HS code, origin, quantity, unit
 * value and weight per item, duty terms. Values that were not set print as "not set", never as 0. White-label: the shipper of a
 * Dropship parcel is the seller's approved brand (the database decides).
 */
import { buildPdf, type PdfOp } from './pdf';

export const A4_W = 595.28;
export const A4_H = 841.89;

type Party = { name: string | null; address?: unknown; city?: string | null; province?: string | null; postcode?: string | null; country: string | null; phone?: string | null; email?: string | null };
export type CommercialInvoice = {
  number: string; date: string; sandbox: boolean; tracking_no: string; service_name: string | null; order_code: string; reference: string;
  exporter: Party; consignee: Party; scope: 'dropship' | 'client_order'; duty_type: 'DDP' | 'DAP' | null; incoterm: string | null; currency: 'USD';
  declared_usd_cents: number | null; weight_g: number | null;
  items: { sku: string; description_en: string; hs_code: string | null; qty: number; unit_value_cents: number | null; value_cents: number | null; origin_country: string | null; unit_weight_g: number | null }[];
};

export const usd = (cents: number | null | undefined) => (cents == null ? 'not set' : `US$ ${(cents / 100).toFixed(2)}`);

function addressLines(p: Party): string[] {
  const a = p.address;
  let street: string[] = [];
  if (typeof a === 'string') street = [a];
  else if (a && typeof a === 'object') {
    const o = a as Record<string, unknown>;
    street = [o.line1 ?? o.address1, o.line2 ?? o.address2].filter((x): x is string => typeof x === 'string' && x.trim() !== '');
    const city = [o.postcode ?? o.zip ?? o.postal_code, o.city].filter((x) => typeof x === 'string' && x).join(' ');
    const region = typeof (o.region ?? o.state ?? o.province) === 'string' ? String(o.region ?? o.state ?? o.province) : '';
    return [...street, city, [region, p.country].filter(Boolean).join(', ')].filter((l) => l.trim() !== '');
  }
  return [...street, [p.postcode, p.city].filter(Boolean).join(' '), [p.province, p.country].filter(Boolean).join(', ')].filter((l) => l.trim() !== '');
}

export function commercialInvoiceOps(ci: CommercialInvoice): PdfOp[] {
  const m = 40;
  const W = A4_W - 2 * m;
  const ops: PdfOp[] = [];
  let y = A4_H - m - 10;
  ops.push({ t: 'text', x: m, y, size: 18, bold: true, text: 'COMMERCIAL INVOICE' });
  ops.push({ t: 'text', x: A4_W - m - 190, y, size: 10, text: `No. ${ci.number}` });
  ops.push({ t: 'text', x: A4_W - m - 190, y: y - 14, size: 10, text: `Date ${ci.date}` });
  if (ci.sandbox) {
    y -= 30;
    ops.push({ t: 'rect', x: m, y: y - 4, w: W, h: 18 });
    ops.push({ t: 'text', x: m + 6, y: y + 1, size: 10, bold: true, white: true, text: 'SANDBOX - TEST DOCUMENT, NOT FOR CUSTOMS' });
  }
  y -= 40;
  const box = (x: number, title: string, p: Party) => {
    ops.push({ t: 'stroke', x, y: y - 82, w: W / 2 - 8, h: 92 });
    ops.push({ t: 'text', x: x + 6, y: y - 2, size: 8, bold: true, text: title });
    [p.name ?? '', ...addressLines(p), p.phone ? `Tel ${p.phone}` : ''].filter(Boolean).slice(0, 6)
      .forEach((l, i) => ops.push({ t: 'text', x: x + 6, y: y - 16 - i * 11, size: i === 0 ? 10 : 9, bold: i === 0, text: String(l).slice(0, 52) }));
  };
  box(m, 'SHIPPER / EXPORTER', ci.exporter);
  box(m + W / 2 + 8, 'CONSIGNEE', ci.consignee);
  y -= 104;
  const terms = [
    `Order ${ci.reference} (${ci.order_code})`,
    `Tracking ${ci.tracking_no}${ci.service_name ? ` - ${ci.service_name}` : ''}`,
    `Duties: ${ci.duty_type === 'DDP' ? 'DDP - paid by the sender' : ci.duty_type === 'DAP' ? 'DAP - paid by the receiver' : 'not set'}${ci.incoterm ? ` (${ci.incoterm})` : ''}`,
    `Reason for export: ${ci.scope === 'dropship' ? 'Sale of goods (merchandise)' : 'Sale of goods'}`,
    `Currency: ${ci.currency}. Gross weight: ${ci.weight_g ? `${(ci.weight_g / 1000).toFixed(3)} kg` : 'not set'}`,
  ];
  terms.forEach((t, i) => ops.push({ t: 'text', x: m, y: y - i * 12, size: 9, text: t.slice(0, 100) }));
  y -= terms.length * 12 + 14;
  const cols = [
    { h: 'Description (EN)', x: m, w: 170 }, { h: 'HS code', x: m + 172, w: 66 }, { h: 'Origin', x: m + 240, w: 40 }, { h: 'Qty', x: m + 282, w: 30 },
    { h: 'Unit value', x: m + 314, w: 70 }, { h: 'Value', x: m + 386, w: 70 }, { h: 'Unit kg', x: m + 458, w: 57 },
  ];
  ops.push({ t: 'rect', x: m, y: y - 4, w: W, h: 16 });
  cols.forEach((c) => ops.push({ t: 'text', x: c.x + 3, y: y + 1, size: 8, bold: true, white: true, text: c.h }));
  y -= 18;
  const rows = ci.items.slice(0, 30);
  for (const it of rows) {
    const cells = [it.description_en, it.hs_code ?? 'not set', it.origin_country ?? 'not set', String(it.qty), usd(it.unit_value_cents), usd(it.value_cents),
      it.unit_weight_g ? (it.unit_weight_g / 1000).toFixed(3) : 'not set'];
    cells.forEach((v, i) => ops.push({ t: 'text', x: cols[i].x + 3, y, size: 8, text: v.slice(0, i === 0 ? 38 : 14) }));
    y -= 13;
  }
  if (ci.items.length > rows.length) { ops.push({ t: 'text', x: m, y, size: 8, text: `+ ${ci.items.length - rows.length} more line(s) on the next invoice copy` }); y -= 13; }
  y -= 6;
  ops.push({ t: 'stroke', x: m, y: y - 4, w: W, h: 0.5 });
  ops.push({ t: 'text', x: m + 300, y: y - 18, size: 11, bold: true, text: `Total declared value: ${usd(ci.declared_usd_cents)}` });
  y -= 56;
  ops.push({ t: 'text', x: m, y, size: 8.5, text: 'I declare that the information on this invoice is true and correct and that the contents of this shipment are as stated above.' });
  ops.push({ t: 'text', x: m, y: y - 30, size: 9, text: `Signature: ______________________     Name: ${String(ci.exporter.name ?? '').slice(0, 40)}` });
  return ops;
}

export const commercialInvoicePdf = (ci: CommercialInvoice) => buildPdf(commercialInvoiceOps(ci), `Commercial invoice ${ci.number}`, A4_W, A4_H);
