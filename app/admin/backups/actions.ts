'use server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/server';
import { guard, fail, ok, str, bool, type Result } from '@/components/admin/server';
import { errorCode, errorText, type BackupSettings } from '@/components/admin/backups/shared';

/** Result that keeps the raw DB error code so the client can react (e.g. MFA_REQUIRED → /mfa). */
export type CodeResult<T = object> = ({ ok: true } & T) | { ok: false; error: string; code: string };

function bad(e: { message?: string } | string | null | undefined): { ok: false; error: string; code: string } {
  const raw = typeof e === 'string' ? e : e?.message ?? 'Something went wrong';
  return { ok: false, error: errorText(raw), code: errorCode(raw) };
}

const PAGE = '/admin/backups';

/** Step 1 of the restore wizard: create the request (rpc request_restore → status "verifying"). The client then starts verification. */
export async function requestRestore(input: { backupId: string; type: string; reason: string; modules: string[]; records: Record<string, string[]> }): Promise<CodeResult<{ id: string }>> {
  const g = await guard('backups', 'request_restore');
  if ('error' in g) return bad('FORBIDDEN');
  if (!['full_staging', 'full_production', 'partial', 'drill'].includes(input.type)) return bad('Pick what to restore.');
  if (!input.reason.trim()) return bad('REASON_REQUIRED');
  const { data, error } = await g.sb.rpc('request_restore', {
    p_backup: input.backupId, p_type: input.type, p_reason: input.reason.trim(),
    p_modules: input.type === 'partial' ? input.modules : [], p_records: input.type === 'partial' ? input.records : {},
  });
  if (error) return bad(error);
  revalidatePath(PAGE);
  return { ok: true, id: data as string };
}

export async function approveRestore(id: string): Promise<CodeResult> {
  const g = await guard('backups', 'approve_restore');
  if ('error' in g) return bad('FORBIDDEN');
  const { error } = await g.sb.rpc('approve_restore', { p_id: id });
  if (error) return bad(error);
  revalidatePath(PAGE);
  return { ok: true };
}

export async function cancelRestore(id: string, reason?: string): Promise<Result> {
  const g = await guard('backups', 'view');
  if ('error' in g) return g.error;
  const { error } = await g.sb.rpc('cancel_restore', { p_id: id, p_reason: reason?.trim() || null });
  if (error) return { ok: false, error: errorText(error.message) };
  revalidatePath(PAGE);
  return ok('Request cancelled');
}

/** Notify possible second approvers (Finance for money-touching restores, otherwise Admins) — in-app notifications. */
export async function sendApproverReminder(id: string): Promise<Result> {
  const g = await guard('backups', 'request_restore');
  if ('error' in g) return g.error;
  const { data: r, error } = await g.sb.from('restore_requests').select('id, code, touches_money, status, requested_by, backups(code)').eq('id', id).maybeSingle();
  if (error || !r) return fail('NOT_FOUND');
  if (r.status !== 'pending_approval') return { ok: false, error: 'Only requests waiting for approval can be reminded.' };
  const admin = createAdminClient();
  // Approvers must hold backups:approve_restore (admins always do); money-touching restores: Finance or Admin, else another Admin.
  const { data: perm } = await admin.from('role_permissions').select('role_code').eq('area', 'backups').eq('action', 'approve_restore');
  const allowed = new Set(['admin', ...(perm ?? []).map((p) => p.role_code as string)]);
  const roles = (r.touches_money ? ['finance', 'admin'] : ['admin']).filter((x) => allowed.has(x));
  const { data: users } = await admin.from('user_roles').select('user_id').in('role_code', roles);
  const ids = [...new Set((users ?? []).map((u) => u.user_id as string))].filter((u) => u !== r.requested_by);
  if (!ids.length) return { ok: false, error: 'No other approver account found. Add a second Admin or Finance user on Staff & roles.' };
  const bk = (r.backups as unknown as { code: string } | null)?.code ?? '';
  const { error: e2 } = await admin.from('notifications').insert(ids.map((user_id) => ({
    user_id, title: `Restore ${r.code} is waiting for your approval`,
    body: `Restore from ${bk} was verified and needs a second approver (re-enter 2FA to approve).`, link: `${PAGE}?rs=${r.id}#restore`,
  })));
  if (e2) return fail(e2);
  await admin.from('audit_log').insert({ actor_id: g.s.userId, action: 'restore.reminder', entity: 'restore_requests', entity_id: r.id, details: { notified: ids.length } });
  return ok(`Reminder sent to ${ids.length} approver${ids.length === 1 ? '' : 's'}`);
}

