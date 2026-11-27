import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Skeleton } from '@octopus/ui';
import { countryName, getShopFrameData, loadSectionItems } from '../_lib/loaders';
import type { DropshipCardModel } from '../_lib/cards';
import { DropshipView } from './_components/dropship-view';

export const metadata: Metadata = { title: 'Dropshipping products', robots: { index: false, follow: false } };

type SP = Promise<{ category?: string }>;

/**
 * ODS T4 · /shop/dropship. Access = Dropship v2 UI on AND company_services.dropship = on (getShopFrameData →
 * viewer.dropshipAccess, same rule as today's DropshipRail). Data = loadSectionItems('dropship'): with access
 * get_dropship_catalogue(country) (allowlisted columns; only id, title, first image, stock and the best route reach the
 * card), without access the public products list (octopus_dropship) with NO price fields.
 */
export default function ShopDropshipPage({ searchParams }: { searchParams: SP }) {
  return (
    <div className="mx-auto w-full max-w-ods-content px-ods-pad-page py-6">
      <Suspense fallback={<Skeleton lines={8} label="Loading dropshipping products" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  const [sp, { viewer }] = await Promise.all([searchParams, getShopFrameData()]);
  let items: DropshipCardModel[] = [];
  let total = 0;
  let error = false;
  try {
    const r = await loadSectionItems('dropship', { category: sp.category ?? null, limit: 48 });
    items = r.items.filter((m): m is DropshipCardModel => m.kind === 'dropship');
    total = r.total;
  } catch {
    error = true;
  }
  return (
    <DropshipView
      hasAccess={viewer.dropshipAccess}
      requestHref={viewer.dropshipRequestHref}
      countryName={viewer.dropshipAccess ? countryName(viewer.country) : undefined}
      items={items}
      total={total}
      error={error}
    />
  );
}
