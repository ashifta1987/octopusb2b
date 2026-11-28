import 'server-only';
/**
 * ODS T9 · Customer record data — TODAY's queries (app/admin/customers/[id]/page.tsx + components/admin/customer-one-app.tsx),
 * plus per-tab reads of the customer's rows with the SAME session client, so RLS decides exactly as today (account managers see
 * only their own customers). Extra reads are gated with today's permission checks (see customer-logic.ts panelVisibility):
 *  - money / invoices / payments / statement: finance:view or orders:view (today's /admin/finance/* and /office/orders/[id]);
 *  - wallet balance + top-ups: wallet:view or finance:view (today's /admin/wallet);
 *  - credit terms: finance:view, read with the admin client only after that check (today's /admin/finance/credit);
 *  - supplier documents (purchase orders, remittances) are not even SELECTed without admin / suppliers:view / finance:view.
 * Read-only. Each part loads and fails on its own (null = failed). Writes stay in today's server actions.
 */
import { cache } from 'react';
import { unstable_rethrow } from 'next/navigation';
import { can, type Session } from '@/lib/auth';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { withHiddenColumns } from '@/components/backoffice/hidden-columns';
import { loadAssistantSettings, loadWorkload } from '@/components/admin/assistant/data';
import { COUNTRY_NAMES } from '@/lib/format';
import {
  OPEN_REQUEST_STATUSES,
  SERVICE_LABEL,
  activeServices,
  companyStatusName,
  currencyLabel,
  customerPerms,
  formatCents,
  humanizeWord,
  invoiceBalanceCents,
  invoiceStatusName,
  isSupplierDocType,
  moneySummary,
  openItems as mapOpenItems,
  orderServiceLabel,
  panelVisibility,
  shortDate,
  type CustomerPerms,
  type MoneySummary,
  type PanelVisibility,
} from '../../_lib/customer-logic';
import type {
  AccountManagerVM, ActivityTabVM, ActivityVM, CompanyVM, CreditVM, CustomerActionsVM, CustomerHeaderVM, DocumentsTabVM, InvoiceRowVM,
  OrderRowVM, OverviewVM, PanelData, RfqRowVM, TeamTabVM, WalletTabVM,
} from '../../_lib/types';

type Sb = Awaited<ReturnType<typeof createClient>>;

async function part<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    unstable_rethrow(e);
    return null;
  }
}
const must = <T,>(r: { data: T | null; error: unknown }): T => {
  if (r.error) throw r.error;
  return (r.data ?? ([] as unknown)) as T;
};

const ORG_COLS = 'id, name, buyer_code, country, city, business_type, registration_no, website, kyc_status, credit_eligible, created_at, archived_at, wallet_reference';
type OrgRow = {
  id: string; name: string; buyer_code: string | null; country: string | null; city: string | null; business_type: string | null; registration_no: string | null;
  website: string | null; kyc_status: string; credit_eligible: boolean | null; created_at: string; archived_at: string | null; wallet_reference: string | null;
};

export type CustomerCtx = { s: Session; sb: Sb; id: string; org: OrgRow; perms: CustomerPerms; vis: PanelVisibility; managerId: string | null; nowIso: string };

/** Org row (today's select + archived_at / wallet_reference, both read by today's pages) and the account manager id. null = not found / not visible. */
export async function loadCustomerCtx(s: Session, id: string): Promise<CustomerCtx | null> {
  const sb = await createClient();
  const [{ data: org }, { data: am }] = await Promise.all([
    sb.from('organizations').select(ORG_COLS).eq('id', id).maybeSingle(),
    sb.from('account_managers').select('staff_user_id').eq('org_id', id).maybeSingle(),
  ]);
  if (!org) return null;
  const managerId = (am?.staff_user_id as string | undefined) ?? null;
  const perms = customerPerms(s, managerId);
  const nowIso = new Date().toISOString(); // request time (the page is dynamic: it read the staff session first)
  return { s, sb, id, org: org as unknown as OrgRow, perms, vis: panelVisibility(perms), managerId, nowIso };
}

/* ───────── shared cached reads (one query per request even when two panels need it) ───────── */

