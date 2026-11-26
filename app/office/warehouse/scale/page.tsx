import { Suspense } from 'react';
import { DsEmptyState, DsSkeleton } from '@/components/dropship-ui';
import { requireWarehouseStaff } from '@/lib/warehouse';
import { createClient } from '@/lib/supabase/server';
import type { ScaleBoard } from '@/lib/warehouse-w3b';
import { WhHeader } from '../wh-header';
import { ScaleClient } from './scale-client';

export const metadata = { title: 'Scale check · Warehouse' };

/**
 * Warehouse OS board 17 — scale check: per-bench calibration reads (reference weight vs reading, tolerance). A failed bench is
 * locked until it passes; only a passing check unlocks (after a failed check, a supervisor runs it). Packing stations weigh only
 * on a checked bench.
 */
async function Content() {
  const access = await requireWarehouseStaff('/office/warehouse/scale');
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_scale_board', { p_warehouse: access.current?.code ?? null });
  if (error) throw new Error(`Could not load the scale benches: ${error.message}`);
  const board = data as ScaleBoard;
  return (
    <div className="flex flex-col gap-5" data-testid="wh-scale-page">
      <WhHeader access={access} title="Scale check" icon="scale"
        subtitle={`${access.current ? access.current.name : 'All warehouses'} · weigh a reference weight on each bench. A failed bench is locked until it passes.`} />
      {board.stations.length === 0
        ? <DsEmptyState icon="scale" title="No open warehouse" description="Scale benches belong to an active warehouse." testId="wh-scale-none" />
        : board.stations.map((s) => <ScaleClient key={s.warehouse_code} station={s} />)}
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}><Content /></Suspense>;
}
