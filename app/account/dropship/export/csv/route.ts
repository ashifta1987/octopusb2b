import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { centsToDecimal, toCsv } from '@/lib/dropship-ds12-shared';

/**
 * GET /account/dropship/export/csv?kind=products|orders|invoices — Settings › Data › "Export my data" as CSV (the JSON bundle
 * stays at /account/dropship/export). Allowed for active, paused and closed merchants via ds_export_rows(): products (DS model
 * numbers, the merchant's titles), orders and Octopus documents. No supplier or Octopus cost data.
 */
const SPEC: Record<string, { headers: string[]; row: (r: Record<string, unknown>) => unknown[] }> = {
  products: {
    headers: ['DS model no.', 'Title', 'Status', 'Updated (UTC)'],
    row: (r) => [r.model_no, r.title, r.status, String(r.updated_at ?? '').slice(0, 10)],
  },
  orders: {
    headers: ['Order', 'Store order', 'Channel', 'Date (UTC)', 'Country', 'Shipping', 'Duties', 'Product (USD)', 'Processing (USD)', 'Shipping (USD)',
      'Duties and tax (USD)', 'Total (USD)', 'Payment', 'Status', 'Charged (UTC)', 'Refunded (USD)', 'Delivered (UTC)', 'Cancelled (UTC)'],
    row: (r) => [r.order_number, r.external_order_name, r.channel, String(r.created_at ?? '').slice(0, 10), r.destination_country, r.shipping_method, r.incoterm,
      centsToDecimal(r.product_cents as number | null), centsToDecimal(r.processing_cents as number | null), centsToDecimal(r.shipping_cents as number | null),
      r.duties_cents == null ? 'not known yet' : centsToDecimal(r.duties_cents as number), r.total_cents == null ? 'not known yet' : centsToDecimal(r.total_cents as number),
      r.payment_state, r.merchant_status, String(r.charged_at ?? '').slice(0, 10), centsToDecimal(r.refunded_cents as number | null),
      String(r.delivered_at ?? '').slice(0, 10), String(r.cancelled_at ?? '').slice(0, 10)],
  },
  invoices: {
    headers: ['Number', 'Date (UTC)', 'Type', 'Amount', 'Paid', 'Currency', 'Status', 'Due (UTC)'],
    row: (r) => [r.number, String(r.created_at ?? '').slice(0, 10), r.doc_type, centsToDecimal(r.amount_cents as number | null), centsToDecimal(r.paid_cents as number | null),
      r.currency, r.status, String(r.due_at ?? '').slice(0, 10)],
  },
};

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL('/login?next=/account/dropship/settings', req.url));
  if (!session.org) return new NextResponse('No organisation', { status: 403 });
  const kind = req.nextUrl.searchParams.get('kind') ?? '';
  const spec = SPEC[kind];
  if (!spec) return new NextResponse('Choose products, orders or invoices.', { status: 400 });
  const sb = await createClient();
  const { data, error } = await sb.rpc('ds_export_rows', { p_kind: kind });
  if (error) return new NextResponse('Dropship data export is not available for this account.', { status: 403 });
  const rows = ((data ?? []) as Record<string, unknown>[]).map(spec.row);
  return new NextResponse(toCsv(spec.headers, rows), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="dropship-${kind}-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