const ordersFor = cache(async (sb: Sb, id: string) =>
  must(await sb.from('orders').select('id, code, title, status, total_cents, paid_cents, currency, created_at, pool_id').eq('org_id', id).order('created_at', { ascending: false }).limit(200)) as {
    id: string; code: string; title: string; status: string; total_cents: number; paid_cents: number; currency: string | null; created_at: string; pool_id: string | null;
  }[]);

const rfqsFor = cache(async (sb: Sb, id: string) =>
  must(await sb.from('rfqs').select('id, code, title, quantity, unit, status, created_at, quotes(id)').eq('org_id', id).order('created_at', { ascending: false }).limit(200)) as {
    id: string; code: string; title: string; quantity: number; unit: string | null; status: string; created_at: string; quotes: unknown[] | null;
  }[]);

const invoicesFor = cache(async (sb: Sb, id: string) =>
  must(await sb.from('documents').select('id, number, doc_type, status, amount_cents, paid_cents, currency, due_at, created_at').eq('org_id', id).in('doc_type', ['commercial_invoice', 'proforma_invoice', 'credit_note']).order('created_at', { ascending: false }).limit(200)) as {
    id: string; number: string; doc_type: string; status: string | null; amount_cents: number | null; paid_cents: number | null; currency: string | null; due_at: string | null; created_at: string;
  }[]);

const paymentsFor = cache(async (sb: Sb, id: string) =>
  must(await sb.from('payments').select('amount_cents, status, method, created_at, confirmed_at').eq('org_id', id).order('created_at', { ascending: false }).limit(500)) as {
    amount_cents: number; status: string; method: string; created_at: string; confirmed_at: string | null;
  }[]);

const profilesFor = async (sb: Sb, ids: (string | null | undefined)[]) => {
  const uniq = [...new Set(ids.filter(Boolean))] as string[];
  if (!uniq.length) return new Map<string, { full_name: string | null; email: string | null; title: string | null; team: string | null; office: string | null; out_of_office: boolean | null }>();
  const { data } = await sb.from('profiles').select('id, full_name, email, title, team, office, out_of_office').in('id', uniq);
  return new Map((data ?? []).map((p) => [p.id as string, p as { full_name: string | null; email: string | null; title: string | null; team: string | null; office: string | null; out_of_office: boolean | null }]));
};

const amHistory = cache(async (sb: Sb, id: string) =>
  must(await sb.from('audit_log').select('id, actor_id, action, details, created_at').eq('entity', 'organizations').eq('entity_id', id).like('action', 'assistant.%').order('created_at', { ascending: false }).limit(10)) as {
    id: string; actor_id: string | null; action: string; details: { staff?: string; reason?: string } | null; created_at: string;
  }[]);

/* ───────── header + actions (today's page: org, members, account manager, settings, counts, workload) ───────── */

