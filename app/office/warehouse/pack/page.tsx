import { Suspense } from 'react';
import { DsSkeleton } from '@/components/dropship-ui';
import { requireWarehouseStaff } from '@/lib/warehouse';
import { createClient } from '@/lib/supabase/server';
import { signEvidence } from '@/lib/warehouse-evidence';
import type { OrderDetail, PackBoard } from '@/lib/warehouse-orders';
import type { PackExtras } from '@/lib/warehouse-w3b';
import { WhHeader } from '../wh-header';
import { PackClient } from './pack-client';

export const metadata = { title: 'Packing station · Warehouse' };

/**
 * Warehouse OS board 2 — packing station: scan every item, choose the box, photos, weigh. A weight outside tolerance needs a
 * supervisor PIN with a reason (3 wrong PINs lock it); dangerous goods need the battery mark. Settings, boxes and the PIN below.
 * W3b: the reading names a checked scale bench (once the warehouse has benches); extra packaging is recorded; orders that need
 * several boxes go to Multi-parcel packing.
 */
async function Content({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const access = await requireWarehouseStaff('/office/warehouse/pack');
  const sp = await searchParams;
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_pack_board', { p_warehouse: access.current?.code ?? null });
  if (error) throw new Error(`Could not load the packing station: ${error.message}`);
  let detail: OrderDetail | null = null;
  let extras: PackExtras | null = null;
  const ref = (sp.order ?? '').trim().toUpperCase();
  if (/^WO-\d{6,}$/.test(ref)) {
    const r = await sb.rpc('wh_order_detail', { p_ref: ref });
    if (!r.error) {
      detail = r.data as OrderDetail;
      const urls = await signEvidence(sb, detail.evidence.map((e) => e.path));
      detail.evidence = detail.evidence.map((e) => ({ ...e, url: urls.get(e.path) ?? null }));
      // W3b: scale benches, packaging materials used and whether the order is packed in parcels
      const x = await sb.rpc('wh_pack_extras', { p_order: detail.order.id });
      if (x.error) throw new Error(`Could not load the station extras: ${x.error.message}`);
      extras = x.data as PackExtras;
    }
  }
  return (
    <div className="flex flex-col gap-4" data-testid="wh-pack-page">
      <WhHeader access={access} title="Packing station" icon="package"
        subtitle={`${access.current ? access.current.name : 'All warehouses'} · scan every item, choose the box, take the photos, weigh, close.`} />
      <PackClient board={data as PackBoard} detail={detail} extras={extras} />
    </div>
  );
}

export default function Page(props: { searchParams: Promise<{ order?: string }> }) {
  return <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}><Content {...props} /></Suspense>;
}
