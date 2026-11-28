import 'server-only';
/**
 * ODS T9 · Sourcing requests — server reads (session client, RLS + division scope exactly as today's
 * app/office/rfqs pages). Called only AFTER the page's requireStaff('requests','view'). No writes here: every action is
 * today's server action (sendQuote → RPC send_quote; postMessage → RPC post_request_message).
 *
 * Added reads (read-only, each fails on its own):
 *  - rfq_lines (audit C4, all lines) — unreadable (migration 251 not applied) → line 1 = the RFQ, as today;
 *  - organizations.name + rfqs.org_id (customer link), rfqs.assigned_to → profiles.full_name (owner);
 *  - status head counts (KPI strip / tab badges);
 *  - record: orders.rfq_id (Ordered step), request_messages / request_files (today's thread reads).
 * Supplier names: ONLY when suppliers:view (withSuppliers = today's helper; otherwise never called).
 */
import { createClient } from '@/lib/supabase/server';
import { withSuppliers } from '@/components/backoffice/hidden-columns';
import { one } from '@/components/backoffice/server-utils';
import { COUNTRY_NAMES } from '@/lib/format';
import type { DivisionScope } from '@/lib/divisions/scope';
import {
  TAB_STATUSES, ageInfo, initials, lineSummary, linesForRecord, quoteSummary, rfqStatusName, supplierCell, tabAscending, tabCounts,
  type LineSummary, type RfqLineVM, type RfqPerms, type RfqQuery, type RfqTab,
} from './rfq-core';

type SB = Awaited<ReturnType<typeof createClient>>;

export type RfqRowVM = {
  id: string;
  code: string;
  title: string;
  customer: { id: string | null; name: string; place: string };
  products: LineSummary;
  service: string;
  statusRaw: string;
  status: string;
  owner: { name: string; initials: string } | null;
  createdAt: string;
  age: { text: string; late: boolean };
  quotes: { count: number; text: string; status: string | null };
  quantity: number;
  unit: string;
  targetMinor: number | null;
  currency: string;
  href: string;
};

export type RfqKpis = { counts: Record<RfqTab, number> | null; late48: number | null };
export type RfqListResult = { ok: true; rows: RfqRowVM[]; kpis: RfqKpis; updatedAt: string } | { ok: false; error: string; kpis: RfqKpis };

const place = (city: string | null | undefined, country: string | null | undefined) =>
  [city, country ? COUNTRY_NAMES[country] ?? country : null].filter(Boolean).join(', ');

async function ownerNames(sb: SB, ids: (string | null)[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  if (!uniq.length) return new Map();
  const { data, error } = await sb.from('profiles').select('id, full_name').in('id', uniq);
  if (error) return new Map();
  return new Map((data ?? []).map((p) => [p.id as string, ((p.full_name as string | null) ?? '').trim()]));
}

/** All lines for these RFQs (title + line no). null = rfq_lines not readable → callers fall back to line 1. */
async function linesByRfq(sb: SB, ids: string[]): Promise<Map<string, { line_no: number; title: string; quantity: number; unit: string | null }[]> | null> {
  if (!ids.length) return new Map();
  const out = new Map<string, { line_no: number; title: string; quantity: number; unit: string | null }[]>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await sb.from('rfq_lines').select('rfq_id, line_no, title, quantity, unit').in('rfq_id', ids.slice(i, i + 200));
    if (error) return null;
    for (const l of (data ?? []) as { rfq_id: string; line_no: number; title: string; quantity: number; unit: string | null }[]) {
      const list = out.get(l.rfq_id) ?? [];
      list.push(l);
      out.set(l.rfq_id, list);
    }
  }
  return out;
}

export async function loadRfqKpis(scope: DivisionScope, nowMs: number): Promise<RfqKpis> {
  const sb = await createClient();
  const statuses = TAB_STATUSES.all;
  const head = () => {
    const q = sb.from('rfqs').select('id', { count: 'exact', head: true });
    return scope.all ? q : q.eq('division_id', scope.division.id);
  };
  const res = await Promise.all(statuses.map((st) => head().eq('status', st)));
  const late = await head()
    .in('status', [...TAB_STATUSES.to_quote])
    .lt('created_at', new Date(nowMs - 48 * 36e5).toISOString());
  const failed = res.some((r) => r.error);
  const by: Record<string, number> = {};
  statuses.forEach((st, i) => (by[st] = res[i].count ?? 0));
  return { counts: failed ? null : tabCounts(by), late48: late.error ? null : (late.count ?? 0) };
}

