import { getSession, can } from '@/lib/auth';
import { COUNTRY_NAMES } from '@/lib/format';
import { toCsv } from '@/components/admin/server';
import { loadGeography } from '../data';

/** CSV of customers by country (same filters as the page). Requires customers:view. */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return new Response('Unauthorized', { status: 401 });
  if (!s.isStaff || !can(s, 'customers', 'view')) return new Response('Forbidden', { status: 403 });
  const p = new URL(req.url).searchParams;
  const days = Number(p.get('period') || 0);
  const { rows, ctx } = await loadGeography({
    kyc: p.get('kyc') || undefined, type: p.get('type') || undefined, region: p.get('region') || undefined,
    since: days ? new Date(Date.now() - days * 864e5).toISOString() : undefined,
  });
  // GMV per order currency + total converted into the platform currency at the approved rate (SPEC §15.1)
  const csv = toCsv(['country_code', 'country', 'region', 'customers', 'kyc_verified', 'kyc_pending', 'kyc_not_started', 'kyc_rejected', 'orders',
    'gmv_usd', 'gmv_cny', 'gmv_converted', 'currency', 'fx_rate_cny_per_usd'],
    rows.map((r) => [r.country, COUNTRY_NAMES[r.country] ?? r.country, r.region, r.customers, r.verified, r.pending, r.notStarted, r.rejected, r.orders,
      ((r.gmvBy.USD ?? 0) / 100).toFixed(2), ((r.gmvBy.CNY ?? 0) / 100).toFixed(2), (r.gmv / 100).toFixed(2), ctx.currency, ctx.rate]));
  return new Response('\uFEFF' + csv, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="octopus-geography-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store' },
  });
}
