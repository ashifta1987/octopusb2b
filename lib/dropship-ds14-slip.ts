import { esc } from '@/lib/dropship-print';
import { countryName } from '@/lib/dropship-ds14-shared';
import type { ShipTo, SupItem } from '@/lib/dropship-ds14';

/**
 * The Octopus packing slip for a parcel a PARTNER SUPPLIER ships to the buyer (SPEC §5.9). White-label rules:
 * the buyer's name and address (for shipping only), the order reference, items and quantities. Never prices, never the merchant,
 * never supplier details, and the supplier must not add an invoice, logo or contact details to the parcel.
 */
export function supplierSlipHtml(d: { order: string; date: string; shipTo: ShipTo; items: SupItem[] }): string {
  const a = d.shipTo;
  const lines = [a.name, a.line1, a.line2, [a.postcode, a.city].filter(Boolean).join(' '), a.region, countryName(a.country), a.phone].filter((x) => x && String(x).trim());
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Packing slip ${esc(d.order)}</title>
<style>
  body{font:14px/1.5 Inter,Arial,sans-serif;color:#1A174A;margin:32px;max-width:720px}
  h1{font-size:20px;margin:0 0 4px} .brand{font-weight:700;font-size:18px;margin-bottom:16px}
  .box{border:1px solid #D5DBE7;border-radius:8px;padding:12px 16px;margin:16px 0}
  .lbl{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#5B6478}
  table{border-collapse:collapse;width:100%} th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #E3E7EF} th:last-child,td:last-child{text-align:right}
  .note{font-size:12px;color:#5B6478;margin-top:20px} @media print{body{margin:12mm}}
</style></head><body>
<div class="brand">Octopus</div>
<h1>Packing slip · Order ${esc(d.order)}</h1>
<div class="lbl">${esc(d.date)}</div>
<div class="box"><div class="lbl">Ship to</div>${lines.map((l) => `<div>${esc(l)}</div>`).join('')}</div>
<table><thead><tr><th>Item</th><th>SKU</th><th>Qty</th></tr></thead><tbody>
${d.items.map((i) => `<tr><td>${esc(i.title)}${i.variant ? ` · ${esc(i.variant)}` : ''}</td><td>${esc(i.sku)}</td><td>${esc(i.qty)}</td></tr>`).join('')}
</tbody></table>
<p class="note">No prices are shown on the packing slip. Put this slip in the parcel. Do not add your own invoice, logo or contact details.</p>
</body></html>`;
}
