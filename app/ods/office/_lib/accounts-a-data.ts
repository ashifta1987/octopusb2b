import 'server-only';
import { can, type Session } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { countWithoutSeeds, dropSeeds, seedIds, withHiddenColumns } from '@/components/backoffice/hidden-columns';
import { CURRENCIES, convertMinor, humanize, COUNTRY_NAMES } from '@/lib/format';
import { getCurrencyContext, toPlatform } from '@/lib/currency';
import { getDivisionScope } from '@/lib/divisions/scope';
import { isStaging } from '@/lib/core/account';
import { nowMs as getNowMs } from '@/components/account/order-utils';
import {
  approvalStage, divisionTotals, gmvByMonth, ledgerBalanced, monthLabelOf, monthOptions, receivableRows, refundShare, sinceOf, totalsOf,
  type DivisionRow, type ReceivableBucket, type ReceivableRow, type Totals,
} from './accounts-a-core';

/**
 * ODS T9 · Accounts batch A loaders. Each one makes EXACTLY the reads today's page makes (same tables, columns, filters,
 * limits, seed handling and hidden-column helpers), on the staff member's session (RLS). The page calls the same
 * requireStaff(area, action) as today BEFORE calling a loader. Shapes are plain data for the client screens.
 */

const fxOf = async () => {
  const ctx = await getCurrencyContext();
  const step = ctx.rounding[ctx.currency]?.step_minor ?? 1;
  const toPlat = (minor: number, c: string) => convertMinor(minor, c, ctx.currency, ctx.rate, step);
  return { ctx, toPlat, rateText: `${Number(ctx.rate).toLocaleString('en-US', { maximumFractionDigits: 6 })} CNY/USD` };
};

/* ───────── /admin/finance ───────── */

export type FinanceOverviewData = {
  month: string; monthLabel: string; months: { value: string; label: string }[]; currency: string; rateText: string;
  kpis: { gross: Totals; refunds: Totals; net: Totals; paymentsIn: Totals; payoutsDue: Totals; wallets: Totals; refundShare: string; payoutsAwaiting: number };
  streams: { stream: string; label: string; convMinor: number; parts: Totals['parts'] }[];
  revNet: Totals;
  limitUsdMinor: number; limitPlatMinor: number | null;
  ledger: { error: boolean; rows: { currency: string; debit: number; credit: number; journals: number; unbalanced: number; balanced: boolean }[] };
  pending: { id: string; kind: string; label: string; ref: string; forName: string; amountMinor: number; currency: string; reason: string; preparedBy: string; mine: boolean; stage: 'Needs Admin' | 'Needs Finance' }[];
  decided: { id: string; label: string; amountMinor: number; currency: string; status: string; requestedBy: string; approvedBy: string; decidedAt: string | null }[];
  orgs: { id: string; label: string }[]; suppliers: { id: string; label: string }[]; openOrders: { id: string; label: string }[]; unpaid: { id: string; label: string }[];
  topups: { id: string; createdAt: string; org: string; reference: string | null; method: string; amountMinor: number; currency: string }[];
  payments: { id: string; createdAt: string; org: string; reference: string | null; purpose: string; method: string; amountMinor: number; currency: string; status: string }[];
  payouts: { id: string; supplier: string; amountMinor: number; currency: string; status: string; createdAt: string }[];
  journals: { id: string; createdAt: string; who: string; memo: string; number: string; stream: string | null; totals: { currency: string; minor: number }[] }[];
  signedInAs: string;
};

type Approval = { id: string; kind: string; org_id: string | null; supplier_id: string | null; order_id: string | null; amount_cents: number; currency: string; reason: string; status: string; requested_by: string; approved_by: string | null; created_at: string; decided_at: string | null };

