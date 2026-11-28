// ODS T9 · B2B shipments (Warehouse OS › B2B shipments, Part 7.6 list + drawer + record). Replaces the T8 re-export of
// app/office/warehouse/b2b-shipments/page.tsx. Same guard (requireStaff('orders','view')), same b2bShippingAccess rules
// (F-05: carrier names / rates not even loaded for Support-only staff), same division scope, same reads (orders ready to ship,
// latest 50 shipments + tracking events, get_shipment_rates / get_shipment_carriers RPCs, suppliers via withSuppliers only with
// suppliers:view or Finance), same ?order= create flow calling today's priceTrial / createShipment unchanged.
import { Suspense } from 'react';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { withSuppliers } from '@/components/backoffice/hidden-columns';
import { getCarrier } from '@/lib/adapters';
import { one } from '@/components/backoffice/server-utils';
import { COUNTRY_NAMES } from '@/lib/format';
import { isStaging } from '@/lib/core/account';
import { isWarehouseMember } from '@/lib/warehouse-retire-server';
import { B2B_SHIPMENTS_PATH, isUuid } from '@/lib/warehouse-retire';
import { getDivisionScope } from '@/lib/divisions/scope';
import { priceTrial, createShipment } from '@/app/office/actions';
import { StatusPill, Button } from '@octopus/ui';
import { applyShippingAccess, b2bShippingAccess, b2bView, carrierStatusText, type ReadyRow, type ShipEvent, type ShipmentRow } from './_lib/shipping-core';
import { B2bShipments } from './_components/b2b-shipments';
import { CreateShipment } from './_components/create-shipment';
import { SalesPageHead } from '../../_components/sales-bits';

export const metadata = { title: 'B2B shipments · Warehouse' };

const READY_COLS = 'id, code, title, total_cents, currency, incoterm, updated_at, organizations(name, country, city)';
const SHIP_COLS = 'id, code, tracking_no, status, service_code, currency, label_url, last_event_at, created_at, order_id, store_order_id, orders(id, code), store_orders(order_number), tracking_events(status, description, occurred_at)';

type Org = { name: string; country: string | null; city: string | null };
type Ready = { id: string; code: string; title: string; total_cents: number; currency: string; incoterm: string | null; updated_at: string; organizations: Org | Org[] | null };
type SP = Promise<{ order?: string; view?: string }>;

