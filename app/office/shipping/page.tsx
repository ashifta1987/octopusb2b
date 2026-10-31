import Link from 'next/link';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getCarrier } from '@/lib/adapters';
import { Card, PageHeader, StatusBadge, Table, EmptyState, Money } from '@/components/ui';
import { RunButton } from '@/components/backoffice/action-form';
import { ShipmentCreator } from '@/components/backoffice/shipment-creator';
import { one } from '@/components/backoffice/server-utils';
import { fmtDate, COUNTRY_NAMES } from '@/lib/format';
import { cn } from '@/lib/cn';
import { priceTrial, createShipment, simulateTracking } from '../actions';

export const metadata = { title: 'Shipping' };

export default async function Shipping({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const s = await requireStaff('orders', 'view', '/office/shipping');
  const { order: selId } = await searchParams;
  const sb = await createClient();
  const carrier = getCarrier();
  const [{ data: ready }, { data: ships }] = await Promise.all([
    sb.from('orders').select('id, code, title, total_cents, currency, incoterm, updated_at, organizations(name, country, city), suppliers(code, legal_name, country, city)').eq('status', 'ready_to_ship').order('updated_at').limit(100),
    sb.from('shipments').select('id, code, tracking_no, status, service_code, rate_cents, currency, label_url, last_event_at, created_at, orders(id, code), tracking_events(status, description, occurred_at)').order('created_at', { ascending: false }).limit(50),
  ]);
  const sel = (ready ?? []).find((o) => o.id === selId);
  const canEdit = can(s, 'orders', 'edit');
  const exceptions = (ships ?? []).filter((x) => x.status === 'exception');
  let hs = '';
  if (sel) {
    const { data: o } = await sb.from('orders').select('quote_id, rfqs(products(hs_code))').eq('id', sel.id).maybeSingle();
    const prod = one((one(o?.rfqs as unknown as { products: unknown } | null)?.products ?? null) as { hs_code: string | null } | null);
    hs = prod?.hs_code ?? '';
  }
  const org = sel ? one(sel.organizations as unknown as { name: string; country: string | null; city: string | null } | null) : null;
  const sup = sel ? one(sel.suppliers as unknown as { code: string; legal_name: string; country: string; city: string | null } | null) : null;

  return (
    <>
      <PageHeader title={sel ? `Create shipment with YunExpress · ${sel.code}` : 'Shipping'}
        eyebrow={sel ? <nav aria-label="Breadcrumb" className="text-sm text-muted"><Link href="/office/shipping">Shipping</Link> / {sel.code}</nav> : undefined}
        subtitle={sel ? undefined : 'Paid orders ready to ship, YunExpress price trial and labels, live shipments and exceptions.'}
        actions={<span className="inline-flex items-center gap-2 card px-4 py-2 text-sm"><span className={cn('w-2 h-2 rounded-full', carrier.mode === 'live' ? 'bg-ok' : 'bg-warn')} aria-hidden /><b>YunExpress</b> · {carrier.mode === 'live' ? 'Production' : 'Sandbox mode'}</span>}
      />

      {sel ? (
        <div className="grid lg:grid-cols-[1fr_340px] gap-6 items-start mb-8">
          <div className="space-y-6">
            <section className="card p-6">
              <h2 className="text-lg font-semibold mb-4">1 · Route</h2>
              <div className="grid sm:grid-cols-[1fr_auto_1fr] gap-4 items-center">
                <div className="rounded-[10px] bg-surface p-4">
                  <div className="eyebrow text-muted">Ship from · supplier</div>
                  <div className="font-semibold mt-1">{sup?.legal_name} ({sup?.code})</div>
                  <div className="text-sm text-muted">{[sup?.city, sup?.country].filter(Boolean).join(', ')}</div>
                </div>
                <span aria-hidden className="text-muted text-xl">→</span>
                <div className="rounded-[10px] bg-surface p-4">
                  <div className="eyebrow text-muted">Ship to · buyer</div>
                  <div className="font-semibold mt-1">{org?.name}</div>
                  <div className="text-sm text-muted">{[org?.city, org?.country ? COUNTRY_NAMES[org.country] ?? org.country : null].filter(Boolean).join(', ')} · Incoterm {sel.incoterm ?? '—'}</div>
                </div>
              </div>
            </section>
            {canEdit ? (
              <ShipmentCreator orderId={sel.id} orderCode={sel.code} fromCountry={sup?.country ?? 'CN'} toCountry={org?.country ?? 'US'} defaultDesc={sel.title}
                defaultHs={hs} declaredCents={sel.total_cents} declaredCurrency={sel.currency} incoterm={sel.incoterm} priceTrial={priceTrial} createShipment={createShipment} />
            ) : <Card><p className="p-6 text-sm text-muted">You can view shipping but not create shipments.</p></Card>}
          </div>
          <aside className="space-y-4">
            <div className="card p-5 border-dashed">
              <h3 className="font-semibold">Waybill and label</h3>
              <p className="text-sm text-muted mt-2">Pick a service and create the shipment. The YunExpress waybill number, a 10 × 15 cm label and tracking appear here and on the order.</p>
            </div>
            <div className="card p-5">
              <h3 className="font-semibold">Who sees what</h3>
              <p className="text-sm text-muted mt-2">The buyer sees the carrier, waybill number and tracking only. The supplier&apos;s address stays hidden.</p>
              <p className="text-sm text-muted mt-2">The supplier gets the label to print and stick on the parcels.</p>
            </div>
          </aside>
        </div>
      ) : (
        <Card className="mb-6" title={`Ready to ship · ${ready?.length ?? 0}`}>
          <Table head={['Order', 'Buyer', 'Supplier', 'Value', 'Incoterm', 'Ready since', '']} empty={<EmptyState title="No orders ready to ship" body="Orders appear here once the balance is paid and they are moved to “ready to ship”." />}>
            {(ready ?? []).map((o) => {
              const og = one(o.organizations as unknown as { name: string; country: string | null } | null);
              return (
                <tr key={o.id}>
                  <td className="td"><div className="mono font-semibold text-sm">{o.code}</div><div className="text-xs text-muted line-clamp-1">{o.title}</div></td>
                  <td className="td text-sm">{og?.name} <span className="text-muted">{og?.country}</span></td>
                  <td className="td mono text-sm">{one(o.suppliers as unknown as { code: string } | null)?.code}</td>
                  <td className="td"><Money cents={o.total_cents} currency={o.currency} /></td>
                  <td className="td text-sm">{o.incoterm ?? '—'}</td>
                  <td className="td text-sm">{fmtDate(o.updated_at)}</td>
                  <td className="td text-right"><Link className="btn btn-primary btn-sm" href={`/office/shipping?order=${o.id}`}>Create shipment</Link></td>
                </tr>
              );
            })}
          </Table>
        </Card>
      )}

      {exceptions.length > 0 && (
        <Card className="mb-6 border-bad/50" title={`Exceptions · ${exceptions.length}`}>
          <ul className="px-6 pb-6 space-y-2">
            {exceptions.map((x) => {
              const last = ((x.tracking_events ?? []) as { status: string; description: string | null; occurred_at: string }[]).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))[0];
              return (
                <li key={x.id} className="flex flex-wrap items-center gap-3 rounded-[10px] border border-bad/40 bg-[#FDF6F6] px-4 py-3 text-sm">
                  <StatusBadge status="exception" />
                  <span className="mono font-semibold">{x.tracking_no}</span>
                  <Link href={`/office/orders/${one(x.orders as unknown as { id: string } | null)?.id}`} className="mono text-blue">{one(x.orders as unknown as { code: string } | null)?.code}</Link>
                  <span className="text-muted">{last?.description ?? ''} · {fmtDate(x.last_event_at, true)}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card title="Shipments">
        <Table head={['Shipment', 'Order', 'Waybill', 'Service', 'Rate', 'Last event', 'Status', '']} empty={<EmptyState title="No shipments yet" />}>
          {(ships ?? []).map((x) => {
            const ev = ((x.tracking_events ?? []) as { status: string; description: string | null; occurred_at: string }[]).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))[0];
            const ord = one(x.orders as unknown as { id: string; code: string } | null);
            const final = ['delivered', 'returned'].includes(x.status);
            return (
              <tr key={x.id}>
                <td className="td mono text-sm">{x.code}</td>
                <td className="td mono text-sm"><Link href={`/office/orders/${ord?.id}`} className="text-blue">{ord?.code}</Link></td>
                <td className="td mono text-sm">{x.tracking_no ?? '—'}</td>
                <td className="td text-sm">{x.service_code ?? '—'}</td>
                <td className="td"><Money cents={x.rate_cents} currency={x.currency} /></td>
                <td className="td text-sm"><div>{ev?.description ?? '—'}</div><div className="text-xs text-muted">{fmtDate(x.last_event_at ?? x.created_at, true)}</div></td>
                <td className="td"><StatusBadge status={x.status} /></td>
                <td className="td">
                  <div className="flex flex-wrap gap-2 justify-end">
                    {x.label_url && <a href={x.label_url} target="_blank" rel="noopener" className="btn btn-ghost btn-sm">Label</a>}
                    {carrier.mode === 'sandbox' && canEdit && !final && <>
                      <RunButton action={simulateTracking.bind(null, x.id, 'next')}>Simulate event</RunButton>
                      {x.status !== 'exception' && <RunButton className="btn btn-ghost btn-sm text-bad" action={simulateTracking.bind(null, x.id, 'exception')}>Exception</RunButton>}
                    </>}
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
        {carrier.mode === 'sandbox' && <p className="px-6 py-3 text-xs text-muted border-t border-line">Sandbox: “Simulate event” appends the next tracking event (picked up → in transit → out for delivery → delivered). Live mode uses YunExpress webhooks with an hourly cron fallback.</p>}
      </Card>
    </>
  );
}
