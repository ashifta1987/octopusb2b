import { Suspense } from 'react';
import Link from 'next/link';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { withSuppliers } from '@/components/backoffice/hidden-columns';
import { getCarrier } from '@/lib/adapters';
import { DsBadge, DsCard, DsLinkButton, DsNotice, DsPageHeader, DsSkeleton, DsTableCard, type DsBadgeTone } from '@/components/dropship-ui';
import { ShipmentCreator } from '@/components/backoffice/shipment-creator';
import { one } from '@/components/backoffice/server-utils';
import { fmtDate, COUNTRY_NAMES, humanize, money } from '@/lib/format';
import { isStaging } from '@/lib/core/account';
import { isWarehouseMember } from '@/lib/warehouse-retire-server';
import { B2B_SHIPMENTS_PATH, b2bShippingAccess, isUuid, packFallback } from '@/lib/warehouse-retire';
import { getDivisionScope } from '@/lib/divisions/scope';
import { priceTrial, createShipment } from '../../actions';

export const metadata = { title: 'B2B shipments · Warehouse' };

/**
 * Warehouse OS · W7 (D10) — B2B order shipping inside Warehouse OS; the legacy /office/shipping screen is deleted (redirects here).
 * Warehouse OS orders (wh_orders: 3PL clients + Dropship) are labelled and tracked in Dispatch and freight (W4). Sourcing
 * (B2B) orders are not warehouse orders: the supplier ships them direct with the YunExpress B2B adapter (lib/adapters), so
 * their queue and shipments stay here — same server actions as before (priceTrial / createShipment), no simulated tracking.
 * Who sees what: orders:view opens the page; carrier name, service, rate and label only for admin / orders editors /
 * Finance / warehouse:view (Support alone reads status, waybill number and events — audit F-05); suppliers only with
 * suppliers:view or Finance. Dropship rows link to the Warehouse OS order search, never to /office/orders/undefined (F-06).
 */
const READY_COLS = 'id, code, title, total_cents, currency, incoterm, updated_at, organizations(name, country, city)';
const SHIP_COLS = 'id, code, tracking_no, status, service_code, currency, label_url, last_event_at, created_at, order_id, store_order_id, orders(id, code), store_orders(order_number), tracking_events(status, description, occurred_at)';

type Org = { name: string; country: string | null; city: string | null };
type ReadyRow = { id: string; code: string; title: string; total_cents: number; currency: string; incoterm: string | null; updated_at: string; organizations: Org | Org[] | null };
type Ev = { status: string; description: string | null; occurred_at: string };

function tone(status: string): DsBadgeTone {
  if (status === 'delivered') return 'ok';
  if (status === 'exception' || status === 'returned') return 'bad';
  if (['picked_up', 'in_transit', 'out_for_delivery'].includes(status)) return 'info';
  return 'neutral';
}

