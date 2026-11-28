import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { Icon, KpiStrip, buttonClass } from '@octopus/ui';
import { BackupNowButton, BackupProgress, MaintenanceControl } from '@/components/admin/backups/client';
import { StatusCards, BackupsTable, RestoreCard, RestoreList, ExportsCard, SettingsCard } from '@/components/admin/backups/sections';
import { nextCronRun, chinaTime, type BackupRow, type RestoreRow, type CheckRow, type ExportRow, type BackupSettings, type MaintenanceMode } from '@/components/admin/backups/shared';
import { backupSummary, bytesText } from '../_lib/admin-c-core';

/**
 * ODS T9 · /admin/backups view (server-compatible: no 'use client'), used by the page and the staging fixture. ODS header,
 * notices and summary strip around TODAY's backup components (their own permission checks, fresh-2FA and the
 * two-person restore rule — the requester cannot approve; the database enforces it).
 */

const OPEN = ['draft', 'verifying', 'verified', 'pending_approval', 'approved', 'running'];

function Note({ tone, children, testId }: { tone: 'warning' | 'info' | 'danger'; children: ReactNode; testId?: string }) {
  const bg = tone === 'warning' ? 'bg-ods-warning-tint' : tone === 'danger' ? 'bg-ods-danger-tint' : 'bg-ods-info-tint';
  return <p role={tone === 'danger' ? 'alert' : 'status'} data-testid={testId} className={`m-0 rounded-ods-control px-3 py-2 text-ods-small ${bg}`}>{children}</p>;
}

export type BackupsViewProps = {
  backups: BackupRow[]; requests: RestoreRow[]; exports: ExportRow[]; settings: BackupSettings; maintenance: MaintenanceMode; overdue: boolean;
  selected: RestoreRow | null; mode: 'new' | 'existing' | 'none'; wizardBackup: BackupRow | null; checks: CheckRow[]; names: Record<string, string>;
  backupCodes: Record<string, string>; drill: { at: string; status: 'pass' | 'fail' | 'pending'; minutes: number | null } | null; active: BackupRow | null;
  githubConfigured: boolean; mfaNeeded: boolean; monthStart: string; monthEnd: string; now: number; filter: string; initialType: string; userId: string;
  perms: { backup: boolean; download: boolean; requestRestore: boolean; approveRestore: boolean; export: boolean; isAdmin: boolean };
};

export function BackupsView(props: BackupsViewProps) {
  const { backups, requests, exports, settings, maintenance, overdue, selected, mode, wizardBackup, checks, names, backupCodes, drill, active, githubConfigured, mfaNeeded, monthStart, monthEnd, now, perms } = props;
  const sum = backupSummary(backups);
  const openRestores = requests.filter((r) => OPEN.includes(r.status)).length;
  return (
    <div className="flex min-w-0 flex-col gap-ods-gap" data-testid="backups-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 max-w-3xl">
          <p className="m-0 text-ods-small text-ods-slate">Admin › Backup and restore</p>
          <h1 className="m-0 text-ods-h1 font-bold text-ods-navy">Backup &amp; restore</h1>
          <p className="m-0 mt-0.5 text-ods-small text-ods-slate">Every night the database and all files are copied, encrypted, to off-site storage. Back up now, download a backup, restore all data or only selected records, and export data for accounting.</p>
          <p className="m-0 mt-1 inline-flex items-center gap-1 text-ods-small text-ods-slate"><Icon icon={Lock} size="xs" />Downloads, restores and approvals ask for a fresh 2FA code. A restore needs a second person to approve it.</p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <a href="#exports" className={buttonClass('secondary')}>Export data</a>
          <a href="/admin/backups/recovery" className={buttonClass('secondary')}>Partial restore</a>
          <BackupNowButton allowed={perms.backup} />
        </div>
      </div>

      {maintenance.enabled ? <Note tone="warning" testId="maintenance-on"><b>Maintenance mode is ON</b> since {chinaTime(maintenance.since)} China time. Visitors see: “{maintenance.message}”</Note> : null}
      {mfaNeeded ? <Note tone="info">Downloads, restores and approvals need a fresh 2FA check. <a href="/mfa?next=/admin/backups" className="font-semibold text-ods-blue underline underline-offset-4">Verify with your authenticator app</a></Note> : null}
      {overdue && backups.length > 0 ? <Note tone="danger" testId="backup-overdue">No successful backup in the last {settings.alert_missing_hours ?? 26} hours. Check the backup workflow runs in GitHub Actions.</Note> : null}

      <KpiStrip
        variant="strip"
        label="Backups"
        data-testid="backups-summary"
        items={[
          { label: 'Last successful backup', value: sum.lastAt ? chinaTime(sum.lastAt) : 'None yet', hint: 'China time' },
          { label: 'Size', value: bytesText(sum.lastSize), hint: 'newest completed backup' },
          { label: 'Failed (last 60)', value: String(sum.failed), hint: sum.failed ? 'see the list below' : 'all good' },
          { label: 'Open restores', value: String(openRestores), hint: 'need a second approver' },
        ]}
      />

      <div className="ods-legacy-section flex min-w-0 flex-col">
        <BackupProgress key={active?.id ?? 'none'} initial={active ? { id: active.id, code: active.code, status: active.status, progress: active.progress, error: active.error } : null} githubConfigured={githubConfigured} />
        <StatusCards backups={backups} settings={settings} nextRun={nextCronRun(settings.schedule, now)} overdue={overdue && backups.length > 0} drill={drill} now={now} />
        <BackupsTable backups={backups} filter={props.filter} names={names}
          canDownload={perms.download} canRestore={perms.requestRestore} />
        <RestoreCard mode={mode} request={selected} backup={wizardBackup} checks={checks.filter((c) => c.phase === 'verify' || c.phase === 'drill')} postChecks={checks.filter((c) => c.phase === 'post_restore')}
          names={names} userId={props.userId} canRequest={perms.requestRestore} canApprove={perms.approveRestore} isAdmin={perms.isAdmin}
          initialType={props.initialType} />
        <RestoreList requests={requests} backups={backupCodes} names={names} selected={selected?.id ?? null} />
        <div className="mb-6 grid items-start gap-6 lg:grid-cols-2">
          <ExportsCard exports={exports} canExport={perms.export} from={monthStart} to={monthEnd} />
          <SettingsCard settings={settings} isAdmin={perms.isAdmin} />
        </div>
      </div>

      <section className="rounded-ods-card border border-ods-line bg-ods-surface p-ods-pad-card shadow-ods-card" id="maintenance" aria-labelledby="maint-h" data-testid="maintenance">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="maint-h" className="m-0 text-ods-body font-bold text-ods-navy">Maintenance mode</h2>
            <p className="m-0 mt-0.5 max-w-[640px] text-ods-small text-ods-slate">Used during a full restore to the live site. The storefront and portals show the notice, the public API returns 503 with Retry-After and queues pause. The admin portal keeps working.</p>
          </div>
          <span className="font-semibold">{maintenance.enabled ? 'ON' : 'OFF'}</span>
        </div>
        <div className="mt-3 max-w-[640px]">
          <MaintenanceControl enabled={!!maintenance.enabled} message={maintenance.message ?? ''} retryAfter={maintenance.retry_after ?? 900} allowed={perms.isAdmin} />
        </div>
      </section>
    </div>
  );
}
