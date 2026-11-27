import { safeCustomerNext, safeNext, CUSTOMER_HOME } from '@/lib/safe-next';

/**
 * ODS T3 · sign-in helpers (Part 4.3–4.6). Pure: no server or React imports, so the route handler, the server actions,
 * the client forms and the unit tests (tests/unit/ods-auth.test.ts) share one copy.
 */

/* ───────── phone (WhatsApp), E.164 ───────── */

/**
 * "+971 50 123 4567", "+971-50-123-4567", "(+971) 501234567", "00971 50 123 4567" → "+971501234567".
 * Returns null when the result is not E.164: "+", a country code that doesn't start with 0, 8–15 digits in total.
 * We never guess a country code for a local number ("050 123 4567" → null): the person must type the "+".
 */
export function normalizeE164(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s || s.length > 32) return null;
  if (/[^\d\s+().-]/.test(s)) return null; // letters, slashes, "ext" … → not a phone number
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  const plus = s.startsWith('+') || s.startsWith('(+');
  const digits = s.replace(/\D/g, '');
  if (!plus || (s.match(/\+/g) ?? []).length !== 1) return null;
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  return `+${digits}`;
}
export const isE164 = (raw: unknown) => normalizeE164(raw) !== null;
export const PHONE_HINT = 'Start with + and your country code, for example +971 50 123 4567.';
export const PHONE_ERROR = 'Enter the number with + and the country code, for example +971 50 123 4567.';

/* ───────── role → organizations.business_type ───────── */

/**
 * "Your role" (Auth_Setup). complete_onboarding() takes p_business_type (free text, organizations.business_type); the ODS
 * setup asks for the person's role instead of a business type, so the role's label is what we store there:
 *   owner → "Owner / director", buyer → "Buyer", store_manager → "Store manager", other → "Other".
 * Rows created by the old /onboarding keep their business types ("Importer / wholesaler" …); staff read both as text.
 */
export const SETUP_ROLES = [
  { value: 'owner', label: 'Owner / director' },
  { value: 'buyer', label: 'Buyer' },
  { value: 'store_manager', label: 'Store manager' },
  { value: 'other', label: 'Other' },
] as const;
export type SetupRole = (typeof SETUP_ROLES)[number]['value'];
export function roleToBusinessType(role: unknown): string | null {
  return SETUP_ROLES.find((r) => r.value === role)?.label ?? null;
}

/* ───────── interests (the six check cards) ───────── */

/** Service keys of the six cards = odsServices keys (packages/ui tokens). Stored by save_company_interests (migration 252, draft). */
export const INTEREST_KEYS = ['sourcing', 'pools', 'dropship', '3pl', 'turnkey', 'brand'] as const;
export type InterestKey = (typeof INTEREST_KEYS)[number];
export const cleanInterests = (v: unknown[]): InterestKey[] =>
  [...new Set(v.filter((x): x is InterestKey => typeof x === 'string' && (INTEREST_KEYS as readonly string[]).includes(x)))];

/* ───────── country ───────── */

/** "Other" in the country list (a country we don't list). Stored as the ISO "unknown" code ZZ (user-assigned). */
export const OTHER_COUNTRY = 'ZZ';

/* ───────── name / avatar from the Google profile ───────── */

export type AuthIdentity = { name: string; firstName: string; initials: string; email: string; avatarUrl: string | null; provider: 'google' | 'email' };

/** Google user_metadata (full_name / name / given_name / avatar_url / picture) → what the setup card shows. */
export function identityFrom(user: { email?: string | null; user_metadata?: Record<string, unknown> | null; app_metadata?: Record<string, unknown> | null }): AuthIdentity {
  const m = user.user_metadata ?? {};
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : '');
  const email = (user.email ?? '').toLowerCase();
  const local = email.split('@')[0]?.replace(/[._-]+/g, ' ').trim() ?? '';
  const name = str(m.full_name) || str(m.name) || [str(m.given_name), str(m.family_name)].filter(Boolean).join(' ') || local || 'there';
  const firstName = str(m.given_name) || name.split(/\s+/)[0];
  const parts = name.split(/\s+/).filter(Boolean);
  const initials = ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
  const avatar = str(m.avatar_url) || str(m.picture);
  const provider = user.app_metadata?.provider === 'google' ? 'google' : 'email';
  return { name, firstName, initials, email, avatarUrl: /^https:\/\//.test(avatar) ? avatar : null, provider };
}

