import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /account/dropship/export -> JSON bundle of the merchant's Octopus Dropship
 * profile, selling countries, store orders, documents (OCT-DS / STMT-DS), and withdrawals.
 * Allowed for active, paused, and closed merchants via `export_my_dropship_data()`.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.redirect(new URL('/login?next=/account/dropship/settings', req.url));
  }
  if (!session.org) {
    return new NextResponse('No organisation', { status: 403 });
  }

  const sb = await createClient();
  const { data, error } = await sb.rpc('export_my_dropship_data');
  if (error || !data) {
    return new NextResponse('Dropship data export is not available for this account.', {
      status: 403,
    });
  }

  const datePart = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(data, null, 2) + '\n', {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="octopus-dropship-export-${datePart}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}