export async function loadHeaderAndActions(ctx: CustomerCtx): Promise<{ header: CustomerHeaderVM; actions: CustomerActionsVM; company: CompanyVM }> {
  const { sb, id, org, perms, vis, s } = ctx;
  const count = (q: PromiseLike<{ count: number | null; error: unknown }>) => part(async () => { const r = await q; if (r.error) throw r.error; return r.count ?? 0; });
  const [amRow, settings, members, nOrders, nRfqs, nTickets, nInvoices, nDocs, services, ticket, rfq, workload, limits, ceiling, markets, kyc] = await Promise.all([
    sb.from('account_managers').select('org_id, staff_user_id, team, assigned_at').eq('org_id', id).maybeSingle().then((r) => r.data),
    loadAssistantSettings(sb),
    sb.from('org_members').select('user_id, member_role, created_at').eq('org_id', id).order('created_at').then((r) => r.data ?? []),
    count(sb.from('orders').select('id', { count: 'exact', head: true }).eq('org_id', id)),
    count(sb.from('rfqs').select('id', { count: 'exact', head: true }).eq('org_id', id)),
    count(sb.from('tickets').select('id', { count: 'exact', head: true }).eq('org_id', id)),
    vis.invoices ? count(sb.from('documents').select('id', { count: 'exact', head: true }).eq('org_id', id).in('doc_type', ['commercial_invoice', 'proforma_invoice', 'credit_note'])) : Promise.resolve(null),
    count(vis.supplierDocuments
      ? sb.from('documents').select('id', { count: 'exact', head: true }).eq('org_id', id)
      : sb.from('documents').select('id', { count: 'exact', head: true }).eq('org_id', id).not('doc_type', 'in', '("purchase_order","remittance")')),
    sb.from('company_services').select('service, status, plan, updated_at').eq('org_id', id).then((r) => r.data ?? []),
    vis.tickets ? sb.from('tickets').select('id').eq('org_id', id).not('status', 'in', '("resolved","closed")').order('updated_at', { ascending: false }).limit(1).maybeSingle().then((r) => r.data) : Promise.resolve(null),
    vis.requestLinks ? sb.from('rfqs').select('id').eq('org_id', id).in('status', [...OPEN_REQUEST_STATUSES]).order('created_at', { ascending: false }).limit(1).maybeSingle().then((r) => r.data) : Promise.resolve(null),
    perms.reassign ? loadWorkload(sb) : Promise.resolve([]),
    sb.from('customer_limits').select('max_order_cents, max_month_cents, min_margin_pct, set_at').eq('org_id', id).maybeSingle().then((r) => r.data),
    sb.from('manager_limits').select('max_amount_cents, min_margin_pct').eq('manager_user_id', s.userId).maybeSingle().then((r) => r.data),
    sb.from('dropship_markets').select('country, locked_by_staff').eq('org_id', id).order('country').then((r) => r.data ?? []),
    sb.from('kyc_submissions').select('id').eq('org_id', id).order('submitted_at', { ascending: false }).limit(1).maybeSingle().then((r) => r.data),
  ]);
  // assigned_by / reason are hidden from session reads (migration 195): added with the service role for the row RLS returned (as today).
  const [am] = amRow ? await withHiddenColumns<typeof amRow, { assigned_by: string | null; reason: string | null }>('account_managers', [amRow], 'assigned_by, reason', 'org_id') : [];
  const history = await part(() => amHistory(sb, id)); // RLS limits audit_log rows (audit:view), exactly as today
  const owner = members.find((m) => m.member_role === 'owner') ?? members[0];
  const P = await profilesFor(sb, [am?.staff_user_id as string, am?.assigned_by, owner?.user_id as string, ...(history ?? []).flatMap((h) => [h.actor_id, h.details?.staff])]);
  const nm = (uid: string | null | undefined, fallback = 'Staff') => (uid ? (P.get(uid)?.full_name ?? fallback) : 'System');
  const mgr = am ? P.get(am.staff_user_id as string) : undefined;
  const kycHref = vis.kycLink ? (kyc?.id ? `/office/kyc/${kyc.id}` : '/office/kyc') : null;

  const accountManager: AccountManagerVM = {
    current: am
      ? {
          id: am.staff_user_id as string,
          name: nm(am.staff_user_id as string),
          title: mgr?.title ?? null,
          team: (am.team as string | null) ?? null,
          office: mgr?.office ?? null,
          email: mgr?.email ?? null,
          outOfOffice: !!mgr?.out_of_office,
          assignedAt: am.assigned_at as string,
          assignedBy: nm(am.assigned_by),
          reason: am.reason ? humanizeWord(am.reason) : null,
          load: workload.find((w) => w.id === am.staff_user_id)?.customers ?? null,
        }
      : null,
    cap: settings.cap,
    candidates: workload.map((w) => ({ id: w.id, name: w.name, team: w.team, customers: w.customers, outOfOffice: w.outOfOffice })),
    auditVisible: perms.audit,
    history: history === null ? null : history.map((h) => ({
      id: h.id,
      title: `${h.action === 'assistant.reassigned' ? 'Reassigned' : 'Assigned'} to ${nm(h.details?.staff)}${h.details?.reason ? ` · ${humanizeWord(h.details.reason)}` : ''}`,
      actor: nm(h.actor_id),
      at: h.created_at,
      tone: 'info' as const,
    })),
  };
  const svcMap = new Map(services.map((r) => [r.service as string, r]));
  const header: CustomerHeaderVM = {
    id,
    name: org.name,
    buyerCode: org.buyer_code,
    city: org.city,
    countryName: org.country ? (COUNTRY_NAMES[org.country] ?? org.country) : null,
    since: org.created_at,
    status: companyStatusName({ kycStatus: org.kyc_status, archivedAt: org.archived_at }),
    vip: settings.vip.includes(id),
    accountManager: accountManager.current ? { id: accountManager.current.id, name: accountManager.current.name, team: accountManager.current.team, outOfOffice: accountManager.current.outOfOffice } : null,
    owner: owner ? (P.get(owner.user_id as string)?.full_name ?? null) : null,
    services: activeServices(services.map((r) => ({ service: r.service as string, status: r.status as string }))),
    counts: { orders: nOrders, invoices: nInvoices, rfqs: nRfqs, documents: nDocs, team: members.length, tickets: nTickets },
    message: !vis.tickets ? { reason: 'Support · view permission needed' } : ticket?.id ? { href: `/office/support?t=${ticket.id}` } : { reason: 'No open support ticket. Customers start conversations from their account.' },
    newQuote: !vis.requestLinks ? { reason: 'Requests · view permission needed' } : rfq?.id ? { href: `/office/rfqs/${rfq.id}` } : { reason: 'Quotes are added to an open request. This customer has none.' },
  };
  const actions: CustomerActionsVM = {
    orgId: id,
    orgName: org.name,
    visibility: vis.actions,
    vip: header.vip,
    creditEligible: Boolean(org.credit_eligible),
    accountManager,
    services: Object.entries(SERVICE_LABEL).map(([k, label]) => {
      const r = svcMap.get(k);
      return { service: k, label, status: (r?.status as string) ?? 'off', plan: (r?.plan as string) ?? '', updatedAt: (r?.updated_at as string | null) ?? null };
    }),
    dropshipMarkets: { countries: markets.map((m) => String(m.country).trim()), locked: markets.some((m) => m.locked_by_staff) },
    limits: {
      maxOrderCents: (limits?.max_order_cents as number | null) ?? null,
      maxMonthCents: (limits?.max_month_cents as number | null) ?? null,
      minMarginPct: (limits?.min_margin_pct as number | null) ?? null,
      setAt: (limits?.set_at as string | null) ?? null,
      ownCeiling: s.isAdmin || !perms.isMine ? null : ceiling ? { maxAmountCents: Number(ceiling.max_amount_cents), minMarginPct: Number(ceiling.min_margin_pct) } : 'none',
    },
    kycHref,
    assistantHref: vis.assistantLinks ? '/office/assistant' : null,
  };
  const company: CompanyVM = {
    legalName: org.name,
    buyerCode: org.buyer_code,
    country: header.countryName,
    city: org.city,
    businessType: org.business_type ? humanizeWord(org.business_type) : null,
    registrationNo: org.registration_no,
    website: org.website,
    kycStatus: org.kyc_status,
    kycHref,
    since: org.created_at,
    walletReference: org.wallet_reference,
  };
  return { header, actions, company };
}

