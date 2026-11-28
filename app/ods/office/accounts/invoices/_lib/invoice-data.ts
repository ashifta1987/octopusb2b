import 'server-only';
import { createClient } from '@/lib/supabase/server';
import {
  INVOICE_DOC_TYPES,
  INVOICE_TABS,
  SERVICE_BY_DIVISION,
  SORTABLE,
  daysOverdue,
  initials,
  invoiceFigures,
  invoiceStatus,
  issuedFrom,
  paymentTarget,
  receivableKpis,
  safeSearch,
  serviceLabel,
  tabFilter,
  type InvoiceKpis,
  type InvoiceListResult,
  type InvoiceQuery,
  type InvoiceRow,
  type InvoiceTab,
  type KpiFigure,
  type TabFilterStep,
} from './invoice-core';

/**
 * ODS T9 · Invoices — server reads (session client, RLS applies; the page has already passed
 * requireStaff('finance', 'view') like today's Admin › Finance › Receivables). Read-only: no writes of any kind.
 * Every panel loads and fails on its own: the grid, each tab count and each KPI.
 */

type Sb = Awaited<ReturnType<typeof createClient>>;

/** typed as string on purpose: the literal select parser hits TS2589 on this many embeds; rows are cast to DocRow. */
const COLS: string =
  'id, number, doc_type, org_id, order_id, division_id, amount_cents, paid_cents, currency, status, due_at, payment_option, last_reminder_stage, created_at, data, organizations(name), divisions(code), orders(code, total_cents, paid_cents, currency)';

/** The few PostgREST filter methods the loader uses (keeps the builder's own type through `as T`). */
type Filterable = {
  eq(c: string, v: unknown): Filterable;
  neq(c: string, v: unknown): Filterable;
  gt(c: string, v: unknown): Filterable;
  lt(c: string, v: unknown): Filterable;
  gte(c: string, v: unknown): Filterable;
  in(c: string, v: readonly unknown[]): Filterable;
  not(c: string, op: string, v: unknown): Filterable;
  or(expr: string): Filterable;
};

/** No generic constraint on purpose: checking the Postgrest builder against Filterable is TS2589 (too deep). */
function applySteps<T>(q: T, steps: TabFilterStep[]): T {
  let r = q as unknown as Filterable;
  for (const s of steps) {
    if (s.op === 'or') r = r.or(s.expr);
    else if (s.op === 'notIn') r = r.not(s.col, 'in', `(${s.vals.join(',')})`);
    else if (s.op === 'in') r = r.in(s.col, s.vals);
    else r = r[s.op](s.col, s.val);
  }
  return r as unknown as T;
}


type DocRow = {
  id: string; number: string; doc_type: string; org_id: string | null; order_id: string | null; amount_cents: number | null; paid_cents: number | null;
  currency: string | null; status: string | null; due_at: string | null; payment_option: string | null; last_reminder_stage: string | null;
  created_at: string; data: { service?: string } | null;
  organizations: { name?: string } | null; divisions: { code?: string } | null;
  orders: { code?: string; total_cents?: number; paid_cents?: number; currency?: string } | null;
};

/** Shared filters (search, service, customer, issued) — the same for the grid and every tab count. */
async function sharedFilters(sb: Sb, q: InvoiceQuery, nowMs: number): Promise<{ steps: TabFilterStep[]; empty: boolean }> {
  const steps: TabFilterStep[] = [{ op: 'in', col: 'doc_type', vals: INVOICE_DOC_TYPES }];
  const orgIds = async (name: string) => {
    const { data } = await sb.from('organizations').select('id').ilike('name', `%${name}%`).limit(100);
    return (data ?? []).map((o) => o.id as string);
  };
  const text = safeSearch(q.q);
  if (text) {
    const ids = await orgIds(text);
    steps.push({ op: 'or', expr: [`number.ilike.*${text}*`, ...(ids.length ? [`org_id.in.(${ids.join(',')})`] : [])].join(',') });
  }
  const cust = safeSearch(q.customer);
  if (cust) {
    const ids = await orgIds(cust);
    if (!ids.length) return { steps, empty: true };
    steps.push({ op: 'in', col: 'org_id', vals: ids });
  }
  if (q.service) {
    const { data } = await sb.from('divisions').select('id').eq('code', q.service).maybeSingle();
    if (!data) return { steps, empty: true };
    steps.push({ op: 'eq', col: 'division_id', val: data.id as string });
  }
  if (q.issued) steps.push({ op: 'gte', col: 'created_at', val: issuedFrom(q.issued, nowMs) });
  return { steps, empty: false };
}