/** Today's list read for a tab (same columns + filter + order + limit 200), plus lines / customer name / owner. */
export async function loadRfqList(scope: DivisionScope, query: RfqQuery, nowMs: number): Promise<RfqListResult> {
  const sb = await createClient();
  const kpisP = loadRfqKpis(scope, nowMs).catch(() => ({ counts: null, late48: null }) as RfqKpis);
  const q = sb
    .from('rfqs')
    .select('id, code, title, quantity, unit, target_price_cents, currency, destination_country, destination_city, status, created_at, expires_at, org_id, assigned_to, organizations(name, city, country), quotes(id, status)');
  const { data, error } = await (scope.all ? q : q.eq('division_id', scope.division.id))
    .in('status', [...TAB_STATUSES[query.f]])
    .order('created_at', { ascending: tabAscending(query.f) })
    .limit(200);
  const kpis = await kpisP;
  if (error) return { ok: false, error: 'We couldn’t load the requests. Try again.', kpis };
  const rows = (data ?? []) as Record<string, unknown>[];
  const ids = rows.map((r) => r.id as string);
  const [lines, owners] = await Promise.all([linesByRfq(sb, ids).catch(() => null), ownerNames(sb, rows.map((r) => (r.assigned_to as string | null) ?? null)).catch(() => new Map<string, string>())]);
  return { ok: true, kpis, updatedAt: new Date(nowMs).toISOString(), rows: rows.map((r) => toRow(r, lines, owners, nowMs)) };
}

function toRow(r: Record<string, unknown>, lines: Map<string, { line_no: number; title: string; quantity: number; unit: string | null }[]> | null, owners: Map<string, string>, nowMs: number): RfqRowVM {
  const o = one(r.organizations as { name: string | null; city: string | null; country: string | null } | null);
  const qs = ((r.quotes as { id: string; status: string }[] | null) ?? []).map((x) => x.status);
  const raw = String(r.status);
  const ownerName = r.assigned_to ? owners.get(r.assigned_to as string) : undefined;
  const qsum = quoteSummary(qs);
  return {
    id: r.id as string,
    code: r.code as string,
    title: r.title as string,
    customer: { id: (r.org_id as string | null) ?? null, name: o?.name ?? '—', place: place(o?.city, o?.country) },
    products: lineSummary(lines ? (lines.get(r.id as string) ?? []) : null, { title: r.title as string }),
    service: 'Sourcing',
    statusRaw: raw,
    status: rfqStatusName(raw),
    owner: ownerName ? { name: ownerName, initials: initials(ownerName) } : null,
    createdAt: r.created_at as string,
    age: ageInfo(r.created_at as string, nowMs, qs.length, raw),
    quotes: { count: qs.length, ...qsum },
    quantity: Number(r.quantity),
    unit: (r.unit as string | null) ?? 'pcs',
    targetMinor: r.target_price_cents == null ? null : Number(r.target_price_cents),
    currency: (r.currency as string | null) ?? 'USD',
    href: `/office/rfqs/${r.id as string}`,
  };
}

/* ───────── record ───────── */

export type QuoteRowVM = {
  id: string;
  code: string;
  supplier: ReturnType<typeof supplierCell>;
  unitMinor: number;
  quantity: number;
  shippingMinor: number;
  totalMinor: number;
  leadDays: number | null;
  incoterm: string | null;
  validUntil: string | null;
  statusRaw: string;
  createdAt: string;
  currency: string;
  notes: string | null;
};

export type RfqRecordVM = {
  id: string;
  code: string;
  title: string;
  details: string | null;
  statusRaw: string;
  status: string;
  createdAt: string;
  expiresAt: string | null;
  quantity: number;
  unit: string;
  targetMinor: number | null;
  currency: string;
  incoterm: string | null;
  shipTo: string;
  category: string | null;
  customer: { id: string | null; name: string; place: string; kyc: string | null };
  owner: string | null;
  product: { title: string; slug: string; specs: { name: string; value: string }[] } | null;
  lines: { rows: RfqLineVM[]; fromLines: boolean } | null;
  order: { id: string; code: string; status: string } | null;
};

export type ThreadVM = {
  messages: { id: string; fromStaff: boolean; body: string; at: string }[];
  files: { id: string; name: string; kind: string; fromStaff: boolean }[];
};

export type SupplierOption = { id: string; label: string; disabled?: boolean };

