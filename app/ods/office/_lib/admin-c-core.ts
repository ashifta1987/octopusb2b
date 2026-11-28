/**
 * ODS T9 · Admin batch C (Staff & roles, Divisions, Company, Payment / Dropship settings, Backups) — PURE helpers
 * shared by the loaders, the client screens, the staging fixtures and tests/unit/ods-office-admin.test.ts. Rules are
 * copied from today's pages (app/admin/staff, company …) — nothing new is decided here.
 */

export type StaffSec = {
  user_id: string; email: string; last_sign_in_at: string | null; totp_factors: number; active_sessions: number; banned_until: string | null;
  invited_at: string | null; email_confirmed: boolean; locked_until: string | null;
};

export type StaffStatusKey = 'deactivated' | 'locked' | 'invited' | 'active';

/** Today's status order: deactivated (inactive or banned) → locked → invited (email not confirmed) → active. */
export function staffStatus(active: boolean, sec: StaffSec | null | undefined, nowMs: number): { key: StaffStatusKey; label: string; tone: 'neutral' | 'danger' | 'info' | 'success' } {
  const banned = !!sec?.banned_until && new Date(sec.banned_until).getTime() > nowMs;
  if (!active || banned) return { key: 'deactivated', label: 'Deactivated', tone: 'neutral' };
  if (sec?.locked_until) return { key: 'locked', label: 'Locked', tone: 'danger' };
  if (sec != null && !sec.email_confirmed) return { key: 'invited', label: 'Invited', tone: 'info' };
  return { key: 'active', label: 'Active', tone: 'success' };
}

export type StaffActionFlags = { resendInvite: boolean; unlock: boolean; reset2fa: boolean; endSessions: boolean; toggleActive: boolean };

/** Which row actions today's page offers (same conditions, one place). */
export function staffActions(o: {
  canEdit: boolean; canCreate: boolean; isAdmin: boolean; self: boolean; targetIsAdmin: boolean; status: StaffStatusKey; twoFa: boolean; sessions: number; hasSec: boolean;
}): StaffActionFlags {
  const deactivated = o.status === 'deactivated';
  return {
    resendInvite: o.canCreate && o.status === 'invited',
    unlock: o.canEdit && o.status === 'locked' && o.hasSec,
    reset2fa: o.isAdmin && !o.self && o.twoFa && !deactivated,
    endSessions: o.canEdit && !o.self && o.sessions > 0,
    toggleActive: o.canEdit && !o.self && (!o.targetIsAdmin || o.isAdmin),
  };
}

/** "Chrome · macOS" from a user agent (today's audit device column). */
export function deviceLabel(ua: unknown): string {
  if (typeof ua !== 'string' || !ua) return '—';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /node|curl|undici/i.test(ua) ? 'Script' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} · ${os}` : browser;
}

export const EVENT_LABEL: Record<string, string> = {
  'auth.sign_in': 'Signed in', 'auth.sign_in_failed': 'Sign-in failed', 'auth.password_failed': 'Wrong password', 'auth.totp_failed': 'Wrong 2FA code',
  'auth.backup_code_failed': 'Wrong backup code', 'auth.google_failed': 'Google sign-in refused', 'auth.lockout': 'Account locked', 'auth.unlocked': 'Account unlocked',
  'auth.2fa_enrolled': '2FA set up', 'auth.2fa_verified': '2FA verified', 'auth.2fa_reset': '2FA reset by Admin', 'auth.backup_code_used': 'Backup code used',
  'auth.workspace_switch': 'Workspace switch', 'auth.sign_out': 'Signed out', 'auth.session_expired': 'Session expired', 'auth.sessions_ended': 'Sessions ended',
  'auth.password_reset_requested': 'Password reset requested', 'auth.invite_sent': 'Invitation sent', 'auth.security_settings': 'Security settings changed',
};
const EVENT_TONE: Record<string, 'danger' | 'warning' | 'success' | 'info'> = {
  'auth.lockout': 'danger', 'auth.2fa_reset': 'warning', 'auth.security_settings': 'warning', 'auth.sessions_ended': 'warning', 'auth.sign_in': 'success', 'auth.invite_sent': 'info',
};
export function securityEvent(action: string): { label: string; tone: 'danger' | 'warning' | 'success' | 'info' | 'neutral' } {
  return {
    label: EVENT_LABEL[action] ?? action.replace(/^auth\./, '').replace(/_/g, ' '),
    tone: EVENT_TONE[action] ?? (/failed$/.test(action) ? 'warning' : 'neutral'),
  };
}

/** Permission matrix (today): generic areas × 6 actions; areas with their own actions (Backups) as a separate list. */
export const MATRIX_ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'export'] as const;
export const AREA_ACTIONS: Record<string, readonly string[]> = { backups: ['view', 'backup', 'download', 'export', 'request_restore', 'approve_restore'] };

/* ───────── company ───────── */

export const COMPANY_LABELS: Record<string, string> = {
  legal_name: 'Legal name', legal_name_cn: 'Legal name (Chinese)', registration_no: 'Registration no.', tax_id: 'Tax ID',
  address: 'Registered address', address_cn: 'Registered address (Chinese)', registered_in: 'Registered in',
};

/** Fields that changed in one company_profile audit entry (today's `changes`). */
export function companyChanges(details: unknown): string[] {
  const x = (details ?? {}) as { old?: Record<string, unknown>; new?: Record<string, unknown> };
  return Object.keys(COMPANY_LABELS).filter((k) => x.old && x.new && JSON.stringify(x.old[k] ?? null) !== JSON.stringify(x.new[k] ?? null));
}

export const maskAccount = (n: string | null | undefined) => (n ? `•••• ${n.slice(-4)}` : '—');

/* ───────── payment settings ───────── */

/** Today's rule: company-wide Admin or company-wide Finance (role), and editing needs admin or finance:edit. */
export function paymentSettingsAccess(s: { isAdmin: boolean; roles: string[]; canFinanceEdit: boolean }): { allowed: boolean; canEdit: boolean } {
  const allowed = s.isAdmin || s.roles.includes('finance');
  return { allowed, canEdit: allowed && (s.isAdmin || s.canFinanceEdit) };
}

/* ───────── backups ───────── */

export type BackupLite = { status: string; created_at: string; finished_at?: string | null; size_bytes?: number | null; trigger?: string | null };

/** Header figures from today's backups list: last successful backup, how many failed, size of the newest completed one. */
export function backupSummary(backups: BackupLite[]) {
  const done = backups.filter((b) => b.status === 'completed');
  const last = done[0] ?? null;
  return {
    lastAt: last ? last.finished_at ?? last.created_at : null,
    lastSize: last?.size_bytes ?? null,
    completed: done.length,
    failed: backups.filter((b) => b.status === 'failed').length,
    running: backups.some((b) => b.status === 'queued' || b.status === 'running'),
  };
}

export function bytesText(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toLocaleString('en-US', { maximumFractionDigits: i ? 1 : 0 })} ${u[i]}`;
}
