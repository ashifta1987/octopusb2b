/**
 * ODS T9 · Back Office Dashboard, My work and Approvals — PURE helpers (no React, no server imports): used by the server
 * loaders, the client panels, the staging fixtures and tests/unit/ods-office-dashboard.test.ts.
 *
 * Numbers are never invented here: the helpers only bucket / scale / label rows the loaders read from today's tables.
 */
import { can, type OfficePerms } from './nav';

/* ───────── greeting ───────── */

/** "Good morning / afternoon / evening" by the viewer's LOCAL hour; null (server render) → "Hello". */
export function greetingFor(hour: number | null): string {
  if (hour == null) return 'Hello';
  if (hour < 5) return 'Good evening';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** First word of the display name; an e-mail address keeps the part before @. */
export function firstNameOf(name: string | null | undefined): string {
  const n = (name ?? '').trim();
  if (!n) return '';
  const base = n.includes('@') && !n.includes(' ') ? n.split('@')[0] : n;
  return base.split(/\s+/)[0] ?? '';
}

/* ───────── widgets by role ───────── */

export type WidgetId = 'kpis' | 'my-work' | 'money' | 'ageing' | 'pools' | 'activity';

export const WIDGET_LABELS: Record<WidgetId, string> = {
  kpis: 'Key figures',
  'my-work': 'My work',
  money: 'Money in and out',
  ageing: 'Receivables ageing',
  pools: 'MOQ pools closing soon',
  activity: 'Recent activity',
};

/**
 * Which panels a person gets (Part 7.3 "widgets are chosen by role"), from the SAME permissions today's pages check:
 * money / ageing = finance:view (Admin › Finance, Receivables); pools = orders:view (Admin › Pools); key figures need
 * finance:view (finance strip) or requests / orders view (sales pipeline strip). My work and Recent activity: everyone
 * on the Dashboard (dashboard:view; the audit-log half of the activity still needs audit:view).
 */
export function dashboardWidgets(p: Pick<OfficePerms, 'isAdmin' | 'permissions'>): WidgetId[] {
  const pp = p as OfficePerms;
  const out: WidgetId[] = [];
  if (can(pp, 'finance') || can(pp, 'requests') || can(pp, 'orders')) out.push('kpis');
  out.push('my-work');
  if (can(pp, 'finance')) out.push('money', 'ageing');
  if (can(pp, 'orders')) out.push('pools');
  out.push('activity');
  return out;
}

/** Finance figures for Finance viewers; everyone else with request / order access sees the sales pipeline. */
export function kpiKindFor(p: Pick<OfficePerms, 'isAdmin' | 'permissions'>): 'finance' | 'sales' | null {
  const pp = p as OfficePerms;
  if (can(pp, 'finance')) return 'finance';
  if (can(pp, 'requests') || can(pp, 'orders')) return 'sales';
  return null;
}

/** Hidden widgets saved in ui_prefs.extra.dashboardHidden (Customise): only known ids, never "my-work"-less junk. */
export function hiddenWidgetsFrom(extra: Record<string, unknown> | null | undefined): WidgetId[] {
  const raw = extra?.dashboardHidden;
  if (!Array.isArray(raw)) return [];
  const known = Object.keys(WIDGET_LABELS) as WidgetId[];
  return [...new Set(raw.filter((x): x is WidgetId => typeof x === 'string' && (known as string[]).includes(x)))];
}

/* ───────── receivables ageing ───────── */

export type AgeingBucketId = '0_30' | '31_60' | '61_90' | '90_plus';
export type AgeingBucket = { id: AgeingBucketId; label: string; amountMinor: number; pct: number; count: number };
export type AgeingResult = { buckets: AgeingBucket[]; totalMinor: number; overdueMinor: number; notDueMinor: number; count: number };

export const AGEING_LABELS: Record<AgeingBucketId, string> = { '0_30': '0–30 days', '31_60': '31–60', '61_90': '61–90', '90_plus': '90+' };

/** Days past due exactly as today's Receivables page: floor((now − due) / 1 day); no due date = not due yet (0). */
export function daysOverdue(dueAt: string | null, nowMs: number): number {
  const dueMs = dueAt ? new Date(dueAt).getTime() : nowMs;
  return Math.floor((nowMs - (Number.isNaN(dueMs) ? nowMs : dueMs)) / 86_400_000);
}

/** Today's thresholds (> 90, > 60, > 30); "0–30" holds Current + 1–30 (the board's four columns). */
export function ageingBucketFor(days: number): AgeingBucketId {
  if (days > 90) return '90_plus';
  if (days > 60) return '61_90';
  if (days > 30) return '31_60';
  return '0_30';
}

/**
 * Open balances into the four buckets. `toMinor` converts each row into the one display currency (today's
 * convertMinor at the approved rate); rows with no balance are skipped like today's page. Percentages are whole
 * numbers of the total (largest remainder, so they add up to 100).
 */
export function ageingBuckets(
  rows: { balanceMinor: number; dueAt: string | null; currency?: string }[],
  nowMs: number,
  toMinor: (minor: number, currency: string) => number = (m) => m,
): AgeingResult {
  const ids: AgeingBucketId[] = ['0_30', '31_60', '61_90', '90_plus'];
  const sums: Record<AgeingBucketId, number> = { '0_30': 0, '31_60': 0, '61_90': 0, '90_plus': 0 };
  const counts: Record<AgeingBucketId, number> = { '0_30': 0, '31_60': 0, '61_90': 0, '90_plus': 0 };
  let overdue = 0;
  let notDue = 0;
  let count = 0;
  for (const r of rows) {
    const bal = Math.max(0, Number(r.balanceMinor) || 0);
    if (bal <= 0) continue;
    const v = toMinor(bal, r.currency ?? 'USD');
    const d = daysOverdue(r.dueAt, nowMs);
    const b = ageingBucketFor(d);
    sums[b] += v;
    counts[b] += 1;
    count += 1;
    if (d > 0) overdue += v;
    else notDue += v;
  }
  const total = ids.reduce((a, id) => a + sums[id], 0);
  const pcts = wholePercents(ids.map((id) => sums[id]));
  return {
    buckets: ids.map((id, i) => ({ id, label: AGEING_LABELS[id], amountMinor: sums[id], pct: pcts[i]!, count: counts[id] })),
    totalMinor: total,
    overdueMinor: overdue,
    notDueMinor: notDue,
    count,
  };
}

/** Whole-number percentages that add up to 100 (largest remainder); all zeros when the total is 0. */
export function wholePercents(values: number[]): number[] {
  const total = values.reduce((a, v) => a + Math.max(0, v), 0);
  if (total <= 0) return values.map(() => 0);
  const exact = values.map((v) => (Math.max(0, v) / total) * 100);
  const floor = exact.map(Math.floor);
  let left = 100 - floor.reduce((a, v) => a + v, 0);
  const order = exact.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    floor[i]! += 1;
    left -= 1;
  }
  return floor;
}

