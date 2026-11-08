import Link from 'next/link';
import { cn } from '@/lib/cn';
import { Card, EmptyState, StatusBadge } from '@/components/ui';
import { ActionForm } from '@/components/admin/client';
import { saveBackupSettings } from '@/app/admin/backups/actions';
import {
  chinaTime, fmtBytes, relativeDay, TYPE_LABEL, RESTORE_STATUS, FORMAT_LABEL, EXPORT_GROUPS,
  type BackupRow, type RestoreRow, type CheckRow, type ExportRow, type BackupSettings,
} from './shared';
import { DownloadBackupButton, FilterSelect, RestoreForm, RestoreActions, TypeOption, AutoRefresh, ExportForm, ExportDownload, OffsiteTestButton } from './client';

/* ───────── Status cards ───────── */

function Pill({ tone, children }: { tone: 'green' | 'amber' | 'red' | 'gray'; children: React.ReactNode }) {
  const t = { green: 'bg-ok-bg text-ok', amber: 'bg-warn-bg text-warn', red: 'bg-bad-bg text-bad', gray: 'bg-fill text-black' }[tone];
  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap', t)}>{children}</span>;
}

function StatusCard({ label, value, children }: { label: string; value: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="card p-5 min-w-0">
      <div className="text-[13px] text-muted">{label}</div>
      <div className="font-display text-[22px] font-semibold mt-1.5 truncate">{value}</div>
      <div className="mt-2 text-[13px] text-muted">{children}</div>
    </div>
  );
}

export function StatusCards({ backups, settings, nextRun, overdue, drill, now }: {
  backups: BackupRow[]; settings: BackupSettings; nextRun: Date | null; overdue: boolean;
  drill: { at: string; status: 'pass' | 'fail' | 'pending'; minutes: number | null } | null; now: number;
}) {
  const last = backups.find((b) => b.status === 'completed');
  const stored = backups.filter((b) => b.status === 'completed');
  const total = stored.reduce((s, b) => s + (b.size_bytes ?? 0), 0);
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 mb-6">
      <StatusCard label="Last backup" value={last ? relativeDay(last.finished_at ?? last.created_at, now) : 'None yet'}>
        {!last ? <Pill tone="amber">No successful backup</Pill>
          : last.checksum_ok === true ? <Pill tone="green">OK · checksum verified</Pill>
          : last.checksum_ok === false ? <Pill tone="red">Checksum mismatch</Pill>
          : <Pill tone="gray">Checksum not checked</Pill>}
        {overdue && <div className="mt-1.5"><Pill tone="red">Overdue · over {settings.alert_missing_hours ?? 26} h</Pill></div>}
      </StatusCard>
      <StatusCard label="Next scheduled" value={nextRun ? relativeDay(nextRun, now) : '—'}>
        China time · {settings.schedule_label?.replace(/ ?China time/i, '').toLowerCase() || 'nightly'}
      </StatusCard>
      <StatusCard label="Off-site storage" value={fmtBytes(total || (stored.length ? 0 : null))}>
        {stored.length} backup{stored.length === 1 ? '' : 's'} · encrypted
      </StatusCard>
      <StatusCard label="Point-in-time recovery" value={settings.pitr_enabled ? 'On' : 'Off'}>
        {settings.pitr_enabled ? 'Any minute in last 7 days' : 'Supabase PITR add-on not enabled'}
      </StatusCard>
      <StatusCard label="Last restore drill" value={drill ? chinaTime(drill.at).slice(0, 6) : 'None yet'}>
        {!drill ? (settings.monthly_drill ? 'Monthly drill is on' : 'Monthly drill is off')
          : drill.status === 'pass' ? <Pill tone="green">Passed{drill.minutes != null ? ` · ${drill.minutes} min` : ''}</Pill>
          : drill.status === 'fail' ? <Pill tone="red">Failed</Pill>
          : <Pill tone="amber">In progress</Pill>}
      </StatusCard>
    </div>
  );
}

/* ───────── Backups table ───────── */

