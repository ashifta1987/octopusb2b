/** Shared (client + server safe) helpers for the Backup & restore screen (SPEC §16.4). */

export const TZ = 'Asia/Shanghai';

export type BackupRow = {
  id: string; code: string; kind: string; trigger: string; retention_class: string; status: string; progress: number;
  includes: { database?: boolean; buckets?: string[] } | null; size_bytes: number | null; checksum_ok: boolean | null;
  manifest: Record<string, unknown> | null; note: string | null; error: string | null; created_at: string;
  started_at: string | null; finished_at: string | null; created_by: string | null;
};

export type RestoreRow = {
  id: string; code: string; backup_id: string; restore_type: string; target: string; modules: string[]; records: Record<string, string[]>;
  reason: string; touches_money: boolean; status: string; requested_by: string; approved_by: string | null; approved_at: string | null;
  started_at: string | null; finished_at: string | null; report: Record<string, unknown> | null; error: string | null; created_at: string;
};

export type CheckRow = { id: string; restore_id: string | null; backup_id: string | null; phase: string; kind: string; status: 'pass' | 'fail' | 'note'; detail: string; created_at: string };

export type ExportRow = {
  id: string; code: string; title: string | null; modules: string[]; format: string; status: string; size_bytes: number | null;
  date_from: string | null; date_to: string | null; created_at: string; error: string | null;
};

export type BackupSettings = {
  schedule?: string; schedule_label?: string; timezone?: string; keep_daily?: number; keep_weekly?: number; keep_monthly?: number;
  keep_exports_months?: number; offsite?: { provider?: string; bucket?: string; endpoint?: string; region?: string; last_test_at?: string | null; last_test_ok?: boolean | null };
  key_fingerprint?: string; alert_email?: string; monthly_drill?: boolean; alert_missing_hours?: number; pitr_enabled?: boolean; require_mfa?: boolean;
};

export type MaintenanceMode = { enabled?: boolean; message?: string; retry_after?: number; since?: string | null };

/** "Nov 01 02:00" in China time. */
export function chinaTime(d: string | Date | null | undefined, withDate = true) {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
  return withDate ? `${p('month')} ${p('day')} ${p('hour')}:${p('minute')}` : `${p('hour')}:${p('minute')}`;
}

/** YYYY-MM-DD of a date in China time. */
export function chinaDay(d: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function cronField(f: string, v: number) {
  return f.split(',').some((part) => {
    if (part === '*') return true;
    const step = part.match(/^\*\/(\d+)$/);
    if (step) return v % Number(step[1]) === 0;
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) return v >= Number(range[1]) && v <= Number(range[2]);
    return Number(part) === v;
  });
}

/** Next run of a daily-style UTC cron ("m h * * *", lists and steps supported) — null if it cannot be parsed. */
export function nextCronRun(cron: string | undefined, nowMs: number): Date | null {
  const f = (cron ?? '').trim().split(/\s+/);
  if (f.length !== 5 || f.slice(2).some((x) => x !== '*')) return null;
  const start = Math.floor(nowMs / 60000) * 60000 + 60000;
  for (let i = 0; i < 2 * 24 * 60; i++) {
    const d = new Date(start + i * 60000);
    if (cronField(f[0], d.getUTCMinutes()) && cronField(f[1], d.getUTCHours())) return d;
  }
  return null;
}

/** "Today 02:00" / "Tomorrow 02:00" / "Yesterday 02:00" / "Oct 30 02:00" relative to China time. */
export function relativeDay(d: string | Date | null | undefined, nowMs: number) {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  const day = chinaDay(date);
  const today = chinaDay(new Date(nowMs));
  const tomorrow = chinaDay(new Date(nowMs + 86400000));
  const yesterday = chinaDay(new Date(nowMs - 86400000));
  const hm = chinaTime(date, false);
  if (day === today) return `Today ${hm}`;
  if (day === tomorrow) return `Tomorrow ${hm}`;
  if (day === yesterday) return `Yesterday ${hm}`;
  return chinaTime(date);
}

