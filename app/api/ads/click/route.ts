import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * Pay-per-click redirect (SPEC §4.8, AdsAdmin). Records the click with `record_ad_click` (service-role only:
 * de-dupes per fingerprint/24h, enforces budget + wallet) and redirects to the campaign link.
 * Fingerprint = sha256(ip + user-agent); raw IPs are never stored.
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('c') ?? '';
  const home = new URL('/', req.url);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.redirect(home, 302);

  const sb = createAdminClient();
  const { data: c } = await sb.from('ad_campaigns').select('id, link, status').eq('id', id).maybeSingle();
  if (!c) return NextResponse.redirect(home, 302);

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('x-real-ip') || '';
  const ua = req.headers.get('user-agent') ?? '';
  const isBot = /bot|crawl|spider|slurp|preview|headless/i.test(ua);
  if (c.status === 'active' && !isBot) {
    const fingerprint = createHash('sha256').update(`${ip}|${ua}`).digest('hex');
    const { error } = await sb.rpc('record_ad_click', { p_campaign: id, p_fingerprint: fingerprint });
    if (error) console.error('record_ad_click failed', error.message);
  }

  let target = home;
  try {
    const u = new URL(c.link || '/', req.url);
    if (u.protocol === 'http:' || u.protocol === 'https:') target = u;
  } catch {
    /* invalid link → home */
  }
  const res = NextResponse.redirect(target, 302);
  res.headers.set('Cache-Control', 'no-store');
  res.headers.set('X-Robots-Tag', 'noindex');
  return res;
}
