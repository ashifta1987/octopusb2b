import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import {
  DEFAULT_LIMITS, EXPIRED_COOKIE, STAFF_COOKIE, sessionState, signExpiredMarker, signStaffCookie, staffCookieOptions, verifyStaffCookie,
} from '@/lib/staff/session-cookie';

/** Customer portals: signed-out visitors go to the customer login. */
const PORTALS = ['/account', '/supplier', '/onboarding'];
/** Staff areas (SPEC §17.3): staff login + aal2 + staff session rules. */
const STAFF_AREAS = ['/office', '/admin', '/distributor', '/staff'];
/** Staff sign-in steps that must stay reachable without a full staff session. */
const STAFF_OPEN = ['/staff/login', '/staff/verify', '/staff/forgot', '/staff/set-password'];

const under = (path: string, p: string) => path === p || path.startsWith(`${p}/`);

/**
 * Refreshes the Supabase session cookie and does optimistic auth redirects (SPEC §9 "Auth & session", §17.3).
 * Real authorization happens in RLS (has_permission + aal2) and server code; this only routes users and
 * enforces the staff idle (30 min, unless "trust this computer") and maximum (12 h) session limits.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;
  const path = request.nextUrl.pathname;

  /** Redirect while keeping any refreshed (or cleared) Supabase cookies. */
  const redirectTo = (pathname: string, params: Record<string, string> = {}) => {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    url.search = '';
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const res = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => res.cookies.set(c));
    return res;
  };

  if (STAFF_AREAS.some((p) => under(path, p)) && !STAFF_OPEN.some((p) => under(path, p))) {
    const next = path + request.nextUrl.search;
    if (!user) return redirectTo('/staff/login', { next });
    // password-only (aal1) sessions have no staff access; /staff/verify sends non-staff (customers) to /login
    if (user.aal !== 'aal2') return redirectTo('/staff/verify', { next });

    let staff = null;
    try {
      staff = verifyStaffCookie(request.cookies.get(STAFF_COOKIE)?.value);
    } catch {
      staff = null; // no signing secret configured → treat as no staff session
    }
    // aal2 but the staff session was not started at /staff/verify (or belongs to someone else) → verify again
    if (!staff || (staff.uid && staff.uid !== user.sub)) return redirectTo('/staff/verify', { next });

    const now = Date.now();
    const state = sessionState(staff, now, DEFAULT_LIMITS);
    if (state !== 'ok') {
      await supabase.auth.signOut();
      const res = redirectTo('/staff/login', { expired: '1', next });
      res.cookies.delete(STAFF_COOKIE);
      try {
        res.cookies.set(EXPIRED_COOKIE, signExpiredMarker({ uid: user.sub as string, reason: state, at: now }), {
          httpOnly: true, sameSite: 'lax', path: '/', maxAge: 600, secure: process.env.NODE_ENV === 'production',
        });
      } catch {
        // no secret: the login page simply can't audit the expiry
      }
      return res;
    }
    // sliding idle window: bump `last` (at most once a minute to limit cookie writes)
    if (now - staff.last > 60_000) {
      response.cookies.set(STAFF_COOKIE, signStaffCookie({ ...staff, last: now }), staffCookieOptions(DEFAULT_LIMITS));
    }
    return response;
  }

  if (PORTALS.some((p) => under(path, p)) && !user) {
    return redirectTo('/login', { next: path });
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/v1|api/webhooks|api/cron|api/health|api/supplier|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)'],
};
