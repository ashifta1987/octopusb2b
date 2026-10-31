import { NextResponse, type NextRequest } from 'next/server';

/**
 * Legacy §16 2FA page — superseded by the staff verification step (SPEC §17). Kept as a redirect so old links
 * (e.g. backups "verify with your authenticator app") land on /staff/verify as a step-up re-check.
 */
export function GET(req: NextRequest) {
  const url = new URL(req.url);
  const n = url.searchParams.get('next');
  const next = n && n.startsWith('/') && !n.startsWith('//') ? n : '/staff/workspace';
  const target = new URL('/staff/verify', url.origin);
  target.searchParams.set('next', next);
  target.searchParams.set('reason', 'step_up');
  return NextResponse.redirect(target);
}
