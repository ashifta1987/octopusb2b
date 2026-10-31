/**
 * Step-up helpers (SPEC §17.3 "Sensitive actions ask for the code again if it is older than 10 minutes").
 * Pure module — safe in server actions, server components and client components.
 */

function errorText(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (typeof err === 'object') {
    const e = err as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown; error?: unknown };
    return [e.message, e.code, e.details, e.hint, typeof e.error === 'string' ? e.error : (e.error as { message?: string } | undefined)?.message]
      .filter((x) => typeof x === 'string')
      .join(' ');
  }
  return String(err);
}

/**
 * True when a DB/RPC error means "verify your code again": STEP_UP_REQUIRED (require_step_up()), MFA_REQUIRED,
 * or a row-level-security failure on user_roles / role_permissions (their write policies require mfa_fresh()).
 */
export function isStepUpError(err: unknown): boolean {
  const t = errorText(err);
  if (!t) return false;
  if (/STEP_UP_REQUIRED|MFA_REQUIRED/.test(t)) return true;
  return /row[- ]level security/i.test(t) && /user_roles|role_permissions/i.test(t);
}

/** Where to send the user to re-verify, coming back to `path` afterwards. */
export function stepUpRedirect(path: string): string {
  const safe = path && path.startsWith('/') && !path.startsWith('//') ? path : '/staff/workspace';
  return `/staff/verify?next=${encodeURIComponent(safe)}&reason=step_up`;
}
