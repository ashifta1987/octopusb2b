/**
 * Turnkey T7 — staff dashboard, reports and settings helpers (docs/design/turnkey-v2: "Dashboard is the staff home";
 * "Reports shows fees by service, funnel, unpaid ageing and inspector workload"; Settings). Pure functions: the numbers
 * come from the tk_report_* / tk_dashboard database functions (real rows only); nothing here invents a value.
 */

export type TkFeeRow = { period: string; service_key: string; service_name: string; issued_count: number; issued_cents: number; paid_cents: number; outstanding_cents: number; void_count: number };
export type TkFunnelRow = { seq: number; stage: string; stage_name: string; reached: number; open_now: number; on_hold_now: number; cancelled_here: number; completed_here: number };
export type TkAgeingRow = { bucket: string; sort: number; open_count: number; outstanding_cents: number; oldest_days: number | null };
export type TkUnpaidRow = { document_id: string; number: string | null; project_code: string; client_name: string | null; service_name: string; amount_cents: number; paid_cents: number; outstanding_cents: number; issued_at: string; age_days: number };
export type TkInspectorRow = { inspector_id: string; inspector_name: string; open_jobs: number; due_7_days: number; overdue: number; awaiting_review: number; published_in_period: number; next_on: string | null };
export type TkReportKind = 'fees' | 'funnel' | 'ageing' | 'unpaid' | 'inspectors';
export const TK_REPORT_KINDS: TkReportKind[] = ['fees', 'funnel', 'ageing', 'unpaid', 'inspectors'];

export type TkDashboard = {
  can_see_all: boolean;
  kpi: null | {
    open_by_stage: Record<string, number>; open_total: number; on_hold: number; new_enquiries_7d: number; waiting_approvals: number;
    unpaid_count: number; unpaid_cents: number; inspections_to_schedule: number; inspections_due_7d: number; inspections_overdue: number;
    reports_to_review: number; trips_requested: number; trips_upcoming_30d: number;
    next_trips: { code: string; title: string; start_on: string; end_on: string; travellers: number }[];
    due_inspections: { code: string; title: string; kind: string; round: number; scheduled_on: string; status: string }[];
  };
  my_projects: { code: string; title: string; stage: string; status: string; client: string | null; updated_at: string; unpaid: number; on_cover: boolean }[];
};

export type TkSettings = {
  deposit_pct: number | null; extra_traveller_day_cents: number | null; included_travellers: number | null; visit_rule_text: string | null;
  passport_retention_days: number; passport_retention_set: boolean; am_waiver_threshold_cents: number | null; can_edit: boolean;
  changes: { action: string; entity_id: string | null; details: Record<string, unknown> | null; at: string; by: string | null }[];
};

/** Report period: whole calendar months (UTC) back from the current month, or everything. */
export type TkPeriod = { months: 0 | 1 | 3 | 6 | 12; from: string | null; label: string };
export function reportPeriod(raw: string | undefined, now: Date): TkPeriod {
  const m = raw === 'all' ? 0 : raw === '1' ? 1 : raw === '3' ? 3 : raw === '12' ? 12 : 6;
  if (m === 0) return { months: 0, from: null, label: 'All time' };
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  d.setUTCMonth(d.getUTCMonth() - (m - 1));
  return { months: m, from: d.toISOString(), label: m === 1 ? 'This month' : `Last ${m} months` };
}

/** Totals of the fees-by-service rows per service (all months of the period together), integer cents. */
export function feeTotals(rows: TkFeeRow[]): { service_key: string; service_name: string; issued_count: number; issued_cents: number; paid_cents: number; outstanding_cents: number; void_count: number }[] {
  const by = new Map<string, { service_key: string; service_name: string; issued_count: number; issued_cents: number; paid_cents: number; outstanding_cents: number; void_count: number }>();
  for (const r of rows) {
    const t = by.get(r.service_key) ?? { service_key: r.service_key, service_name: r.service_name, issued_count: 0, issued_cents: 0, paid_cents: 0, outstanding_cents: 0, void_count: 0 };
    t.issued_count += Number(r.issued_count); t.issued_cents += Number(r.issued_cents); t.paid_cents += Number(r.paid_cents);
    t.outstanding_cents += Number(r.outstanding_cents); t.void_count += Number(r.void_count);
    by.set(r.service_key, t);
  }
  return [...by.values()].sort((a, b) => b.issued_cents - a.issued_cents || a.service_name.localeCompare(b.service_name));
}