function typeLabel(b: BackupRow, names: Record<string, string>) {
  if (b.trigger === 'manual') return `Manual${b.created_by && names[b.created_by] ? ` · ${names[b.created_by].split(' ')[0]}` : ''}`;
  if (b.trigger === 'drill') return 'Drill';
  if (b.retention_class === 'weekly') return 'Weekly';
  if (b.retention_class === 'monthly') return 'Monthly';
  return 'Scheduled';
}

function subLabel(b: BackupRow) {
  if (b.status === 'failed' && b.error) return b.error;
  if (b.note) return b.note;
  if (b.trigger === 'retry') return 'Automatic retry';
  if (b.trigger === 'drill') return 'Restore drill';
  return { daily: 'Nightly', weekly: 'Weekly copy', monthly: 'Monthly copy', manual: 'Manual backup' }[b.retention_class] ?? '';
}

function includesLabel(b: BackupRow) {
  const m = (b.manifest ?? {}) as { buckets?: unknown[] };
  const n = b.includes?.buckets?.length ?? (Array.isArray(m.buckets) ? m.buckets.length : 0);
  const db = b.includes?.database !== false && b.kind !== 'storage';
  const parts = [db ? 'DB' : null, n ? `${n} file bucket${n === 1 ? '' : 's'}` : b.kind === 'database' ? null : 'files'].filter(Boolean);
  return parts.join(' + ');
}

const BACKUP_TONE: Record<string, 'green' | 'red' | 'blue' | 'gray' | 'amber'> = { completed: 'green', failed: 'red', running: 'blue', queued: 'amber', expired: 'gray' };

