import { Suspense } from 'react';
import { DsSkeleton } from '@/components/dropship-ui';
import { requireWarehouseStaff } from '@/lib/warehouse';
import { createClient } from '@/lib/supabase/server';
import type { OrderDetail, PickBoard } from '@/lib/warehouse-orders';
import { WhHeader } from '../wh-header';
import { PickClient } from './pick-client';

export const metadata = { title: 'Picking · Warehouse' };

/** Warehouse OS board 6 — handheld picking: choose an order, scan the bin and the product; FIFO by lot; short pick → exception. */
async function Content({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const access = await requireWarehouseStaff('/office/warehouse/pick');
  const sp = await searchParams;
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_pick_board', { p_warehouse: access.current?.code ?? null });
  if (error) throw new Error(`Could not load picking: ${error.message}`);
  let detail: OrderDetail | null = null;
  const ref = (sp.order ?? '').trim().toUpperCase();
  if (/^WO-\d{6,}$/.test(ref)) {
    const r = await sb.rpc('wh_order_detail', { p_ref: ref });
    if (!r.error) detail = r.data as OrderDetail;
  }
  return (
    <div className="flex flex-col gap-4" data-testid="wh-pick-page">
      <WhHeader access={access} title="Picking" icon="list"
        subtitle={`${access.current ? access.current.name : 'All warehouses'} · scan the bin, then the product. Oldest lot first.`} />
      <PickClient board={data as PickBoard} detail={detail} />
    </div>
  );
}

export default function Page(props: { searchParams: Promise<{ order?: string }> }) {
  return <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}><Content {...props} /></Suspense>;
}
