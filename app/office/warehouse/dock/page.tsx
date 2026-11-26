import { Suspense } from 'react';
import { DsSkeleton } from '@/components/dropship-ui';
import { requireWarehouseStaff } from '@/lib/warehouse';
import { createClient } from '@/lib/supabase/server';
import { WhHeader } from '../wh-header';
import { DockClient, type DockBoard } from './dock-client';

export const metadata = { title: 'Dock appointments · Warehouse' };

/** Warehouse OS board 15 — the day's slots per dock; book (double booking refused), check in, unload, finish. */
async function Content({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const access = await requireWarehouseStaff('/office/warehouse/dock');
  const sp = await searchParams;
  const day = sp.day && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : null;
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_dock_board', { p_warehouse: access.current?.code ?? null, p_day: day });
  if (error) throw new Error(`Could not load the dock: ${error.message}`);
  const bookable = access.warehouses.filter((w) => w.status === 'active' && ['receiver', 'supervisor', 'admin'].includes(w.role ?? ''))
    .filter((w) => !access.current || w.code === access.current.code);
  return (
    <div className="flex flex-col gap-5" data-testid="wh-dock-page">
      <WhHeader access={access} title="Dock appointments" icon="clock"
        subtitle={`${access.current ? access.current.name : 'All warehouses'} · Booked → Arrived → Unloading → Done. A slot with no stock notice cannot be checked in.`} />
      <DockClient board={data as DockBoard} bookable={bookable.map((w) => ({ code: w.code, name: w.name }))}
        warehouseNames={Object.fromEntries(access.warehouses.map((w) => [w.code, w.name]))} />
    </div>
  );
}

export default function Page(props: { searchParams: Promise<{ day?: string }> }) {
  return <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}><Content {...props} /></Suspense>;
}
