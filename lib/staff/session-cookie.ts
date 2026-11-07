/**
 * Staff session cookie `oct_staff` (SPEC §17.3 Sessions): HMAC-signed {start, last, trusted}.
 * Set when the staff member passes 2FA at /staff/verify; the proxy bumps `last` on every staff request and
 * ends the session after 30 idle minutes (unless "trust this computer") or 12 hours in total.
 * Trusted computers (7 Nov 2026): the cookie carries a signed `until` (sign-in + trust_hours, e.g. 30 days); until then
 * there is no idle timeout and no 12-hour maximum, so the staff member is not asked for the code again on that computer.
 * Uses node:crypto (proxy runs on the Node.js runtime in Next 16). No `server-only` so the proxy and unit tests can import it.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const STAFF_COOKIE = 'oct_staff';

export type StaffCookie = { start: number; last: number; trusted: boolean; uid?: string; until?: number };

export type SessionLimits = { idleMinutes: number; maxHours: number; trustHours: number };
export const DEFAULT_LIMITS: SessionLimits = { idleMinutes: 30, maxHours: 12, trustHours: 12 };

function secret(): string {
  const s = process.env.STAFF_SESSION_SECRET || process.env.WEBHOOK_SIGNING_SECRET;
  if (!s) throw new Error('STAFF_SESSION_SECRET (or WEBHOOK_SIGNING_SECRET) is not set');
  return s;
}

function b64url(s: string | Buffer) {
  return Buffer.from(s).toString('base64url');
}

function mac(body: string, key = secret()) {
  return createHmac('sha256', key).update(body).digest('base64url');
}

export function signStaffCookie(v: StaffCookie, key?: string): string {
  const body = b64url(JSON.stringify(v));
  return `${body}.${mac(body, key ?? secret())}`;
}

export function verifyStaffCookie(raw: string | null | undefined, key?: string): StaffCookie | null {
  if (!raw) return null;
  const [body, sig] = raw.split('.');
  if (!body || !sig) return null;
  const expected = mac(body, key ?? secret());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const v = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StaffCookie;
    if (typeof v.start !== 'number' || typeof v.last !== 'number') return null;
    return { start: v.start, last: v.last, trusted: !!v.trusted, uid: v.uid, ...(typeof v.until === 'number' ? { until: v.until } : {}) };
  } catch {
    return null;
  }
}

export type SessionState = 'ok' | 'idle' | 'max';

/** Evaluate a staff session at `now` (ms). Trusted computers skip the idle timeout; the maximum age always applies. */
export function sessionState(v: StaffCookie, now = Date.now(), limits: SessionLimits = DEFAULT_LIMITS): SessionState {
  // trusted computer with a signed expiry: valid until then (no idle timeout, no normal maximum)
  if (v.trusted && typeof v.until === 'number') return now > v.until ? 'max' : 'ok';
  const maxMs = (v.trusted ? Math.min(limits.maxHours, limits.trustHours) : limits.maxHours) * 3600_000;
  if (now - v.start > maxMs) return 'max';
  if (!v.trusted && now - v.last > limits.idleMinutes * 60_000) return 'idle';
  return 'ok';
}

export function newStaffCookie(trusted: boolean, uid?: string, now = Date.now(), trustHours?: number): StaffCookie {
  return { start: now, last: now, trusted, uid, ...(trusted && trustHours ? { until: now + trustHours * 3600_000 } : {}) };
}

/** Cookie options: lives as long as the maximum session; httpOnly + secure in production. */
export function staffCookieOptions(limits: SessionLimits = DEFAULT_LIMITS, until?: number, now = Date.now()) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: until && until > now ? Math.round((until - now) / 1000) : Math.round(limits.maxHours * 3600),
  };
}

/** Short-lived marker the proxy leaves when it ends a session, so /staff/login can audit auth.session_expired. */
export const EXPIRED_COOKIE = 'oct_staff_exp';
export type ExpiredMarker = { uid: string; reason: SessionState | 'missing'; at: number };

export function signExpiredMarker(m: ExpiredMarker, key?: string): string {
  const body = b64url(JSON.stringify(m));
  return `${body}.${mac(body, key ?? secret())}`;
}

export function verifyExpiredMarker(raw: string | null | undefined, key?: string, now = Date.now()): ExpiredMarker | null {
  if (!raw) return null;
  const [body, sig] = raw.split('.');
  if (!body || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(mac(body, key ?? secret()));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const m = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ExpiredMarker;
    if (typeof m.uid !== 'string' || typeof m.at !== 'number' || now - m.at > 10 * 60_000) return null;
    return m;
  } catch {
    return null;
  }
}
