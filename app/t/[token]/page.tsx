import { Suspense, type ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { isDropshipV2UiEnabled } from '@/lib/dropship';
import { createClient } from '@/lib/supabase/server';
import { isStaging } from '@/lib/core/account';
import { COUNTRY_NAMES } from '@/lib/format';
import type { PublicTracking } from '@/lib/warehouse-w4';
import { DsPageHeader } from '@/components/dropship-ui';
import { dsInter } from '@/components/dropship-ui/font';
import { BrandBlock } from './brand-block';

export const metadata = {
  title: 'Track your parcel',
  robots: { index: false, follow: false },
};

type PublicTrackingEvent = {
  status: string;
  description: string | null;
  location: string | null;
  occurred_at: string;
};

type PublicTrackingPayload = {
  order_ref: string;
  seller_name: string;
  destination_country: string;
  tracking_no: string | null;
  status: string;
  status_label: string;
  eta: string | null;
  last_event_at: string | null;
  events: PublicTrackingEvent[];
};

const utc = (ts: string) => `${new Date(ts).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
const country = (c: string) => COUNTRY_NAMES[c] ?? c;
const PARCEL_STATUS: Record<string, string> = {
  handed_over: 'Shipped', in_transit: 'In transit', out_for_delivery: 'Out for delivery', delivered: 'Delivered', exception: 'Delivery problem', returned: 'Returned',
};

/**
 * Warehouse OS · W4 board 7 — what the end customer sees for an order shipped from an Octopus warehouse: order reference,
 * "Packed and shipped from {warehouse city}", tracking numbers and events. White-label: no carrier, supplier, merchant or store
 * name. Sandbox (staging) shipments say so and are never served on live.
 */
function WarehouseTracking({ t, brand }: { t: PublicTracking; brand?: ReactNode }) {
  const from = `${t.shipped_from_city}, ${country(t.shipped_from_country)}`;
  const numbered = t.parcels.filter((p) => p.tracking_no);
  return (
    <div className={`${dsInter.variable} ds-v2 min-h-screen p-6`} data-testid="public-warehouse-tracking">
      <div className="max-w-[760px] mx-auto space-y-6">
        <DsPageHeader title="Track your order" subtitle={`Order ${t.order_ref}`} icon="truck" />
        {brand}

        {t.sandbox && (
          <p role="note" className="m-0 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-900" data-testid="tracking-sandbox">
            SANDBOX · this is a test shipment on the staging site. It is not a real parcel and no carrier has it.
          </p>
        )}

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4" aria-labelledby="trk-status">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="trk-status" className="text-xs font-medium uppercase tracking-wide text-slate-600 m-0">Current status</h2>
              <div className="text-lg font-semibold text-slate-900 mt-0.5" data-testid="tracking-status-label">{t.status_label}</div>
            </div>
            <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
              Destination: {country(t.destination_country)}
            </span>
          </div>
          <p className="m-0 text-sm text-slate-800" data-testid="tracking-shipped-from">
            Packed and shipped from {from}{t.shipped_at ? ` on ${utc(t.shipped_at).slice(0, 10)}` : ''}{t.freight ? ' as freight' : ''}.
          </p>
          {numbered.length > 0 && (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-slate-100 text-sm m-0">
              {numbered.map((p) => (
                <div key={p.seq}>
                  <dt className="text-slate-600">{t.parcels.length > 1 ? `Parcel ${p.seq} tracking number` : 'Tracking number'}</dt>
                  <dd className="font-mono font-medium text-slate-900 mt-0.5 ml-0" data-testid={`tracking-number-${p.seq}`}>
                    {p.tracking_no}{t.parcels.length > 1 && p.status ? <span className="font-sans text-slate-600"> · {PARCEL_STATUS[p.status] ?? p.status}</span> : null}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3" aria-labelledby="trk-events">
          <h2 id="trk-events" className="text-sm font-semibold text-slate-900 m-0">Delivery updates</h2>
          {t.events.length === 0 ? (
            <p className="text-sm text-slate-600 m-0">Shipped. Scans appear here as the parcel moves.</p>
          ) : (
            <ol className="space-y-3 list-none m-0 p-0" data-testid="tracking-events-list">
              {t.events.map((ev, idx) => (
                <li key={`${ev.occurred_at}-${idx}`} className="border-l-2 border-slate-200 pl-3 py-0.5">
                  <div className="text-sm font-medium text-slate-900">{ev.description}{t.parcels.length > 1 && ev.parcel ? ` (parcel ${ev.parcel})` : ''}</div>
                  <div className="text-xs text-slate-600 mt-0.5">{ev.location ? `${ev.location} · ` : ''}{utc(ev.occurred_at)}</div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}

async function Guarded({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const sb = await createClient();

  // W4: orders shipped from a Warehouse OS warehouse (3PL client orders and Octopus Dropship orders handed over by the warehouse)
  const wh = await sb.rpc('wh_public_tracking', { p_token: token });
  if (!wh.error && wh.data) {
    const t = wh.data as PublicTracking;
    if (t.sandbox && !isStaging()) notFound(); // never present a test shipment as real outside staging
    return <WarehouseTracking t={t} brand={<BrandBlock token={token} />} />;
  }

  if (!(await isDropshipV2UiEnabled())) {
    notFound();
  }

  const { data, error } = await sb.rpc('get_public_dropship_tracking', {
    p_token: token,
  });

  if (error || !data) {
    notFound();
  }

  const t = data as PublicTrackingPayload;

  return (
    <div className={`${dsInter.variable} ds-v2 min-h-screen p-6`} data-testid="public-dropship-tracking">
      <div className="max-w-[760px] mx-auto space-y-6">
        <DsPageHeader
          title="Track your parcel"
          subtitle={`${t.seller_name} · Order ${t.order_ref}`}
          icon="truck"
        />
        <BrandBlock token={token} />

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Current status</div>
              <div className="text-lg font-semibold text-slate-900 mt-0.5" data-testid="tracking-status-label">
                {t.status_label}
              </div>
            </div>
            <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
              Destination: {t.destination_country}
            </span>
          </div>

          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-slate-100 text-sm">
            <div>
              <dt className="text-slate-500">Tracking number</dt>
              <dd className="font-mono font-medium text-slate-900 mt-0.5" data-testid="tracking-number">
                {t.tracking_no ?? 'Assigned at dispatch'}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Estimated delivery</dt>
              <dd className="font-medium text-slate-900 mt-0.5">
                {t.eta ?? 'Updating once in transit'}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-900">Delivery updates</h2>
          {t.events.length === 0 ? (
            <p className="text-sm text-slate-500">Parcel prepared. Scans will appear once handed to the carrier.</p>
          ) : (
            <ol className="space-y-3" data-testid="tracking-events-list">
              {t.events.map((ev, idx) => (
                <li key={`${ev.occurred_at}-${idx}`} className="border-l-2 border-slate-200 pl-3 py-0.5">
                  <div className="text-sm font-medium text-slate-900">{ev.description || ev.status}</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {ev.location ? `${ev.location} · ` : ''}
                    {new Date(ev.occurred_at).toISOString().slice(0, 16).replace('T', ' ')} UTC
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}

export default function Page({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Suspense fallback={<div className={`${dsInter.variable} ds-v2 min-h-screen p-6`}>Loading…</div>}>
      <Guarded params={params} />
    </Suspense>
  );
}
