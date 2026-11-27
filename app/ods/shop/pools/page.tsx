import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { nowIso } from '@/lib/core/account';
import { getShopViewer } from '@/lib/shop/data';
import { getStoreContent } from '@/components/store/currency';
import { listOpenPools } from '@/components/store/data';
import { resolveCategory } from '../_lib/loaders';
import { toPoolCard, type PoolCardModel } from '../_lib/cards';
import { groupPools, parsePoolFilter, parsePoolSort, poolsListHref, toPoolRow, toPoolView, type PoolFilter, type PoolView } from './_lib/pool-logic';
import { loadFilledPools, loadMyPools } from './_lib/loaders';
import { PoolsListSkeleton, PoolsListView } from './_components/pools-list-view';

export const metadata: Metadata = { title: 'MOQ pools', robots: { index: false, follow: false } };

type SP = Promise<{ status?: string; sort?: string; category?: string }>;

/** ODS T4 · /shop/pools (proxy rewrite of the public URL when the Shop + ODS switches are on). */
export default function ShopPoolsPage({ searchParams }: { searchParams: SP }) {
  return (
    <div className="mx-auto w-full max-w-ods-content px-ods-pad-page py-6">
      <Suspense fallback={<PoolsListSkeleton />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function settle<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

async function Content({ searchParams }: { searchParams: SP }) {
  const [sp, viewer, { settings }] = await Promise.all([searchParams, getShopViewer(), getStoreContent()]);
  if (settings.pool_enabled === false) notFound();
  await connection();
  const now = Date.parse(nowIso());
  const status = parsePoolFilter(sp.status);
  const sort = parsePoolSort(sp.sort);
  const cat = sp.category ? await resolveCategory(sp.category) : null;

  // each list loads on its own; a failure only blanks its own pill count and grid
  const [open, filled, mine] = await Promise.all([
    settle(listOpenPools({ sort, limit: 96, categoryIds: cat?.ids }).then((l) => l.items.map(toPoolView))),
    settle(loadFilledPools(sort)),
    settle(loadMyPools(viewer.org.id, sort)),
  ]);
  const groups = groupPools(open ?? [], filled ?? [], mine ?? [], now);
  const failed: Record<PoolFilter, boolean> = { open: !open, 'closing-soon': !open, 'almost-full': !open, filled: !filled, mine: !mine };
  const counts = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, failed[k as PoolFilter] ? null : v.length])) as Record<PoolFilter, number | null>;
  const toCards = (list: PoolView[]) => list.map((v) => toPoolCard(toPoolRow(v), { now })).filter((c): c is PoolCardModel => c !== null);

  return (
    <PoolsListView
      status={status}
      sort={sort}
      category={cat?.slug ?? null}
      counts={counts}
      items={toCards(groups[status])}
      error={failed[status]}
      retryHref={poolsListHref({ status, sort, category: cat?.slug })}
    />
  );
}