async function Content({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const s = await requireStaff('orders', 'view', B2B_SHIPMENTS_PATH);
  const sp = await searchParams;
  const selId = isUuid(sp.order) ? sp.order : undefined;
  const a = b2bShippingAccess({ isAdmin: s.isAdmin, can: (area, action) => can(s, area, action) });
  const scope = await getDivisionScope(s);
  const sb = await createClient();
  const [{ data: readyRows }, { data: shipsRaw }, whMember] = await Promise.all([
    a.canSeeReadyToShip
      ? (scope.all ? sb.from('orders').select(READY_COLS) : sb.from('orders').select(READY_COLS).eq('division_id', scope.division.id)).eq('status', 'ready_to_ship').order('updated_at').limit(100)
      : Promise.resolve({ data: [] as ReadyRow[] }),
    (scope.all ? sb.from('shipments').select(SHIP_COLS) : sb.from('shipments').select(SHIP_COLS).eq('division_id', scope.division.id)).order('created_at', { ascending: false }).limit(50),
    isWarehouseMember(),
  ]);
  const shipIds = (shipsRaw ?? []).map((x) => x.id as string);
  const [{ data: rateRows }, { data: carrierRows }, ready] = await Promise.all([
    a.canSeeRates && shipIds.length ? sb.rpc('get_shipment_rates', { p_ids: shipIds }) : Promise.resolve({ data: [] as { shipment_id: string; rate_cents: number | null; currency: string | null }[] }),
    // carrier names are not even loaded for Support-only staff (F-05)
    a.canSeeCarrier && shipIds.length ? sb.rpc('get_shipment_carriers', { p_ids: shipIds }) : Promise.resolve({ data: [] as { shipment_id: string; carrier_name: string | null }[] }),
    a.canSeeReadyToShip && a.canSeeSuppliers
      ? withSuppliers(sb, 'orders', (readyRows ?? []) as ReadyRow[], 'code, legal_name, country, city')
      : Promise.resolve(((readyRows ?? []) as ReadyRow[]).map((r) => ({ ...r, supplier_id: null as string | null, suppliers: null as { code: string; legal_name: string; country: string; city: string | null } | null }))),
  ]);
  type RateRow = { shipment_id: string; rate_cents: number | null; currency: string | null };
  type CarrierRow = { shipment_id: string; carrier_name: string | null };
  const rateMap = new Map<string, RateRow>(((rateRows ?? []) as RateRow[]).map((r) => [r.shipment_id, r]));
  const carrierMap = new Map<string, string | null>(((carrierRows ?? []) as CarrierRow[]).map((r) => [r.shipment_id, r.carrier_name]));
  const ships = (shipsRaw ?? []).map((x) => {
    const ord = one(x.orders as unknown as { id: string; code: string } | null);
    const so = one(x.store_orders as unknown as { order_number: string | null } | null);
    const evs = ((x.tracking_events ?? []) as Ev[]).slice().sort((p, q) => q.occurred_at.localeCompare(p.occurred_at));
    return {
      id: x.id as string, code: x.code as string, tracking_no: x.tracking_no as string | null, status: x.status as string,
      service_code: a.canSeeCarrier ? (x.service_code as string | null) : null,
      label_url: a.canDownloadLabels ? (x.label_url as string | null) : null,
      rate_cents: a.canSeeRates ? (rateMap.get(x.id)?.rate_cents ?? null) : null,
      rate_currency: (a.canSeeRates ? rateMap.get(x.id)?.currency : null) ?? (x.currency as string | null) ?? 'USD',
      carrier_name: a.canSeeCarrier ? (carrierMap.get(x.id) ?? null) : null,
      at: (x.last_event_at ?? x.created_at) as string,
      ord, dso: so?.order_number ?? null, isDropship: Boolean(x.store_order_id), evs,
    };
  });
  const exceptions = ships.filter((x) => x.status === 'exception');
  const sel = a.canSeeReadyToShip && selId ? (ready ?? []).find((o) => o.id === selId) : undefined;
  let hs = '';
  if (sel && a.canEdit) {
    const { data: o } = await sb.from('orders').select('quote_id, rfqs(products(hs_code))').eq('id', sel.id).maybeSingle();
    const prod = one((one(o?.rfqs as unknown as { products: unknown } | null)?.products ?? null) as { hs_code: string | null } | null);
    hs = prod?.hs_code ?? '';
  }
  const org = sel ? one(sel.organizations as unknown as Org | null) : null;
  const sup = sel && a.canSeeSuppliers ? one(sel.suppliers as unknown as { code: string; legal_name: string; country: string; city: string | null } | null) : null;
  const carrier = a.canSeeCarrier && a.canSeeReadyToShip ? getCarrier() : null;
  const carrierStatus = !carrier ? null : carrier.mode === 'live' ? 'Production' : isStaging() ? 'Sandbox mode' : 'Carrier not connected';

  const orderCell = (x: (typeof ships)[number]) => {
    if (x.ord?.id) return <Link href={`/office/orders/${x.ord.id}`} className="font-mono text-coral-text">{x.ord.code}</Link>;
    if (x.isDropship) {
      return (
        <span className="text-[13px]">
          <span className="text-muted">Dropship </span>
          {x.dso && whMember ? <Link href={packFallback(x.dso)} className="font-mono text-coral-text">{x.dso}</Link> : <span className="font-mono">{x.dso ?? '—'}</span>}
        </span>
      );
    }
    return <span className="text-muted">—</span>;
  };

  return (
    <div className="flex flex-col gap-5" data-testid="b2b-shipments-page">
      <DsPageHeader
        title={sel ? `Create shipment · ${sel.code}` : 'B2B shipments'}
        icon="send"
        subtitle={sel
          ? <><Link href={B2B_SHIPMENTS_PATH} className="text-coral-text">B2B shipments</Link> / {sel.code}</>
          : a.canSeeReadyToShip
            ? 'Sourcing orders the supplier ships direct to the buyer: ready to ship, waybill and label, tracking and exceptions. Warehouse parcels are labelled in Dispatch and freight.'
            : 'Read-only tracking of B2B shipments: status, waybill number and tracking events.'}
        actions={<>
          {carrierStatus && <span className="ds-badge ds-badge-neutral" data-testid="carrier-connection-badge"><b>YunExpress</b>&nbsp;· {carrierStatus}</span>}
          {whMember && <DsLinkButton href="/office/warehouse/dispatch" variant="secondary" icon="truck">Dispatch and freight</DsLinkButton>}
        </>}
      />

      {sel ? (
        <div className="grid lg:grid-cols-[1fr_320px] gap-5 items-start">
          <div className="flex flex-col gap-5">
            <DsCard title="1 · Route" icon="globe">
              <div className="grid sm:grid-cols-[1fr_auto_1fr] gap-4 items-center text-[14px]">
                <div className="rounded-[10px] bg-pearl p-4">
                  <div className="text-[12px] text-muted">Ship from · supplier</div>
                  <div className="font-semibold mt-1">{sup ? `${sup.legal_name} (${sup.code})` : '—'}</div>
                  <div className="text-[13px] text-muted">{[sup?.city, sup?.country].filter(Boolean).join(', ')}</div>
                </div>
                <span aria-hidden className="text-muted text-xl">→</span>
                <div className="rounded-[10px] bg-pearl p-4">
                  <div className="text-[12px] text-muted">Ship to · buyer</div>
                  <div className="font-semibold mt-1">{org?.name}</div>
                  <div className="text-[13px] text-muted">{[org?.city, org?.country ? COUNTRY_NAMES[org.country] ?? org.country : null].filter(Boolean).join(', ')} · Incoterm {sel.incoterm ?? '—'}</div>
                </div>
              </div>
            </DsCard>
            {a.canEdit ? (
              <ShipmentCreator orderId={sel.id} orderCode={sel.code} fromCountry={sup?.country ?? 'CN'} toCountry={org?.country ?? 'US'} defaultDesc={sel.title}
                defaultHs={hs} declaredCents={sel.total_cents} declaredCurrency={sel.currency} incoterm={sel.incoterm} priceTrial={priceTrial} createShipment={createShipment}
                backHref={B2B_SHIPMENTS_PATH} />
            ) : <DsNotice tone="info" title="View only">You can view shipping but not create shipments.</DsNotice>}
          </div>
          <DsCard title="Who sees what" icon="eye">
            <p className="m-0 text-[13px] text-muted">The buyer sees the waybill number and tracking only, with the carrier label set in Admin. The supplier&apos;s address stays hidden.</p>
            <p className="mt-2 mb-0 text-[13px] text-muted">The supplier gets the label to print and stick on the parcels.</p>
          </DsCard>
        </div>
      ) : a.canSeeReadyToShip ? (
        <DsTableCard title={`Ready to ship · ${ready?.length ?? 0}`} icon="cart" testId="b2b-ready"
          headers={['Order', 'Buyer', ...(a.canSeeSuppliers ? ['Supplier'] : []), 'Value', 'Incoterm', 'Ready since', ...(a.canEdit ? [''] : [])]}
          footer={!ready?.length ? 'No orders ready to ship. Orders appear here once the balance is paid and they are moved to “ready to ship”.' : undefined}>
          {(ready ?? []).map((o) => {
            const og = one(o.organizations as unknown as Org | null);
            return (
              <tr key={o.id}>
                <td><div className="font-mono font-semibold text-[13px]">{o.code}</div><div className="text-[12px] text-muted line-clamp-1">{o.title}</div></td>
                <td className="text-[13px]">{og?.name} <span className="text-muted">{og?.country}</span></td>
                {a.canSeeSuppliers && <td className="font-mono text-[13px]">{one(o.suppliers as unknown as { code: string } | null)?.code ?? '—'}</td>}
                <td className="font-mono text-[13px]">{money(o.total_cents, o.currency)}</td>
                <td className="text-[13px]">{o.incoterm ?? '—'}</td>
                <td className="text-[13px]">{fmtDate(o.updated_at)}</td>
                {a.canEdit && <td className="text-right"><DsLinkButton href={`${B2B_SHIPMENTS_PATH}?order=${o.id}`} variant="primary">Create shipment</DsLinkButton></td>}
              </tr>
            );
          })}
        </DsTableCard>
      ) : null}

      {exceptions.length > 0 && (
        <DsNotice tone="bad" title={`Exceptions · ${exceptions.length}`} testId="b2b-exceptions">
          {exceptions.map((x) => `${x.tracking_no ?? x.code}${x.ord?.code ? ` (${x.ord.code})` : x.dso ? ` (${x.dso})` : ''}: ${x.evs[0]?.description ?? 'exception'} · ${fmtDate(x.at, true)}`).join(' · ')}
        </DsNotice>
      )}

      <DsTableCard title="Shipments" icon="send" testId="b2b-shipments" minWidth={760}
        headers={['Shipment', 'Order', ...(a.canSeeCarrier ? ['Carrier', 'Service'] : []), 'Waybill', ...(a.canSeeRates ? ['Rate'] : []), 'Last event', 'Status', ...(a.canDownloadLabels ? [''] : [])]}
        footer={ships.length
          ? 'Tracking events come from the carrier (webhook, with an hourly check). Older shipments of Dropship orders are listed for reference; new warehouse parcels are tracked in Dispatch and freight.'
          : 'No shipments yet.'}>
        {ships.map((x) => (
          <tr key={x.id}>
            <td className="font-mono text-[13px]">{x.code}</td>
            <td>{orderCell(x)}</td>
            {a.canSeeCarrier && <td className="text-[13px] font-medium">{x.carrier_name ?? '—'}</td>}
            {a.canSeeCarrier && <td className="text-[13px]">{x.service_code ?? '—'}</td>}
            <td className="font-mono text-[13px]">{x.tracking_no ?? '—'}</td>
            {a.canSeeRates && <td className="font-mono text-[13px]">{x.rate_cents == null ? '—' : money(x.rate_cents, x.rate_currency)}</td>}
            <td className="text-[13px]">
              <div>{x.evs[0]?.description ?? '—'}</div>
              <div className="text-[12px] text-muted">{fmtDate(x.at, true)}</div>
              {x.evs.length > 0 && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-[12px] text-coral-text">All events ({x.evs.length})</summary>
                  <ul className="mt-1 pl-4 text-[12px] text-muted">
                    {x.evs.map((e, i) => <li key={i}>{humanize(e.status)}{e.description ? ` · ${e.description}` : ''} · {fmtDate(e.occurred_at, true)}</li>)}
                  </ul>
                </details>
              )}
            </td>
            <td><DsBadge tone={tone(x.status)}>{humanize(x.status)}</DsBadge></td>
            {a.canDownloadLabels && <td className="text-right">{x.label_url && <a href={x.label_url} target="_blank" rel="noopener" className="ds-btn ds-btn-secondary">Label</a>}</td>}
          </tr>
        ))}
      </DsTableCard>
    </div>
  );
}

export default function Page(props: { searchParams: Promise<{ order?: string }> }) {
  return <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}><Content {...props} /></Suspense>;
}
