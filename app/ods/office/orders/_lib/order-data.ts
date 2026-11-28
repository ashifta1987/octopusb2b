import 'server-only';
/**
 * ODS T9 · Orders — server reads (session client = RLS, after the page's requireStaff('orders','view')). Read-only.
 * Same tables and columns as today's Orders list / order page; hidden columns (orders.supplier_id) only through today's
 * withSuppliers and only with the supplier permission. Every panel fails on its own (null).
 */
import { createClient } from '@/lib/supabase/server';
import { withSuppliers } from '@/components/backoffice/hidden-columns';
import type { DivisionScope } from '@/lib/divisions/scope';
import {
  ACTIVE_STATUSES, SORTABLE, SUPPLIER_DOC_TYPES, TAB_STATUSES, ORDER_TABS, initials, isSupplierDocType, orderFigures, orderServiceLabel, showSupplierCodes, showSupplierDocs, staffOrderStatus, statusFilter,
  type OrderPerms, type OrderQuery, type OrderRow, type OrderTab,
} from './order-core';
import type { CountFigure, OrderKpis, OrderListData, OrderRecordData } from './types';

type Sb = Awaited<ReturnType<typeof createClient>>;
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const LIST_COLS = 'id, code, title, quantity, status, total_cents, paid_cents, deposit_cents, currency, created_at, updated_at, org_id';

/** Owner = the customer's account manager (account_managers + profiles, as on Admin › Customers / Invoices). Missing → none. */
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

function scoped<Q extends { eq: (c: string, v: string) => Q }>(q: Q, scope: DivisionScope): Q {
  return scope.all ? q : q.eq('division_id', scope.division.id);
}

async function count(sb: Sb, scope: DivisionScope, statuses: readonly string[] | null): Promise<CountFigure> {
  let q = sb.from('orders').select('id', { count: 'exact', head: true });
  if (statuses) q = q.in('status', [...statuses]);
  const { count: n, error } = await scoped(q, scope);
  return error ? { error: 'Couldn’t load this figure' } : (n ?? 0);
}

/** Grid page (server-side tab / steps / search / customer / sort / page) + tab counts + KPIs. */
export async function loadOrderList(query: OrderQuery, scope: DivisionScope, perms: OrderPerms): Promise<{ ok: true; data: OrderListData } | { ok: false; error: string; kpis: OrderKpis | null }> {
  const sb = await createClient();
  const st = statusFilter(query.tab, query.steps);
  const kpiP = Promise.all([
    count(sb, scope, ACTIVE_STATUSES),
    count(sb, scope, ['deposit_pending', 'balance_pending']),
    count(sb, scope, TAB_STATUSES.production),
    count(sb, scope, ['ready_to_ship']),
    count(sb, scope, ['disputed']),
  ]).then(([active, awaiting, production, ready, disputed]): OrderKpis => ({ active, awaiting, production, ready, disputed }));
  const countsP = Promise.all(ORDER_TABS.map(async ([t]) => [t, await count(sb, scope, TAB_STATUSES[t])] as const)).then((pairs) => {
    const out: Partial<Record<OrderTab, number>> = {};
    for (const [t, n] of pairs) if (typeof n === 'number') out[t] = n;
    return out;
  });

  const embed = query.customer ? 'organizations!inner(name, country)' : 'organizations(name, country)';
  let q = sb.from('orders').select(`${LIST_COLS}, ${embed}`, { count: 'exact' });
  // a Step filter outside the tab matches nothing: no query (orders.status is an enum)
  if (st && !st.length) {
    const [kpis, counts] = await Promise.all([kpiP, countsP]);
    return { ok: true, data: { rows: [], total: 0, counts, kpis, updatedAt: new Date().toISOString(), allUsd: true, supplierColumn: showSupplierCodes(perms.canSeeSuppliers) } };
  }
  if (st) q = q.in('status', st);
  q = scoped(q, scope);
  if (query.q) q = q.or(`code.ilike.%${query.q}%,title.ilike.%${query.q}%`);
  if (query.customer) q = q.ilike('organizations.name', `%${query.customer.replace(/[%*,()\\]/g, '')}%`);
  q = q.order(SORTABLE[query.sort.id] ?? 'updated_at', { ascending: !query.sort.desc }).range(query.page * query.size, query.page * query.size + query.size - 1);

  const [{ data: raw, count: total, error }, kpis, counts] = await Promise.all([q, kpiP, countsP]);
  if (error) return { ok: false, error: 'We couldn’t load the orders. Try again.', kpis };
  const rowsRaw = (raw ?? []) as unknown as Record<string, unknown>[];
  // supplier code: today's withSuppliers (orders.supplier_id is hidden, migration 195) for every viewer, limited by suppliers RLS — as today
  const withSup = showSupplierCodes(perms.canSeeSuppliers) ? await withSuppliers<Record<string, unknown>, { code: string }>(sb, 'orders', rowsRaw, 'code') : null;
  const owners = await ownersFor(sb, [...new Set(rowsRaw.map((r) => r.org_id as string | null).filter((x): x is string => !!x))]);
  const rows: OrderRow[] = rowsRaw.map((o, i) => {
    const org = one(o.organizations as { name: string; country: string | null } | { name: string; country: string | null }[] | null);
    const f = orderFigures(o as { total_cents: number; paid_cents: number; deposit_cents: number });
    const s = staffOrderStatus(String(o.status));
    const ownerName = o.org_id ? owners.get(o.org_id as string) : undefined;
    const row: OrderRow = {
      id: String(o.id),
      code: String(o.code ?? ''),
      title: String(o.title ?? ''),
      quantity: o.quantity == null ? null : Number(o.quantity),
      status: String(o.status),
      statusName: s.name,
      step: s.step,
      attention: s.attention,
      service: orderServiceLabel(o.code as string),
      customer: org?.name ?? '—',
      customerId: (o.org_id as string | null) ?? null,
      country: org?.country ?? null,
      currency: String(o.currency ?? 'USD').trim() || 'USD',
      ...f,
      owner: ownerName ? { initials: initials(ownerName), name: ownerName } : null,
      updatedAt: String(o.updated_at ?? o.created_at),
      createdAt: String(o.created_at),
    };
    if (withSup) row.supplierCode = one(withSup[i]?.suppliers as { code: string } | null)?.code ?? null;
    return row;
  });
  return {
    ok: true,
    data: { rows, total: total ?? rows.length, counts, kpis, updatedAt: new Date().toISOString(), allUsd: rows.every((r) => r.currency === 'USD'), supplierColumn: showSupplierCodes(perms.canSeeSuppliers) },
  };
}

