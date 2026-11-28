import 'server-only';
/**
 * ODS T9 · Support desk — server reads, the same queries as today's app/office/support/page.tsx (session client = RLS after
 * requireStaff('support','view'); tickets.assigned_to and orders.supplier_id are hidden columns added with today's
 * withHiddenColumns / withSuppliers helpers). Read-only. Each panel fails on its own.
 */
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { withHiddenColumns, withSuppliers } from '@/components/backoffice/hidden-columns';
import { getCurrencyContext } from '@/lib/currency';
import { SUPPORT_KIND_LABEL, type TicketContext } from '@/lib/warehouse-w5';
import { CASE_KIND_LABEL, caseStatusLabel, usd, type CaseKind, type CaseStatus } from '@/lib/dropship-problems-shared';
import { showSupplierCodes } from '@/app/ods/office/orders/_lib/order-core';
import { human, sortTickets, type Macro, type SupportKpis, type SupportPerms, type SupportQuery, type TicketDetail, type TicketRow } from './support-core';

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const NO_ID = '00000000-0000-0000-0000-000000000000';

export type SupportDeskData = {
  tickets: TicketRow[] | null;
  kpis: SupportKpis;
  macros: Macro[];
  selected: TicketDetail | null;
};

export async function loadSupportDesk(userId: string, query: SupportQuery, perms: SupportPerms, nowIso: string): Promise<SupportDeskData> {
  const sb = await createClient();
  let q = sb.from('tickets').select('id, code, subject, category, priority, status, sla_due_at, created_at, updated_at, order_id, organizations(name), orders(code)').limit(200);
  if (query.f === 'resolved') q = q.in('status', ['resolved', 'closed']);
  else q = q.not('status', 'in', '(resolved,closed)');
  if (['complaint', 'question', 'feedback'].includes(query.f)) q = q.eq('category', query.f);
  if (query.f === 'overdue') q = q.lt('sla_due_at', nowIso);
  // "mine" = ids assigned to the caller (service role, own assignments only) ∩ the caller's RLS-visible tickets — as today
  if (query.f === 'mine') {
    const { data: mineIds } = await createAdminClient().from('tickets').select('id').eq('assigned_to', userId).limit(1000);
    q = q.in('id', (mineIds ?? []).map((r) => r.id as string).concat(NO_ID));
  }
  if (query.p) q = q.eq('priority', query.p);
  if (query.q) q = q.or(`code.ilike.%${query.q}%,subject.ilike.%${query.q}%`);

  const [list, openC, overdueC, macrosR, csatR] = await Promise.all([
    q,
    sb.from('tickets').select('id', { count: 'exact', head: true }).not('status', 'in', '(resolved,closed)'),
    sb.from('tickets').select('id', { count: 'exact', head: true }).not('status', 'in', '(resolved,closed)').lt('sla_due_at', nowIso),
    sb.from('support_macros').select('id, title, body').order('title'),
    sb.from('tickets').select('csat').not('csat', 'is', null).limit(500),
  ]);

  let tickets: TicketRow[] | null = null;
  let mine = 0;
  if (!list.error) {
    const raw = await withHiddenColumns<Record<string, unknown>, { assigned_to: string | null }>('tickets', (list.data ?? []) as Record<string, unknown>[], 'assigned_to');
    const ids = [...new Set(raw.map((t) => t.assigned_to).filter((x): x is string => !!x))];
    const { data: people } = ids.length ? await sb.from('profiles').select('id, full_name').in('id', ids) : { data: [] as { id: string; full_name: string | null }[] };
    const name = (id: string | null) => (id ? ((people ?? []).find((p) => p.id === id)?.full_name ?? 'User') : null);
    mine = raw.filter((t) => t.assigned_to === userId).length;
    tickets = sortTickets(
      raw.map((t) => ({
        id: String(t.id),
        code: String(t.code ?? ''),
        subject: String(t.subject ?? ''),
        category: String(t.category ?? ''),
        priority: String(t.priority ?? 'normal'),
        status: String(t.status ?? ''),
        slaDueAt: (t.sla_due_at as string | null) ?? null,
        customer: one(t.organizations as { name: string } | null)?.name ?? '—',
        assignee: name(t.assigned_to),
        assignedToMe: t.assigned_to === userId,
        orderId: (t.order_id as string | null) ?? null,
        orderCode: one(t.orders as { code: string } | null)?.code ?? null,
        updatedAt: String(t.updated_at ?? t.created_at),
      })),
    );
  }
  const csat = csatR.error ? null : (csatR.data ?? []);
  const kpis: SupportKpis = {
    open: openC.error ? null : (openC.count ?? 0),
    overdue: overdueC.error ? null : (overdueC.count ?? 0),
    mine,
    csat: csat === null ? null : { avg: csat.length ? (csat.reduce((a, c) => a + Number(c.csat ?? 0), 0) / csat.length).toFixed(1) : null, n: csat.length },
    macros: macrosR.error ? null : (macrosR.data ?? []).length,
  };
  const macros = ((macrosR.data ?? []) as Macro[]).map((m) => ({ id: m.id, title: m.title, body: m.body }));
  const selected = query.t ? await loadTicket(query.t, userId, perms) : null;
  return { tickets, kpis, macros, selected };
}

