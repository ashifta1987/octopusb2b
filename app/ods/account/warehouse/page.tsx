import { Suspense, cache } from 'react';
import type { Metadata } from 'next';
import { PageHead, PageWrap } from '../_services/ui';
import { getSiteContent } from '@/lib/content';
import { requireAccount, settle } from '../_lib/loaders';
import { getAccountContext, serviceOn } from '@/lib/core/account';
import { createClient } from '@/lib/supabase/server';
import { ASN_STATUS } from '@/lib/warehouse-inbound';
import { ORDER_STATUS } from '@/lib/warehouse-orders';
import type { Inventory } from '@/lib/warehouse-w5';
import type { IssuedInvoice } from '@/lib/warehouse-w6';
import { Skeleton } from '@octopus/ui';
import { LOW_STOCK_SETTING_KEY, WAREHOUSE_TABS, lowStockCoverDays, odsTone, pickTab } from '../_services/logic';
import {
  FeesPanel, InboundPanel, OutboundPanel, StockPanel, WarehouseKpiStrip, WarehouseNotStarted, WarehouseView,
  type FeesData, type PanelState, type RateCard, type WarehouseKpis,
} from './_components/warehouse-view';
import type { InboundRow, OutboundRow, StockRow } from './_components/warehouse-tables';

export const metadata: Metadata = { title: 'Warehouse (3PL)' };

type Sb = Awaited<ReturnType<typeof createClient>>;
type Ctx = { sb: Sb; orgId: string; client: { plan_code: string; preferred_warehouse: string | null } | null };
const OPEN_ASN = ['submitted', 'booked', 'arrived', 'receiving'];
const OPEN_ORDER = ['new', 'allocated', 'picking', 'picked', 'packing', 'exception'];

/**
 * ODS /account/warehouse (Part 6.7, C_Warehouse). Same reads as today's app/account/warehouse/page.tsx, all RLS-scoped to the
 * company: wh_claim_my_application (today's first-visit link of an approved application), wh_clients, wh_portal_inventory,
 * wh_asns + wh_asn_lines + wh_client_skus + wh_lots (blocked = being checked), wh_orders + wh_order_lines, wh_rate_versions
 * (active, public columns only) and wh_portal_invoices. Each panel streams in its own Suspense and fails on its own.
 */
export default function WarehousePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  return (
    <PageWrap>
      <Suspense fallback={<div className="flex flex-col gap-6"><PageHead title="Warehouse (3PL)" /><Skeleton lines={2} label="Loading the warehouse" /><WarehouseKpiStrip state={{ kind: 'loading' }} /></div>}>
      <Warehouse searchParams={searchParams} />
      </Suspense>
    </PageWrap>
  );
}

