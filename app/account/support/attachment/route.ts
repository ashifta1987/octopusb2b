import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Ticket attachment download: creates a 60 s signed URL server-side with the user's session (storage RLS limits
 * access to the caller's org folder, or support staff) and redirects to it. Links on the page never go stale.
 */
export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get('p');
  if (!path || path.includes('..')) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const sb = await createClient();
  const { data: auth } = await sb.auth.getClaims();
  if (!auth?.claims?.sub) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent('/account/support')}`, req.url));
  const { data, error } = await sb.storage.from('tickets').createSignedUrl(path, 60);
  if (error || !data?.signedUrl) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.redirect(data.signedUrl, { headers: { 'Cache-Control': 'no-store' } });
}
