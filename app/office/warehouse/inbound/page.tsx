import { Suspense } from 'react';
import { DsSkeleton } from '@/components/dropship-ui';
import { requireWarehouseStaff } from '@/lib/warehouse';
import { createClient } from '@/lib/supabase/server';
import type { AsnRow } from '@/lib/warehouse-inbound';
import { WhHeader } from '../wh-header';
import { InboundClient } from './inbound-client';

export const metadata = { title: 'Inbound · Warehouse' };

/** Warehouse OS — stock notices (ASN) by status for the chosen warehouse; open one to receive it (board 5). */
async function Content() {
  const access = await requireWarehouseStaff('/office/warehouse/inbound');
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_list_asns', { p_warehouse: access.current?.code ?? null });
  if (error) throw new Error(`Could not load stock notices: ${error.message}`);
  return (
    <div className="flex flex-col gap-5" data-testid="wh-inbound-page">
      <WhHeader access={access} title="Inbound" icon="download"
        subtitle={`${access.current ? access.current.name : 'All warehouses'} · stock notices from clients and Octopus. No notice, no check-in at the dock.`} />
      <InboundClient asns={(data ?? []) as AsnRow[]} warehouseNames={Object.fromEntries(access.warehouses.map((w) => [w.code, w.name]))} />
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}><Content /></Suspense>;
}