/** Today's record read + customer name / owner / lines / order. null → notFound (RLS hides it or it doesn't exist). */
export async function loadRfqRecord(id: string): Promise<RfqRecordVM | null> {
  const sb = await createClient();
  const { data: r } = await sb
    .from('rfqs')
    .select('id, code, title, details, quantity, unit, target_price_cents, destination_country, destination_city, incoterm, status, fee_minor, currency, created_at, expires_at, org_id, assigned_to, product_id, organizations(name, city, country, kyc_status), categories(name), products(id, title, slug, product_specs(name, value, sort))')
    .eq('id', id)
    .maybeSingle();
  if (!r) return null;
  const [ln, ord, owners] = await Promise.all([
    sb.from('rfq_lines').select('line_no, title, quantity, unit, target_price_minor, customisation, notes, product_id').eq('rfq_id', id).order('line_no'),
    sb.from('orders').select('id, code, status').eq('rfq_id', id).maybeSingle(),
    ownerNames(sb, [(r.assigned_to as string | null) ?? null]).catch(() => new Map<string, string>()),
  ]);
  const org = one(r.organizations as unknown as { name: string | null; city: string | null; country: string | null; kyc_status: string | null } | null);
  const prod = one(r.products as unknown as { id: string; title: string; slug: string; product_specs: { name: string; value: string; sort: number }[] } | null);
  const base = { title: r.title as string, quantity: Number(r.quantity), unit: (r.unit as string | null) ?? 'pcs', target_price_cents: r.target_price_cents == null ? null : Number(r.target_price_cents), product_id: (r.product_id as string | null) ?? null };
  return {
    id: r.id as string,
    code: r.code as string,
    title: r.title as string,
    details: (r.details as string | null) ?? null,
    statusRaw: r.status as string,
    status: rfqStatusName(r.status as string),
    createdAt: r.created_at as string,
    expiresAt: (r.expires_at as string | null) ?? null,
    quantity: base.quantity,
    unit: base.unit,
    targetMinor: base.target_price_cents,
    currency: (r.currency as string | null) ?? 'USD',
    incoterm: (r.incoterm as string | null) ?? null,
    shipTo: [r.destination_city, r.destination_country].filter(Boolean).join(', '),
    category: one(r.categories as unknown as { name: string } | null)?.name ?? null,
    customer: { id: (r.org_id as string | null) ?? null, name: org?.name ?? '—', place: place(org?.city, org?.country), kyc: org?.kyc_status ?? null },
    owner: r.assigned_to ? (owners.get(r.assigned_to as string) || null) : null,
    product: prod ? { title: prod.title, slug: prod.slug, specs: [...(prod.product_specs ?? [])].sort((a, b) => a.sort - b.sort).map((x) => ({ name: x.name, value: x.value })) } : null,
    // rfq_lines error (not applied / not readable) → line 1 from the RFQ; empty → also line 1 (older single-product RFQs)
    lines: ln.error ? linesForRecord(null, base) : linesForRecord((ln.data ?? []) as Record<string, unknown>[], base),
    order: ord.error || !ord.data ? null : { id: ord.data.id as string, code: ord.data.code as string, status: ord.data.status as string },
  };
}

/** Today's quotes read; suppliers only with suppliers:view (today's withSuppliers, after the page guard). */
export async function loadRfqQuotes(id: string, perms: Pick<RfqPerms, 'canSeeSuppliers'>): Promise<QuoteRowVM[] | null> {
  const sb = await createClient();
  const { data, error } = await sb.from('quotes').select('id, code, unit_price_cents, quantity, incoterm, lead_time_days, shipping_cents, currency, notes, status, valid_until, created_at').eq('rfq_id', id).order('created_at');
  if (error) return null;
  const rows = perms.canSeeSuppliers
    ? await withSuppliers(sb, 'quotes', data, 'code, legal_name, country')
    : (data ?? []).map((q) => ({ ...q, suppliers: null }));
  return rows.map((q) => {
    const unit = Number(q.unit_price_cents);
    const ship = Number(q.shipping_cents);
    return {
      id: q.id as string,
      code: q.code as string,
      supplier: supplierCell(perms, one(q.suppliers as unknown as { code: string; legal_name: string; country: string } | null)),
      unitMinor: unit,
      quantity: Number(q.quantity),
      shippingMinor: ship,
      totalMinor: unit * Number(q.quantity) + ship,
      leadDays: (q.lead_time_days as number | null) ?? null,
      incoterm: (q.incoterm as string | null) ?? null,
      validUntil: (q.valid_until as string | null) ?? null,
      statusRaw: q.status as string,
      createdAt: q.created_at as string,
      currency: (q.currency as string | null) ?? 'USD',
      notes: (q.notes as string | null) ?? null,
    };
  });
}

/** Today's supplier options for the quote form (session read: suppliers_staff RLS → none without suppliers:view). */
export async function loadSupplierOptions(): Promise<SupplierOption[]> {
  const sb = await createClient();
  const { data } = await sb.from('suppliers').select('id, code, legal_name, country, supplier_switches(rfq_replies)').is('archived_at', null).order('code');
  return (data ?? []).map((x) => {
    const off = one(x.supplier_switches as unknown as { rfq_replies: boolean } | null)?.rfq_replies === false;
    return { id: x.id as string, label: `${x.code} · ${x.legal_name} · ${x.country}${off ? ' (RFQ replies off)' : ''}`, disabled: off };
  });
}

/** Today's thread reads (request_messages + request_files). null = couldn't load. */
export async function loadRfqThread(id: string): Promise<ThreadVM | null> {
  const sb = await createClient();
  const [m, f] = await Promise.all([
    sb.from('request_messages').select('id, from_staff, body, created_at').eq('rfq_id', id).order('created_at'),
    sb.from('request_files').select('id, file_name, file_kind, from_staff').eq('rfq_id', id).order('created_at'),
  ]);
  if (m.error && f.error) return null;
  return {
    messages: (m.data ?? []).map((x) => ({ id: x.id as string, fromStaff: !!x.from_staff, body: x.body as string, at: x.created_at as string })),
    files: (f.data ?? []).map((x) => ({ id: x.id as string, name: x.file_name as string, kind: x.file_kind as string, fromStaff: !!x.from_staff })),
  };
}