/* ───────── money in and out · last 8 weeks ───────── */

export type MoneyWeek = { start: string; label: string; inMinor: number; outMinor: number };

/** Monday 00:00 UTC of the week holding `ms`. */
export function weekStartUtc(ms: number): number {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Sums movements into the last `weeks` calendar weeks (Monday-based, UTC, the current week last). Labels follow the
 * board: "5 Oct", "12", "19", "26", "2 Nov" … (month shown on the first bar and when it changes).
 * Movements outside the window are ignored. `toMinor` converts into the display currency.
 */
export function weeklyMoney(
  entries: { at: string; inMinor: number; outMinor: number; currency?: string }[],
  nowMs: number,
  weeks = 8,
  toMinor: (minor: number, currency: string) => number = (m) => m,
): MoneyWeek[] {
  const last = weekStartUtc(nowMs);
  const starts = Array.from({ length: weeks }, (_, i) => last - (weeks - 1 - i) * 7 * 86_400_000);
  const out = starts.map((s, i) => {
    const d = new Date(s);
    const prev = i > 0 ? new Date(starts[i - 1]!) : null;
    const showMonth = !prev || prev.getUTCMonth() !== d.getUTCMonth();
    return { start: d.toISOString().slice(0, 10), label: showMonth ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` : String(d.getUTCDate()), inMinor: 0, outMinor: 0 };
  });
  const end = last + 7 * 86_400_000;
  for (const e of entries) {
    const t = new Date(e.at).getTime();
    if (Number.isNaN(t) || t < starts[0]! || t >= end) continue;
    const idx = Math.min(weeks - 1, Math.floor((t - starts[0]!) / (7 * 86_400_000)));
    const c = e.currency ?? 'USD';
    out[idx]!.inMinor += toMinor(Math.max(0, Number(e.inMinor) || 0), c);
    out[idx]!.outMinor += toMinor(Math.max(0, Number(e.outMinor) || 0), c);
  }
  return out;
}

export type ChartUnit = 'units' | 'thousands';

/** "Nice" axis top (1, 2, 2.5, 5 × 10^n) at or above the largest bar, in MAJOR units; 0 data → 1. */
export function niceMax(maxMajor: number): number {
  if (!(maxMajor > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(maxMajor)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= maxMajor) return m * p;
  return 10 * p;
}

/** Chart geometry for the bars: axis top + bar heights in % of the plot (0–100). */
export function chartScale(data: MoneyWeek[]): { maxMajor: number; ticks: number[]; bars: { inPct: number; outPct: number }[] } {
  const maxMajor = niceMax(Math.max(0, ...data.flatMap((w) => [w.inMinor, w.outMinor])) / 100);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => maxMajor * f);
  const pct = (minor: number) => Math.max(0, Math.min(100, (minor / 100 / maxMajor) * 100));
  return { maxMajor, ticks, bars: data.map((w) => ({ inPct: pct(w.inMinor), outPct: pct(w.outMinor) })) };
}

/** Axis / tooltip text in the chosen unit: "US$ 12,400" or "US$ 12.4k" (thousands). */
export function chartValueText(major: number, unit: ChartUnit, prefix = 'US$'): string {
  if (unit === 'thousands') return `${prefix} ${(major / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k`;
  return `${prefix} ${Math.round(major).toLocaleString('en-US')}`;
}

/* ───────── my work (today's work queue items) ───────── */

export type WorkItemLike = { key: string; late: boolean; owner: boolean; dueLabel: string };
export type PillTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

/** Status words for a work-queue item (never colour alone): Overdue · Needs owner · Waiting · To check · Open. */
export function workStatus(i: WorkItemLike): { label: string; tone: PillTone } {
  if (i.late) return { label: 'Overdue', tone: 'danger' };
  if (i.key.startsWith('ap-')) return i.owner ? { label: 'Needs owner', tone: 'warning' } : { label: 'Waiting', tone: 'warning' };
  if (i.key.startsWith('tt-')) return { label: 'To check', tone: 'info' };
  return { label: 'Open', tone: 'info' };
}

/* ───────── approvals ───────── */

export type ApprovalLike = { source: string; kind: string; status: 'waiting' | 'approved' | 'rejected'; canDecide: boolean; mine: boolean };

const KIND_LABELS: Record<string, string> = {
  payment: 'Payment',
  refund: 'Refund',
  credit_note: 'Credit note',
  supplier_payment: 'Supplier payment',
  payout: 'Supplier payment',
  wallet_adjustment: 'Wallet adjustment',
  pay_later: 'Credit terms',
  adjustment: 'Adjustment',
  writeoff: 'Write-off',
  release: 'Release held payment',
};

/** "Payment", "Credit note", "Release held payment" … from the source table + kind (office_approval_queue: escrow kinds are "escrow_<action>"). */
export function approvalKindLabel(a: Pick<ApprovalLike, 'source' | 'kind'>): string {
  let k = (a.kind ?? '').trim();
  if (a.source === 'customer_credit_terms') return 'Credit terms';
  if (a.source === 'escrow_hold_approvals') {
    k = k.replace(/^escrow_/, '');
    if (k === 'release') return 'Release held payment';
    if (k === 'refund') return 'Refund held payment';
    return `Held payment · ${k ? k.replace(/_/g, ' ') : 'decision'}`;
  }
  return KIND_LABELS[k] ?? (k ? k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : 'Approval');
}

/**
 * What a card / drawer may show for one item (Part 7.7):
 *  - `canAct` only while waiting, when the database says this person may decide (finance:approve, not the requester);
 *  - `note` "self" = I recorded it → "You requested this — another Finance user must decide";
 *    "not-approver" = waiting but I can't decide (no approve permission) → read only.
 */
export function approvalCardState(a: Pick<ApprovalLike, 'status' | 'canDecide' | 'mine'>): {
  canAct: boolean;
  note: 'self' | 'not-approver' | null;
  statusLabel: 'Waiting' | 'Approved' | 'Rejected';
  tone: PillTone;
} {
  const statusLabel = a.status === 'approved' ? 'Approved' : a.status === 'rejected' ? 'Rejected' : 'Waiting';
  const tone: PillTone = a.status === 'approved' ? 'success' : a.status === 'rejected' ? 'danger' : 'warning';
  if (a.status !== 'waiting') return { canAct: false, note: null, statusLabel, tone };
  if (a.mine) return { canAct: false, note: 'self', statusLabel, tone };
  if (!a.canDecide) return { canAct: false, note: 'not-approver', statusLabel, tone };
  return { canAct: true, note: null, statusLabel, tone };
}

export const SELF_APPROVAL_NOTE = 'You requested this — another Finance user must decide.';

/** Same rule as decideApproval (REASON_REQUIRED): a rejection needs at least 3 characters of reason. */
export function rejectReasonError(note: string | null | undefined): string | null {
  return (note ?? '').trim().length < 3 ? 'Say why it is rejected (at least 3 characters).' : null;
}

/** Readiness banner text (Part 7.7: the owner must add a second Finance user before go-live). */
export function secondApproverText(approvers: number): string {
  const who = approvers === 1 ? 'Only 1 person' : approvers === 0 ? 'Nobody' : `Only ${approvers} people`;
  return `${who} can approve money actions. Money above the limit needs a second Finance user to decide — the owner must add a second Finance user in Users and roles before go-live.`;
}

/** URL for one approval (staff notifications deep-link here). */
export const approvalHref = (id: string) => `/office/approvals?item=${encodeURIComponent(id)}`;
