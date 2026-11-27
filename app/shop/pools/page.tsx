import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getStoreContent } from '@/components/store/currency';
import { listOpenPools } from '@/components/store/data';
import { PoolGrid } from '@/components/store/pools/pool-card';
import { EmptyState } from '@/components/ui';
import { RailSkeleton } from '@/components/shop/rails';

export const metadata: Metadata = { title: 'MOQ pools', alternates: { canonical: '/pools' } };

/** CH-1 /shop/pools: open MOQ pools (same listOpenPools + PoolGrid as /pools), inside the shop shell. Joining = the existing /pool/[code] flow. */
export default function ShopPools() {
  return <Suspense fallback={<RailSkeleton title="MOQ pools" n={3} />}><Content /></Suspense>;
}

async function Content() {
  const [{ settings, categories }, list] = await Promise.all([getStoreContent(), listOpenPools({ limit: 48 })]);
  if (settings.pool_enabled === false) notFound();
  const names = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  return (
    <div className="max-w-[1240px] mx-auto px-4 sm:px-6 py-6">
      <h1 className="m-0 text-[28px] sm:text-[34px] font-bold">MOQ pools: buy together</h1>
      <p className="m-0 mt-1 text-[15px] text-black">Join other buyers to reach the factory minimum and pay the bulk price. {list.total} open now.</p>
      <div className="mt-6">
        {list.items.length === 0
          ? <div className="card"><EmptyState title="No open pools right now" body="Start one from any product page: other buyers join and you pay only for your share." action={<Link href="/shop/products?pool=1" className="btn btn-ghost">Browse products</Link>} /></div>
          : <PoolGrid pools={list.items} categoryNames={names} />}
      </div>
    </div>
  );
}
