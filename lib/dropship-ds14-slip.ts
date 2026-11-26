import { esc } from '@/lib/dropship-print';
import { countryName } from '@/lib/dropship-ds14-shared';
import type { ShipTo, SupItem } from '@/lib/dropship-ds14';

/** The merchant's brand on a Dropship slip (DS12 brand settings: approved brand name + logo when the merchant shows it on slips). */
export type SlipBrand = { name: string | null; logoUrl: string | null };

const STYLE = `<style>
  body{font:14px/1.5 Inter,Arial,sans-serif;color:#1A174A;margin:32px;max-width:720px}
  h1{font-size:20px;margin:0 0 4px} .brand{display:flex;align-items:center;gap:12px;font-weight:700;font-size:18px;margin-bottom:16px}
  .brand img{max-height:48px;max-width:180px;object-fit:contain}
  .box{border:1px solid #D5DBE7;border-radius:8px;padding:12px 16px;margin:16px 0}
  .lbl{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#5B6478}
  table{border-collapse:collapse;width:100%} th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #E3E7EF} th:last-child,td:last-child{text-align:right}
  .note{font-size:12px;color:#5B6478;margin-top:20px} @media print{body{margin:12mm}}
</style>`;

function body(d: { order: string; date: string; shipTo: ShipTo; items: SupItem[] }, brandHtml: string, note: string): string {
  const a = d.shipTo;
  const lines = [a.name, a.line1, a.line2, [a.postcode, a.city].filter(Boolean).join(' '), a.region, countryName(a.country), a.phone].filter((x) => x && String(x).trim());
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Packing slip ${esc(d.order)}</title>
${STYLE}</head><body>
${brandHtml}
<h1>Packing slip · Order ${esc(d.order)}</h1>
<div class="lbl">${esc(d.date)}</div>
<div class="box"><div class="lbl">Ship to</div>${lines.map((l) => `<div>${esc(l)}</div>`).join('')}</div>
<table><thead><tr><th>Item</th><th>SKU</th><th>Qty</th></tr></thead><tbody>
${d.items.map((i) => `<tr><td>${esc(i.title)}${i.variant ? ` · ${esc(i.variant)}` : ''}</td><td>${esc(i.sku)}</td><td>${esc(i.qty)}</td></tr>`).join('')}
</tbody></table>
<p class="note">${note}</p>
</body></html>`;
}

/**
 * Packing slip for a parcel a PARTNER SUPPLIER ships straight to the buyer of a Dropship order (owner decision 26 Nov 2026):
 * the MERCHANT's brand only — the approved brand name and, if the merchant shows it on slips, the logo. Never Octopus, never
 * prices, never the merchant's company, never supplier details. The buyer's name and address are for shipping only.
 * No brand set → no brand line at all (never a fallback to Octopus).
 */
export function supplierSlipHtml(d: { order: string; date: string; shipTo: ShipTo; items: SupItem[]; brand: SlipBrand }): string {
  const b = d.brand;
  const brandHtml = b.name || b.logoUrl
    ? `<div class="brand" data-slip-brand="merchant">${b.logoUrl ? `<img src="${esc(b.logoUrl)}" alt="${esc(b.name ?? 'Seller logo')}">` : ''}${b.name ? `<span>${esc(b.name)}</span>` : ''}</div>`
    : '';
  return body(d, brandHtml, 'No prices are shown on the packing slip. Put this slip in the parcel. Do not add your own invoice, logo or contact details.');
}

/** B2B Sourcing parcels keep the Octopus slip (Octopus is the seller there). Not used for Dropship orders. */
export function sourcingSlipHtml(d: { order: string; date: string; shipTo: ShipTo; items: SupItem[] }): string {
  return body(d, '<div class="brand" data-slip-brand="octopus">Octopus</div>', 'No prices are shown on the packing slip. Put this slip in the parcel.');
}
