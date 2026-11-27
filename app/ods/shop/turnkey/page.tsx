import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTurnkeyCatalogue } from '@/lib/turnkey/catalogue';
import { toTurnkeyCard } from '../_lib/cards';
import { getShopViewer } from '@/lib/shop/data';
import { turnkeyEnabled } from './_lib/loaders';
import { TurnkeyListView } from './_components/turnkey-list-view';
import { PoolsListSkeleton } from '../pools/_components/pools-list-view';

export const metadata: Metadata = { title: 'Turnkey projects', robots: { index: false, follow: false } };

type SP = Promise<{ page?: string }>;
const PER = 24;

/** ODS T4 · /shop/turnkey: ready projects from today's catalogue (TurnkeyCards), 24 per page. */
export default function ShopTurnkeyPage({ searchParams }: { searchParams: SP }) {
  return (
    <div className="mx-auto w-full max-w-ods-content px-ods-pad-page py-6">
      <Suspense fallback={<PoolsListSkeleton />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  const [sp] = await Promise.all([searchParams, getShopViewer()]);
  if (!(await turnkeyEnabled())) notFound();
  let projects: Awaited<ReturnType<typeof getTurnkeyCatalogue>>['projects'] | null = null;
  try {
    ({ projects } = await getTurnkeyCatalogue());
  } catch {
    projects = null;
  }
  const all = projects ?? [];
  const pages = Math.max(1, Math.ceil(all.length / PER));
  const page = Math.min(pages, Math.max(1, Number(sp.page) || 1));
  const sb = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const items = all.slice((page - 1) * PER, page * PER).map((p) => toTurnkeyCard(p, { supabaseUrl: sb }));
  return <TurnkeyListView items={items} total={all.length} page={page} pages={pages} error={!projects} />;
}