export async function loadFinanceOverview(s: Session, monthParam: string | undefined): Promise<FinanceOverviewData> {
  const now = new Date(getNowMs());
  const month = /^\d{4}-\d{2}$/.test(monthParam ?? '') ? monthParam! : now.toISOString().slice(0, 7);
  const from = new Date(month + '-01T00:00:00Z');
  const to = new Date(from); to.setUTCMonth(to.getUTCMonth() + 1);
  const sb = await createClient();
  const [seedPay, seedTop, seedJour, seedOrd] = await Promise.all([seedIds('payments'), seedIds('wallet_topups'), seedIds('journals'), seedIds('orders')]);
  const [rev, revAll, check, paymentsRaw, topupsRaw, approvals, payouts, journalsRaw, openOrdersRaw, orgs, suppliers, limitRow, wallets, refundsRow, fx] = await Promise.all([
    sb.rpc('admin_revenue_by_stream', { p_from: from.toISOString(), p_to: to.toISOString() }),
    sb.rpc('admin_revenue_by_stream', {}),
    sb.rpc('admin_ledger_check'),
    sb.from('payments').select('id, org_id, order_id, purpose, method, amount_cents, currency, reference, status, created_at, confirmed_at').order('created_at', { ascending: false }).limit(25 + seedPay.size),
    sb.from('wallet_topups').select('id, org_id, amount_cents, currency, method, reference, status, created_at').eq('status', 'pending').order('created_at'),
    sb.from('finance_approvals').select('*').order('created_at', { ascending: false }).limit(40),
    sb.from('payouts').select('id, supplier_id, amount_cents, currency, status, reference, created_at, approval_id').order('created_at', { ascending: false }).limit(25),
    sb.from('journals').select('id, number, memo, stream, created_at').order('created_at', { ascending: false }).limit(10 + seedJour.size),
    sb.from('orders').select('id, code, org_id, total_cents, paid_cents, deposit_cents, currency, status').not('status', 'in', '(cancelled,closed)').order('created_at', { ascending: false }).limit(200 + seedOrd.size),
    sb.from('organizations').select('id, name, country').order('name').limit(1000),
    sb.from('suppliers').select('id, code, legal_name').order('code'),
    sb.from('site_settings').select('value').eq('key', 'finance_approval_limit_cents').maybeSingle(),
    sb.rpc('admin_wallet_balances'),
    sb.from('ledger_entries').select('debit_cents, credit_cents, currency, created_at, ledger_accounts!inner(code)').in('ledger_accounts.code', ['exp:refunds', 'exp:refunds:CNY']).gte('created_at', from.toISOString()).lt('created_at', to.toISOString()),
    fxOf(),
  ]);
  const { ctx, toPlat } = fx;
  const P = ctx.currency;
  const payments = dropSeeds(paymentsRaw.data, seedPay, 25);
  const topups = dropSeeds(topupsRaw.data, seedTop);
  const journals = await withHiddenColumns<NonNullable<typeof journalsRaw.data>[number], { created_by: string | null }>('journals', dropSeeds(journalsRaw.data, seedJour, 10), 'created_by');
  const openOrders = dropSeeds(openOrdersRaw.data, seedOrd, 200);
  const limit = Number(limitRow.data?.value ?? 100000);

  type RevRow = { stream: string; credit_cents: number; debit_cents: number; net_cents: number; currency: string; net_converted_minor: number };
  const revRows = (rev.data ?? []) as RevRow[];
  const gross = totalsOf(revRows, (r) => r.credit_cents, (r) => r.currency, toPlat, P);
  const refundsSrc = [
    ...(refundsRow.data ?? []).map((r) => ({ v: Number(r.debit_cents) - Number(r.credit_cents), c: r.currency as string })),
    ...revRows.map((r) => ({ v: Number(r.debit_cents), c: r.currency })),
  ];
  const refundsPos = totalsOf(refundsSrc, (x) => x.v, (x) => x.c, toPlat, P);
  const grossMap = new Map(gross.parts.map((p) => [p.currency, p.minor]));
  const refMap = new Map(refundsPos.parts.map((p) => [p.currency, p.minor]));
  const netSrc = CURRENCIES.filter((c) => grossMap.has(c) || refMap.has(c)).map((c) => ({ c, v: (grossMap.get(c) ?? 0) - (refMap.get(c) ?? 0) }));
  const net = totalsOf(netSrc, (x) => x.v, (x) => x.c, toPlat, P);
  const refunds = totalsOf(refundsPos.parts, (p) => -p.minor, (p) => p.currency, toPlat, P);
  const paymentsIn = totalsOf(payments.filter((p) => p.status === 'confirmed' && p.confirmed_at && p.confirmed_at >= from.toISOString() && p.confirmed_at < to.toISOString()), (p) => p.amount_cents, (p) => p.currency, toPlat, P);
  const payoutsDue = totalsOf((payouts.data ?? []).filter((p) => ['scheduled', 'approved'].includes(p.status)), (p) => p.amount_cents, (p) => p.currency, toPlat, P);
  const walletsT = totalsOf((wallets.data ?? []) as { balance_cents: number; currency: string }[], (w) => w.balance_cents, (w) => w.currency, toPlat, P);

  type LedgerRow = { total_debit: number; total_credit: number; journals: number; unbalanced_journals: number; currency: string };
  const ledgerRows = (check.data ?? []) as LedgerRow[];
  const streams = new Map<string, { conv: number; rows: RevRow[] }>();
  revRows.forEach((r) => { const x = streams.get(r.stream) ?? { conv: 0, rows: [] }; x.conv += Number(r.net_converted_minor ?? r.net_cents); x.rows.push(r); streams.set(r.stream, x); });
  const orgName = new Map((orgs.data ?? []).map((o) => [o.id as string, o.name as string]));
  const supName = new Map((suppliers.data ?? []).map((x) => [x.id as string, `${x.legal_name} · ${x.code}`]));
  const appr = (approvals.data ?? []) as Approval[];
  const pending = appr.filter((a) => a.status === 'requested');
  const decided = appr.filter((a) => a.status !== 'requested').slice(0, 10);
  const peopleIds = [...new Set([...appr.flatMap((a) => [a.requested_by, a.approved_by]), ...journals.map((j) => j.created_by)].filter(Boolean) as string[])];
  const { data: people } = peopleIds.length ? await sb.from('profiles').select('id, full_name, email').in('id', peopleIds) : { data: [] };
  const who = new Map((people ?? []).map((p) => [p.id as string, (p.full_name as string) || (p.email as string)]));
  const jIds = journals.map((j) => j.id);
  const { data: jEntries } = jIds.length ? await sb.from('ledger_entries').select('journal_id, debit_cents, currency').in('journal_id', jIds) : { data: [] };
  const jTotals = new Map<string, Map<string, number>>();
  (jEntries ?? []).forEach((e) => {
    const m = jTotals.get(e.journal_id) ?? new Map<string, number>();
    m.set(e.currency, (m.get(e.currency) ?? 0) + Number(e.debit_cents));
    jTotals.set(e.journal_id, m);
  });
  const unpaid = openOrders.filter((o) => Number(o.paid_cents) < Number(o.total_cents));
  const fmtMinor = (minor: number, c: string) => `${c === 'CNY' ? 'CN¥' : 'US$'} ${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return {
    month, monthLabel: monthLabelOf(month),
    months: monthOptions(now.toISOString(), month, ((revAll.data ?? []) as { month: string }[]).map((r) => String(r.month))).map((m) => ({ value: m, label: monthLabelOf(m) })),
    currency: P, rateText: fx.rateText,
    kpis: {
      gross, refunds, net, paymentsIn, payoutsDue, wallets: walletsT,
      refundShare: refundShare(refundsPos.convMinor, gross.convMinor),
      payoutsAwaiting: pending.filter((a) => a.kind === 'payout').length,
    },
    streams: [...streams.entries()].sort((a, b) => b[1].conv - a[1].conv).map(([stream, x]) => ({ stream, label: humanize(stream), convMinor: x.conv, parts: totalsOf(x.rows, (r) => r.net_cents, (r) => r.currency, toPlat, P).parts })),
    revNet: totalsOf(revRows, (r) => r.net_cents, (r) => r.currency, toPlat, P),
    limitUsdMinor: limit, limitPlatMinor: P !== 'USD' ? toPlat(limit, 'USD') : null,
    ledger: { error: !!check.error, rows: ledgerRows.map((l) => ({ currency: l.currency, debit: Number(l.total_debit), credit: Number(l.total_credit), journals: Number(l.journals), unbalanced: Number(l.unbalanced_journals), balanced: ledgerBalanced(l) })) },
    pending: pending.map((a) => ({
      id: a.id, kind: a.kind, label: humanize(a.kind), ref: a.id.slice(0, 8).toUpperCase(),
      forName: (a.supplier_id ? supName.get(a.supplier_id) : a.org_id ? orgName.get(a.org_id) : null) ?? '—',
      amountMinor: Number(a.amount_cents), currency: a.currency, reason: a.reason, preparedBy: who.get(a.requested_by) ?? '—', mine: a.requested_by === s.userId,
      stage: approvalStage(Number(a.amount_cents), a.currency, ctx.rate, limit),
    })),
    decided: decided.map((a) => ({ id: a.id, label: humanize(a.kind), amountMinor: Number(a.amount_cents), currency: a.currency, status: a.status, requestedBy: who.get(a.requested_by) ?? '—', approvedBy: a.approved_by ? who.get(a.approved_by) ?? '—' : '—', decidedAt: a.decided_at })),
    orgs: (orgs.data ?? []).map((o) => ({ id: o.id as string, label: `${o.name}${o.country ? ` · ${o.country}` : ''}` })),
    suppliers: (suppliers.data ?? []).map((x) => ({ id: x.id as string, label: `${x.code} · ${x.legal_name}` })),
    openOrders: openOrders.map((o) => ({ id: o.id as string, label: `${o.code} · ${orgName.get(o.org_id as string) ?? ''} · ${o.currency}` })),
    unpaid: unpaid.map((o) => ({ id: o.id as string, label: `${o.code} · ${orgName.get(o.org_id as string) ?? ''} · due ${fmtMinor(Number(o.total_cents) - Number(o.paid_cents), o.currency as string)} (${humanize(o.status as string)})` })),
    topups: topups.map((t) => ({ id: t.id as string, createdAt: t.created_at as string, org: orgName.get(t.org_id as string) ?? '—', reference: (t.reference as string | null) ?? null, method: humanize(t.method as string), amountMinor: Number(t.amount_cents), currency: t.currency as string })),
    payments: payments.map((p) => ({ id: p.id as string, createdAt: p.created_at as string, org: p.org_id ? orgName.get(p.org_id as string) ?? '—' : '—', reference: (p.reference as string | null) ?? null, purpose: humanize(p.purpose as string), method: humanize(p.method as string), amountMinor: Number(p.amount_cents), currency: p.currency as string, status: p.status as string })),
    payouts: (payouts.data ?? []).map((p) => ({ id: p.id as string, supplier: supName.get(p.supplier_id as string) ?? '—', amountMinor: Number(p.amount_cents), currency: p.currency as string, status: p.status as string, createdAt: p.created_at as string })),
    journals: journals.map((j) => ({ id: j.id as string, createdAt: j.created_at as string, who: j.created_by ? who.get(j.created_by) ?? 'Staff' : 'System', memo: (j.memo as string) ?? '', number: String(j.number ?? ''), stream: (j.stream as string | null) ?? null, totals: [...(jTotals.get(j.id as string) ?? new Map<string, number>())].map(([currency, minor]) => ({ currency, minor })) })),
    signedInAs: s.profile?.full_name ?? s.email ?? '',
  };
}

/* ───────── /admin/finance/receivables ───────── */

export type ReconciliationAlert = { id: string; provider: string; providerPaymentId: string | null; kind: string; expectedMinor: number | null; actualMinor: number | null; currency: string | null; detail: string; status: string; createdAt: string };

export async function loadReceivables(): Promise<{ rows: ReceivableRow[]; buckets: Record<ReceivableBucket, number>; alerts: ReconciliationAlert[]; currency: string; rateText: string }> {
  const sb = await createClient();
  const [{ data: docs, error }, { data: alerts, error: e2 }, fx] = await Promise.all([
    sb.from('documents')
      .select('id, number, org_id, division_id, amount_cents, paid_cents, currency, status, due_at, payment_option, last_reminder_stage, created_at, organizations(name), divisions(code)')
      .eq('doc_type', 'commercial_invoice')
      .not('status', 'in', '("paid","void","cancelled")')
      .order('due_at', { ascending: true, nullsFirst: false })
      .limit(200),
    sb.from('payment_reconciliation_alerts')
      .select('id, provider, provider_payment_id, kind, expected_cents, actual_cents, currency, detail, status, created_at')
      .order('created_at', { ascending: false })
      .limit(50),
    fxOf(),
  ]);
  if (error) throw new Error(`documents: ${error.message}`);
  const { rows, buckets } = receivableRows((docs ?? []) as Parameters<typeof receivableRows>[0], getNowMs());
  return {
    rows, buckets, currency: fx.ctx.currency, rateText: fx.rateText,
    alerts: e2 ? [] : ((alerts ?? []) as Record<string, unknown>[]).map((a) => ({
      id: String(a.id), provider: String(a.provider ?? ''), providerPaymentId: (a.provider_payment_id as string | null) ?? null, kind: String(a.kind ?? ''),
      expectedMinor: a.expected_cents == null ? null : Number(a.expected_cents), actualMinor: a.actual_cents == null ? null : Number(a.actual_cents),
      currency: (a.currency as string | null) ?? null, detail: String(a.detail ?? ''), status: String(a.status ?? ''), createdAt: String(a.created_at ?? ''),
    })),
  };
}

/* ───────── /admin/reports ───────── */

const SWITCHES: { key: string; label: string; hint: string }[] = [
  { key: 'wallet_enabled', label: 'Wallet', hint: 'Customers top up and pay services from the wallet' },
  { key: 'supplier_portal_enabled', label: 'Supplier portal', hint: 'Suppliers log in and manage their own products' },
  { key: 'ads_enabled', label: 'Advertising', hint: 'Pay-per-click ads on the storefront' },
  { key: 'supplier_sees_contacts_after_paid', label: 'Supplier sees buyer contacts after payment', hint: 'Contacts visibility rule' },
];
const OPEN_RFQ = ['submitted', 'assigned', 'quoting', 'quoted'];
const OPEN_TICKET = ['new', 'open', 'waiting_customer', 'waiting_internal', 'reopened'];

export type ReportsData = {
  months: number; currency: string; rateText: string; mixed: boolean;
  firstSupplier: { at: string; by: string | null } | null;
  kpis: { gmv: Totals; orders: number; nonOrder: Totals; customers: number; kycPct: number; verified: number; liveProducts: number; openRfqs: number; openTickets: number };
  gmvMonths: { month: string; label: string; minor: number }[];
  streams: { stream: string; label: string; convMinor: number; text: string }[];
  switches: { key: string; label: string; hint: string; on: boolean }[];
  serviceTypes: { code: string; label: string; count: number }[];
  topCountries: string[];
  topSuppliers: { id: string; name: string; code: string; country: string | null; gmvMinor: number; orders: number }[];
  staff: { id: string; name: string; roles: string[] }[];
  activity: { key: string; at: string; who: string; what: string }[];
  auditShown: boolean;
};

export async function loadReports(s: Session, months: number): Promise<ReportsData> {
  const since = sinceOf(getNowMs(), months);
  const sb = await createClient();
  const [seedOrd, seedOrg, seedProd, seedRfq, seedTkt, seedSr] = await Promise.all(['orders', 'organizations', 'products', 'rfqs', 'tickets', 'service_requests'].map((t) => seedIds(t)));
  const [ordersRaw, revenue, orgsRaw, liveProductsRaw, openRfqsRaw, openTicketsRaw, srsRaw, settings, audit, history, staffRoles, suppliers, ctx] = await Promise.all([
    sb.from('orders').select('id, total_cents, currency, status, created_at, org_id').neq('status', 'cancelled').limit(5000 + seedOrd.size),
    sb.rpc('admin_revenue_by_stream', { p_from: since.toISOString() }),
    sb.from('organizations').select('id, kyc_status, country').is('archived_at', null).limit(10000 + seedOrg.size),
    sb.from('products').select('id', { count: 'exact', head: true }).eq('status', 'live'),
    sb.from('rfqs').select('id', { count: 'exact', head: true }).in('status', OPEN_RFQ),
    sb.from('tickets').select('id', { count: 'exact', head: true }).in('status', OPEN_TICKET),
    sb.from('service_requests').select('id, service_code').limit(5000 + seedSr.size),
    sb.from('site_settings').select('key, value').in('key', SWITCHES.map((x) => x.key)),
    can(s, 'audit', 'view') ? sb.from('audit_log').select('id, actor_id, action, entity, entity_id, created_at').order('created_at', { ascending: false }).limit(8) : Promise.resolve({ data: [] as never[] }),
    sb.from('status_history').select('id, entity, entity_id, from_status, to_status, actor_id, reason, created_at').order('created_at', { ascending: false }).limit(8),
    can(s, 'staff', 'view') ? sb.from('user_roles').select('user_id, role_code, roles!inner(is_staff)').eq('roles.is_staff', true) : Promise.resolve({ data: [] as never[] }),
    sb.from('suppliers').select('id, code, legal_name, country, is_seed'),
    getCurrencyContext(),
  ]);
  const orders = await withHiddenColumns<NonNullable<typeof ordersRaw.data>[number], { supplier_id: string | null }>('orders', dropSeeds(ordersRaw.data, seedOrd, 5000), 'supplier_id');
  const orgList = dropSeeds(orgsRaw.data, seedOrg, 10000);
  const srs = dropSeeds(srsRaw.data, seedSr, 5000);
  const [liveProducts, openRfqs, openTickets] = await Promise.all([
    countWithoutSeeds(liveProductsRaw.count, seedProd, (ids) => sb.from('products').select('id', { count: 'exact', head: true }).eq('status', 'live').in('id', ids)),
    countWithoutSeeds(openRfqsRaw.count, seedRfq, (ids) => sb.from('rfqs').select('id', { count: 'exact', head: true }).in('status', OPEN_RFQ).in('id', ids)),
    countWithoutSeeds(openTicketsRaw.count, seedTkt, (ids) => sb.from('tickets').select('id', { count: 'exact', head: true }).in('status', OPEN_TICKET).in('id', ids)),
  ]);
  const { data: wipeRow } = await sb.from('site_settings').select('value').eq('key', 'demo_wipe').maybeSingle();
  const wipe = wipeRow?.value as { at?: string; by_name?: string | null } | undefined;
  const realSuppliers = (suppliers.data ?? []).filter((x) => !x.is_seed).length;

  const P = ctx.currency;
  const step = ctx.rounding[P]?.step_minor ?? 1;
  const toPlat = (minor: number, c: string) => convertMinor(minor, c, P, ctx.rate, step);
  const conv = (minor: number, currency: string | null) => toPlatform(ctx, minor, currency) ?? 0;
  const periodOrders = orders.filter((o) => new Date(o.created_at as string) >= since);
  const gmvT = totalsOf(periodOrders, (o) => o.total_cents as number, (o) => o.currency as string, toPlat, P);
  const revRows = (revenue.data ?? []) as { month: string; stream: string; net_cents: number; currency: string; net_converted_minor: number }[];
  const byStream = new Map<string, number>();
  revRows.forEach((r) => byStream.set(r.stream, (byStream.get(r.stream) ?? 0) + Number(r.net_converted_minor ?? r.net_cents)));
  const streamBy = new Map<string, Map<string, number>>();
  revRows.forEach((r) => { const m = streamBy.get(r.stream) ?? new Map<string, number>(); m.set(r.currency, (m.get(r.currency) ?? 0) + Number(r.net_cents)); streamBy.set(r.stream, m); });
  const nonOrder = totalsOf(revRows.filter((r) => r.stream !== 'orders'), (r) => r.net_cents, (r) => r.currency, toPlat, P);
  const mixed = [...gmvT.parts.map((p) => p.currency), ...revRows.map((r) => r.currency)].some((c) => c !== P);
  const verified = orgList.filter((o) => o.kyc_status === 'verified').length;
  const setting = new Map((settings.data ?? []).map((r) => [r.key as string, r.value === true || r.value === 'true']));
  const srCount = new Map<string, number>();
  srs.forEach((r) => srCount.set(r.service_code as string, (srCount.get(r.service_code as string) ?? 0) + 1));
  const byCountry = new Map<string, number>();
  orgList.forEach((o) => o.country && byCountry.set(o.country as string, (byCountry.get(o.country as string) ?? 0) + 1));
  const supMap = new Map((suppliers.data ?? []).map((x) => [x.id as string, x]));
  const supAgg = new Map<string, { gmv: number; n: number }>();
  periodOrders.forEach((o) => { if (!o.supplier_id) return; const a = supAgg.get(o.supplier_id) ?? { gmv: 0, n: 0 }; a.gmv += conv(Number(o.total_cents), o.currency as string); a.n++; supAgg.set(o.supplier_id, a); });

  const actorIds = new Set<string>();
  (audit.data ?? []).forEach((a: { actor_id: string | null }) => a.actor_id && actorIds.add(a.actor_id));
  (history.data ?? []).forEach((h) => h.actor_id && actorIds.add(h.actor_id as string));
  const staffIds = new Set(((staffRoles.data ?? []) as { user_id: string }[]).map((r) => r.user_id));
  const peopleIds = [...new Set([...actorIds, ...staffIds])];
  const { data: people } = peopleIds.length ? await sb.from('profiles').select('id, full_name, email, active').in('id', peopleIds) : { data: [] };
  const name = new Map((people ?? []).map((p) => [p.id as string, (p.full_name as string) || (p.email as string)]));
  const activity = [
    ...((audit.data ?? []) as { id: number; actor_id: string | null; action: string; entity: string | null; entity_id: string | null; created_at: string }[])
      .map((a) => ({ key: `a${a.id}`, at: a.created_at, who: a.actor_id ? name.get(a.actor_id) ?? 'Staff' : 'System', what: `${humanize(a.action.replace('.', ' · '))}${a.entity_id ? ` — ${a.entity_id.slice(0, 40)}` : ''}` })),
    ...(history.data ?? []).map((h) => ({ key: `h${h.id}`, at: h.created_at as string, who: h.actor_id ? name.get(h.actor_id as string) ?? 'User' : 'System', what: `${humanize(h.entity as string)} ${h.from_status ? humanize(h.from_status as string) + ' → ' : ''}${humanize(h.to_status as string)}${h.reason ? ` (${h.reason})` : ''}` })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10);
  const staffByUser = new Map<string, string[]>();
  ((staffRoles.data ?? []) as { user_id: string; role_code: string }[]).forEach((r) => staffByUser.set(r.user_id, [...(staffByUser.get(r.user_id) ?? []), r.role_code]));

  return {
    months, currency: P, rateText: `${Number(ctx.rate).toLocaleString('en-US', { maximumFractionDigits: 6 })} CNY/USD`, mixed,
    firstSupplier: wipe?.at && realSuppliers === 0 ? { at: wipe.at, by: wipe.by_name ?? null } : null,
    kpis: {
      gmv: gmvT, orders: periodOrders.length, nonOrder, customers: orgList.length, kycPct: orgList.length ? Math.round((verified / orgList.length) * 100) : 0, verified,
      liveProducts: liveProducts ?? 0, openRfqs: openRfqs ?? 0, openTickets: openTickets ?? 0,
    },
    gmvMonths: gmvByMonth(periodOrders as { created_at: string; total_cents: number; currency: string | null }[], since, months, conv),
    streams: [...byStream.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({
      stream: k, label: humanize(k), convMinor: v,
      text: [...(streamBy.get(k) ?? new Map<string, number>())].map(([c, x]) => `${c === 'CNY' ? 'CN¥' : 'US$'} ${(x / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join(' · '),
    })),
    switches: SWITCHES.map((x) => ({ ...x, on: setting.get(x.key) ?? false })),
    serviceTypes: [...srCount.entries()].sort((a, b) => b[1] - a[1]).map(([code, count]) => ({ code, label: humanize(code), count })),
    topCountries: [...byCountry.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c]) => COUNTRY_NAMES[c] ?? c),
    topSuppliers: [...supAgg.entries()].sort((a, b) => b[1].gmv - a[1].gmv).slice(0, 5).map(([id, a]) => {
      const sp = supMap.get(id);
      return { id, name: (sp?.legal_name as string) ?? (sp?.code as string) ?? '—', code: (sp?.code as string) ?? '', country: (sp?.country as string | null) ?? null, gmvMinor: a.gmv, orders: a.n };
    }),
    staff: [...staffByUser.entries()].slice(0, 6).map(([id, roles]) => ({ id, name: name.get(id) ?? '—', roles })),
    activity,
    auditShown: can(s, 'audit', 'view'),
  };
}

