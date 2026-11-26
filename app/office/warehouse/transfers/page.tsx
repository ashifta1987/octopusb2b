import { Suspense } from 'react';
import { DsSkeleton } from '@/components/dropship-ui';
import { requireWarehouseStaff } from '@/lib/warehouse';
import { createClient } from '@/lib/supabase/server';
import type { TransfersBoard } from '@/lib/warehouse-putaway';
import { WhHeader } from '../wh-header';
import { TransfersClient } from './transfers-client';

export const metadata = { title: 'Transfers · Warehouse' };

/** Warehouse OS (amendment: several China warehouses) — move stock between warehouses: Draft → In transit → Received. */
async function Content() {
  const access = await requireWarehouseStaff('/office/warehouse/transfers');
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_transfers_board', { p_warehouse: access.current?.code ?? null });
  if (error) throw new Error(`Could not load transfers: ${error.message}`);
  return (
    <div className="flex flex-col gap-5" data-testid="wh-transfers-page">
      <WhHeader access={access} title="Transfers" icon="send"
        subtitle={`${access.current ? access.current.name : 'All warehouses'} · stock leaves the origin’s bins and stock on dispatch and arrives as new lots, ready to put away, on receipt.`} />
      <TransfersClient board={data as TransfersBoard} current={access.current?.code ?? null}
        warehouseNames={Object.fromEntries(access.warehouses.map((w) => [w.code, w.name]))} />
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}><Content /></Suspense>;
}
