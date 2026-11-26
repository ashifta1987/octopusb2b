import { Suspense } from 'react';
import Link from 'next/link';
import { DsCard, DsEmptyState, DsNotice, DsSkeleton } from '@/components/dropship-ui';
import { requireWarehouseStaff } from '@/lib/warehouse';
import { createClient } from '@/lib/supabase/server';
import { signEvidence } from '@/lib/warehouse-evidence';
import type { MultiParcel, MultiQueueRow } from '@/lib/warehouse-w3b';
import { WhHeader } from '../wh-header';
import { MultiParcelClient } from './multi-parcel-client';

export const metadata = { title: 'Multi-parcel packing · Warehouse' };

/**
 * Warehouse OS board 14 — multi-parcel packing: an order that ships in more than one parcel. Each parcel gets its items, box,
 * photos, a reading on a checked scale bench (supervisor PIN when outside tolerance) and the battery mark when it carries
 * dangerous goods; the order closes when every picked unit is in a closed parcel.
 */
async function Content({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const access = await requireWarehouseStaff('/office/warehouse/multi-parcel');
  const sp = await searchParams;
  const sb = await createClient();
  const q = await sb.rpc('wh_multi_parcel_queue', { p_warehouse: access.current?.code ?? null });
  if (q.error) throw new Error(`Could not load orders to pack: ${q.error.message}`);
  const queue = (q.data ?? []) as MultiQueueRow[];
  const ref = (sp.order ?? '').trim().toUpperCase();
  let detail: MultiParcel | null = null;
  let missing = false;
  if (/^WO-\d{6,}$/.test(ref)) {
    const r = await sb.rpc('wh_multi_parcel', { p_ref: ref });
    if (r.error) missing = true;
    else {
      detail = r.data as MultiParcel;
      const urls = await signEvidence(sb, detail.parcels.flatMap((p) => p.evidence.map((e) => e.path)));
      detail.parcels = detail.parcels.map((p) => ({ ...p, evidence: p.evidence.map((e) => ({ ...e, url: urls.get(e.path) ?? null })) }));
    }
  }
  return (
    <div className="flex flex-col gap-4" data-testid="wh-multi-page">
      <WhHeader access={access} title="Multi-parcel packing" icon="layers"
        subtitle={`${access.current ? access.current.name : 'All warehouses'} · split an order into parcels: items, box, photos and weight per parcel.`} />
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5 items-start">
        <DsCard title="Ready to pack" icon="list" testId="wh-multi-queue">
          {queue.length === 0 ? <p className="m-0 text-[13px] text-muted">Nothing to pack. Orders appear once they are fully picked.</p> : (
            <ul className="m-0 p-0 list-none flex flex-col gap-2">
              {queue.map((o) => (
                <li key={o.id}>
                  <Link href={`/office/warehouse/multi-parcel?order=${o.code}`} aria-current={detail?.order.code === o.code ? 'page' : undefined} data-testid={`wh-multi-open-${o.code}`}
                    className={`block rounded-[10px] border p-3 no-underline text-ink min-h-[44px] ${detail?.order.code === o.code ? 'border-coral-text bg-tint-2' : 'border-line hover:bg-pearl'}`}>
                    <span className="font-mono font-semibold">{o.code}</span>{' '}
                    <span className="text-[12.5px] text-muted">· {o.picked} unit(s){o.parcels ? ` · ${o.parcels} parcel(s)` : ''}{o.has_dangerous_goods ? ' · DG' : ''}</span>
                    <span className="block text-[12.5px] text-muted">{o.owner}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </DsCard>
        {detail ? <MultiParcelClient d={detail} />
          : missing ? <DsNotice tone="warn" title={`We couldn’t find order ${ref}`} testId="wh-multi-missing">Check the number, or choose an order from the list.</DsNotice>
            : <DsEmptyState icon="layers" title="Choose an order" description="Pick an order from the list. A one-box order is quicker at the packing station." testId="wh-multi-none" />}
      </div>
    </div>
  );
}

export default function Page(props: { searchParams: Promise<{ order?: string }> }) {
  return <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}><Content {...props} /></Suspense>;
}
