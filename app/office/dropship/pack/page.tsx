import { Suspense } from 'react';
import { requireDropshipV2Staff } from '@/lib/dropship-staff';
import { handOffToWarehouseOs } from '@/lib/warehouse-retire-server';
import { WH_PACK_PATH } from '@/lib/warehouse-retire';
import { MovedToWarehouseOs } from '../moved-to-warehouse';

export const metadata = { title: 'Pack station · Back office' };

/** W7 (owner, 26 Nov 2026): the old placeholder is gone — packing happens at the Warehouse OS packing station. */
async function Guarded() {
  await requireDropshipV2Staff(false, '/office/dropship/pack');
  await handOffToWarehouseOs(WH_PACK_PATH);
  return <MovedToWarehouseOs title="Pack station" icon="scale" what="Packing" />;
}

export default function Page() {
  return (
    <Suspense fallback={<div className="ds-card">Loading…</div>}>
      <Guarded />
    </Suspense>
  );
}
