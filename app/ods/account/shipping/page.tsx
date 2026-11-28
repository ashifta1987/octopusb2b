import { Suspense } from 'react';
import type { Metadata } from 'next';
import { requireAccount } from '../_lib/loaders';
import { createClient } from '@/lib/supabase/server';
import { PageHead, PageWrap } from '../_services/ui';
import { SHIPPING_FILTERS, pickTab, shipmentGroup, warehouseOrderGroup } from '../_services/logic';
import { ShippingView, type ShipmentRow, type ShippingState } from './_components/shipping-view';

export const metadata: Metadata = { title: 'Shipping' };

type Ship = {
  id: string; code: string; order_id: string; carrier_code: string; service_code: string | null; tracking_no: string | null; status: string; eta: string | null;
  last_event_at: string | null; created_at: string; orders: { code: string; title: string } | null;
};
type Ev = { shipment_id: string; status: string; description: string | null; location: string | null; occurred_at: string };
type Wh = { id: string; code: string; external_ref: string | null; status: string; ship_name: string; ship_country: string; shipped_at: string; tracking_token: string | null; created_at: string };

/**
 * ODS /account/shipping (Part 6.7, C_Shipping). Today's app has no separate shipping page (switch off → /account/warehouse), so
 * this lists what the company can already see: B2B order shipments (shipments + carriers + latest tracking_events, as on today's
 * order page) and shipped warehouse orders (wh_orders with the public tracking page /t/<token>, as on today's warehouse Orders
 * tab). RLS keeps it to the company. The board's "Get a shipping quote / Ship a parcel" needs rate cards that customers can't
 * query today — not shown (documented).
 */
export default function ShippingPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  return (
    <PageWrap testId="shipping-page">
      <PageHead title="Shipping" description="Your shipments and their tracking: order shipments and the orders our warehouse sent for you." />
      <Suspense fallback={<ShippingView state={{ kind: 'loading' }} status="all" syncUrl={false} />}>
        <List searchParams={searchParams} />
      </Suspense>
    </PageWrap>
  );
}

async function load(orgId: string): Promise<ShippingState> {
  const sb = await createClient();
  const [shipRes, whRes, carrierRes] = await Promise.all([
    sb.from('shipments').select('id, code, order_id, carrier_code, service_code, tracking_no, status, eta, last_event_at, created_at, orders(code, title)')
      .eq('org_id', orgId).neq('status', 'draft').order('created_at', { ascending: false }).limit(100),
    sb.from('wh_orders').select('id, code, external_ref, status, ship_name, ship_country, shipped_at, tracking_token, created_at')
      .eq('org_id', orgId).not('shipped_at', 'is', null).order('shipped_at', { ascending: false }).limit(100),
    sb.from('carriers').select('code, name'),
  ]);
  if (shipRes.error && whRes.error) return { kind: 'error' };
  const ships = (shipRes.data ?? []) as unknown as Ship[];
  const ids = ships.map((x) => x.id);
  const { data: evs } = ids.length ? await sb.from('tracking_events').select('shipment_id, status, description, location, occurred_at').in('shipment_id', ids).order('occurred_at', { ascending: false }).limit(500) : { data: [] };
  const latest = new Map<string, Ev>();
  for (const e of (evs ?? []) as Ev[]) if (!latest.has(e.shipment_id)) latest.set(e.shipment_id, e);
  const carriers = new Map(((carrierRes.data ?? []) as { code: string; name: string }[]).map((c) => [c.code, c.name]));
  const rows: ShipmentRow[] = [
    ...ships.map((x): ShipmentRow => {
      const g = shipmentGroup(x.status);
      const e = latest.get(x.id);
      return {
        id: `s-${x.id}`, kind: 'order', code: x.code, title: x.orders?.title ?? 'Order shipment',
        ref: x.orders ? { label: x.orders.code, href: `/account/orders/${x.order_id}` } : null,
        carrier: carriers.get(x.carrier_code) ?? null, service: x.service_code, trackingNo: x.tracking_no, trackingHref: null,
        group: g.group, status: { label: g.label, tone: g.tone },
        lastEvent: e ? { text: [e.description || g.label, e.location].filter(Boolean).join(' · '), at: e.occurred_at } : null,
        eta: x.eta, updatedAt: e?.occurred_at ?? x.last_event_at ?? x.created_at,
      };
    }),
    ...((whRes.data ?? []) as Wh[]).map((o): ShipmentRow => {
      const g = warehouseOrderGroup(o.status);
      return {
        id: `w-${o.id}`, kind: 'warehouse', code: o.code, title: `Warehouse order to ${o.ship_name}`,
        ref: { label: o.external_ref ? `Your ref ${o.external_ref}` : 'Packing record', href: `/account/warehouse?tab=orders&order=${o.code}` },
        carrier: null, service: o.ship_country, trackingNo: null, trackingHref: o.tracking_token ? `/t/${o.tracking_token}` : null,
        group: g.group, status: { label: g.label, tone: g.tone }, lastEvent: null, eta: null, updatedAt: o.shipped_at,
      };
    }),
  ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { kind: 'ready', rows };
}

async function List({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const s = await requireAccount('/account/shipping');
  const sp = await searchParams;
  return <ShippingView state={await load(s.org!.id)} status={pickTab(sp.status, SHIPPING_FILTERS)} />;
}