export function fmtBytes(n: number | null | undefined) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${u[i]}`;
}

export const TYPE_LABEL: Record<string, string> = { full_staging: 'Full restore to staging', full_production: 'Full restore to live site', partial: 'Restore selected records', drill: 'Verify only (restore drill to scratch)' };

export const RESTORE_STATUS: Record<string, { label: string; tone: 'green' | 'amber' | 'red' | 'blue' | 'gray' }> = {
  draft: { label: 'Draft', tone: 'gray' },
  verifying: { label: 'Verifying in scratch', tone: 'blue' },
  verified: { label: 'Verified', tone: 'green' },
  pending_approval: { label: 'Waiting for second approval', tone: 'amber' },
  approved: { label: 'Approved', tone: 'green' },
  running: { label: 'Running', tone: 'blue' },
  completed: { label: 'Completed', tone: 'green' },
  failed: { label: 'Failed', tone: 'red' },
  cancelled: { label: 'Cancelled', tone: 'gray' },
};

/** Restore type → modules picked in the wizard for "Restore selected records" (partial). */
export const PARTIAL_MODULES: { key: string; label: string }[] = [
  { key: 'products', label: 'Products' },
  { key: 'categories', label: 'Categories & tags' },
  { key: 'customers', label: 'Customers & KYC' },
  { key: 'suppliers', label: 'Suppliers' },
  { key: 'cms', label: 'Site content (pages, banners, terms)' },
  { key: 'tickets', label: 'Support tickets' },
  { key: 'services', label: 'Services' },
  { key: 'orders', label: 'Orders (money — Finance approves; rows never overwritten)' },
];

/** Data export checkboxes (Backups.html) → modules accepted by rpc request_export. */
export const EXPORT_GROUPS: { key: string; label: string; modules: string[]; checked?: boolean }[] = [
  { key: 'customers', label: 'Customers & KYC status', modules: ['customers'], checked: true },
  { key: 'orders', label: 'Orders & invoices', modules: ['orders', 'invoices'], checked: true },
  { key: 'ledger', label: 'Ledger & wallets', modules: ['ledger', 'wallet'], checked: true },
  { key: 'products', label: 'Products & categories', modules: ['products', 'categories'] },
  { key: 'suppliers', label: 'Suppliers', modules: ['suppliers'] },
  { key: 'services', label: 'Service requests', modules: ['services'] },
  { key: 'tickets', label: 'Support tickets', modules: ['tickets'] },
  { key: 'cms', label: 'Site content', modules: ['cms'] },
];

export const FORMAT_LABEL: Record<string, string> = { xlsx: 'Excel', csv: 'CSV', json: 'JSON' };

/** Money tables are never restored row-by-row (SPEC §16.3) — corrections go through finance adjustments. */
export const MONEY_TABLES = new Set(['ledger_entries', 'journals', 'ledger_accounts', 'payments', 'wallet_topups', 'wallet_withdrawals', 'finance_approvals', 'payouts', 'orders', 'proforma_invoices', 'documents', 'ad_clicks', 'ad_charges']);

const ERRORS: Record<string, string> = {
  FORBIDDEN: 'You do not have permission to do this.',
  MFA_REQUIRED: 'Please re-enter your 2FA code first.',
  STEP_UP_REQUIRED: 'Please re-enter your 2FA code first (it is older than 10 minutes).',
  BACKUP_ALREADY_RUNNING: 'A backup is already queued or running. Wait for it to finish.',
  MAKER_CANNOT_APPROVE: 'You requested this restore, so you cannot approve it. Another approver must do it (maker–checker).',
  NEEDS_FINANCE_APPROVER: 'This restore touches money records: a Finance user (or Admin) must approve it.',
  NEEDS_ADMIN_APPROVER: 'Another Admin must approve this restore.',
  VERIFICATION_FAILED: 'Verification failed, so this restore cannot be approved. Cancel it and pick another backup.',
  REASON_REQUIRED: 'Please write a reason (shown to the approver and in the audit log).',
  MODULES_REQUIRED: 'Pick at least one module.',
  BACKUP_NOT_COMPLETED: 'Only completed backups can be restored.',
  MONEY_RECORDS_NOT_RESTORABLE: 'Money records (ledger, payments, orders, invoices) are never overwritten. Use a finance adjustment instead.',
  TABLE_NOT_RESTORABLE: 'This table cannot be restored row by row.',
  NOT_IN_RECOVERY: 'This table is not loaded in the recovery area yet. Load it from a backup with restore.yml (partial mode) first.',
  GITHUB_NOT_CONFIGURED: 'GitHub Actions is not connected yet (GITHUB_REPO / GITHUB_ACTIONS_TOKEN). The request was saved and will run once it is set up.',
  OFFSITE_NOT_CONFIGURED: 'Off-site storage is not configured yet (BACKUP_S3_* secrets).',
  INVALID_TRANSITION: 'This request can no longer be changed.',
  INVALID_FORMAT: 'Pick Excel, CSV or JSON.',
  UNKNOWN_MODULE: 'Unknown export module.',
  NOT_FOUND: 'Not found.',
  NOT_AVAILABLE: 'This feature is not available yet (the server route is missing). Try again after the next deploy.',
};

export function errorText(raw: string | null | undefined) {
  const m = raw ?? 'Something went wrong';
  const code = m.split(':')[0].trim();
  return ERRORS[code] ?? m;
}

export function errorCode(raw: string | null | undefined) {
  return (raw ?? '').split(':')[0].trim();
}
