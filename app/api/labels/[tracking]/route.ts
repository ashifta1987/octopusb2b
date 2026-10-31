import { getSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getCarrier } from '@/lib/adapters';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Pseudo barcode (visual only, sandbox): bar widths derived from the tracking number characters. */
function bars(code: string) {
  let x = 0; const out: string[] = [];
  for (const ch of `*${code}*`) {
    const n = ch.charCodeAt(0);
    for (let i = 0; i < 6; i++) {
      const w = ((n >> i) & 1) + 1;
      if (i % 2 === 0) out.push(`<rect x="${x}" y="0" width="${w * 1.6}" height="60"/>`);
      x += w * 1.6;
    }
    x += 2;
  }
  return { svg: out.join(''), width: x };
}

/** Printable 10 × 15 cm shipping label (sandbox). RLS: buyer org or staff with orders:view. */
export async function GET(_req: Request, { params }: { params: Promise<{ tracking: string }> }) {
  const { tracking } = await params;
  const s = await getSession();
  if (!s) return new Response('Sign in to print labels', { status: 401 });
  const sb = await createClient();
  const { data: sh } = await sb.from('shipments')
    .select('code, tracking_no, service_code, weight_kg, parcels, created_at, carrier_code, orders(code, title, quantity, incoterm, organizations(id, name, city, country), suppliers(code, country, city))')
    .eq('tracking_no', tracking).maybeSingle();
  if (!sh) return new Response('Label not found', { status: 404 });
  const o = (Array.isArray(sh.orders) ? sh.orders[0] : sh.orders) as { code: string; title: string; quantity: number; incoterm: string | null; organizations: unknown; suppliers: unknown } | null;
  const org = (Array.isArray(o?.organizations) ? o?.organizations[0] : o?.organizations) as { id: string; name: string; city: string | null; country: string | null } | null;
  const sup = (Array.isArray(o?.suppliers) ? o?.suppliers[0] : o?.suppliers) as { code: string; country: string; city: string | null } | null;
  const { data: addr } = org ? await sb.from('addresses').select('line1, line2, city, region, postal_code, country').eq('org_id', org.id).order('is_default', { ascending: false }).limit(1).maybeSingle() : { data: null };
  const b = bars(sh.tracking_no ?? tracking);

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Label ${esc(sh.tracking_no)}</title>
<style>
@page { size: 100mm 150mm; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; background: #eee; }
.label { width: 100mm; height: 150mm; margin: 10px auto; background: #fff; border: 1px solid #000; padding: 4mm; display: flex; flex-direction: column; gap: 3mm; }
.row { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #000; padding-bottom: 2mm; }
.carrier { font-size: 20px; font-weight: 800; letter-spacing: .5px; }
.svc { font-size: 11px; text-align: right; }
.box { border: 1px solid #000; padding: 2mm; font-size: 11px; line-height: 1.35; }
.box h4 { margin: 0 0 1mm; font-size: 9px; text-transform: uppercase; letter-spacing: 1px; }
.to { font-size: 14px; font-weight: 700; }
.bc { text-align: center; }
.trk { font-family: 'Courier New', monospace; font-size: 18px; font-weight: 700; letter-spacing: 2px; text-align: center; }
.meta { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 2mm; font-size: 10px; }
.sandbox { margin-top: auto; text-align: center; font-size: 10px; font-weight: 700; border: 1px dashed #000; padding: 1mm; }
@media print { body { background: #fff; } .label { margin: 0; border: none; } .noprint { display: none; } }
.noprint { text-align: center; margin: 8px; font-family: sans-serif; }
</style></head><body>
<div class="noprint"><button onclick="window.print()">Print label</button></div>
<div class="label">
  <div class="row"><div class="carrier">YunExpress</div><div class="svc">${esc(sh.service_code)}<br>${esc(sh.code)}</div></div>
  <div class="box"><h4>Ship to</h4><div class="to">${esc(org?.name)}</div>
    ${addr ? `${esc(addr.line1)}${addr.line2 ? `, ${esc(addr.line2)}` : ''}<br>${esc(addr.postal_code)} ${esc(addr.city)}${addr.region ? `, ${esc(addr.region)}` : ''}<br>` : ''}
    <b>${esc(addr?.city ?? org?.city)} · ${esc(addr?.country ?? org?.country)}</b></div>
  <div class="box"><h4>From</h4>Octopus B2B fulfilment · Supplier ${esc(sup?.code)}<br>${esc(sup?.city)} · ${esc(sup?.country)}</div>
  <div class="bc"><svg viewBox="0 0 ${b.width} 60" width="90%" height="60" preserveAspectRatio="none" role="img" aria-label="Barcode ${esc(sh.tracking_no)}">${b.svg}</svg></div>
  <div class="trk">${esc(sh.tracking_no)}</div>
  <div class="meta">
    <div><b>Order</b><br>${esc(o?.code)}</div>
    <div><b>Pieces</b><br>${esc(sh.parcels ?? 1)}</div>
    <div><b>Weight</b><br>${esc(sh.weight_kg ?? '—')} kg</div>
    <div><b>Incoterm</b><br>${esc(o?.incoterm ?? '—')}</div>
    <div><b>Date</b><br>${esc(new Date(sh.created_at).toISOString().slice(0, 10))}</div>
    <div><b>Contents</b><br>${esc((o?.title ?? '').slice(0, 40))}</div>
  </div>
  ${getCarrier().mode === 'sandbox' ? '<div class="sandbox">SANDBOX LABEL — NOT VALID FOR CARRIAGE</div>' : ''}
</div></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' } });
}