async function Warehouse({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const s = await requireAccount('/account/warehouse');
  const orgId = s.org!.id;
  const sb = await createClient();
  await sb.rpc('wh_claim_my_application');
  const [ctx, clientRes, sp] = await Promise.all([
    getAccountContext(orgId),
    sb.from('wh_clients').select('plan_code, preferred_warehouse').eq('org_id', orgId).eq('status', 'active').maybeSingle(),
    searchParams,
  ]);
  const client = (clientRes.data ?? null) as Ctx['client'];
  if (!client) return <WarehouseNotStarted settingUp={serviceOn(ctx.services.warehouse)} />;
  const c: Ctx = { sb, orgId, client };
  return (
    <WarehouseView tab={pickTab(sp.tab, WAREHOUSE_TABS)}
      kpis={<Suspense fallback={<WarehouseKpiStrip state={{ kind: 'loading' }} />}><Kpis c={c} /></Suspense>}
      panels={{
        stock: <Suspense fallback={<StockPanel state={{ kind: 'loading' }} />}><Stock c={c} /></Suspense>,
        inbound: <Suspense fallback={<InboundPanel state={{ kind: 'loading' }} />}><Inbound c={c} /></Suspense>,
        outbound: <Suspense fallback={<OutboundPanel state={{ kind: 'loading' }} />}><Outbound c={c} /></Suspense>,
        fees: <Suspense fallback={<FeesPanel state={{ kind: 'loading' }} />}><Fees c={c} /></Suspense>,
      }} />
  );
}

/* ───────── loaders (each returns its own error state) ───────── */

const loadStock = cache(async ({ sb, orgId }: Ctx): Promise<PanelState<StockRow[]>> => {
  const { data, error } = await sb.rpc('wh_portal_inventory', { p_org: orgId });
  if (error || !data) return { kind: 'error' };
  const inv = data as Inventory;
  return { kind: 'ready', data: inv.skus.map((x) => ({ id: x.id, sku: x.sku, name: x.name, on_hand: x.on_hand, reserved: x.reserved, available: x.available, incoming: x.incoming, checking: x.checking, days_cover: x.days_cover, status: x.status })) };
});

type AsnRow = { id: string; code: string; warehouse_code: string; expected_date: string; cartons: number | null; status: string };
type LineRow = { id: string; asn_id: string; expected_qty: number; received_good: number | null; status: string };
const loadInbound = cache(async ({ sb, orgId }: Ctx): Promise<PanelState<InboundRow[]>> => {
  const [asnRes, whRes] = await Promise.all([
    sb.from('wh_asns').select('id, code, warehouse_code, expected_date, cartons, status').eq('org_id', orgId).order('created_at', { ascending: false }).limit(100),
    sb.from('warehouses').select('code, name').eq('status', 'active'),
  ]);
  if (asnRes.error) return { kind: 'error' };
  const asns = (asnRes.data ?? []) as AsnRow[];
  const names = new Map(((whRes.data ?? []) as { code: string; name: string }[]).map((w) => [w.code, w.name]));
  const ids = asns.map((a) => a.id);
  const [lineRes, lotRes] = ids.length ? await Promise.all([
    sb.from('wh_asn_lines').select('id, asn_id, expected_qty, received_good, status').in('asn_id', ids),
    sb.from('wh_lots').select('asn_line_id, qty').eq('org_id', orgId).eq('status', 'blocked'),
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  if (lineRes.error) return { kind: 'error' };
  const lines = (lineRes.data ?? []) as LineRow[];
  const blocked = new Map(((lotRes.data ?? []) as { asn_line_id: string | null; qty: number }[]).filter((t) => t.asn_line_id).map((t) => [t.asn_line_id as string, Number(t.qty)]));
  return {
    kind: 'ready',
    data: asns.map((a) => {
      const own = lines.filter((l) => l.asn_id === a.id);
      const [label, tone] = ASN_STATUS[a.status] ?? [a.status, 'neutral'];
      const got = own.some((l) => l.received_good != null) ? own.reduce((n, l) => n + Number(l.received_good ?? 0), 0) : null;
      return {
        id: a.id, code: a.code, warehouse: names.get(a.warehouse_code) ?? a.warehouse_code, expected_date: a.expected_date, cartons: a.cartons,
        units: own.reduce((n, l) => n + Number(l.expected_qty), 0), received: got, status: { key: a.status, label, tone: odsTone(tone) },
        checking: own.filter((l) => l.status === 'blocked').reduce((n, l) => n + (blocked.get(l.id) ?? 0), 0),
      };
    }),
  };
});

type OrderRow = { id: string; code: string; external_ref: string | null; status: string; ship_name: string; ship_country: string; created_at: string; shipped_at: string | null; tracking_token: string | null };
const loadOutbound = cache(async ({ sb, orgId }: Ctx): Promise<PanelState<OutboundRow[]>> => {
  const { data, error } = await sb.from('wh_orders').select('id, code, external_ref, status, ship_name, ship_country, created_at, shipped_at, tracking_token')
    .eq('org_id', orgId).order('created_at', { ascending: false }).limit(100);
  if (error) return { kind: 'error' };
  const rows = (data ?? []) as OrderRow[];
  const ids = rows.map((o) => o.id);
  const lines = ids.length ? ((await sb.from('wh_order_lines').select('order_id, qty').in('order_id', ids)).data ?? []) as { order_id: string; qty: number }[] : [];
  return {
    kind: 'ready',
    data: rows.map((o) => {
      const [label, tone] = ORDER_STATUS[o.status] ?? [o.status, 'neutral'];
      return { id: o.id, code: o.code, external_ref: o.external_ref, ship_to: `${o.ship_name} · ${o.ship_country}`, status: { key: o.status, label, tone: odsTone(tone) }, created_at: o.created_at, shipped_at: o.shipped_at, tracking_token: o.tracking_token, units: lines.filter((l) => l.order_id === o.id).reduce((n, l) => n + Number(l.qty), 0) };
    }),
  };
});

const RATE_COLS = 'plan_code, warehouse_code, version, receiving_per_carton_cents, storage_per_pallet_month_cents, storage_per_cbm_month_cents, pick_pack_first_cents, pick_pack_extra_cents, returns_per_item_cents, min_monthly_cents';
async function loadFees({ sb, orgId, client }: Ctx): Promise<PanelState<FeesData>> {
  const [rateRes, planRes, whRes, invRes] = await Promise.all([
    sb.from('wh_rate_versions').select(RATE_COLS).eq('status', 'active').eq('plan_code', client!.plan_code),
    sb.from('wh_rate_plans').select('code, name').eq('code', client!.plan_code).maybeSingle(),
    sb.from('warehouses').select('code, name').eq('status', 'active'),
    sb.rpc('wh_portal_invoices', { p_org: orgId }),
  ]);
  if (rateRes.error || invRes.error) return { kind: 'error' };
  type R = Omit<RateCard, 'plan' | 'warehouse'> & { plan_code: string; warehouse_code: string | null };
  const rows = (rateRes.data ?? []) as R[];
  const pick = rows.find((r) => r.warehouse_code && r.warehouse_code === client!.preferred_warehouse) ?? rows.find((r) => !r.warehouse_code) ?? null;
  const whName = new Map(((whRes.data ?? []) as { code: string; name: string }[]).map((w) => [w.code, w.name]));
  const num = (v: unknown) => (v == null ? null : Number(v));
  const rates: RateCard | null = pick ? {
    plan: (planRes.data as { name: string } | null)?.name ?? pick.plan_code, warehouse: pick.warehouse_code ? whName.get(pick.warehouse_code) ?? pick.warehouse_code : null, version: pick.version,
    receiving_per_carton_cents: num(pick.receiving_per_carton_cents), storage_per_cbm_month_cents: num(pick.storage_per_cbm_month_cents), storage_per_pallet_month_cents: num(pick.storage_per_pallet_month_cents),
    pick_pack_first_cents: num(pick.pick_pack_first_cents), pick_pack_extra_cents: num(pick.pick_pack_extra_cents), returns_per_item_cents: num(pick.returns_per_item_cents), min_monthly_cents: num(pick.min_monthly_cents),
  } : null;
  const statements = ((invRes.data ?? []) as IssuedInvoice[]).map((i) => {
    const total = Number(i.amount_cents ?? i.total_cents), paid = Number(i.paid_cents ?? 0);
    const status = i.status === 'cancelled' || i.status === 'void' ? { label: 'Cancelled', tone: 'neutral' as const }
      : paid >= total && total > 0 ? { label: 'Paid', tone: 'success' as const } : paid > 0 ? { label: 'Partly paid', tone: 'warning' as const } : { label: 'Sent', tone: 'info' as const };
    return { id: i.id, period: i.period, number: i.number, total_cents: total, paid_cents: paid, currency: i.currency, status };
  });
  return { kind: 'ready', data: { rates, statements } };
}

async function loadKpis(c: Ctx): Promise<PanelState<WarehouseKpis>> {
  const [stock, inbound, outbound] = await Promise.all([loadStock(c), loadInbound(c), loadOutbound(c)]);
  const st = stock.kind === 'ready' ? stock.data : null;
  const open = inbound.kind === 'ready' ? inbound.data.filter((a) => OPEN_ASN.includes(a.status.key ?? '')) : null;
  return {
    kind: 'ready',
    data: {
      onHand: st && st.length ? st.reduce((n, r) => n + r.on_hand, 0) : null,
      available: st && st.length ? st.reduce((n, r) => n + r.available, 0) : null,
      products: st ? st.length : null,
      inboundOpen: open ? open.length : null,
      inboundUnits: open ? open.reduce((n, a) => n + a.units, 0) : null,
      openOrders: outbound.kind === 'ready' ? outbound.data.filter((o) => OPEN_ORDER.includes(o.status.key ?? '')).length : null,
    },
  };
}

/** Days of cover under which stock is low: site setting warehouse.low_stock_cover_days (1–365; missing / invalid / unreadable → 14). */
async function coverDays(): Promise<number> {
  const r = await settle(() => getSiteContent());
  return lowStockCoverDays(r.ok ? r.data.settings[LOW_STOCK_SETTING_KEY] : undefined);
}
async function Stock({ c }: { c: Ctx }) {
  const [state, days] = await Promise.all([loadStock(c), coverDays()]);
  return <StockPanel state={state} coverDays={days} />;
}
async function Inbound({ c }: { c: Ctx }) { return <InboundPanel state={await loadInbound(c)} />; }
async function Outbound({ c }: { c: Ctx }) { return <OutboundPanel state={await loadOutbound(c)} />; }
async function Fees({ c }: { c: Ctx }) { return <FeesPanel state={await loadFees(c)} />; }
async function Kpis({ c }: { c: Ctx }) { return <WarehouseKpiStrip state={await loadKpis(c)} />; }
