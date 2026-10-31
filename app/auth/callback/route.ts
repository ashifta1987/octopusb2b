import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/** OAuth / magic-link callback: exchanges the code for a session, then routes to onboarding if no profile. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/account';
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/account';
  if (code) {
    const sb = await createClient();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin));
    const { data: u } = await sb.auth.getUser();
    const { data: profile } = await sb.from('profiles').select('id').eq('id', u.user!.id).maybeSingle();
    if (!profile) return NextResponse.redirect(new URL('/onboarding', url.origin));
  }
  return NextResponse.redirect(new URL(safeNext, url.origin));
}
