import { Suspense } from 'react';
import { DsSkeleton } from '@/components/dropship-ui';
import { requireWarehouseStaff } from '@/lib/warehouse';
import { createClient } from '@/lib/supabase/server';
import { credentialsPresent } from '@/lib/carriers';
import type { CarriersBoard } from '@/lib/warehouse-w4';
import { WhHeader } from '../wh-header';
import { CarriersClient } from './carriers-client';

export const metadata = { title: 'Carriers and rules · Warehouse' };

/**
 * Warehouse OS board 9 — carriers and rules: carrier accounts (YunExpress, 4PX; sandbox on staging only, live with server
 * credentials) and their services per warehouse; ordered rules that pick the service by country, product type (dangerous goods)
 * and weight, with a fallback. A warehouse admin proposes a version; a DIFFERENT admin approves it (D7).
 */
async function Content() {
  const access = await requireWarehouseStaff('/office/warehouse/carriers');
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_carriers_board', { p_warehouse: access.current?.code ?? null });
  if (error) throw new Error(`Could not load carriers: ${error.message}`);
  const board = data as CarriersBoard;
  // whether each account's credentials exist on THIS server (names only; values are never read out or sent to the browser)
  const credentials: Record<string, boolean> = {};
  for (const st of board.stations) for (const a of st.accounts) credentials[a.id] = credentialsPresent({ carrier: a.carrier, mode: a.mode, credentialEnv: a.credential_env });
  return (
    <div className="flex flex-col gap-5" data-testid="wh-carriers-page">
      <WhHeader access={access} title="Carriers and rules" icon="globe"
        subtitle={`${access.current ? access.current.name : 'All warehouses'} · rules pick the YunExpress or 4PX service by country, product type and weight, with a fallback. A second admin approves every change.`} />
      <CarriersClient board={board} credentials={credentials} />
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}><Content /></Suspense>;
}
