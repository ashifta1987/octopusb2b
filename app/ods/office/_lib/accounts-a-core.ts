/**
 * ODS T9 · Accounts batch A (Finance overview, Receivables, Reports, Reports by division) — PURE helpers shared by the
 * server loaders, the client screens, the staging fixtures and tests/unit/ods-office-accounts-a.test.ts. They only
 * reshape rows today's pages already read; the calculations are today's (same thresholds, same sums, same conversion).
 */

export type CurrencyPart = { currency: string; minor: number };
/** Per-currency amounts (never added together unconverted) + the total converted into the platform currency. */
export type Totals = { parts: CurrencyPart[]; convMinor: number; mixed: boolean };

const ORDER = ['USD', 'CNY'];
const sortParts = (a: CurrencyPart, b: CurrencyPart) => (ORDER.indexOf(a.currency) + 1 || 99) - (ORDER.indexOf(b.currency) + 1 || 99) || a.currency.localeCompare(b.currency);

/** Today's sumByCurrency + convertedTotal, as plain data (`mixed` = anything not in the platform currency). */
export function totalsOf<T>(
  rows: T[],
  amount: (r: T) => number | null | undefined,
  currency: (r: T) => string | null | undefined,
  toPlat: (minor: number, currency: string) => number,
  platform: string,
): Totals {
  const m = new Map<string, number>();
  for (const r of rows) {
    const c = (currency(r) ?? '').trim() === 'CNY' ? 'CNY' : 'USD';
    m.set(c, (m.get(c) ?? 0) + Number(amount(r) ?? 0));
  }
  const parts = [...m.entries()].map(([c, minor]) => ({ currency: c, minor })).sort(sortParts);
  return { parts, convMinor: parts.reduce((a, p) => a + toPlat(p.minor, p.currency), 0), mixed: parts.some((p) => p.currency !== platform) };
}

