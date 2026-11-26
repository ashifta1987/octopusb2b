import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { toCsv } from '@/components/admin/server';
import { WH_COOKIE } from '@/lib/warehouse';
import { reportCsvRows, validYmd, type Report } from '@/lib/warehouse-w6';

/**
 * Warehouse OS · W6 — CSV download of the Reports page (board 30): same wh_report() call, period, client and warehouse
 * choice as the page. The database function decides what the caller may see (warehouses they work in, 2FA staff).
 */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return new Response('Unauthorized', { status: 401 });
  if (!s.isStaff || s.aal !== 'aal2') return new Response('Forbidden', { status: 403 });
  const url = new URL(req.url);
  const from = validYmd(url.searchParams.get('from'));
  const to = validYmd(url.searchParams.get('to'));
  if (!from || !to) return new Response('Choose the period', { status: 400 });
  const orgParam = url.searchParams.get('org') ?? '';
  const org = /^[0-9a-f-]{36}$/i.test(orgParam) ? orgParam : null;
  const chosen = (await cookies()).get(WH_COOKIE)?.value;
  const warehouse = chosen && chosen !== 'all' && /^[A-Z]{2,4}-[0-9]{2}$/.test(chosen) ? chosen : null;
  const sb = await createClient();
  let { data, error } = await sb.rpc('wh_report', { p_from: from, p_to: to, p_warehouse: warehouse, p_org: org });
  // a stale warehouse choice the person no longer works in: fall back to every warehouse they see (like the page)
  if (error && warehouse && /FORBIDDEN/.test(error.message)) ({ data, error } = await sb.rpc('wh_report', { p_from: from, p_to: to, p_warehouse: null, p_org: org }));
  if (error) return new Response(/FORBIDDEN/.test(error.message) ? 'Forbidden' : 'Could not export', { status: /FORBIDDEN/.test(error.message) ? 403 : 400 });
  const out = reportCsvRows(data as Report);
  return new Response(toCsv(out.head, out.rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="warehouse-report-${from}-to-${to}${warehouse ? `-${warehouse}` : ''}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
