import { Suspense } from 'react';
import { DsLinkButton, DsSkeleton } from '@/components/dropship-ui';
import { requireWarehouseStaff } from '@/lib/warehouse';
import { createClient } from '@/lib/supabase/server';
import type { PutawayBoard } from '@/lib/warehouse-putaway';
import { WhHeader } from '../wh-header';
import { PutawayClient } from './putaway-client';

export const metadata = { title: 'Putaway and pallets · Warehouse' };

/** Warehouse OS board 10 — released lots by source and owner, put away to rack-row-bin, pallets, bin occupancy, moves. */
async function Content() {
  const access = await requireWarehouseStaff('/office/warehouse/putaway');
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_putaway_board', { p_warehouse: access.current?.code ?? null });
  if (error) throw new Error(`Could not load putaway: ${error.message}`);
  return (
    <div className="flex flex-col gap-5" data-testid="wh-putaway-page">
      <WhHeader access={access} title="Putaway and pallets" icon="box"
        subtitle={`${access.current ? access.current.name : 'All warehouses'} · put released lots into a rack, row and bin. Putaway changes where stock is, never how much is on hand.`}
        actions={<DsLinkButton href="/office/warehouse/putaway/bins" variant="secondary" icon="grid" testId="wh-manage-bins">Manage bins</DsLinkButton>} />
      <PutawayClient board={data as PutawayBoard}
        warehouseNames={Object.fromEntries(access.warehouses.map((w) => [w.code, w.name]))} current={access.current?.code ?? null} />
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}><Content /></Suspense>;
}
