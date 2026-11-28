// ODS T9
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { nowMs } from '@/components/admin/server';
import { chinaDay, type BackupRow, type RestoreRow, type CheckRow, type ExportRow, type BackupSettings, type MaintenanceMode } from '@/components/admin/backups/shared';
import { BackupsView } from '@/app/ods/office/_components/admin-c-backups';
import { PanelSkeleton } from '@/app/ods/office/_components/dashboard';

/**
 * ODS T9 · /admin/backups — Backup & restore. Guard as today: requireStaff('backups','view'). Same reads and the same
 * wizard selection. The backup / download / restore / approve / export / settings / maintenance controls are TODAY's
 * components (components/admin/backups/*) with TODAY's checks: per-action backups permissions (backup, download,
 * request_restore, approve_restore, export), fresh 2FA, the TWO-PERSON restore rule (the requester cannot approve; the
 * database enforces it) and admin-only settings / maintenance. The ODS page adds the header, the summary strip and
 * ODS notices.
 */
export const metadata: Metadata = { title: 'Backup & restore' };

const OPEN = ['draft', 'verifying', 'verified', 'pending_approval', 'approved', 'running'];
const BK_COLS = 'id, code, kind, trigger, retention_class, status, progress, includes, size_bytes, checksum_ok, manifest, note, error, created_at, started_at, finished_at, created_by';
const RR_COLS = 'id, code, backup_id, restore_type, target, modules, records, reason, touches_money, status, requested_by, approved_by, approved_at, started_at, finished_at, report, error, created_at';

type SP = Promise<{ filter?: string; backup?: string; type?: string; rs?: string }>;