/* ───────── Money (shared by Overview + Wallet) ───────── */

async function loadMoney(ctx: CustomerCtx): Promise<MoneySummary | null> {
  const { sb, id, vis, nowIso } = ctx;
  const [wallets, holds, invoices, payments] = await Promise.all([
    vis.walletBalance ? part(async () => must(await sb.from('wallets').select('currency, balance_minor').eq('org_id', id)) as { currency: string; balance_minor: number }[]) : Promise.resolve('restricted' as const),
    part(async () => must(await sb.from('wallet_holds').select('amount_cents').eq('org_id', id).eq('status', 'open')) as { amount_cents: number }[]),
    vis.invoices ? part(() => invoicesFor(sb, id)) : Promise.resolve('restricted' as const),
    vis.invoices ? part(() => paymentsFor(sb, id)) : Promise.resolve('restricted' as const),
  ]);
  if (wallets === null && holds === null && invoices === null && payments === null) return null;
  return moneySummary(
    {
      currency: 'USD',
      wallets: wallets === null || wallets === 'restricted' ? wallets : wallets.map((w) => ({ currency: String(w.currency).trim(), balanceMinor: Number(w.balance_minor) })),
      holds: holds === null ? null : holds.map((h) => ({ amountCents: Number(h.amount_cents) })),
      invoices: invoices === null || invoices === 'restricted' ? invoices : invoices.map((d) => ({ docType: d.doc_type, status: d.status, amountCents: Number(d.amount_cents ?? 0), paidCents: Number(d.paid_cents ?? 0), dueAt: d.due_at, currency: String(d.currency ?? 'USD').trim() || 'USD' })),
      payments: payments === null || payments === 'restricted' ? payments : payments.map((p) => ({ amountCents: Number(p.amount_cents), status: p.status, method: p.method, at: p.confirmed_at ?? p.created_at })),
    },
    nowIso,
  );
}