/** The order record: today's order page reads, split per panel. null = not found / not visible (RLS). */
export async function loadOrderRecord(id: string, perms: OrderPerms): Promise<OrderRecordData | null> {
  const sb = await createClient();
  const { data: oRow } = await sb
    .from('orders')
    .select('id, code, title, status, quantity, unit_price_cents, shipping_cents, total_cents, deposit_cents, deposit_pct, paid_cents, currency, incoterm, created_at, delivered_at, claim_visible_until, claim_hidden_until, organizations(id, name, country, city, kyc_status), quotes(code), rfqs(code)')
    .eq('id', id)
    .maybeSingle();
  if (!oRow) return null;
  // suppliers(...) through orders.supplier_id (hidden): loaded only with the supplier permission, exactly as today
  const o: Record<string, unknown> = perms.canSeeSuppliers
    ? (await withSuppliers<Record<string, unknown>, { code: string; legal_name: string; country: string }>(sb, 'orders', [oRow as Record<string, unknown>], 'code, legal_name, country'))[0]
    : { ...(oRow as Record<string, unknown>), suppliers: null };

  let docsQ = sb.from('documents').select('id, doc_type, number, amount_cents, currency, status, created_at').eq('order_id', id);
  // every document the user can read (RLS), as today; ODS_SUPPLIER_STRICT would drop supplier documents here
  const supDocs = showSupplierDocs(perms.canSeeSuppliers);
  if (!supDocs) docsQ = docsQ.not('doc_type', 'in', `(${SUPPLIER_DOC_TYPES.map((t) => `"${t}"`).join(',')})`);
  const [ev, docs, pays, ships, tks, fresh] = await Promise.all([
    sb.from('order_events').select('id, kind, title, body, created_at').eq('order_id', id).order('created_at'),
    docsQ.order('created_at'),
    sb.from('payments').select('id, purpose, method, amount_cents, currency, reference, status, created_at').eq('order_id', id).order('created_at'),
    sb.from('shipments').select('id, code, tracking_no, status, service_code, label_url, created_at, divisions(code)').eq('order_id', id).order('created_at'),
    perms.canSeeTickets ? sb.from('tickets').select('id, code, subject, status, priority, updated_at').eq('order_id', id).order('updated_at', { ascending: false }).limit(50) : Promise.resolve(null),
    perms.canPay ? sb.rpc('mfa_fresh') : Promise.resolve(null),
  ]);

  let shipments: OrderRecordData['shipments'] = null;
  if (!ships.error) {
    const list = ships.data ?? [];
    const ids = list.map((s) => s.id as string);
    const carriers = new Map<string, string | null>();
    if (perms.canSeeCarrier && ids.length) {
      const { data: cr } = await sb.rpc('get_shipment_carriers', { p_ids: ids });
      for (const r of (cr ?? []) as { shipment_id: string; carrier_name: string | null }[]) carriers.set(r.shipment_id, r.carrier_name);
    }
    shipments = list.map((s) => ({
      id: s.id as string,
      code: (s.code as string | null) ?? null,
      trackingNo: (s.tracking_no as string | null) ?? null,
      status: String(s.status),
      carrier: perms.canSeeCarrier ? (carriers.get(s.id as string) ?? null) : null,
      serviceCode: perms.canSeeCarrier ? ((s.service_code as string | null) ?? null) : null,
      labelUrl: perms.canDownloadLabels ? ((s.label_url as string | null) ?? null) : null,
      packingSlip: perms.canDownloadLabels && !!s.tracking_no && one(s.divisions as { code: string } | { code: string }[] | null)?.code === 'DS',
      createdAt: String(s.created_at),
    }));
  }

  const org = one(o.organizations as { id: string; name: string; country: string | null; city: string | null; kyc_status: string | null } | null);
  const sup = perms.canSeeSuppliers ? one(o.suppliers as { code: string; legal_name: string; country: string } | null) : null;
  const f = orderFigures(o as { total_cents: number; paid_cents: number; deposit_cents: number });
  return {
    id: String(o.id),
    code: String(o.code ?? ''),
    title: String(o.title ?? ''),
    status: String(o.status),
    service: orderServiceLabel(o.code as string),
    customer: org ? { id: org.id, name: org.name, country: org.country, city: org.city, kycStatus: org.kyc_status } : null,
    quantity: o.quantity == null ? null : Number(o.quantity),
    unitPriceMinor: o.unit_price_cents == null ? null : Number(o.unit_price_cents),
    shippingMinor: o.shipping_cents == null ? null : Number(o.shipping_cents),
    totalMinor: f.totalMinor,
    depositMinor: Number(o.deposit_cents ?? 0),
    depositPct: o.deposit_pct == null ? null : Number(o.deposit_pct),
    paidMinor: f.paidMinor,
    balanceMinor: f.balanceMinor,
    depositDueMinor: f.depositDueMinor,
    currency: String(o.currency ?? 'USD').trim() || 'USD',
    incoterm: (o.incoterm as string | null) ?? null,
    quoteCode: one(o.quotes as { code: string } | null)?.code ?? null,
    rfqCode: one(o.rfqs as { code: string } | null)?.code ?? null,
    createdAt: String(o.created_at),
    deliveredAt: (o.delivered_at as string | null) ?? null,
    claimVisibleUntil: (o.claim_visible_until as string | null) ?? null,
    claimHiddenUntil: (o.claim_hidden_until as string | null) ?? null,
    supplier: perms.canSeeSuppliers ? { code: sup?.code ?? null, legalName: sup?.legal_name ?? null, country: sup?.country ?? null } : null,
    documents: docs.error
      ? null
      : (docs.data ?? [])
          .filter((d) => supDocs || !isSupplierDocType(String(d.doc_type)))
          .map((d) => ({ id: d.id as string, number: String(d.number ?? ''), type: String(d.doc_type), supplier: isSupplierDocType(String(d.doc_type)), amountMinor: d.amount_cents == null ? null : Number(d.amount_cents), currency: (d.currency as string | null) ?? null, status: (d.status as string | null) ?? null, createdAt: String(d.created_at) })),
    supplierDocsHidden: !supDocs,
    payments: pays.error
      ? null
      : (pays.data ?? []).map((p) => ({ id: p.id as string, purpose: String(p.purpose ?? ''), method: String(p.method ?? ''), amountMinor: Number(p.amount_cents ?? 0), currency: String(p.currency ?? 'USD'), reference: (p.reference as string | null) ?? null, status: String(p.status ?? ''), createdAt: String(p.created_at) })),
    shipments,
    events: ev.error ? null : (ev.data ?? []).map((e) => ({ id: e.id as string, kind: (e.kind as string | null) ?? null, title: String(e.title ?? ''), body: (e.body as string | null) ?? null, createdAt: String(e.created_at) })),
    tickets: !perms.canSeeTickets
      ? 'restricted'
      : !tks || tks.error
        ? null
        : (tks.data ?? []).map((t) => ({ id: t.id as string, code: String(t.code ?? ''), subject: String(t.subject ?? ''), status: String(t.status ?? ''), priority: String(t.priority ?? 'normal'), updatedAt: String(t.updated_at) })),
    payFresh: perms.canPay && fresh && !fresh.error ? ((fresh.data as boolean | null) ?? null) : null,
  };
}