export default function OdsBackupsPage({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<PanelSkeleton title="Backup & restore" testId="backups-page" lines={8} />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  const s = await requireStaff('backups', 'view', '/admin/backups');
  const sp = await searchParams;
  const sb = await createClient();
  const now = nowMs();

  const [{ data: bk }, { data: rr }, { data: ex }, { data: settingsRows }, { data: overdue }, { data: drillChecks }] = await Promise.all([
    sb.from('backups').select(BK_COLS).order('created_at', { ascending: false }).limit(60),
    sb.from('restore_requests').select(RR_COLS).order('created_at', { ascending: false }).limit(20),
    sb.from('data_exports').select('id, code, title, modules, format, status, size_bytes, date_from, date_to, created_at, error').order('created_at', { ascending: false }).limit(8),
    sb.from('site_settings').select('key, value').in('key', ['backup_settings', 'maintenance_mode']),
    sb.rpc('backup_overdue'),
    sb.from('restore_checks').select('id, restore_id, backup_id, phase, kind, status, detail, created_at').eq('phase', 'drill').order('created_at', { ascending: false }).limit(20),
  ]);
  const backups = (bk ?? []) as BackupRow[];
  const requests = (rr ?? []) as RestoreRow[];
  const exports = (ex ?? []) as ExportRow[];
  const settings = (settingsRows?.find((r) => r.key === 'backup_settings')?.value ?? {}) as BackupSettings;
  const maintenance = (settingsRows?.find((r) => r.key === 'maintenance_mode')?.value ?? {}) as MaintenanceMode;

  let selected: RestoreRow | null = sp.rs ? requests.find((r) => r.id === sp.rs) ?? null : null;
  if (sp.rs && !selected) {
    const { data } = await sb.from('restore_requests').select(RR_COLS).eq('id', sp.rs).maybeSingle();
    selected = (data as RestoreRow | null) ?? null;
  }
  const newBackup = !selected && sp.backup ? backups.find((b) => b.id === sp.backup && b.status === 'completed') ?? null : null;
  if (!selected && !newBackup) selected = requests.find((r) => OPEN.includes(r.status)) ?? null;
  const mode: 'new' | 'existing' | 'none' = newBackup ? 'new' : selected ? 'existing' : 'none';
  let wizardBackup = newBackup ?? (selected ? backups.find((b) => b.id === selected!.backup_id) ?? null : null);
  if (selected && !wizardBackup) {
    const { data } = await sb.from('backups').select(BK_COLS).eq('id', selected.backup_id).maybeSingle();
    wizardBackup = (data as BackupRow | null) ?? null;
  }
  const { data: chk } = selected
    ? await sb.from('restore_checks').select('id, restore_id, backup_id, phase, kind, status, detail, created_at').eq('restore_id', selected.id).order('created_at')
    : { data: [] };
  const checks = (chk ?? []) as CheckRow[];
  const userIds = [...new Set([...requests.flatMap((r) => [r.requested_by, r.approved_by]), ...backups.map((b) => b.created_by), selected?.requested_by, selected?.approved_by].filter(Boolean) as string[])];
  const { data: profiles } = userIds.length ? await sb.from('profiles').select('id, full_name').in('id', userIds) : { data: [] };
  const names: Record<string, string> = Object.fromEntries((profiles ?? []).map((p) => [p.id as string, p.full_name as string]));
  const backupCodes: Record<string, string> = Object.fromEntries(backups.map((b) => [b.id, b.code]));
  if (wizardBackup) backupCodes[wizardBackup.id] = wizardBackup.code;

  const drillReq = requests.find((r) => r.restore_type === 'drill');
  const dc = (drillChecks ?? []) as CheckRow[];
  let drill: { at: string; status: 'pass' | 'fail' | 'pending'; minutes: number | null } | null = null;
  if (drillReq && (!dc[0] || drillReq.created_at >= dc[0].created_at)) {
    const passed = ['pending_approval', 'verified', 'approved', 'completed'].includes(drillReq.status);
    const end = drillReq.finished_at ?? null;
    drill = {
      at: drillReq.created_at,
      status: drillReq.status === 'failed' ? 'fail' : passed ? 'pass' : drillReq.status === 'cancelled' ? 'fail' : 'pending',
      minutes: end ? Math.max(1, Math.round((new Date(end).getTime() - new Date(drillReq.started_at ?? drillReq.created_at).getTime()) / 60000)) : null,
    };
  } else if (dc[0]) {
    const batch = dc.filter((c) => (c.restore_id ?? c.backup_id) === (dc[0]!.restore_id ?? dc[0]!.backup_id));
    drill = { at: dc[0].created_at, status: batch.some((c) => c.status === 'fail') ? 'fail' : 'pass', minutes: null };
  }

  const active = backups.find((b) => b.status === 'queued' || b.status === 'running') ?? null;
  const githubConfigured = !!(process.env.GITHUB_REPO && process.env.GITHUB_ACTIONS_TOKEN);
  const mfaNeeded = (settings.require_mfa ?? true) && s.aal !== 'aal2';
  const today = new Date(now);
  const monthStart = chinaDay(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)));
  const monthEnd = chinaDay(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0, 12)));

  return (
    <BackupsView
      backups={backups} requests={requests} exports={exports} settings={settings} maintenance={maintenance} overdue={overdue === true}
      selected={selected} mode={mode} wizardBackup={wizardBackup} checks={checks} names={names} backupCodes={backupCodes} drill={drill}
      active={active} githubConfigured={githubConfigured} mfaNeeded={mfaNeeded} monthStart={monthStart} monthEnd={monthEnd} now={now}
      filter={['scheduled', 'manual', 'failed'].includes(sp.filter ?? '') ? sp.filter! : 'all'}
      initialType={sp.type && ['drill', 'full_staging', 'full_production', 'partial'].includes(sp.type) ? sp.type : 'full_staging'}
      userId={s.userId}
      perms={{ backup: can(s, 'backups', 'backup'), download: can(s, 'backups', 'download'), requestRestore: can(s, 'backups', 'request_restore'), approveRestore: can(s, 'backups', 'approve_restore'), export: can(s, 'backups', 'export'), isAdmin: s.isAdmin }}
    />
  );
}