export const PREFIX: Record<string, string> = { USD: 'US$', CNY: 'CN¥' };
const fmt = (minor: number, c: string) => {
  const v = Math.abs(minor) / 100;
  return `${minor < 0 ? '−' : ''}${PREFIX[c] ?? c} ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
/** "US$ 1,200.00 · CN¥ 300.00" (or the platform currency 0.00 when empty) — today's perCurrencyText. */
export function partsText(t: Pick<Totals, 'parts'>, fallback = 'USD'): string {
  return t.parts.length ? t.parts.map((p) => fmt(p.minor, p.currency)).join(' · ') : fmt(0, fallback);
}
export const moneyText = fmt;

/* ───────── Finance overview ───────── */

/** Months for the selector: revenue history + this month + the chosen one, newest first (today's rule). */
export function monthOptions(nowIso: string, chosen: string, history: string[]): string[] {
  const s = new Set<string>([nowIso.slice(0, 7), chosen]);
  history.forEach((h) => s.add(String(h).slice(0, 7)));
  return [...s].filter((m) => /^\d{4}-\d{2}$/.test(m)).sort().reverse();
}
export const validMonth = (m: string | undefined, nowIso: string) => (/^\d{4}-\d{2}$/.test(m ?? '') ? m! : nowIso.slice(0, 7));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Nov 2026" (fixed English abbreviations: same on server and client, whatever the ICU data). */
export function monthLabelOf(m: string): string {
  return `${MON[Number(m.slice(5, 7)) - 1] ?? ''} ${m.slice(0, 4)}`;
}

/** Today's finance approval stage: amount converted to USD (approved rate) above the USD limit → "Needs Admin". */
export function approvalStage(amountMinor: number, currency: string, rate: number, limitUsdMinor: number): 'Needs Admin' | 'Needs Finance' {
  const usd = currency === 'CNY' ? Math.round(amountMinor / rate) : amountMinor;
  return usd > limitUsdMinor ? 'Needs Admin' : 'Needs Finance';
}

/** Refunds as a share of gross (today: "x.x% of revenue", "—" without revenue). */
export const refundShare = (refundsConv: number, grossConv: number) => (grossConv ? `${((refundsConv / grossConv) * 100).toFixed(1)}% of revenue` : '—');

/** Journal balance check row (today's ledgerOk). */
export const ledgerBalanced = (l: { total_debit: number; total_credit: number; unbalanced_journals: number }) =>
  Number(l.total_debit) === Number(l.total_credit) && Number(l.unbalanced_journals) === 0;

/* ───────── Receivables ───────── */

export type ReceivableBucket = 'current' | '1_30' | '31_60' | '61_90' | '90_plus';
export const RECEIVABLE_BUCKETS: { id: ReceivableBucket; label: string }[] = [
  { id: 'current', label: 'Current (not yet due)' },
  { id: '1_30', label: '1–30 days overdue' },
  { id: '31_60', label: '31–60 days overdue' },
  { id: '61_90', label: '61–90 days overdue' },
  { id: '90_plus', label: '90+ days overdue' },
];

export type ReceivableRow = {
  id: string; number: string; orgId: string | null; orgName: string; divisionCode: string; amountMinor: number; paidMinor: number;
  balanceMinor: number; currency: string; dueAt: string | null; daysOverdue: number; bucket: ReceivableBucket; paymentOption: string | null;
  lastReminder: string | null; createdAt: string;
};

/** Today's Receivables mapping exactly: balance = amount − paid; days = floor((now − due)/day), no due = now; > 90 / > 60 / > 30 / > 0. */
export function receivableRows(
  docs: {
    id: string; number: string | null; org_id: string | null; amount_cents: number | null; paid_cents: number | null; currency: string | null;
    due_at: string | null; payment_option: string | null; last_reminder_stage: string | null; created_at: string;
    organizations?: unknown; divisions?: unknown;
  }[],
  nowMs: number,
): { rows: ReceivableRow[]; buckets: Record<ReceivableBucket, number> } {
  const buckets: Record<ReceivableBucket, number> = { current: 0, '1_30': 0, '31_60': 0, '61_90': 0, '90_plus': 0 };
  const one = (o: unknown) => (Array.isArray(o) ? o[0] : o) as Record<string, unknown> | null;
  const rows = docs
    .map((d) => {
      const amount = Number(d.amount_cents ?? 0);
      const paid = Number(d.paid_cents ?? 0);
      const bal = Math.max(0, amount - paid);
      const dueMs = d.due_at ? new Date(d.due_at).getTime() : nowMs;
      const days = Math.floor((nowMs - dueMs) / 86_400_000);
      const bucket: ReceivableBucket = days > 90 ? '90_plus' : days > 60 ? '61_90' : days > 30 ? '31_60' : days > 0 ? '1_30' : 'current';
      buckets[bucket] += bal;
      return {
        id: d.id, number: d.number ?? '', orgId: d.org_id, orgName: String(one(d.organizations)?.name ?? 'Customer'),
        divisionCode: String(one(d.divisions)?.code ?? 'SRC'), amountMinor: amount, paidMinor: paid, balanceMinor: bal,
        currency: (d.currency ?? '').trim() || 'USD', dueAt: d.due_at, daysOverdue: days, bucket, paymentOption: d.payment_option,
        lastReminder: d.last_reminder_stage, createdAt: d.created_at,
      };
    })
    .filter((r) => r.balanceMinor > 0);
  return { rows, buckets };
}

/** Ageing words for a row (never colour alone): "Current" or "12d overdue"; tone as today (≤ 0 ok, ≤ 30 amber, else red). */
export function receivableAge(daysOverdue: number): { label: string; tone: 'success' | 'warning' | 'danger' } {
  if (daysOverdue <= 0) return { label: 'Current', tone: 'success' };
  return { label: `${daysOverdue}d overdue`, tone: daysOverdue <= 30 ? 'warning' : 'danger' };
}

export type CustomerReceivables = {
  orgId: string | null; orgName: string; invoices: ReceivableRow[]; balance: Totals; overdue: Totals; oldestDays: number; byBucket: Record<ReceivableBucket, Totals>;
};

/** Customer drill-down: one customer's open invoices (oldest first), balance per currency, worst age, split by bucket. */
export function customerReceivables(rows: ReceivableRow[], key: { orgId: string | null; orgName: string }, toPlat: (m: number, c: string) => number = (m) => m, platform = 'USD'): CustomerReceivables {
  const inv = rows
    .filter((r) => (key.orgId ? r.orgId === key.orgId : r.orgName === key.orgName))
    .sort((a, b) => b.daysOverdue - a.daysOverdue);
  const t = (list: ReceivableRow[]) => totalsOf(list, (r) => r.balanceMinor, (r) => r.currency, toPlat, platform);
  const byBucket = Object.fromEntries(RECEIVABLE_BUCKETS.map((b) => [b.id, t(inv.filter((r) => r.bucket === b.id))])) as Record<ReceivableBucket, Totals>;
  return {
    orgId: key.orgId, orgName: key.orgName, invoices: inv,
    balance: t(inv),
    overdue: t(inv.filter((r) => r.daysOverdue > 0)),
    oldestDays: inv.length ? Math.max(...inv.map((r) => r.daysOverdue)) : 0,
    byBucket,
  };
}

/* ───────── Reports ───────── */

export const reportMonths = (m: string | undefined) => (m === '12' ? 12 : m === '3' ? 3 : 6);
export const divisionMonths = (m: string | undefined) => (m === '12' ? 12 : m === '3' ? 3 : m === 'all' ? 0 : 6);

/** First day (UTC) of the window that ends with this month (today's `since`). */
export function sinceOf(nowMs: number, months: number): Date {
  const d = new Date(nowMs);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCMonth(d.getUTCMonth() - (Math.max(1, months) - 1));
  return d;
}

/** GMV by month (today: non-cancelled orders in the window, converted; empty months stay 0). */
export function gmvByMonth(orders: { created_at: string; total_cents: number; currency: string | null }[], since: Date, months: number, conv: (minor: number, c: string | null) => number) {
  const keys: string[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(since);
    d.setUTCMonth(since.getUTCMonth() + i);
    keys.push(d.toISOString().slice(0, 7));
  }
  const m = new Map(keys.map((k) => [k, 0]));
  orders.forEach((o) => {
    const k = o.created_at.slice(0, 7);
    if (m.has(k)) m.set(k, (m.get(k) ?? 0) + conv(Number(o.total_cents), o.currency));
  });
  return keys.map((k) => ({ month: k, label: MON[Number(k.slice(5, 7)) - 1] ?? k, minor: m.get(k) ?? 0 }));
}

export type DivisionRow = {
  line: 'division' | 'advertising' | 'company'; division_code: string | null; division_name: string; sort_order: number;
  revenue_by_currency: Record<string, number>; revenue_converted_minor: number; orders_count: number;
  orders_by_currency: Record<string, number>; orders_converted_minor: number; open_work: number; open_detail: Record<string, number>;
  pipeline_count: number; pipeline_by_currency: Record<string, number>; pipeline_converted_minor: number;
  deposits_by_currency: Record<string, number>; deposits_converted_minor: number;
};

/** Company total exactly as today (revenue / orders / order value / open work / pipeline / deposits over every line). */
export function divisionTotals(rows: DivisionRow[]) {
  return rows.reduce(
    (a, r) => ({
      rev: a.rev + Number(r.revenue_converted_minor), ord: a.ord + r.orders_count, val: a.val + Number(r.orders_converted_minor), work: a.work + r.open_work,
      pipe: a.pipe + Number(r.pipeline_converted_minor ?? 0), pipeN: a.pipeN + (r.pipeline_count ?? 0), dep: a.dep + Number(r.deposits_converted_minor ?? 0),
    }),
    { rev: 0, ord: 0, val: 0, work: 0, pipe: 0, pipeN: 0, dep: 0 },
  );
}

export const WORK_LABEL: Record<string, string> = {
  rfqs: 'RFQs', service_requests: 'Service requests', orders: 'Orders in progress', brand_projects: 'Brand projects', pools: 'Open pools',
  turnkey_leads: 'Turnkey leads', turnkey_projects: 'Turnkey projects', shipments: 'Shipments',
};

/** "US$ 1,200.00 + CN¥ 300.00" for non-zero currencies of a by-currency object (today's byCur). */
export function byCurrencyText(m: Record<string, number> | null | undefined): string {
  return Object.entries(m ?? {})
    .filter(([, v]) => Number(v) !== 0)
    .map(([c, v]) => fmt(Number(v), c))
    .join(' + ');
}

export const pct = (v: number, max: number) => (max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0);