/** One ticket: today's ticket read + conversation + warehouse / dropship context. null = not visible. */
export async function loadTicket(id: string, userId: string, perms: SupportPerms): Promise<TicketDetail | null> {
  const sb = await createClient();
  const { data: tRow } = await sb
    .from('tickets')
    .select('id, code, org_id, order_id, store_order_id, subject, category, priority, status, sla_due_at, csat, created_at, organizations(name, country, kyc_status), orders(id, code, status, currency, claim_visible_until, claim_hidden_until, delivered_at)')
    .eq('id', id)
    .maybeSingle();
  if (!tRow) return null;
  const [t] = await withHiddenColumns<Record<string, unknown>, { assigned_to: string | null }>('tickets', [tRow as Record<string, unknown>], 'assigned_to');
  const tOrder = one<Record<string, unknown>>(t.orders as Record<string, unknown> | null);
  // the order's supplier (hidden orders.supplier_id): today's withSuppliers for every viewer, limited by suppliers RLS
  const supCodes = showSupplierCodes(perms.canSeeSuppliers);
  const [ordSup] = tOrder && supCodes ? await withSuppliers<Record<string, unknown>, { code: string }>(sb, 'orders', [tOrder], 'code') : [null];
  const [msgsR, whR, dsR] = await Promise.all([
    sb.from('ticket_messages').select('id, author_id, is_staff, internal, body, attachments, created_at').eq('ticket_id', id).order('created_at'),
    t.category === 'warehouse' ? sb.rpc('wh_ticket_context', { p_ticket: id }) : Promise.resolve({ data: null }),
    t.store_order_id ? sb.rpc('ds10_ticket_context', { p_ticket: id }) : Promise.resolve({ data: null }),
  ]);
  const authorIds = [...new Set([...(msgsR.data ?? []).map((m) => m.author_id as string | null), t.assigned_to].filter(Boolean))] as string[];
  const { data: people } = authorIds.length ? await sb.from('profiles').select('id, full_name').in('id', authorIds) : { data: [] as { id: string; full_name: string | null }[] };
  const name = (pid: string | null) => (people ?? []).find((p) => p.id === pid)?.full_name ?? (pid ? 'User' : '—');
  const wh = (whR.data ?? null) as TicketContext;
  const ds = (dsR.data ?? null) as { order_number: string; external_order_name: string | null; merchant_status: string; payment_state: string; total_cents: number | null; cases: { code: string; kind: CaseKind; status: CaseStatus }[] } | null;
  const org = one(t.organizations as { name: string; country: string | null; kyc_status: string | null } | null);
  const escCurrency = (tOrder?.currency as string | undefined) ?? (await getCurrencyContext()).currency;
  return {
    id: String(t.id),
    code: String(t.code ?? ''),
    orgId: String(t.org_id),
    orderId: (t.order_id as string | null) ?? null,
    subject: String(t.subject ?? ''),
    category: String(t.category ?? ''),
    priority: String(t.priority ?? 'normal'),
    status: String(t.status ?? ''),
    slaDueAt: (t.sla_due_at as string | null) ?? null,
    csat: t.csat == null ? null : Number(t.csat),
    createdAt: String(t.created_at),
    customer: org ? { name: org.name, country: org.country, kycStatus: org.kyc_status } : null,
    order: tOrder
      ? {
          id: String(tOrder.id),
          code: String(tOrder.code ?? ''),
          status: String(tOrder.status ?? ''),
          ...(supCodes ? { supplierCode: one((ordSup?.suppliers ?? null) as { code: string } | null)?.code ?? null } : {}),
          deliveredAt: (tOrder.delivered_at as string | null) ?? null,
          claimVisibleUntil: (tOrder.claim_visible_until as string | null) ?? null,
          claimHiddenUntil: (tOrder.claim_hidden_until as string | null) ?? null,
        }
      : null,
    assignee: t.assigned_to ? name(t.assigned_to) : null,
    assignedToMe: t.assigned_to === userId,
    messages: msgsR.error
      ? null
      : (msgsR.data ?? []).map((m) => ({
          id: m.id as string,
          author: name(m.author_id as string | null),
          isStaff: !!m.is_staff,
          internal: !!m.internal,
          body: String(m.body ?? ''),
          attachments: Array.isArray(m.attachments) ? m.attachments.length : 0,
          createdAt: String(m.created_at),
        })),
    warehouse: wh
      ? {
          kindLabel: SUPPORT_KIND_LABEL[wh.kind] ?? human(wh.kind),
          order: wh.order ? { code: wh.order.code, status: wh.order.status, externalRef: wh.order.external_ref, warehouseCode: wh.order.warehouse_code, packed: wh.order.packed, photos: wh.order.photos, trackingToken: wh.order.tracking_token } : null,
          asn: wh.asn ? { code: wh.asn.code, status: wh.asn.status, warehouseCode: wh.asn.warehouse_code } : null,
          ret: wh.return ? { code: wh.return.code, status: wh.return.status, decision: wh.return.decision } : null,
        }
      : null,
    dropship: ds
      ? {
          orderNumber: ds.order_number,
          externalName: ds.external_order_name,
          merchantStatus: ds.merchant_status,
          paymentState: ds.payment_state,
          total: usd(ds.total_cents),
          cases: (ds.cases ?? []).map((c) => ({ code: c.code, kind: CASE_KIND_LABEL[c.kind], status: caseStatusLabel(c.status, c.kind).label })),
        }
      : null,
    escCurrency,
  };
}
