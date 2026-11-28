import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { nowIso } from '@/lib/core/account';
import { Skeleton } from '@octopus/ui';
import { getShopViewer } from '@/lib/shop/data';
import { subscribePoolAlerts } from '@/app/(store)/pools/actions';
import { loadJoinState, loadPool, resolvePoolCode } from '../_lib/loaders';
import { PoolPageView } from '../_components/pool-page-view';
import { cartAdd } from '../../cart/actions';

export const metadata: Metadata = { title: 'MOQ pool', robots: { index: false, follow: false } };

type Params = Promise<{ id: string }>;

/**
 * ODS T4 · /shop/pools/[id]. `id` = today's pool identifier, the pool code (POOL-0042, as on /pool/[code]); a pool UUID
 * redirects to its code URL. T5a: Join pool adds a cart pool line (cartAdd) and opens the mini-cart; before migration 253
 * it continues on today's join step (see PoolJoinForm).
 */
export default function ShopPoolPage({ params }: { params: Params }) {
  return (
    <div className="mx-auto w-full max-w-ods-content px-ods-pad-page py-6">
      <Suspense fallback={<Skeleton lines={8} label="Loading pool" />}>
        <Content params={params} />
      </Suspense>
    </div>
  );
}

async function Content({ params }: { params: Params }) {
  const [{ id }, viewer] = await Promise.all([params, getShopViewer()]);
  const code = await resolvePoolCode(id);
  if (!code) notFound();
  const pool = await loadPool(code);
  if (!pool) notFound();
  await connection();
  const now = Date.parse(nowIso());
  const join = await loadJoinState(pool, { orgId: viewer.org.id, role: viewer.role }, now);
  return <PoolPageView pool={pool} now={now} join={join} email={viewer.session.email ?? null} notifyAction={subscribePoolAlerts} cartAdd={cartAdd} />;
}