export function BackupsTable({ backups, filter, names, canDownload, canRestore }: {
  backups: BackupRow[]; filter: string; names: Record<string, string>; canDownload: boolean; canRestore: boolean;
}) {
  const rows = backups.filter((b) =>
    filter === 'scheduled' ? ['scheduled', 'retry'].includes(b.trigger)
      : filter === 'manual' ? b.trigger === 'manual'
      : filter === 'failed' ? b.status === 'failed' : true);
  return (
    <section id="backups" className="card mb-6 scroll-mt-6">
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 pt-5 pb-3">
        <div>
          <h2 className="text-lg font-semibold">Backups</h2>
          <p className="text-[13px] text-muted mt-0.5">Each backup holds the database and every file bucket. Downloads need a 2FA check and the link works for 10 minutes.</p>
        </div>
        <FilterSelect label="Filter backups" value={filter} options={[{ value: 'all', label: 'All backups' }, { value: 'scheduled', label: 'Scheduled' }, { value: 'manual', label: 'Manual' }, { value: 'failed', label: 'Failed' }]} />
      </div>
      {rows.length === 0 ? (
        <EmptyState title={filter === 'all' ? 'No backups yet' : 'No backups match this filter'} body={filter === 'all' ? 'The nightly backup runs at 02:00 China time once the backup workflow is set up. You can also press “Back up now”.' : undefined} />
      ) : (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
          <table className="w-full min-w-[960px] border-collapse">
            <thead>
              <tr>{['Backup', 'Time (China)', 'Type', 'Includes', 'Size', 'Status', ''].map((h, i) => <th key={i} className="th">{h || <span className="sr-only">Actions</span>}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((b, i) => {
                const usable = b.status === 'completed';
                return (
                  <tr key={b.id} className={cn(i === 0 && usable && 'bg-fill')}>
                    <td className="td">
                      <div className="mono font-semibold text-[13px]">{b.code}</div>
                      <div className="text-xs text-muted max-w-[260px] truncate" title={subLabel(b)}>{subLabel(b)}</div>
                    </td>
                    <td className="td whitespace-nowrap">{chinaTime(b.started_at ?? b.created_at)}</td>
                    <td className="td whitespace-nowrap">{typeLabel(b, names)}</td>
                    <td className="td whitespace-nowrap">{includesLabel(b)}</td>
                    <td className="td mono text-[13px] whitespace-nowrap">{b.status === 'completed' || b.size_bytes ? fmtBytes(b.size_bytes) : '—'}</td>
                    <td className="td">
                      <StatusBadge status={b.status} tone={BACKUP_TONE[b.status]} label={b.status === 'running' ? `Running ${b.progress}%` : undefined} />
                      {usable && b.checksum_ok === false && <div className="text-xs text-bad mt-1">Checksum mismatch</div>}
                    </td>
                    <td className="td">
                      <div className="flex gap-2 justify-end items-start">
                        <DownloadBackupButton id={b.id} disabled={!usable || !canDownload} />
                        {usable && canRestore
                          ? <Link href={`/admin/backups?backup=${b.id}&type=drill#restore`} scroll={false} className="btn btn-ghost btn-sm">Verify</Link>
                          : <button type="button" className="btn btn-ghost btn-sm" disabled>Verify</button>}
                        {usable && canRestore
                          ? <Link href={`/admin/backups?backup=${b.id}#restore`} scroll={false} className="btn btn-dark btn-sm">Restore</Link>
                          : <button type="button" className="btn btn-dark btn-sm" disabled>Restore</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ───────── Restore wizard ───────── */

function Steps({ current, done }: { current: number; done: number }) {
  const steps = ['Choose type', 'Verify', 'Approve', 'Run & report'];
  return (
    <ol className="flex flex-wrap gap-2 mt-4" aria-label="Restore steps">
      {steps.map((s, i) => {
        const n = i + 1;
        const isDone = n <= done;
        const isCur = n === current && !isDone;
        return (
          <li key={s} aria-current={isCur ? 'step' : undefined}
            className={cn('rounded-full px-3 py-1.5 text-xs font-semibold', isDone ? 'bg-ink text-white' : isCur ? 'bg-coral text-white' : 'bg-fill text-black')}>
            {n} {s}{isDone ? ' ✓' : ''}
          </li>
        );
      })}
    </ol>
  );
}

const CHECK_TONE = { pass: 'green', fail: 'red', note: 'amber' } as const;
const CHECK_LABEL = { pass: 'Pass', fail: 'Fail', note: 'Note' } as const;
const CHECK_KIND: Record<string, string> = { checksums: 'Checksums', row_counts: 'Row counts', ledger_balanced: 'Ledger balanced', migration_version: 'Migrations', integration_keys: 'Integration keys', storage: 'Storage', other: 'Check' };

function Checks({ checks, empty }: { checks: CheckRow[]; empty: string }) {
  if (!checks.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="space-y-3">
      {checks.map((c) => (
        <li key={c.id} className="flex gap-3 items-start text-sm leading-relaxed">
          <StatusBadge status={c.status} tone={CHECK_TONE[c.status]} label={CHECK_LABEL[c.status]} />
          <span><b className="font-semibold">{CHECK_KIND[c.kind] ?? c.kind}</b> · {c.detail}</span>
        </li>
      ))}
    </ul>
  );
}

function impactText(type: string) {
  return {
    full_staging: 'Impact: staging only. About 40 minutes. Live site keeps running.',
    full_production: 'Impact: the live site goes into maintenance mode (storefront notice, API 503, queues paused) until the restore finishes. Orders placed after the backup time must be re-entered.',
    partial: 'Impact: only the selected records are copied back from the recovery area. Money records are never overwritten.',
    drill: 'Impact: none. The backup is restored into a scratch project and checked.',
  }[type] ?? '';
}

export function RestoreCard({ mode, request, backup, checks, postChecks, names, userId, canRequest, canApprove, isAdmin, initialType }: {
  mode: 'new' | 'existing' | 'none'; request: RestoreRow | null; backup: BackupRow | null; checks: CheckRow[]; postChecks: CheckRow[];
  names: Record<string, string>; userId: string; canRequest: boolean; canApprove: boolean; isAdmin: boolean; initialType: string;
}) {
  if (mode === 'none' || !backup) {
    return (
      <section id="restore" className="card p-6 mb-6 scroll-mt-6">
        <div className="eyebrow mono text-xs text-muted uppercase tracking-wider">Restore</div>
        <h2 className="text-lg font-semibold mt-1">Restore wizard</h2>
        <p className="text-sm text-muted mt-1">Pick a completed backup above and press <b>Restore</b> (or <b>Verify</b> for a restore drill). Every restore is verified in a scratch project first, then needs a second approver.</p>
        <p className="text-sm mt-3"><Link href="/admin/backups/recovery" className="text-coral-text font-semibold">Partial restore — compare records side by side →</Link></p>
      </section>
    );
  }

  if (mode === 'new') {
    return (
      <section id="restore" className="card border-2 border-ink p-6 mb-6 scroll-mt-6">
        <div className="mono text-xs text-muted uppercase tracking-wider">New restore request</div>
        <h2 className="text-xl font-semibold mt-1">Restore from <span className="mono">{backup.code}</span></h2>
        <p className="text-sm text-muted mt-1">{chinaTime(backup.started_at ?? backup.created_at)} China time · {fmtBytes(backup.size_bytes)}</p>
        <Steps current={1} done={0} />
        <div className="grid lg:grid-cols-2 gap-8 mt-6">
          <RestoreForm key={`${backup.id}-${initialType}`} backupId={backup.id} backupCode={backup.code} initialType={initialType} canRequest={canRequest} />
          <div>
            <h3 className="font-semibold mb-3">Verification (restored to scratch first)</h3>
            <p className="text-sm text-muted">After you create the request, the backup is restored into a scratch project and checked: checksums match the manifest, row counts match, every ledger journal balances per currency (USD and CNY), and the migration version is known.</p>
            <div className="border-t border-line mt-4 pt-4 text-sm space-y-1.5">
              <p><b className="font-semibold">Second approver:</b> Finance for anything touching money, otherwise another Admin · both re-enter 2FA. The requester cannot approve.</p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  const r = request!;
  const st = RESTORE_STATUS[r.status] ?? { label: r.status, tone: 'gray' as const };
  const verifyFailed = checks.some((c) => c.status === 'fail');
  const order = ['draft', 'verifying', 'verified', 'pending_approval', 'approved', 'running', 'completed'];
  const idx = order.indexOf(r.status);
  const done = r.status === 'completed' ? 4 : r.status === 'running' ? 3 : r.status === 'approved' ? 3 : idx >= 2 ? 2 : 1;
  const current = r.status === 'failed' || r.status === 'cancelled' ? (r.approved_at ? 4 : checks.length ? 3 : 2) : Math.min(4, done + 1);
  const isRequester = r.requested_by === userId;
  const approverRule = r.touches_money ? 'Finance or another Admin' : 'another Admin';
  const blocked = verifyFailed ? 'Verification failed' : r.touches_money ? (canApprove ? null : 'Needs a Finance user or Admin') : isAdmin ? null : 'Needs another Admin';
  const type = TYPE_LABEL[r.restore_type] ?? r.restore_type;
  const report = r.report as Record<string, unknown> | null;

  return (
    <section id="restore" className="card border-2 border-ink p-6 mb-6 scroll-mt-6">
      {(r.status === 'verifying' || r.status === 'running') && <AutoRefresh every={5000} />}
      <div className="flex flex-wrap justify-between gap-3">
        <div className="mono text-xs text-muted uppercase tracking-wider">Restore request {r.code}</div>
        <StatusBadge status={r.status} tone={st.tone} label={st.label} />
      </div>
      <h2 className="text-xl font-semibold mt-1">Restore from <span className="mono">{backup.code}</span></h2>
      <p className="text-sm text-muted mt-1">{chinaTime(backup.started_at ?? backup.created_at)} China time · requested by {names[r.requested_by] ?? 'staff'}{isRequester ? ' (you)' : ''} · {chinaTime(r.created_at)}</p>
      <Steps current={current} done={done} />

      <div className="grid lg:grid-cols-2 gap-8 mt-6">
        <div>
          <h3 className="font-semibold mb-3">What to restore</h3>
          <div className="space-y-3">
            <TypeOption name={`rt-${r.id}`} value={r.restore_type} title={type} body={r.restore_type === 'partial' ? `Modules: ${r.modules.join(', ') || '—'}${Object.values(r.records ?? {}).flat().length ? ` · ${new Set(Object.values(r.records).flat()).size} record IDs` : ''}` : impactText(r.restore_type)} checked disabled />
          </div>
          <div className="label mt-4">Reason (shown to approver and in audit log)</div>
          <p className="input flex items-center bg-pearl">{r.reason}</p>
          {r.restore_type === 'partial' && (
            <p className="text-sm mt-3"><Link href="/admin/backups/recovery" className="text-coral-text font-semibold">Open the compare screen to pick rows →</Link></p>
          )}
        </div>
        <div>
          <h3 className="font-semibold mb-3">Verification (restored to scratch first)</h3>
          <Checks checks={checks} empty={r.status === 'verifying' ? 'Verification is running in a scratch project… results appear here automatically.' : 'No verification results yet.'} />
          <div className="border-t border-line mt-4 pt-4 text-sm space-y-1.5">
            <p><b className="font-semibold">Second approver:</b> {approverRule} · both re-enter 2FA{r.touches_money ? ' · touches money records' : ''}</p>
            <p className="text-muted">{impactText(r.restore_type)}</p>
            {r.approved_by && <p>Approved by {names[r.approved_by] ?? 'staff'} · {chinaTime(r.approved_at)}</p>}
            {r.error && <p className="text-bad">{r.status === 'cancelled' ? 'Cancelled' : 'Error'}: {r.error}</p>}
          </div>
          {(postChecks.length > 0 || report) && (
            <div className="border-t border-line mt-4 pt-4">
              <h3 className="font-semibold mb-3">Restore report</h3>
              <Checks checks={postChecks} empty="" />
              {report && (
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  {Object.entries(report).slice(0, 12).map(([k, v]) => (
                    <div key={k} className="contents"><dt className="text-muted">{k.replace(/_/g, ' ')}</dt><dd className="mono text-xs break-all">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd></div>
                  ))}
                </dl>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="border-t border-line mt-6 pt-5">
        <RestoreActions id={r.id} status={r.status} canApprove={canApprove} isRequester={isRequester} canCancel={isRequester || canApprove} canRemind={canRequest} approveBlockedReason={blocked} />
      </div>
    </section>
  );
}

export function RestoreList({ requests, backups, names, selected }: { requests: RestoreRow[]; backups: Record<string, string>; names: Record<string, string>; selected: string | null }) {
  return (
    <Card title="Restore requests" className="mb-6">
      {requests.length === 0 ? <EmptyState title="No restore requests yet" body="Requests, their verification results and reports are listed here." /> : (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
          <table className="w-full min-w-[760px] border-collapse">
            <thead><tr>{['Request', 'Backup', 'Type', 'Requested', 'Status', ''].map((h, i) => <th key={i} className="th">{h || <span className="sr-only">Open</span>}</th>)}</tr></thead>
            <tbody>
              {requests.map((r) => {
                const st = RESTORE_STATUS[r.status] ?? { label: r.status, tone: 'gray' as const };
                return (
                  <tr key={r.id} className={cn(selected === r.id && 'bg-fill')}>
                    <td className="td mono text-[13px] font-semibold">{r.code}</td>
                    <td className="td mono text-[13px]">{backups[r.backup_id] ?? '—'}</td>
                    <td className="td">{TYPE_LABEL[r.restore_type] ?? r.restore_type}</td>
                    <td className="td whitespace-nowrap">{chinaTime(r.created_at)} · {names[r.requested_by]?.split(' ')[0] ?? 'staff'}</td>
                    <td className="td"><StatusBadge status={r.status} tone={st.tone} label={st.label} /></td>
                    <td className="td text-right"><Link href={`/admin/backups?rs=${r.id}#restore`} scroll={false} className="text-coral-text font-semibold text-sm">{r.status === 'completed' || r.status === 'failed' ? 'Report' : 'Open'}</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ───────── Data exports ───────── */

export function ExportsCard({ exports, canExport, from, to }: { exports: ExportRow[]; canExport: boolean; from: string; to: string }) {
  const groupLabel = (mods: string[]) => EXPORT_GROUPS.filter((g) => g.modules.some((m) => mods.includes(m))).map((g) => g.label).join(', ');
  return (
    <section id="exports" className="card p-5 scroll-mt-6">
      <h2 className="text-lg font-semibold">Data exports</h2>
      <p className="text-[13px] text-muted mt-0.5 mb-4">Readable files for accounting, audits or re-import into a new system.</p>
      <ExportForm defaultFrom={from} defaultTo={to} allowed={canExport} />
      <div className="border-t border-line mt-5 pt-4">
        {exports.length === 0 ? <p className="text-sm text-muted">No exports yet.</p> : (
          <ul className="space-y-2.5">
            {exports.map((e) => (
              <li key={e.id} className="flex justify-between gap-3 items-start text-sm">
                <span className="min-w-0">
                  <span className="mono">{e.code}</span> · {e.title || groupLabel(e.modules)} · {FORMAT_LABEL[e.format] ?? e.format}{e.size_bytes ? ` · ${fmtBytes(e.size_bytes)}` : ''}
                  <span className="block text-xs text-muted">
                    {chinaTime(e.created_at)}{e.date_from || e.date_to ? ` · ${e.date_from ?? '…'} → ${e.date_to ?? '…'}` : ''} · <StatusLabel status={e.status} />
                    {e.error ? ` · ${e.error}` : ''}
                  </span>
                </span>
                {canExport && <ExportDownload id={e.id} status={e.status} />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function StatusLabel({ status }: { status: string }) {
  const t = { ready: 'text-ok', failed: 'text-bad', running: 'text-coral-text', queued: 'text-warn', expired: 'text-muted' }[status] ?? 'text-muted';
  return <span className={cn('font-semibold', t)}>{status === 'ready' ? 'Ready' : status.charAt(0).toUpperCase() + status.slice(1)}</span>;
}

/* ───────── Settings ───────── */

export function SettingsCard({ settings, isAdmin }: { settings: BackupSettings; isAdmin: boolean }) {
  const o = settings.offsite ?? {};
  const offsiteLabel = o.provider ? `${o.provider}${o.bucket ? ` · ${o.bucket}` : ''}${o.region && o.region !== 'auto' ? ` (${o.region})` : ''}` : 'Not configured';
  return (
    <section className="card p-5">
      <h2 className="text-lg font-semibold mb-4">Backup settings</h2>
      <ActionForm action={saveBackupSettings} submitLabel="Save settings" hideSubmit={!isAdmin} confirm="Save the backup settings?">
        <fieldset disabled={!isAdmin} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="bs-schedule">Schedule</label>
              <select id="bs-schedule" name="schedule" className="input" defaultValue={settings.schedule ?? '0 18 * * *'}>
                <option value="0 18 * * *">Nightly 02:00 China time</option>
                <option value="0 6,18 * * *">Every 12 hours</option>
                <option value="0 */6 * * *">Every 6 hours</option>
              </select>
            </div>
            <div><label className="label" htmlFor="bs-daily">Keep daily</label><input id="bs-daily" name="keep_daily" type="number" min={1} max={365} className="input" defaultValue={settings.keep_daily ?? 14} /></div>
            <div><label className="label" htmlFor="bs-weekly">Keep weekly</label><input id="bs-weekly" name="keep_weekly" type="number" min={0} max={104} className="input" defaultValue={settings.keep_weekly ?? 8} /></div>
            <div><label className="label" htmlFor="bs-monthly">Keep monthly</label><input id="bs-monthly" name="keep_monthly" type="number" min={0} max={120} className="input" defaultValue={settings.keep_monthly ?? 12} /></div>
          </div>
          <p className="text-xs text-muted -mt-2">The schedule shown here is for display and monitoring; the real timer lives in <span className="mono">.github/workflows/backup.yml</span> — change the cron there too.</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className="label" htmlFor="bs-exports">Keep exports (months)</label><input id="bs-exports" name="keep_exports_months" type="number" min={1} max={120} className="input" defaultValue={settings.keep_exports_months ?? 12} /></div>
            <div><label className="label" htmlFor="bs-hours">Alert if no successful backup in (hours)</label><input id="bs-hours" name="alert_missing_hours" type="number" min={1} max={240} className="input" defaultValue={settings.alert_missing_hours ?? 26} /></div>
          </div>

          <div>
            <div className="label">Off-site storage</div>
            <div className="flex gap-2 items-start">
              <p className="input flex items-center flex-1 bg-pearl" aria-label="Current off-site storage">{offsiteLabel}</p>
              <OffsiteTestButton allowed={isAdmin} />
            </div>
            <p className={cn('text-xs mt-1 font-semibold', o.last_test_ok === true ? 'text-ok' : o.last_test_ok === false ? 'text-bad' : 'text-muted')}>
              {o.last_test_at ? `${o.last_test_ok ? 'Connected' : 'Connection failed'} · last test ${chinaTime(o.last_test_at)}` : 'Not tested yet'}
            </p>
            <details className="mt-2">
              <summary className="text-sm text-coral-text font-semibold cursor-pointer">Edit connection</summary>
              <div className="grid sm:grid-cols-2 gap-3 mt-3">
                <div><label className="label" htmlFor="bs-provider">Provider</label><input id="bs-provider" name="offsite_provider" className="input" placeholder="Cloudflare R2" defaultValue={o.provider ?? ''} /></div>
                <div><label className="label" htmlFor="bs-bucket">Bucket</label><input id="bs-bucket" name="offsite_bucket" className="input" placeholder="octopus-backups" defaultValue={o.bucket ?? ''} /></div>
                <div><label className="label" htmlFor="bs-endpoint">Endpoint</label><input id="bs-endpoint" name="offsite_endpoint" className="input" placeholder="https://<account>.r2.cloudflarestorage.com" defaultValue={o.endpoint ?? ''} /></div>
                <div><label className="label" htmlFor="bs-region">Region</label><input id="bs-region" name="offsite_region" className="input" placeholder="auto" defaultValue={o.region ?? 'auto'} /></div>
              </div>
              <p className="text-xs text-muted mt-2">Access keys are never stored here: they live in GitHub Actions secrets and Vercel environment variables (<span className="mono">BACKUP_S3_*</span>).</p>
            </details>
          </div>

          <div>
            <label className="label" htmlFor="bs-fp">Encryption key fingerprint</label>
            <input id="bs-fp" name="key_fingerprint" className="input mono" placeholder="age1qz…7m4k" defaultValue={settings.key_fingerprint ?? ''} />
            <p className="text-xs text-muted mt-1">The private key is kept offline by the owner. Without it, backups cannot be opened.</p>
          </div>
          <div>
            <label className="label" htmlFor="bs-email">Alert email</label>
            <input id="bs-email" name="alert_email" type="email" className="input" defaultValue={settings.alert_email ?? ''} />
          </div>
          <div className="space-y-2.5">
            {([
              ['monthly_drill', 'Monthly automatic restore drill into a test project', settings.monthly_drill ?? true],
              ['pitr_enabled', 'Point-in-time recovery (Supabase PITR add-on) is enabled', settings.pitr_enabled ?? false],
              ['require_mfa', 'Require a fresh 2FA check for downloads, restores and approvals', settings.require_mfa ?? true],
            ] as const).map(([name, label, checked]) => (
              <label key={name} className="flex gap-2.5 items-start text-sm text-black">
                <input type="checkbox" name={name} defaultChecked={checked} className="mt-0.5 w-[18px] h-[18px] accent-coral flex-none" />{label}
              </label>
            ))}
          </div>
        </fieldset>
      </ActionForm>
      {!isAdmin && <p className="text-sm text-muted mt-3">Only an Admin can change these settings.</p>}
    </section>
  );
}
