import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { isDropshipV2UiEnabled } from '@/lib/dropship';
import { createClient } from '@/lib/supabase/server';
import { DsPageHeader } from '@/components/dropship-ui';
import { dsInter } from '@/components/dropship-ui/font';

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

async function Guarded({ params }: { params: Promise<{ token: string }> }) {
  if (!(await isDropshipV2UiEnabled())) {
    notFound();
  }

  const { token } = await params;
  const sb = await createClient();
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