function toRow(d: DocRow, nowMs: number, owners: Map<string, string>): InvoiceRow {
  const status = invoiceStatus(d, nowMs);
  const amount = Number(d.amount_cents ?? 0);
  const fig = invoiceFigures(amount, Number(d.paid_cents ?? 0), status);
  const orderOutstanding = d.order_id && d.orders ? Math.max(0, Number(d.orders.total_cents ?? 0) - Number(d.orders.paid_cents ?? 0)) : null;
  const pay = paymentTarget({ docType: d.doc_type, number: d.number, status, orderId: d.order_id, orderOutstandingMinor: orderOutstanding });
  const ownerName = d.org_id ? owners.get(d.org_id) : undefined;
  return {
    id: d.id,
    number: d.number,
    docType: d.doc_type,
    customer: d.organizations?.name ?? 'Customer',
    orgId: d.org_id,
    service: serviceLabel(d.divisions?.code, d.data?.service, d.doc_type),
    issuedAt: d.created_at,
    dueAt: d.due_at,
    amountMinor: d.doc_type === 'credit_note' ? -Math.abs(amount) : amount,
    paidMinor: fig.paid,
    balanceMinor: fig.balance,
    currency: (d.order_id && d.orders?.currency ? d.orders.currency : d.currency ?? 'USD').trim() || 'USD',
    status,
    daysOverdue: status === 'Overdue' ? daysOverdue(d.due_at, nowMs) : 0,
    owner: ownerName ? { initials: initials(ownerName), name: ownerName } : null,
    orderId: d.order_id,
    orderCode: d.orders?.code ?? null,
    orderOutstandingMinor: orderOutstanding,
    payTarget: pay.target,
    payBlockedReason: pay.reason,
    paymentOption: d.payment_option,
    lastReminder: d.last_reminder_stage,
    // documents.emailed_at is not readable by staff sessions (column grant), so it is not shown
    emailedAt: null,
  };
}

/** Owner = the customer's primary account manager (account_managers, as on Admin › Customers). Missing → none. */
async function ownersFor(sb: Sb, orgIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!orgIds.length) return out;
  try {
    const { data: am } = await sb.from('account_managers').select('org_id, staff_user_id').in('org_id', orgIds);
    const staff = [...new Set((am ?? []).map((a) => a.staff_user_id as string))];
    if (!staff.length) return out;
    const { data: profiles } = await sb.from('profiles').select('id, full_name').in('id', staff);
    const names = new Map((profiles ?? []).map((p) => [p.id as string, (p.full_name as string | null) ?? '']));
    for (const a of am ?? []) {
      const n = names.get(a.staff_user_id as string);
      if (n) out.set(a.org_id as string, n);
    }
  } catch {
    /* owner column shows — */
  }
  return out;
}

const fail = (e: unknown): KpiFigure => ({ error: e instanceof Error ? e.message : 'Couldn’t load' });