const invoiceRows = (ctx: CustomerCtx, rows: Awaited<ReturnType<typeof invoicesFor>>): InvoiceRowVM[] =>
  rows.map((d) => {
    const r = { docType: d.doc_type, status: d.status, amountCents: Number(d.amount_cents ?? 0), paidCents: Number(d.paid_cents ?? 0), dueAt: d.due_at };
    return {
      id: d.id, number: d.number, docType: d.doc_type, issued: d.created_at, dueAt: d.due_at, amountCents: r.amountCents, paidCents: r.paidCents,
      balanceCents: invoiceBalanceCents(r), currency: String(d.currency ?? 'USD').trim() || 'USD', status: invoiceStatusName(r, ctx.nowIso), href: `/api/documents/${d.id}/pdf`,
    };
  });

const orderRows = (ctx: CustomerCtx, rows: Awaited<ReturnType<typeof ordersFor>>): OrderRowVM[] =>
  rows.map((o) => ({
    id: o.id, code: o.code, date: o.created_at, service: orderServiceLabel(o.code, o.pool_id), title: o.title, totalCents: Number(o.total_cents ?? 0), paidCents: Number(o.paid_cents ?? 0),
    currency: String(o.currency ?? 'USD').trim() || 'USD', status: o.status, href: ctx.vis.orderLinks ? `/office/orders/${o.id}` : null,
  }));

async function loadCredit(ctx: CustomerCtx): Promise<PanelData<CreditVM>> {
  if (!ctx.vis.credit) return 'restricted';
  return part(async () => {
    // Same source as today's /admin/finance/credit: admin client only after the finance:view check above.
    const rows = must(await createAdminClient().from('customer_credit_terms').select('id, credit_limit_cents, currency, net_days, status, overdue_blocked, proposed_by, updated_at, divisions(code)').eq('org_id', ctx.id).order('updated_at', { ascending: false })) as {
      id: string; credit_limit_cents: number; currency: string | null; net_days: number; status: string; overdue_blocked: boolean | null; proposed_by: string | null; updated_at: string; divisions: { code?: string } | null;
    }[];
    return {
      eligible: Boolean(ctx.org.credit_eligible),
      terms: rows.map((t) => ({
        id: t.id, division: t.divisions?.code ?? 'All divisions', limitCents: Number(t.credit_limit_cents), currency: String(t.currency ?? 'USD').trim() || 'USD', netDays: Number(t.net_days),
        status: t.status, overdueBlocked: !!t.overdue_blocked, updatedAt: t.updated_at, proposedByMe: t.proposed_by === ctx.s.userId,
      })),
    };
  });
}

async function loadActivityItems(ctx: CustomerCtx): Promise<ActivityVM[] | null> {
  const { sb, id } = ctx;
  return part(async () => {
    const [hist, kyc] = await Promise.all([
      amHistory(sb, id),
      // KYC status changes (today's /office/kyc/[id] History; customers:view, RLS as today)
      ctx.vis.kycLink
        ? sb.from('kyc_submissions').select('id').eq('org_id', id).then(async (r) => {
            const ids = (r.data ?? []).map((k) => k.id as string);
            if (!ids.length) return [];
            const { data } = await sb.from('status_history').select('from_status, to_status, created_at').eq('entity', 'kyc').in('entity_id', ids).order('created_at', { ascending: false }).limit(10);
            return (data ?? []) as { from_status: string | null; to_status: string; created_at: string }[];
          })
        : Promise.resolve([]),
    ]);
    const P = await profilesFor(sb, hist.flatMap((h) => [h.actor_id, h.details?.staff]));
    const nm = (uid: string | null | undefined) => (uid ? (P.get(uid)?.full_name ?? 'Staff') : 'System');
    const items: ActivityVM[] = [
      ...hist.map((h) => ({ id: `a-${h.id}`, title: `Account manager ${h.action === 'assistant.reassigned' ? 'reassigned' : 'assigned'}: ${nm(h.details?.staff)}`, actor: nm(h.actor_id), at: h.created_at, tone: 'info' as const })),
      ...kyc.map((k, i) => ({ id: `k-${i}-${k.created_at}`, title: `Verification: ${humanizeWord(k.from_status) || 'New'} → ${humanizeWord(k.to_status)}`, actor: 'Compliance', at: k.created_at, tone: (k.to_status === 'verified' ? 'success' : k.to_status === 'rejected' ? 'danger' : 'neutral') as ActivityVM['tone'] })),
    ];
    return items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 15);
  });
}

