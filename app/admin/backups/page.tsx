import Link from 'next/link';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader, Notice } from '@/components/ui';
import { nowMs } from '@/components/admin/server';
import { BackupNowButton, BackupProgress, MaintenanceControl } from '@/components/admin/backups/client';
import { StatusCards, BackupsTable, RestoreCard, RestoreList, ExportsCard, SettingsCard } from '@/components/admin/backups/sections';
import { nextCronRun, chinaDay, chinaTime, type BackupRow, type RestoreRow, type CheckRow, type ExportRow, type BackupSettings, type MaintenanceMode } from '@/components/admin/backups/shared';
import { StepUpNote } from '@/components/admin/step-up';

export const metadata = { title: 'Backup & restore' };

const OPEN = ['draft', 'verifying', 'verified', 'pending_approval', 'approved', 'running'];

/** Admin → Backup & restore (SPEC §16.4, Backups.png). */
export default async function BackupsPage({ searchParams }: { searchParams: Promise<{ filter?: string; backup?: string; type?: string; rs?: string }> }) {
  const s = await requireStaff('backups', 'view', '/admin/backups');
  const sp = await searchParams;
  const sb = await createClient();
  const now = nowMs();

  const [{ data: bk }, { data: rr }, { data: ex }, { data: settingsRows }, { data: overdue }, { data: drillChecks }] = await Promise.all([
    sb.from('backups').select('id, code, kind, trigger, retention_class, status, progress, includes, size_bytes, checksum_ok, manifest, note, error, created_at, started_at, finished_at, created_by').order('created_at', { ascending: false }).limit(60),
    sb.from('restore_requests').select('id, code, backup_id, restore_type, target, modules, records, reason, touches_money, status, requested_by, approved_by, approved_at, started_at, finished_at, report, error, created_at').order('created_at', { ascending: false }).limit(20),
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

  // Which restore request / new form the wizard shows.
  let selected: RestoreRow | null = sp.rs ? requests.find((r) => r.id === sp.rs) ?? null : null;
  if (sp.rs && !selected) {
    const { data } = await sb.from('restore_requests').select('id, code, backup_id, restore_type, target, modules, records, reason, touches_money, status, requested_by, approved_by, approved_at, started_at, finished_at, report, error, created_at').eq('id', sp.rs).maybeSingle();
    selected = (data as RestoreRow | null) ?? null;
  }
  const newBackup = !selected && sp.backup ? backups.find((b) => b.id === sp.backup && b.status === 'completed') ?? null : null;
  if (!selected && !newBackup) selected = requests.find((r) => OPEN.includes(r.status)) ?? null;
  const mode: 'new' | 'existing' | 'none' = newBackup ? 'new' : selected ? 'existing' : 'none';
  let wizardBackup = newBackup ?? (selected ? backups.find((b) => b.id === selected!.backup_id) ?? null : null);
  if (selected && !wizardBackup) {
    const { data } = await sb.from('backups').select('id, code, kind, trigger, retention_class, status, progress, includes, size_bytes, checksum_ok, manifest, note, error, created_at, started_at, finished_at, created_by').eq('id', selected.backup_id).maybeSingle();
    wizardBackup = (data as BackupRow | null) ?? null;
  }
  const { data: chk } = selected
    ? await sb.from('restore_checks').select('id, restore_id, backup_id, phase, kind, status, detail, created_at').eq('restore_id', selected.id).order('created_at')
    : { data: [] };
  const checks = ((chk ?? []) as CheckRow[]);

  // Names for "requested by" / "Manual · Name".
  const userIds = [...new Set([...requests.flatMap((r) => [r.requested_by, r.approved_by]), ...backups.map((b) => b.created_by), selected?.requested_by, selected?.approved_by].filter(Boolean) as string[])];
  const { data: profiles } = userIds.length ? await sb.from('profiles').select('id, full_name').in('id', userIds) : { data: [] };
  const names: Record<string, string> = Object.fromEntries((profiles ?? []).map((p) => [p.id as string, p.full_name as string]));
  const backupCodes: Record<string, string> = Object.fromEntries(backups.map((b) => [b.id, b.code]));
  if (wizardBackup) backupCodes[wizardBackup.id] = wizardBackup.code;

  // Last restore drill: newest drill request vs newest drill-phase checks (monthly automatic drill).
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
    const batch = dc.filter((c) => (c.restore_id ?? c.backup_id) === (dc[0].restore_id ?? dc[0].backup_id));
    drill = { at: dc[0].created_at, status: batch.some((c) => c.status === 'fail') ? 'fail' : 'pass', minutes: null };
  }

  const active = backups.find((b) => b.status === 'queued' || b.status === 'running') ?? null;
  const githubConfigured = !!(process.env.GITHUB_REPO && process.env.GITHUB_ACTIONS_TOKEN);
  const mfaNeeded = (settings.require_mfa ?? true) && s.aal !== 'aal2';
  const today = new Date(now);
  const monthStart = chinaDay(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)));
  const monthEnd = chinaDay(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0, 12)));

  return (
    <>
      <PageHeader
        title="Backup & restore"
        subtitle="Every night the database and all files are copied, encrypted, to off-site storage. Back up now, download a backup, restore all data or only selected records, and export data for accounting."
        actions={
          <div className="flex flex-wrap gap-3 items-start">
            <a href="#exports" className="btn btn-ghost">Export data</a>
            <BackupNowButton allowed={can(s, 'backups', 'backup')} />
          </div>
        }
      />
      <StepUpNote className="-mt-3 mb-4" />

      {maintenance.enabled && (
        <div className="mb-4"><Notice tone="amber"><b>Maintenance mode is ON</b> since {chinaTime(maintenance.since)} China time. Visitors see: “{maintenance.message}”</Notice></div>
      )}
      {mfaNeeded && (
        <div className="mb-4">
          <Notice tone="blue">Downloads, restores and approvals need a fresh 2FA check. <Link href="/mfa?next=/admin/backups" className="font-semibold underline">Verify with your authenticator app</Link></Notice>
        </div>
      )}
      {overdue === true && backups.length > 0 && (
        <div className="mb-4"><Notice tone="red">No successful backup in the last {settings.alert_missing_hours ?? 26} hours. Check the backup workflow runs in GitHub Actions.</Notice></div>
      )}

      <BackupProgress key={active?.id ?? 'none'} initial={active ? { id: active.id, code: active.code, status: active.status, progress: active.progress, error: active.error } : null} githubConfigured={githubConfigured} />

      <StatusCards backups={backups} settings={settings} nextRun={nextCronRun(settings.schedule, now)} overdue={overdue === true && backups.length > 0} drill={drill} now={now} />

      <BackupsTable backups={backups} filter={['scheduled', 'manual', 'failed'].includes(sp.filter ?? '') ? sp.filter! : 'all'} names={names}
        canDownload={can(s, 'backups', 'download')} canRestore={can(s, 'backups', 'request_restore')} />

      <RestoreCard mode={mode} request={selected} backup={wizardBackup} checks={checks.filter((c) => c.phase === 'verify' || c.phase === 'drill')} postChecks={checks.filter((c) => c.phase === 'post_restore')}
        names={names} userId={s.userId} canRequest={can(s, 'backups', 'request_restore')} canApprove={can(s, 'backups', 'approve_restore')} isAdmin={s.isAdmin}
        initialType={sp.type && ['drill', 'full_staging', 'full_production', 'partial'].includes(sp.type) ? sp.type : 'full_staging'} />

      <RestoreList requests={requests} backups={backupCodes} names={names} selected={selected?.id ?? null} />

      <div className="grid lg:grid-cols-2 gap-6 items-start mb-6">
        <ExportsCard exports={exports} canExport={can(s, 'backups', 'export')} from={monthStart} to={monthEnd} />
        <SettingsCard settings={settings} isAdmin={s.isAdmin} />
      </div>

      <section className="card p-5 mb-6" id="maintenance">
        <div className="flex flex-wrap justify-between gap-3 items-start">
          <div>
            <h2 className="text-lg font-semibold">Maintenance mode</h2>
            <p className="text-[13px] text-muted mt-0.5 max-w-[640px]">Used during a full restore to the live site. The storefront and portals show the notice, the public API returns 503 with Retry-After and queues pause. The admin portal keeps working.</p>
          </div>
          <span className="font-semibold">{maintenance.enabled ? '● ON' : '○ OFF'}</span>
        </div>
        <div className="mt-4 max-w-[640px]">
          <MaintenanceControl enabled={!!maintenance.enabled} message={maintenance.message ?? ''} retryAfter={maintenance.retry_after ?? 900} allowed={s.isAdmin} />
        </div>
      </section>
    </>
  );
}
