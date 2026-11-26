import { Suspense } from 'react';
import { DsSkeleton } from '@/components/dropship-ui';
import { requireWarehouseStaff } from '@/lib/warehouse';
import { createClient } from '@/lib/supabase/server';
import { signReturnPhotos } from '@/lib/warehouse-media';
import type { ReturnsBoard } from '@/lib/warehouse-w5';
import { WhHeader } from '../wh-header';
import { ReturnsClient } from './returns-client';

export const metadata = { title: 'Returns · Warehouse' };

/**
 * Warehouse OS · W5 Returns (§3 step 11, portal board 21's staff side): register a return that arrived, photograph and grade it,
 * then carry out the client's decision — restock (released lot for putaway), discard, or send back (an order straight to packing).
 * A supervisor applies the default when the client has not decided by the date.
 */
async function Content({ searchParams }: { searchParams: Promise<{ status?: string; r?: string }> }) {
  const access = await requireWarehouseStaff('/office/warehouse/returns');
  const sp = await searchParams;
  const status = ['open', 'done', 'all'].includes(sp.status ?? '') ? sp.status! : 'open';
  const sb = await createClient();
  const { data, error } = await sb.rpc('wh_returns_board', { p_warehouse: access.current?.code ?? null, p_status: status });
  if (error) throw new Error(`Could not load returns: ${error.message}`);
  const board = data as ReturnsBoard;
  const urls = await signReturnPhotos(sb, board.returns.flatMap((r) => r.photos.map((p) => p.path)));
  board.returns = board.returns.map((r) => ({ ...r, photos: r.photos.map((p) => ({ ...p, url: urls.get(p.path) ?? null })) }));
  return (
    <div className="flex flex-col gap-5" data-testid="wh-returns-page">
      <WhHeader access={access} title="Returns" icon="refresh"
        subtitle={`${access.current ? access.current.name : 'All warehouses'} · register returned parcels, photograph and grade them; the client decides restock, discard or send back.`} />
      <ReturnsClient board={board} status={status} focus={(sp.r ?? '').toUpperCase()} />
    </div>
  );
}

export default function Page(props: { searchParams: Promise<{ status?: string; r?: string }> }) {
  return <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}><Content {...props} /></Suspense>;
}