/** Share of the projects that reached the first phase, as a whole percentage; null when nothing to compare (unknown = empty). */
export function funnelShare(reached: number, first: number): number | null {
  if (!first) return null;
  return Math.round((reached / first) * 100);
}

const cents = (v: unknown) => String(Math.trunc(Number(v ?? 0)));
const ymd = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : '');

/** CSV head and rows for each report. Money columns are integer US cents (no rounding, no currency symbols). */
export function reportCsv(kind: TkReportKind, rows: unknown[]): { head: string[]; rows: (string | number)[][] } {
  switch (kind) {
    case 'fees':
      return {
        head: ['month', 'service_code', 'service', 'issued_count', 'issued_cents', 'paid_cents', 'outstanding_cents', 'void_count'],
        rows: (rows as TkFeeRow[]).map((r) => [ymd(r.period).slice(0, 7), r.service_key, r.service_name, Number(r.issued_count), cents(r.issued_cents), cents(r.paid_cents), cents(r.outstanding_cents), Number(r.void_count)]),
      };
    case 'funnel':
      return {
        head: ['phase_no', 'phase_code', 'phase', 'reached', 'open_now', 'on_hold_now', 'cancelled_here', 'completed_here'],
        rows: (rows as TkFunnelRow[]).map((r) => [r.seq, r.stage, r.stage_name, r.reached, r.open_now, r.on_hold_now, r.cancelled_here, r.completed_here]),
      };
    case 'ageing':
      return {
        head: ['days_since_issue', 'unpaid_count', 'outstanding_cents', 'oldest_days'],
        rows: (rows as TkAgeingRow[]).map((r) => [r.bucket, r.open_count, cents(r.outstanding_cents), r.oldest_days ?? '']),
      };
    case 'unpaid':
      return {
        head: ['proforma', 'project', 'client', 'service', 'amount_cents', 'paid_cents', 'outstanding_cents', 'issued_on', 'age_days'],
        rows: (rows as TkUnpaidRow[]).map((r) => [r.number ?? '', r.project_code, r.client_name ?? '', r.service_name, cents(r.amount_cents), cents(r.paid_cents), cents(r.outstanding_cents), ymd(r.issued_at), r.age_days]),
      };
    case 'inspectors':
      return {
        head: ['inspector', 'open_jobs', 'due_within_7_days', 'overdue', 'awaiting_review', 'published_in_period', 'next_date'],
        rows: (rows as TkInspectorRow[]).map((r) => [r.inspector_name, r.open_jobs, r.due_7_days, r.overdue, r.awaiting_review, r.published_in_period, ymd(r.next_on)]),
      };
  }
}

/** US dollars typed by staff (e.g. "120" or "99.50") → integer cents; null when not a valid amount. */
export function dollarsToCents(v: string): number | null {
  const t = v.trim().replace(/,/g, '');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(t)) return null;
  const [w, f = ''] = t.split('.');
  return Number(w) * 100 + Number((f + '00').slice(0, 2));
}

/** Whole number of days from 1 to 365; null otherwise. */
export function parseRetentionDays(v: string): number | null {
  const t = v.trim();
  if (!/^\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= 365 ? n : null;
}

/** Plain-English line for a settings change in the audit list. */
export function settingChangeLabel(c: { action: string; details: Record<string, unknown> | null }): string {
  const d = c.details ?? {};
  const usd = (x: unknown) => (x == null ? 'not set' : `US$ ${(Number(x) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  if (c.action === 'turnkey.deposit_pct') return `Deposit: ${d.old ?? 'not set'}${d.old != null ? '%' : ''} → ${d.new}%`;
  switch (d.setting) {
    case 'extra_traveller_day_cents': return `Extra traveller per day: ${usd(d.old)} → ${usd(d.new)}`;
    case 'passport_retention_days': return `Passport copies kept: ${d.old} → ${d.new} days after the visit`;
    case 'am_waiver_threshold_cents': return `Account manager fee waived above: ${usd(d.old)} → ${usd(d.new)}`;
    default: return 'Setting changed';
  }
}
