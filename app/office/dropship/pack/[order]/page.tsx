import { Suspense } from 'react';
import { requireDropshipV2Staff } from '@/lib/dropship-staff';
import { handOffToWarehouseOs, resolveDropshipPackTarget } from '@/lib/warehouse-retire-server';
import { MovedToWarehouseOs } from '../../moved-to-warehouse';

export const metadata = { title: 'Pack station · Back office' };

/**
 * W7 (owner, 26 Nov 2026): the old placeholder is gone — the order opens in Warehouse OS (WO code, store order id or DSO
 * number → that warehouse order; otherwise the Dropship orders list searched by the number).
 */
async function Guarded({ params }: { params: Promise<{ order: string }> }) {
  await requireDropshipV2Staff(false, '/office/dropship/pack');
  const { order } = await params;
  await handOffToWarehouseOs(() => resolveDropshipPackTarget(order));
  return <MovedToWarehouseOs title="Pack station" icon="scale" what="Packing" />;
}

export default function Page(props: { params: Promise<{ order: string }> }) {
  return (
    <Suspense fallback={<div className="ds-card">Loading…</div>}>
      <Guarded params={props.params} />
    </Suspense>
  );
}
