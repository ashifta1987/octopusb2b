import { getSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { toCsv } from '@/components/admin/server';
import { reportCsv, reportPeriod, TK_REPORT_KINDS, type TkReportKind } from '@/lib/turnkey/reports';

/**
 * Turnkey T7 — CSV download of one Turnkey report (design: Reports). Same database functions and period as the page;
 * money in integer US cents. The functions decide who may read (Turnkey staff of the TK division on 2FA).
 */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return new Response('Unauthorized', { status: 401 });
  if (!s.isStaff || s.aal !== 'aal2') return new Response('Forbidden', { status: 403 });
  const url = new URL(req.url);
  const kind = url.searchParams.get('report') as TkReportKind | null;
  if (!kind || !TK_REPORT_KINDS.includes(kind)) return new Response('Unknown report', { status: 400 });
  const period = reportPeriod(url.searchParams.get('months') ?? undefined, new Date());
  const sb = await createClient();
  const range = { p_from: period.from, p_to: null, p_include_test: false };
  const { data, error } = kind === 'fees' ? await sb.rpc('tk_report_fees_by_service', range)
    : kind === 'funnel' ? await sb.rpc('tk_report_funnel', range)
    : kind === 'ageing' ? await sb.rpc('tk_report_unpaid_ageing', { p_include_test: false })
    : kind === 'unpaid' ? await sb.rpc('tk_report_unpaid_list', { p_include_test: false })
    : await sb.rpc('tk_report_inspector_load', range);
  if (error) return new Response(/FORBIDDEN/.test(error.message) ? 'Forbidden' : 'Could not export', { status: /FORBIDDEN/.test(error.message) ? 403 : 400 });
  const out = reportCsv(kind, (data ?? []) as unknown[]);
  const stamp = new Date().toISOString().slice(0, 10);
  const scope = kind === 'ageing' || kind === 'unpaid' ? 'today' : period.months ? `${period.months}m` : 'all';
  return new Response(toCsv(out.head, out.rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="turnkey-${kind}-${scope}-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
