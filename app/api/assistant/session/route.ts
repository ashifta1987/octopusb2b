import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { loadBootstrap } from '@/lib/assistant/bootstrap';

/** GET /api/assistant/session?id=&page= — conversation bootstrap for the floating drawer (messages, account team, context hint). */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  if (!s.org) return NextResponse.json({ error: 'Please complete your company profile first.' }, { status: 400 });
  const url = new URL(req.url);
  const data = await loadBootstrap(await createClient(), s.org, { sessionId: url.searchParams.get('id'), page: url.searchParams.get('page')?.slice(0, 300) ?? null });
  if (!data.enabled) return NextResponse.json({ error: 'Octo is switched off right now.', enabled: false }, { status: 503 });
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
}
