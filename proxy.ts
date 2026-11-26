import { createServerClient } from '@supabase/ssr';
import { friendlyAuthError } from '@/lib/auth-errors';
import { NextResponse, type NextRequest } from 'next/server';
import {
  DEFAULT_LIMITS, EXPIRED_COOKIE, STAFF_COOKIE, sessionState, signExpiredMarker, signStaffCookie, staffCookieOptions, verifyStaffCookie,
} from '@/lib/staff/session-cookie';

/** Customer portals: signed-out visitors go to the customer login. */
const PORTALS = ['/account', '/supplier', '/onboarding'];
/** Staff areas (SPEC §17.3): staff login + aal2 + staff session rules. */
const STAFF_AREAS = ['/office', '/admin', '/distributor', '/staff', '/scan'];
/** Staff sign-in steps that must stay reachable without a full staff session. */
const STAFF_OPEN = ['/staff/login', '/staff/verify', '/staff/forgot', '/staff/set-password'];

const under = (path: string, p: string) => path === p || path.startsWith(`${p}/`);

/** Machine endpoints: no session refresh or redirects here, only the trace id (they authenticate themselves). */
const MACHINE = ['/api/v1', '/api/webhooks', '/api/cron', '/api/health', '/api/supplier'];
/** SPEC §21: every request carries a trace id; a valid incoming one (client follow-up fetch, partner retry) is kept. */
const TRACE_HEADER = 'x-trace-id';
const TRACE_RE = /^[A-Za-z0-9._:-]{8,64}$/;

/** Mints (or keeps) the trace id and forwards it to the route as a request header. */
function traceRequest(request: NextRequest) {
  const incoming = request.headers.get(TRACE_HEADER);
  const id = incoming && TRACE_RE.test(incoming) ? incoming : crypto.randomUUID();
  request.headers.set(TRACE_HEADER, id);
  return id;
}

/**
 * Refreshes the Supabase session cookie and does optimistic auth redirects (SPEC §9 "Auth & session", §17.3).
 * Real authorization happens in RLS (has_permission + aal2) and server code; this only routes users and
 * enforces the staff idle (30 min, unless "trust this computer") and maximum (12 h) session limits.
 */
export async function proxy(request: NextRequest) {
  const traceId = traceRequest(request);
  const path = request.nextUrl.pathname;
  if (MACHINE.some((p) => under(path, p))) {
    const res = NextResponse.next({ request: { headers: request.headers } });
    res.headers.set(TRACE_HEADER, traceId);
    return res;
  }
  // Supabase sends failed OAuth sign-ins back to the Site URL ("/?error=…&error_description=…"):
  // show the message on the login page instead of silently landing on the home page.
  const oauthError = request.nextUrl.searchParams.get('error_description');
  if (path === '/' && oauthError) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('error', friendlyAuthError(oauthError));
    const res = NextResponse.redirect(url);
    res.headers.set(TRACE_HEADER, traceId);
    return res;
  }
  // ADDON-23: advertising is not part of the customer account → dashboard with a one-line notice (real 307)
  if (path === '/account/ads' || path.startsWith('/account/ads/')) {
    const url = request.nextUrl.clone();
    url.pathname = '/account';
    url.search = '?notice=not-in-account';
    const res = NextResponse.redirect(url);
    res.headers.set(TRACE_HEADER, traceId);
    return res;
  }
  // Batch 1 (F-04): Permanent HTTP 301 redirects for legacy /p/<old-slug> → clean white-label slug
  if (path.startsWith('/p/')) {
    const rest = path.slice(3);
    if (rest && !rest.includes('/')) {
      try {
        const decoded = decodeURIComponent(rest);
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (supabaseUrl && anonKey && decoded) {
          const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/resolve_product_slug_redirect`, {
            method: 'POST',
            headers: {
              apikey: anonKey,
              Authorization: `Bearer ${anonKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ p_old_slug: decoded }),
          });
          if (rpcRes.ok) {
            const newSlug = (await rpcRes.json()) as string | null;
            if (typeof newSlug === 'string' && newSlug && newSlug !== decoded) {
              const url = request.nextUrl.clone();
              url.pathname = `/p/${encodeURIComponent(newSlug)}`;
              const res = NextResponse.redirect(url, 301);
              res.headers.set('Cache-Control', 'public, max-age=3600, s-maxage=86400');
              res.headers.set(TRACE_HEADER, traceId);
              return res;
            }
          }
        }
      } catch {
        // Fall through cleanly to Next.js page route if redirect lookup fails transiently
      }
    }
  }
  // Batch 3 (F-14): real 404 status for unknown / not-yet-open public tracking links
  const trackingMatch = path.match(/^\/t\/([^/]+)$/);
  if (trackingMatch) {
    try {
      if (await publicTrackingMissing(decodeURIComponent(trackingMatch[1]))) {
        const url = request.nextUrl.clone();
        url.pathname = '/t/not-found/404';   // no route matches → Next renders the not-found page with HTTP 404
        url.search = '';
        const res = NextResponse.rewrite(url);
        res.headers.set(TRACE_HEADER, traceId);
        return res;
      }
    } catch {
      // fall through to the page, which still renders its own not-found UI
    }
  }
  const res = await route(request);
  res.headers.set(TRACE_HEADER, traceId);
  return res;
}

/**
 * Batch 3 (F-14): public parcel tracking /t/<token> answers with a real HTTP 404 (not a 404 page over 200) when
 * Octopus Dropship is not open (dropship_v2_ui OFF) or the token is unknown. Same flag rule as isDropshipV2UiEnabled().
 */
async function publicTrackingMissing(token: string): Promise<boolean> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return false;
  const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' };
  // W4: orders shipped by a Warehouse OS warehouse have their own public tracking (independent of the Dropship flag);
  // sandbox shipments are only served on staging (the RPC and the page both check)
  const whRes = await fetch(`${supabaseUrl}/rest/v1/rpc/wh_public_tracking`, {
    method: 'POST', headers, body: JSON.stringify({ p_token: token }),
  });
  if (whRes.ok) {
    const wh = (await whRes.json()) as { sandbox?: boolean } | null;
    if (wh != null && !(wh.sandbox && process.env.APP_ENVIRONMENT !== 'staging')) return false;
  }
  const flagRes = await fetch(`${supabaseUrl}/rest/v1/site_settings?select=value&key=eq.dropship_v2_ui`, { headers });
  if (!flagRes.ok) return false;
  const rows = (await flagRes.json()) as { value: unknown }[];
  const on = typeof rows[0]?.value === 'boolean' ? (rows[0].value as boolean) : process.env.APP_ENVIRONMENT === 'staging';
  if (!on) return true;
  const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/get_public_dropship_tracking`, {
    method: 'POST', headers, body: JSON.stringify({ p_token: token }),
  });
  if (!rpcRes.ok) return rpcRes.status < 500;
  return (await rpcRes.json()) == null;
}

async function route(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers: request.headers } });
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
      response.cookies.set(STAFF_COOKIE, signStaffCookie({ ...staff, last: now }), staffCookieOptions(DEFAULT_LIMITS, staff.until, now));
    }
    return response;
  }

  if (PORTALS.some((p) => under(path, p)) && !user) {
    // keep the query (e.g. /account/turnkey/new?project=gym) so the visitor comes back to the same choice, like staff areas
    return redirectTo('/login', { next: path + request.nextUrl.search });
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)'],
};