export async function requestExport(input: { modules: string[]; format: string; from: string; to: string; email: boolean; title: string }): Promise<CodeResult<{ id: string }>> {
  const g = await guard('backups', 'export');
  if ('error' in g) return bad('FORBIDDEN');
  if (!input.modules.length) return bad('MODULES_REQUIRED');
  if (input.from && input.to && input.from > input.to) return bad('The "From" date must be before the "To" date.');
  const { data, error } = await g.sb.rpc('request_export', {
    p_modules: input.modules, p_format: input.format, p_from: input.from || null, p_to: input.to || null, p_email: input.email, p_title: input.title || null,
  });
  if (error) return bad(error);
  revalidatePath(PAGE);
  return { ok: true, id: data as string };
}

const int = (v: string, min: number, max: number, dflt: number) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};

/** Admin only. No secrets are ever stored here — keys live in GitHub / Vercel secrets. */
export async function saveBackupSettings(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('backups', 'view');
  if ('error' in g) return g.error;
  if (!g.s.isAdmin) return fail('FORBIDDEN');
  const { data: cur } = await g.sb.from('site_settings').select('value').eq('key', 'backup_settings').maybeSingle();
  const prev = (cur?.value ?? {}) as BackupSettings;
  const email = str(fd, 'alert_email');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Enter a valid alert email.' };
  const SCHEDULES: Record<string, string> = { '0 18 * * *': 'Nightly 02:00 China time', '0 6,18 * * *': 'Every 12 hours', '0 */6 * * *': 'Every 6 hours' };
  const schedule = SCHEDULES[str(fd, 'schedule')] ? str(fd, 'schedule') : prev.schedule ?? '0 18 * * *';
  const settings: BackupSettings = {
    schedule, schedule_label: SCHEDULES[schedule] ?? prev.schedule_label,
    keep_daily: int(str(fd, 'keep_daily'), 1, 365, 14),
    keep_weekly: int(str(fd, 'keep_weekly'), 0, 104, 8),
    keep_monthly: int(str(fd, 'keep_monthly'), 0, 120, 12),
    keep_exports_months: int(str(fd, 'keep_exports_months'), 1, 120, 12),
    offsite: {
      ...(prev.offsite ?? {}),
      provider: str(fd, 'offsite_provider'), bucket: str(fd, 'offsite_bucket'), endpoint: str(fd, 'offsite_endpoint'), region: str(fd, 'offsite_region') || 'auto',
    },
    key_fingerprint: str(fd, 'key_fingerprint'),
    alert_email: email,
    monthly_drill: bool(fd, 'monthly_drill'),
    alert_missing_hours: int(str(fd, 'alert_missing_hours'), 1, 240, 26),
    pitr_enabled: bool(fd, 'pitr_enabled'),
    require_mfa: bool(fd, 'require_mfa'),
  };
  const { error } = await g.sb.rpc('update_backup_settings', { p_settings: settings });
  if (error) return { ok: false, error: errorText(error.message) };
  revalidatePath(PAGE);
  return ok('Settings saved');
}

/** Admin: maintenance mode on/off (storefront + portals show the CMS notice, API returns 503). */
export async function setMaintenanceMode(enabled: boolean, message: string, retryAfter: number): Promise<Result> {
  const g = await guard('backups', 'view');
  if ('error' in g) return g.error;
  if (!g.s.isAdmin) return fail('FORBIDDEN');
  const { error } = await g.sb.rpc('set_maintenance', { p_enabled: enabled, p_message: message.trim() || null, p_retry_after: Number.isFinite(retryAfter) && retryAfter > 0 ? Math.round(retryAfter) : null });
  if (error) return { ok: false, error: errorText(error.message) };
  revalidateTag('site-content', 'max');
  revalidatePath(PAGE);
  return ok(enabled ? 'Maintenance mode is ON' : 'Maintenance mode is OFF');
}

/** Partial restore: copy selected rows back from the recovery schema (money tables are refused by the RPC). */
export async function restoreRecords(table: string, ids: string[], reason: string): Promise<CodeResult<{ count: number }>> {
  const g = await guard('backups', 'approve_restore');
  if ('error' in g) return bad('FORBIDDEN');
  if (!ids.length) return bad('Select at least one row.');
  if (!reason.trim()) return bad('REASON_REQUIRED');
  const { data, error } = await g.sb.rpc('restore_records', { p_table: table, p_ids: ids, p_reason: reason.trim() });
  if (error) return bad(error);
  revalidatePath(`${PAGE}/recovery`);
  return { ok: true, count: (data as number) ?? 0 };
}