/* ───────── per tab ───────── */

export async function loadOverview(ctx: CustomerCtx, company: CompanyVM): Promise<OverviewVM> {
  const { sb, id, vis } = ctx;
  const [money, credit, orders, rfqs, invoices, tickets, kyc, statement, activity] = await Promise.all([
    loadMoney(ctx),
    loadCredit(ctx),
    part(() => ordersFor(sb, id)),
    part(() => rfqsFor(sb, id)),
    vis.invoices ? part(() => invoicesFor(sb, id)) : Promise.resolve(null),
    vis.tickets ? part(async () => must(await sb.from('tickets').select('id, code, subject, status').eq('org_id', id).not('status', 'in', '("resolved","closed")').order('updated_at', { ascending: false }).limit(5)) as { id: string; code: string; subject: string; status: string }[]) : Promise.resolve(null),
    part(async () => (await sb.from('kyc_submissions').select('id, status').eq('org_id', id).order('submitted_at', { ascending: false }).limit(1).maybeSingle()).data as { id: string; status: string } | null),
    vis.invoices ? part(async () => (await sb.from('documents').select('id').eq('org_id', id).eq('doc_type', 'statement').order('created_at', { ascending: false }).limit(1).maybeSingle()).data as { id: string } | null) : Promise.resolve(null),
    loadActivityItems(ctx),
  ]);
  const open =
    orders === null && rfqs === null
      ? null
      : mapOpenItems(
          {
            rfqs: (rfqs ?? []).map((r) => ({ id: r.id, code: r.code, status: r.status, title: r.title, quotes: r.quotes?.length ?? 0 })),
            orders: (orders ?? []).map((o) => ({ id: o.id, code: o.code, status: o.status, totalCents: Number(o.total_cents ?? 0), paidCents: Number(o.paid_cents ?? 0), currency: String(o.currency ?? 'USD').trim() || 'USD' })),
            invoices: invoices ? invoiceRows(ctx, invoices).map((d) => ({ id: d.id, number: d.number, status: d.status, balanceCents: d.balanceCents, currency: d.currency, dueAt: d.dueAt })) : null,
            tickets,
            kyc: kyc ?? null,
          },
          vis,
          (c, cur) => formatCents(c, currencyLabel(cur)),
          shortDate,
        );
  return {
    company,
    money,
    statementHref: statement?.id ? `/api/documents/${statement.id}/pdf` : null,
    credit,
    openItems: open,
    recentOrders: orders === null ? null : orderRows(ctx, orders.slice(0, 5)),
    activity,
  };
}

export async function loadOrdersTab(ctx: CustomerCtx): Promise<OrderRowVM[] | null> {
  const rows = await part(() => ordersFor(ctx.sb, ctx.id));
  return rows === null ? null : orderRows(ctx, rows);
}

export async function loadInvoicesTab(ctx: CustomerCtx): Promise<PanelData<InvoiceRowVM[]>> {
  if (!ctx.vis.invoices) return 'restricted';
  const rows = await part(() => invoicesFor(ctx.sb, ctx.id));
  return rows === null ? null : invoiceRows(ctx, rows);
}

export async function loadRfqsTab(ctx: CustomerCtx): Promise<RfqRowVM[] | null> {
  const rows = await part(() => rfqsFor(ctx.sb, ctx.id));
  return rows === null
    ? null
    : rows.map((r) => ({ id: r.id, code: r.code, title: r.title, quantity: `${r.quantity} ${r.unit ?? 'pcs'}`, quotes: r.quotes?.length ?? 0, created: r.created_at, status: r.status, href: ctx.vis.requestLinks ? `/office/rfqs/${r.id}` : null }));
}

