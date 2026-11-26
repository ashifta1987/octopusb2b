/**
 * Dropship parcels (owner's decision, 19 Nov 2026): the shipping label and the packing slip show ONLY the seller's
 * brand and the seller's APPROVED return address — never Octopus B2B, the factory label, a supplier address or code,
 * prices or costs. Pure HTML helpers (no server imports) so the output can be unit-tested.
 */
export type SellerBrand = {
  brand_name: string; return_name: string; return_line1: string; return_line2: string | null; return_city: string;
  return_region: string | null; return_postal_code: string | null; return_country: string;
};
export type ShipTo = { name: string | null; line1?: string | null; line2?: string | null; city?: string | null; region?: string | null; postal_code?: string | null; country?: string | null };

export const DROPSHIP_LABEL_BLOCKED = "Dropship label blocked: the seller's return address is not approved yet";
export const DROPSHIP_SLIP_BLOCKED = "Dropship packing slip blocked: the seller's return address is not approved yet";

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Return address as escaped lines (empty parts dropped). */
export function returnAddressLines(b: SellerBrand): string[] {
  const cityLine = [b.return_postal_code, b.return_city].filter(Boolean).join(' ') + (b.return_region ? `, ${b.return_region}` : '');
  return [b.return_name, b.return_line1, b.return_line2, cityLine, b.return_country].filter((x) => x && String(x).trim()).map(esc);
}

/** The label's "From" box for a dropship parcel: brand + approved return address, nothing else. */
export function dropshipFromBox(b: SellerBrand): string {
  return `<div class="box" data-testid="label-from"><h4>From / return to</h4><b>${esc(b.brand_name)}</b><br>${returnAddressLines(b).join('<br>')}</div>`;
}

function shipToLines(t: ShipTo): string[] {
  const cityLine = [t.postal_code, t.city].filter(Boolean).join(' ') + (t.region ? `, ${t.region}` : '');
  return [t.line1, t.line2, cityLine, t.country].filter((x) => x && String(x).trim()).map(esc);
}

/** Printable A5 packing slip for a dropship parcel: seller brand header, ship-to, order code, items + quantities, return address. */
export function packingSlipHtml(d: {
  brand: SellerBrand; orderCode: string | null; date: string; tracking: string | null; shipTo: ShipTo;
  items: { description: string; quantity: number | null }[];
  /** Release 5 · Step 13 (Settings › Branding / Policies): optional logo (signed URL), buyer returns policy and support email. */
  extras?: { logoUrl?: string | null; returnsPolicy?: string | null; supportEmail?: string | null };
}): string {
  const b = d.brand;
  const x = d.extras ?? {};
  const safeLogo = x.logoUrl && /^https:\/\//.test(x.logoUrl) ? x.logoUrl : null;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Packing slip · ${esc(b.brand_name)}</title>
<style>
@page { size: A5; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #111; background: #eee; }
.slip { width: 148mm; min-height: 210mm; margin: 10px auto; background: #fff; border: 1px solid #000; padding: 8mm; display: flex; flex-direction: column; gap: 5mm; }
.head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #000; padding-bottom: 3mm; }
.brand { font-size: 22px; font-weight: 800; }
.doc { font-size: 11px; text-align: right; text-transform: uppercase; letter-spacing: 1px; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
.box { border: 1px solid #000; padding: 3mm; font-size: 11px; line-height: 1.4; }
.box h4 { margin: 0 0 1mm; font-size: 9px; text-transform: uppercase; letter-spacing: 1px; }
table { width: 100%; border-collapse: collapse; font-size: 11px; }
th, td { border-bottom: 1px solid #000; padding: 2mm 1mm; text-align: left; }
th.q, td.q { text-align: right; width: 22mm; }
.foot { margin-top: auto; font-size: 10px; text-align: center; border-top: 1px dashed #000; padding-top: 2mm; }
@media print { body { background: #fff; } .slip { margin: 0; border: none; } .noprint { display: none; } }
.noprint { text-align: center; margin: 8px; font-family: sans-serif; }
</style></head><body>
<div class="noprint"><button onclick="window.print()">Print packing slip</button></div>
<div class="slip">
  <div class="head"><div class="brand" data-testid="slip-brand">${safeLogo ? `<img src="${esc(safeLogo)}" alt="${esc(b.brand_name)} logo" style="max-height:14mm;max-width:50mm;display:block;margin-bottom:1mm">` : ''}${esc(b.brand_name)}</div><div class="doc">Packing slip<br>${esc(d.date)}</div></div>
  <div class="cols">
    <div class="box" data-testid="slip-ship-to"><h4>Ship to</h4><b>${esc(d.shipTo.name)}</b><br>${shipToLines(d.shipTo).join('<br>')}</div>
    <div class="box"><h4>Order</h4><b>${esc(d.orderCode ?? '—')}</b>${d.tracking ? `<br>Tracking: ${esc(d.tracking)}` : ''}</div>
  </div>
  <table data-testid="slip-items"><thead><tr><th>Item</th><th class="q">Quantity</th></tr></thead><tbody>
    ${d.items.map((i) => `<tr><td>${esc(i.description)}</td><td class="q">${esc(i.quantity ?? '—')}</td></tr>`).join('')}
  </tbody></table>
  <div class="box" data-testid="slip-return"><h4>Returns</h4>Please send returns to:<br><b>${esc(b.brand_name)}</b><br>${returnAddressLines(b).join('<br>')}${x.returnsPolicy ? `<br><br><span data-testid="slip-returns-policy">${esc(x.returnsPolicy)}</span>` : ''}${x.supportEmail ? `<br>Questions: ${esc(x.supportEmail)}` : ''}</div>
  <div class="foot">Thank you for shopping with ${esc(b.brand_name)}.</div>
</div></body></html>`;
}