/* ───────── /admin/reports/divisions ───────── */

export type DivisionReportData = {
  months: number; includeTest: boolean; staging: boolean; currency: string; mixed: boolean;
  scopeAll: boolean; scopeName: string | null;
  divisions: DivisionRow[]; extra: DivisionRow[];
  held: Record<string, { count: number; cents: number }>; totalHeld: number;
  total: ReturnType<typeof divisionTotals>;
};

export async function loadDivisionReport(s: Session, months: number, testParam: string | undefined): Promise<DivisionReportData> {
  const includeTest = isStaging() && testParam === '1';
  const since = sinceOf(getNowMs(), months || 1);
  const sb = await createClient();
  const [scope, ctx, res, heldRes] = await Promise.all([
    getDivisionScope(s), getCurrencyContext(),
    sb.rpc('division_report', { p_from: months ? since.toISOString() : null, p_to: null, p_include_test: includeTest }),
    sb.rpc('held_payment_protection_by_division', { p_from: months ? since.toISOString() : null, p_to: null, p_include_test: includeTest }),
  ]);
  if (res.error) throw new Error(`Could not load the division report: ${res.error.message}`);
  const held: Record<string, { count: number; cents: number }> = {};
  ((heldRes.data ?? []) as { division_code: string; held_count: number; held_converted_minor: number }[]).forEach((h) => (held[h.division_code] = { count: Number(h.held_count ?? 0), cents: Number(h.held_converted_minor ?? 0) }));
  let rows = (res.data ?? []) as DivisionRow[];
  if (!scope.all) rows = rows.filter((r) => r.division_code === scope.division.code);
  const divisions = rows.filter((r) => r.line === 'division');
  return {
    months, includeTest, staging: isStaging(), currency: ctx.currency,
    mixed: rows.some((r) => [...Object.keys(r.revenue_by_currency ?? {}), ...Object.keys(r.orders_by_currency ?? {})].some((c) => c !== ctx.currency)),
    scopeAll: scope.all, scopeName: scope.all ? null : scope.division.name,
    divisions, extra: rows.filter((r) => r.line !== 'division'),
    held, totalHeld: divisions.reduce((acc, r) => acc + (held[r.division_code ?? '']?.cents ?? 0), 0),
    total: divisionTotals(rows),
  };
}