export async function loadWalletTab(ctx: CustomerCtx): Promise<WalletTabVM> {
  const { sb, id, vis } = ctx;
  const [money, holds, topups] = await Promise.all([
    loadMoney(ctx),
    part(async () => must(await sb.from('wallet_holds').select('id, amount_cents, service, status, created_at').eq('org_id', id).order('created_at', { ascending: false }).limit(25)) as { id: string; amount_cents: number; service: string; status: string; created_at: string }[]),
    vis.walletBalance
      ? part(async () => must(await sb.from('wallet_topups').select('id, amount_cents, currency, method, reference, status, created_at').eq('org_id', id).order('created_at', { ascending: false }).limit(25)) as { id: string; amount_cents: number; currency: string | null; method: string; reference: string | null; status: string; created_at: string }[])
      : Promise.resolve('restricted' as const),
  ]);
  return {
    money,
    reference: ctx.org.wallet_reference,
    holds: holds === null ? null : holds.map((h) => ({ id: h.id, at: h.created_at, service: SERVICE_LABEL[h.service] ?? humanizeWord(h.service), amountCents: Number(h.amount_cents), status: h.status })),
    topups: topups === null || topups === 'restricted' ? topups : topups.map((t) => ({ id: t.id, at: t.created_at, amountCents: Number(t.amount_cents), currency: String(t.currency ?? 'USD').trim() || 'USD', method: t.method, reference: t.reference, status: t.status })),
  };
}

export async function loadDocumentsTab(ctx: CustomerCtx): Promise<DocumentsTabVM> {
  const { sb, id, vis } = ctx;
  const [docs, kyc] = await Promise.all([
    part(async () => {
      const q = sb.from('documents').select('id, number, doc_type, amount_cents, currency, status, created_at').eq('org_id', id).order('created_at', { ascending: false }).limit(200);
      // supplier documents are never selected without the supplier permission
      return must(await (vis.supplierDocuments ? q : q.not('doc_type', 'in', '("purchase_order","remittance")'))) as { id: string; number: string; doc_type: string; amount_cents: number | null; currency: string | null; status: string | null; created_at: string }[];
    }),
    part(async () => must(await sb.from('kyc_submissions').select('id, status, submitted_at').eq('org_id', id).order('submitted_at', { ascending: false }).limit(10)) as { id: string; status: string; submitted_at: string | null }[]),
  ]);
  return {
    documents: docs === null ? null : docs.filter((d) => vis.supplierDocuments || !isSupplierDocType(d.doc_type)).map((d) => ({
      id: d.id, number: d.number, type: d.doc_type, supplier: isSupplierDocType(d.doc_type), amountCents: d.amount_cents == null ? null : Number(d.amount_cents),
      currency: String(d.currency ?? 'USD').trim() || 'USD', status: d.status ?? 'issued', created: d.created_at, href: `/api/documents/${d.id}/pdf`,
    })),
    kyc: kyc === null ? null : kyc.map((k) => ({ id: k.id, status: k.status, submittedAt: k.submitted_at, href: vis.kycLink ? `/office/kyc/${k.id}` : null })),
    supplierHidden: !vis.supplierDocuments,
  };
}

export async function loadTeamTab(ctx: CustomerCtx, accountManager: AccountManagerVM): Promise<TeamTabVM> {
  const { sb, id } = ctx;
  const members = await part(async () => {
    const rows = must(await sb.from('org_members').select('user_id, member_role, created_at').eq('org_id', id).order('created_at')) as { user_id: string; member_role: string; created_at: string }[];
    const P = await profilesFor(sb, rows.map((m) => m.user_id));
    return rows.map((m) => ({ id: m.user_id, name: P.get(m.user_id)?.full_name ?? 'User', email: P.get(m.user_id)?.email ?? null, role: humanizeWord(m.member_role), joined: m.created_at }));
  });
  return { members, accountManager };
}

export async function loadActivityTab(ctx: CustomerCtx): Promise<ActivityTabVM> {
  const { sb, id, vis } = ctx;
  const [activity, sessions] = await Promise.all([
    loadActivityItems(ctx),
    part(async () => must(await sb.from('assistant_sessions').select('id, title, status, last_message_at').eq('org_id', id).order('last_message_at', { ascending: false }).limit(5)) as { id: string; title: string | null; status: string; last_message_at: string | null }[]),
  ]);
  return {
    activity,
    assistant: sessions === null ? null : sessions.map((x) => ({ id: x.id, title: x.title ?? 'Conversation', status: x.status, lastAt: x.last_message_at, href: vis.assistantLinks ? `/office/assistant?session=${x.id}` : null })),
    auditVisible: can(ctx.s, 'audit', 'view'),
  };
}
