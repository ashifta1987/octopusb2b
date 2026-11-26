import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { REPORT_CSV_HEADERS, reportCsvRows, toCsv } from '@/lib/dropship-ds12-shared';
import type { ReportCsvRow } from '@/lib/dropship-ds12';

/**
 * GET /account/dropship/reports/csv?from=ISO&to=ISO[&country=XX] — the Reports screen's orders as CSV (one row per charged
 * order: store sales in USD at the locked FX, cost lines, refunds, profit before ads, delivery). Read through
 * ds_reports_csv() (own organisation, feature list, paused / closed merchants keep their history). Spreadsheet-safe cells.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL('/login?next=/account/dropship/reports', req.url));
  if (!session.org) return new NextResponse('No organisation', { status: 403 });
  const sp = req.nextUrl.searchParams;
  const from = sp.get('from');
  const to = sp.get('to');
  const country = sp.get('country');
  if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) return new NextResponse('Choose a period.', { status: 400 });
  if (country && !/^[A-Z]{2}$/.test(country)) return new NextResponse('Unknown country.', { status: 400 });
  const sb = await createClient();
  const { data, error } = await sb.rpc('ds_reports_csv', { p_from: from, p_to: to, p_country: country });
  if (error) return new NextResponse('Reports are not available for this account.', { status: 403 });
  const csv = toCsv(REPORT_CSV_HEADERS, reportCsvRows((data ?? []) as ReportCsvRow[]));
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="dropship-report-${from.slice(0, 10)}-to-${to.slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
