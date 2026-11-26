import { Suspense } from 'react';
import { DsSkeleton } from '@/components/dropship-ui';
import { requireWarehouseStaff } from '@/lib/warehouse';
import { createClient } from '@/lib/supabase/server';
import { WhHeader } from '../wh-header';
import { CountsClient, type CountsBoard } from './counts-client';

export const metadata = { title: 'Counts and lots · Warehouse' };

/** Warehouse OS board 16 — recounts, blocked lots (supervisor approval, never by the second counter), serial scanning. */
async function Content() {
  const access = await requireWarehouseStaff('/office/warehouse/counts');
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_counts_board', { p_warehouse: access.current?.code ?? null });
  if (error) throw new Error(`Could not load counts: ${error.message}`);
  return (
    <div className="flex flex-col gap-5" data-testid="wh-counts-page">
      <WhHeader access={access} title="Counts and lots" icon="list"
        subtitle={`${access.current ? access.current.name : 'All warehouses'} · a count that differs is recounted; a lot with a difference stays blocked until a supervisor approves.`} />
      <CountsClient board={data as CountsBoard} />
    </div>
  );
}

export default function Page() {
  return <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}><Content /></Suspense>;
}
