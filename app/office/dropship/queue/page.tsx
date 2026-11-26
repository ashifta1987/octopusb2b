import { Suspense } from 'react';
import { requireDropshipV2Staff } from '@/lib/dropship-staff';
import { handOffToWarehouseOs } from '@/lib/warehouse-retire-server';
import { dropshipQueueTarget } from '@/lib/warehouse-retire';
import { MovedToWarehouseOs } from '../moved-to-warehouse';

export const metadata = { title: 'Fulfilment queue · Back office' };

/** W7 (owner, 26 Nov 2026): the old placeholder is gone — Dropship orders are picked and packed from Warehouse OS Orders. */
async function Guarded({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireDropshipV2Staff(false, '/office/dropship/queue');
  await handOffToWarehouseOs(dropshipQueueTarget(await searchParams));
  return <MovedToWarehouseOs title="Fulfilment queue" icon="list" what="Picking, packing and shipping of Dropship orders" />;
}

export default function Page(props: { searchParams: Promise<{ status?: string }> }) {
  return (
    <Suspense fallback={<div className="ds-card">Loading…</div>}>
      <Guarded searchParams={props.searchParams} />
    </Suspense>
  );
}
