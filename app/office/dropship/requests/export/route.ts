import { getSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { toCsv } from '@/components/admin/server';

/** EA-1 (design v2 StaffRequests › Export): staff CSV of merchant product requests. No supplier or cost columns.
 *  The database function enforces who may read (Dropship / Sourcing staff, 2FA). */
export async function GET() {
  const s = await getSession();
  if (!s) return new Response('Unauthorized', { status: 401 });
  if (!s.isStaff || s.aal !== 'aal2') return new Response('Forbidden', { status: 403 });
  const sb = await createClient();
  const { data, error } = await sb.rpc('list_dropship_product_requests', { p_status: null });
  if (error) return new Response(/FORBIDDEN/.test(error.message) ? 'Forbidden' : 'Could not export', { status: /FORBIDDEN/.test(error.message) ? 403 : 400 });
  const usd = (v: unknown) => (v == null ? '' : (Number(v) / 100).toFixed(2));
  const rows = (data ?? []) as {
    rfq_code: string; title: string; rfq_status: string; merchant_label: string | null; org_name: string;
    ship_to_countries: string[] | null; monthly_volume_band: string | null; wants_brand: boolean;
    target_landed_cents: number | null; quoted_landed_cents: number | null; quoted_country: string | null; created_at: string;
  }[];
  const csv = toCsv(
    ['request', 'merchant', 'product', 'status', 'target_landed_usd', 'countries', 'orders_per_month', 'own_brand', 'quoted_landed_usd', 'quoted_country', 'created_at'],
    rows.map((r) => [
      r.rfq_code, r.org_name, r.title, r.merchant_label ?? r.rfq_status, usd(r.target_landed_cents),
      (r.ship_to_countries ?? []).join(' '), r.monthly_volume_band ?? '', r.wants_brand ? 'yes' : 'no',
      usd(r.quoted_landed_cents), r.quoted_country ?? '', r.created_at,
    ]),
  );
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="product-requests-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
