import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { supplierSlipHtml } from '@/lib/dropship-ds14-slip';
import type { ShipTo, SupItem } from '@/lib/dropship-ds14';

/**
 * Octopus packing slip for a partner supplier's order (white-label: no merchant, no prices). Supplier accounts only; the RPC
 * ds_sup_slip checks the order is this supplier's, refuses cancelled orders and records that the slip was printed (mark shipped needs it).
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
  const d = data as { order: string; date: string; ship_to: ShipTo; items: SupItem[] };
  return new NextResponse(supplierSlipHtml({ order: d.order, date: d.date, shipTo: d.ship_to, items: d.items }), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' },
  });
}
