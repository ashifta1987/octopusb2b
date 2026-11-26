import { Suspense } from 'react';
import { DsEmptyState, DsSkeleton } from '@/components/dropship-ui';
import { requireWarehouseStaff } from '@/lib/warehouse';
import { createClient } from '@/lib/supabase/server';
import type { MaterialsBoard } from '@/lib/warehouse-w3b';
import { WhHeader } from '../wh-header';
import { MaterialsClient } from './materials-client';

export const metadata = { title: 'Materials · Warehouse' };

/**
 * Warehouse OS board 12 — packaging materials: boxes, mailers, tape and marks as stock per warehouse, charged by use. Boxes used at
 * the packing station can be stocked here (each parcel closed in one takes it from stock), one battery mark can be used
 * automatically for dangerous-goods parcels; receive, count, low-stock alert, price per unit (warehouse admin; not set = empty).
 */
async function Content() {
  const access = await requireWarehouseStaff('/office/warehouse/materials');
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_materials_board', { p_warehouse: access.current?.code ?? null });
  if (error) throw new Error(`Could not load materials: ${error.message}`);
  const board = data as MaterialsBoard;
  return (
    <div className="flex flex-col gap-5" data-testid="wh-materials-page">
      <WhHeader access={access} title="Materials" icon="tag"
        subtitle={`${access.current ? access.current.name : 'All warehouses'} · boxes, mailers, tape and marks as stock, charged to the client by use.`} />
      {board.stations.length === 0
        ? <DsEmptyState icon="tag" title="No open warehouse" description="Materials are stocked per active warehouse." testId="wh-materials-none" />
        : board.stations.map((s) => <MaterialsClient key={s.warehouse_code} station={s} />)}
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}><Content /></Suspense>;
}