/* ───────── /auth/callback: where next ───────── */

export type CallbackFacts = {
  /** the ?next= from the URL (untrusted) */
  next: unknown;
  /** default landing: /shop (or /account while the Shop is switched off) */
  home?: string;
  /** ODS theme on for this visitor (lib/ods-request.ts odsOnForPublicRequest) */
  odsOn: boolean;
  /** has an org_members row (any company) */
  isMember: boolean;
  /** has a profiles row */
  hasProfile: boolean;
  /** pending Dropship team invitations for this confirmed email (ds_team_invites_for_me) */
  hasInvites?: boolean;
};

/** Token-less invite page (team invites are matched by e-mail today; real tokens come with invite e-mails later). */
export const INVITE_FOR_ME = '/invite/me';

/**
 * After the code exchange (Part 4.4), pure:
 *  - ODS on, no company: invited → the invite page (invited users skip setup); otherwise → /welcome/setup?next=<safe next>;
 *  - ODS off: today's rule, unchanged — no profile → /onboarding;
 *  - otherwise → the safe next (same-site only; anything else → home).
 */
export function callbackDestination(f: CallbackFacts): string {
  const home = f.home ?? CUSTOMER_HOME;
  const next = safeNext(f.next, home);
  if (f.odsOn) {
    if (!f.isMember) {
      // signed in from an invite page: back to it (it shows the invite, or "wrong Google account")
      if (isInviteNext(next)) return next;
      if (f.hasInvites) return INVITE_FOR_ME;
      return `/welcome/setup?next=${encodeURIComponent(safeCustomerNext(next, home))}`;
    }
    return next;
  }
  if (!f.hasProfile) return '/onboarding';
  return next;
}

/* ───────── /login states (States-Auth) ───────── */

export const LOGIN_STATES = ['cancelled', 'failed', 'link-expired', 'unavailable', 'staff-email', 'session-expired', 'signed-out', 'invite', 'wrong-account'] as const;
export type LoginState = (typeof LOGIN_STATES)[number];

/** Messages lib/auth-errors.ts friendlyAuthError() can produce: only these texts are ever shown from the URL. */
const KNOWN_ERROR_STATES: [RegExp, LoginState][] = [
  [/staff/i, 'staff-email'],
  [/cancel/i, 'cancelled'],
  [/expired|different browser|already used/i, 'link-expired'],
  [/temporarily unavailable|not available right now/i, 'unavailable'],
];

/**
 * ?error= / ?state= / ?next= → which notice the sign-in page shows. ?error= carries either a short code
 * (cancelled | failed | expired | session_expired …) or a friendlyAuthError() text from /auth/callback or proxy.ts.
 * Raw URL text is never shown: unknown text → the generic "failed" message.
 */
export function loginStateFrom(sp: { error?: string | null; state?: string | null; next?: string | null }): LoginState | null {
  const state = (sp.state ?? '').trim().toLowerCase().replace(/_/g, '-');
  const error = (sp.error ?? '').trim();
  const code = error.toLowerCase().replace(/_/g, '-');
  if (state === 'signed-out') return 'signed-out';
  if (state === 'expired' || state === 'session-expired' || code === 'session-expired') return 'session-expired';
  if (state === 'wrong-account') return 'wrong-account';
  if (error) {
    if ((LOGIN_STATES as readonly string[]).includes(code)) return code as LoginState;
    if (code === 'expired') return 'link-expired';
    for (const [re, s] of KNOWN_ERROR_STATES) if (re.test(error)) return s;
    return 'failed';
  }
  if (state === 'invite' || isInviteNext(sp.next)) return 'invite';
  return null;
}

/** next points at an invite (the new /invite/<token> page or today's Dropship team join page). */
export function isInviteNext(next: unknown): boolean {
  const n = safeNext(next, '');
  return /^\/invite\/[A-Za-z0-9_-]{1,128}(\?|$)/.test(n) || /^\/account\/dropship\/join(\?|$)/.test(n);
}
