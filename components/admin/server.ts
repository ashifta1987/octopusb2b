import 'server-only';
import { getSession, can, type Session } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { mapDbError } from '@/lib/format';
import { isStepUpError, stepUpRedirect } from '@/lib/staff/step-up';

/**
 * Shared result shape for every admin server action.
 * `error: 'STEP_UP_REQUIRED'` (+ optional `redirect`) means "re-enter your 2FA code" (SPEC §17.3): the admin client
 * components navigate to `redirect` (or `/staff/verify?next=<current page>&reason=step_up`).
 */
export type Result = { ok: true; message?: string } | { ok: false; error: string; redirect?: string };

export const STEP_UP = 'STEP_UP_REQUIRED';

/** Step-up needed: send the user to /staff/verify and back to `path` afterwards. */
export const stepUp = (path: string): Result => ({ ok: false, error: STEP_UP, redirect: stepUpRedirect(path) });

/** Like `fail`, but a step-up error (STEP_UP_REQUIRED / MFA_REQUIRED / RLS on user_roles|role_permissions) redirects back to `path`. */
export function failAt(e: string | { message?: string } | null | undefined, path: string): Result {
  return isStepUpError(e) ? stepUp(path) : fail(e);
}

/** Pre-check before writes that RLS would silently drop (DELETE on user_roles/role_permissions): is the last code fresh? */
export async function requireFresh(sb: Awaited<ReturnType<typeof createClient>>, path: string): Promise<Result | null> {
  const { data, error } = await sb.rpc('mfa_fresh');
  if (error) return fail(error);
  return data === true ? null : stepUp(path);
}

export const ok = (message?: string): Result => ({ ok: true, message });

const EXTRA: Record<string, string> = {
  PUBLISH_NEEDS_ADMIN: 'Only an Admin can publish or change live legal content. Submit it for review instead.',
  TERMS_NEED_15_SECTIONS: 'Terms must have exactly 15 sections before publishing.',
  REASON_REQUIRED: 'Please give a reason.',
  NOT_FOUND: 'Not found.',
  INVALID_KEY: 'Invalid setting key.',
};

export function fail(e: string | { message?: string } | null | undefined): Result {
  const raw = typeof e === 'string' ? e : e?.message ?? 'Something went wrong';
  const code = raw.split(':')[0].trim();
  if (isStepUpError(raw)) return { ok: false, error: STEP_UP };
  if (EXTRA[code]) return { ok: false, error: EXTRA[code] };
  if (/duplicate key/i.test(raw)) return { ok: false, error: 'That record already exists.' };
  if (/row-level security|permission denied/i.test(raw)) return { ok: false, error: 'You do not have permission to do this.' };
  return { ok: false, error: mapDbError({ message: raw }) };
}

/** Authorise a server action against the permission matrix (RLS / RPCs enforce it again in the database). */
export async function guard(area: string, action = 'view'): Promise<{ s: Session; sb: Awaited<ReturnType<typeof createClient>> } | { error: Result }> {
  const s = await getSession();
  if (!s) return { error: fail('Please sign in again.') };
  if (!s.isStaff || !can(s, area, action)) return { error: fail('FORBIDDEN') };
  const sb = await createClient();
  return { s, sb };
}

export function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v.trim() : '';
}

export function bool(fd: FormData, key: string): boolean {
  const v = fd.get(key);
  return v === 'on' || v === 'true' || v === '1';
}

/** Escape a value for CSV output. */
export function csvCell(v: unknown): string {
  if (v == null) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(head: string[], rows: unknown[][]): string {
  return [head.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n') + '\r\n';
}

export function monthLabel(d: string | Date) {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Request-time clock for server components (pages are dynamic: they read the session cookie first). */
export function nowMs(): number {
  return Date.now();
}
