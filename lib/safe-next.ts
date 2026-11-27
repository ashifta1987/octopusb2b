/**
 * CH-1: the one same-site "?next=" check for every sign-in path (login, sign-up, OAuth / email callback, onboarding, proxy).
 * Only a path on this site is followed: one leading "/", no "//", no backslash (browsers read "/\evil.com" as "//evil.com"),
 * no control characters, no encoded slash / backslash / dot-segment tricks, nothing under /api or /auth (machine and sign-in
 * endpoints). Anything else → the fallback. Pure (no server imports) so the client form, the proxy and unit tests share it.
 */
export const CUSTOMER_HOME = '/shop';

export function safeNext(n: unknown, fallback: string = CUSTOMER_HOME): string {
  if (typeof n !== 'string') return fallback;
  const s = n.trim();
  if (!s || s.length > 512) return fallback;
  if (!s.startsWith('/') || s.startsWith('//')) return fallback;
  if (s.includes('\\')) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(s)) return fallback;
  let decoded = s;
  try {
    decoded = decodeURIComponent(s);
  } catch {
    return fallback;
  }
  if (decoded.startsWith('//') || decoded.includes('\\') || /[\u0000-\u001f\u007f]/.test(decoded)) return fallback;
  if (/(^|\/)\.\.?(\/|$)/.test(decoded.split(/[?#]/)[0])) return fallback;
  const path = s.split(/[?#]/)[0].toLowerCase();
  if (path === '/api' || path.startsWith('/api/') || path === '/auth' || path.startsWith('/auth/')) return fallback;
  return s;
}

/** Customer areas a sign-up / onboarding may continue to (no open redirects, no staff areas). */
export function safeCustomerNext(n: unknown, fallback: string = CUSTOMER_HOME): string {
  const s = safeNext(n, '');
  return s && /^\/(account|shop)(\/[\w.~-]+)*\/?(\?[\w=&%.~+-]*)?$/.test(s) ? s : fallback;
}

/** Where a signed-in person lands when no (usable) next is given. Staff go through /staff/verify (2FA) first. */
export function landingFor(who: { isStaff: boolean; isSupplier: boolean }): string {
  if (who.isStaff) return '/staff/verify';
  if (who.isSupplier) return '/supplier';
  return CUSTOMER_HOME;
}