/** KpiStrip — today's data only: receivables rows as on Admin › Finance › Receivables, confirmed payments, held escrow. */
export async function loadInvoiceKpis(sb: Sb, nowMs: number): Promise<InvoiceKpis> {
  const month = new Date(nowMs);
  const monthStart = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1)).toISOString();
  const [recv, pays, docPays, holds] = await Promise.all([
    sb.from('documents').select('amount_cents, paid_cents, currency, due_at').eq('doc_type', 'commercial_invoice').not('status', 'in', '("paid","void","cancelled")').limit(5000),
    sb.from('payments').select('amount_cents, currency').eq('status', 'confirmed').neq('purpose', 'topup').gte('confirmed_at', monthStart).limit(10000),
    sb.from('document_payments').select('amount_cents, currency').gte('created_at', monthStart).limit(10000),
    sb.from('escrow_holds').select('amount_cents, released_cents, refunded_cents, currency').in('status', ['held', 'partially_released', 'disputed']).limit(10000),
  ]);
  const usd = <T extends { currency?: string | null }>(a: T[]) => a.filter((x) => (x.currency ?? 'USD').trim() === 'USD');
  let receivables: KpiFigure, overdue: KpiFigure & { oldestDays?: number }, due7: KpiFigure;
  if (recv.error) receivables = overdue = due7 = fail(recv.error);
  else ({ receivables, overdue, due7 } = receivableKpis(recv.data ?? [], nowMs));
  let paidMonth: KpiFigure;
  if (pays.error) paidMonth = fail(pays.error);
  else {
    const p = usd(pays.data ?? []);
    const dp = docPays.error ? [] : usd(docPays.data ?? []);
    paidMonth = { minor: [...p, ...dp].reduce((s, x) => s + Number(x.amount_cents ?? 0), 0), count: p.length + dp.length };
  }
  let held: KpiFigure;
  if (holds.error) held = fail(holds.error);
  else {
    const h = usd(holds.data ?? []);
    held = { minor: h.reduce((s, x) => s + Number(x.amount_cents ?? 0) - Number(x.released_cents ?? 0) - Number(x.refunded_cents ?? 0), 0), count: h.length };
  }
  return { receivables, overdue, due7, paidMonth, held };
}

/** Grid page + tab counts + KPIs (server-side sort, filter and pagination). */
export async function loadInvoiceList(q: InvoiceQuery, nowMs: number): Promise<InvoiceListResult> {
  const sb = await createClient();
  const nowIso = new Date(nowMs).toISOString();
  const kpisP = loadInvoiceKpis(sb, nowMs).catch(() => null);
  const shared = await sharedFilters(sb, q, nowMs);
  const kpis = (await kpisP) ?? { receivables: fail(null), overdue: fail(null), due7: fail(null), paidMonth: fail(null), held: fail(null) };
  if (shared.empty) {
    return { ok: true, data: { rows: [], total: 0, counts: Object.fromEntries(INVOICE_TABS.map(([t]) => [t, 0])), kpis, allUsd: true, updatedAt: nowIso } };
  }
  const col = SORTABLE[q.sort.id] ?? 'created_at';
  const from = q.page * q.size;
  const list = applySteps(sb.from('documents').select(COLS, { count: 'exact' }), [...shared.steps, ...tabFilter(q.tab, nowIso)])
    .order(col, { ascending: !q.sort.desc, nullsFirst: false })
    .order('id', { ascending: true })
    .range(from, from + q.size - 1);
  const countQ = (tab: InvoiceTab) => applySteps(sb.from('documents').select('id', { count: 'exact', head: true }), [...shared.steps, ...tabFilter(tab, nowIso)]);
  const [res, ...counts] = await Promise.all([list, ...INVOICE_TABS.map(([t]) => countQ(t))]);
  if (res.error) return { ok: false, error: 'We couldn’t load the invoices.', kpis };
  const docs = (res.data ?? []) as unknown as DocRow[];
  const owners = await ownersFor(sb, [...new Set(docs.map((d) => d.org_id).filter((x): x is string => !!x))]);
  const rows = docs.map((d) => toRow(d, nowMs, owners));
  return {
    ok: true,
    data: {
      rows,
      total: res.count ?? rows.length,
      counts: Object.fromEntries(INVOICE_TABS.flatMap(([t], i) => (counts[i].error ? [] : [[t, counts[i].count ?? 0]]))),
      kpis,
      allUsd: rows.every((r) => r.currency === 'USD'),
      updatedAt: nowIso,
    },
  };
}

/** One invoice (drawer opened from ?open=<id> when it is not on the current page). */
export async function loadInvoiceById(id: string, nowMs: number): Promise<InvoiceRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const sb = await createClient();
  const { data } = await sb.from('documents').select(COLS).eq('id', id).in('doc_type', INVOICE_DOC_TYPES).maybeSingle();
  if (!data) return null;
  const d = data as unknown as DocRow;
  return toRow(d, nowMs, await ownersFor(sb, d.org_id ? [d.org_id] : []));
}

export const SERVICE_FILTER_OPTIONS = Object.values(SERVICE_BY_DIVISION);
