import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { supplierSlipHtml } from '@/lib/dropship-ds14-slip';
import type { ShipTo, SupItem } from '@/lib/dropship-ds14';

/**
 * Packing slip for a partner supplier's Dropship order: the merchant's brand only (owner decision 26 Nov 2026), no prices, no Octopus,
 * no merchant company. Supplier accounts only; the RPC ds_sup_slip checks the order is this supplier's, refuses cancelled orders,
 * records that the slip was printed (mark shipped needs it) and returns the merchant's approved brand name + logo path (DS12 settings).
 * The logo sits in the private 'dropship-branding' bucket: a 10-minute signed URL is made here on the server.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSession();
  if (!s) return new NextResponse('Sign in to print packing slips', { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('Packing slip not found', { status: 404 });
  const sb = await createClient();
  const { data, error } = await sb.rpc('ds_sup_slip', { p_id: id });
  if (error) {
    const code = error.message.split(':')[0].trim();
    return new NextResponse(code === 'ORDER_CANCELLED' ? 'This order was cancelled. Do not ship it.' : 'Packing slip not found', { status: code === 'ORDER_CANCELLED' ? 409 : 404 });
  }
  const d = data as { order: string; date: string; ship_to: ShipTo; items: SupItem[]; brand?: { name: string | null; logo_path: string | null } | null };
  let logoUrl: string | null = null;
  if (d.brand?.logo_path) {
    try {
      // the RPC above already checked this supplier may print this order; the service role only signs the merchant's logo
      const { data: signed } = await createAdminClient().storage.from('dropship-branding').createSignedUrl(d.brand.logo_path, 600);
      logoUrl = signed?.signedUrl ?? null;
    } catch {
      logoUrl = null;
    }
  }
  return new NextResponse(supplierSlipHtml({ order: d.order, date: d.date, shipTo: d.ship_to, items: d.items, brand: { name: d.brand?.name ?? null, logoUrl } }), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' },
  });
}