export default function Page(props: { searchParams: SP }) {
  return (
    <div className="grid min-w-0 gap-3" data-testid="b2b-shipments-page">
      <Suspense fallback={<SalesPageHead crumbs={[{ label: 'Warehouse' }, { label: 'B2B shipments' }]} title="B2B shipments" />}>
        <Content {...props} />
      </Suspense>
    </div>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  const s = await requireStaff('orders', 'view', B2B_SHIPMENTS_PATH);
  const sp = await searchParams;
  const selId = isUuid(sp.order) ? sp.order : undefined;
  const a = b2bShippingAccess({ isAdmin: s.isAdmin, can: (area, action) => can(s, area, action) });
  const scope = await getDivisionScope(s);
  const sb = await createClient();
  const [{ data: readyRows }, { data: shipsRaw, error: shipErr }, whMember] = await Promise.all([
    a.canSeeReadyToShip
      ? (scope.all ? sb.from('orders').select(READY_COLS) : sb.from('orders').select(READY_COLS).eq('division_id', scope.division.id)).eq('status', 'ready_to_ship').order('updated_at').limit(100)
      : Promise.resolve({ data: [] as Ready[] }),
    (scope.all ? sb.from('shipments').select(SHIP_COLS) : sb.from('shipments').select(SHIP_COLS).eq('division_id', scope.division.id)).order('created_at', { ascending: false }).limit(50),
    isWarehouseMember(),
  ]);
  const shipIds = (shipsRaw ?? []).map((x) => x.id as string);
  const [{ data: rateRows }, { data: carrierRows }, ready] = await Promise.all([
    a.canSeeRates && shipIds.length ? sb.rpc('get_shipment_rates', { p_ids: shipIds }) : Promise.resolve({ data: [] as { shipment_id: string; rate_cents: number | null; currency: string | null }[] }),
    // carrier names are not even loaded for Support-only staff (F-05)
    a.canSeeCarrier && shipIds.length ? sb.rpc('get_shipment_carriers', { p_ids: shipIds }) : Promise.resolve({ data: [] as { shipment_id: string; carrier_name: string | null }[] }),
    a.canSeeReadyToShip && a.canSeeSuppliers
      ? withSuppliers(sb, 'orders', (readyRows ?? []) as Ready[], 'code, legal_name, country, city')
      : Promise.resolve(((readyRows ?? []) as Ready[]).map((r) => ({ ...r, supplier_id: null as string | null, suppliers: null as { code: string; legal_name: string; country: string; city: string | null } | null }))),
  ]);
  const rateMap = new Map(((rateRows ?? []) as { shipment_id: string; rate_cents: number | null; currency: string | null }[]).map((r) => [r.shipment_id, r]));
  const carrierMap = new Map(((carrierRows ?? []) as { shipment_id: string; carrier_name: string | null }[]).map((r) => [r.shipment_id, r.carrier_name]));
  const shipments: ShipmentRow[] = (shipsRaw ?? []).map((x) => {
    const ord = one(x.orders as unknown as { id: string; code: string } | null);
    const so = one(x.store_orders as unknown as { order_number: string | null } | null);
    return applyShippingAccess({
      id: x.id as string, code: x.code as string, trackingNo: (x.tracking_no as string | null) ?? null, status: x.status as string,
      serviceCode: (x.service_code as string | null) ?? null, carrierName: carrierMap.get(x.id as string) ?? null, labelUrl: (x.label_url as string | null) ?? null,
      rateCents: rateMap.get(x.id as string)?.rate_cents ?? null,
      rateCurrency: (a.canSeeRates ? rateMap.get(x.id as string)?.currency : null) ?? (x.currency as string | null) ?? 'USD',
      at: (x.last_event_at ?? x.created_at) as string,
      order: ord?.id ? ord : null, dropshipOrder: so?.order_number ?? null, isDropship: Boolean(x.store_order_id),
      events: (x.tracking_events ?? []) as ShipEvent[],
    }, a);
  });
  type ReadyWithSup = Ready & { suppliers: { code: string; legal_name: string; country: string; city: string | null } | null };
  const readyList = (ready ?? []) as unknown as ReadyWithSup[];
  const readyVm: ReadyRow[] = readyList.map((o) => {
    const og = one(o.organizations as unknown as Org | null);
    return {
      id: o.id, code: o.code, title: o.title, buyer: og?.name ?? null, buyerCountry: og?.country ?? null,
      supplierCode: a.canSeeSuppliers ? (one(o.suppliers as unknown as { code: string } | null)?.code ?? null) : null,
      totalCents: o.total_cents, currency: o.currency, incoterm: o.incoterm, readySince: o.updated_at,
    };
  });
  const carrier = a.canSeeCarrier && a.canSeeReadyToShip ? getCarrier() : null;
  const carrierStatus = carrier ? carrierStatusText(carrier.mode, isStaging()) : null;
  const sel = a.canSeeReadyToShip && selId ? readyList.find((o) => o.id === selId) : undefined;
  const actions = (
    <>
      {carrierStatus ? <span data-testid="carrier-connection-badge"><StatusPill tone="neutral">{`YunExpress · ${carrierStatus}`}</StatusPill></span> : null}
      {whMember ? <Button variant="secondary" size="sm" href="/office/warehouse/dispatch">Dispatch and freight</Button> : null}
    </>
  );

  if (sel) {
    let hs = '';
    if (a.canEdit) {
      const { data: o } = await sb.from('orders').select('quote_id, rfqs(products(hs_code))').eq('id', sel.id).maybeSingle();
      const prod = one((one(o?.rfqs as unknown as { products: unknown } | null)?.products ?? null) as { hs_code: string | null } | null);
      hs = prod?.hs_code ?? '';
    }
    const org = one(sel.organizations as unknown as Org | null);
    const sup = a.canSeeSuppliers ? one(sel.suppliers as unknown as { code: string; legal_name: string; country: string; city: string | null } | null) : null;
    return (
      <>
        <SalesPageHead crumbs={[{ label: 'Warehouse' }, { label: 'B2B shipments', href: B2B_SHIPMENTS_PATH }, { label: sel.code }]} title={`Create shipment · ${sel.code}`} actions={actions} />
        <CreateShipment
          orderId={sel.id}
          orderCode={sel.code}
          from={{ label: sup ? `${sup.legal_name} (${sup.code})` : '—', place: [sup?.city, sup?.country].filter(Boolean).join(', '), country: sup?.country ?? 'CN' }}
          to={{ label: org?.name ?? '—', place: [org?.city, org?.country ? COUNTRY_NAMES[org.country] ?? org.country : null].filter(Boolean).join(', '), country: org?.country ?? 'US' }}
          incoterm={sel.incoterm}
          defaultDesc={sel.title}
          defaultHs={hs}
          declaredCents={sel.total_cents}
          declaredCurrency={sel.currency}
          canEdit={a.canEdit}
          priceTrial={priceTrial}
          createShipment={createShipment}
          backHref={B2B_SHIPMENTS_PATH}
        />
      </>
    );
  }

  return (
    <>
      <SalesPageHead
        crumbs={[{ label: 'Warehouse' }, { label: 'B2B shipments' }]}
        title="B2B shipments"
        subtitle={a.canSeeReadyToShip
          ? 'Sourcing orders the supplier ships direct to the buyer: ready to ship, waybill and label, tracking and exceptions. Warehouse parcels are labelled in Dispatch and freight.'
          : 'Read-only tracking of B2B shipments: status, waybill number and tracking events.'}
        actions={actions}
      />
      <B2bShipments access={a} view={b2bView(sp.view, a)} shipments={shipments} ready={readyVm} whMember={whMember} base={B2B_SHIPMENTS_PATH} error={!!shipErr} />
    </>
  );
}
