import { Suspense } from 'react';
import { DsSkeleton } from '@/components/dropship-ui';
import { requireWarehouseStaff } from '@/lib/warehouse';
import { createClient } from '@/lib/supabase/server';
import { signLabels } from '@/lib/warehouse-labels';
import type { DispatchBoard } from '@/lib/warehouse-w4';
import { WhHeader } from '../wh-header';
import { DispatchClient } from './dispatch-client';

export const metadata = { title: 'Dispatch and freight · Warehouse' };

/**
 * Warehouse OS board 13 + §3 step 10 — label and hand over: rules choose the carrier service, the label is made and printed,
 * the label on the parcel is scanned to confirm it belongs to the order, checked labels go into a hand-over batch per carrier
 * (manifest), client orders can ship on a freight pallet instead, and tracking is kept until delivery.
 */
async function Content() {
  const access = await requireWarehouseStaff('/office/warehouse/dispatch');
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_dispatch_board', { p_warehouse: access.current?.code ?? null });
  if (error) throw new Error(`Could not load dispatch: ${error.message}`);
  const board = data as DispatchBoard;
  const paths = [
    ...board.orders.flatMap((o) => o.parcels.map((p) => p.label?.label_path).filter((x): x is string => Boolean(x))),
    ...board.ready.map((l) => l.label_path),
  ];
  const urls = Object.fromEntries(await signLabels(sb, paths));
  return (
    <div className="flex flex-col gap-5" data-testid="wh-dispatch-page">
      <div className="print:hidden">
        <WhHeader access={access} title="Dispatch and freight" icon="truck"
          subtitle={`${access.current ? access.current.name : 'All warehouses'} · label packed parcels, check each label against its order, hand over to the carrier with a manifest, or build a freight pallet.`} />
      </div>
      <DispatchClient board={board} labelUrls={urls} warehouseNames={Object.fromEntries(access.warehouses.map((w) => [w.code, w.name]))}
        cities={Object.fromEntries(access.warehouses.map((w) => [w.code, w.city]))} />
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}><Content /></Suspense>;
}
