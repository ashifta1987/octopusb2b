import { NextResponse, type NextRequest } from 'next/server';
import { ODS_PREVIEW_COOKIE } from '@/lib/ods-flag';
import { safeNext } from '@/lib/safe-next';

/**
 * STAGING ONLY: preview the ODS theme in this browser without touching ods_theme_v1.
 *   /dev/ods-preview?mode=on|all|off|clear&next=/   (next must be a same-site path)
 * Sets the `ods_preview` cookie (lib/ods-flag.ts), which the server ignores on live anyway. 404 on live.
 */
export async function GET(req: NextRequest) {
  if (process.env.APP_ENVIRONMENT !== 'staging') return new NextResponse('Not found', { status: 404 });
  const mode = (req.nextUrl.searchParams.get('mode') ?? 'on').toLowerCase();
  const res = NextResponse.redirect(new URL(safeNext(req.nextUrl.searchParams.get('next'), '/'), req.url), 303);
  if (mode === 'clear') res.cookies.delete(ODS_PREVIEW_COOKIE);
  else if (mode === 'on' || mode === 'all' || mode === 'off')
    res.cookies.set(ODS_PREVIEW_COOKIE, mode, { path: '/', sameSite: 'lax', httpOnly: false, maxAge: 60 * 60 * 24 * 7, secure: req.nextUrl.protocol === 'https:' });
  else return new NextResponse('mode must be on, all, off or clear', { status: 400 });
  return res;
}
