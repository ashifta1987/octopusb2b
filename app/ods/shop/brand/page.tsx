import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Skeleton } from '@octopus/ui';
import { getShopViewer } from '@/lib/shop/data';
import { loadSectionItems } from '../_lib/loaders';
import type { BrandCardModel } from '../_lib/cards';
import { BrandView } from './_components/brand-view';

export const metadata: Metadata = { title: 'Make My Brand', robots: { index: false, follow: false } };

/** ODS T4 · /shop/brand. Cards = loadSectionItems('brand') → brandMethods(site_settings brand.methods). */
export default function ShopBrandPage() {
  return (
    <div className="mx-auto w-full max-w-ods-content px-ods-pad-page py-6">
      <Suspense fallback={<Skeleton lines={8} label="Loading branding options" />}>
        <Content />
      </Suspense>
    </div>
  );
}

async function Content() {
  await getShopViewer();
  const items = await loadSectionItems('brand', { limit: 12 }).then(
    (r) => r.items.filter((m): m is BrandCardModel => m.kind === 'brand'),
    () => null,
  );
  return <BrandView items={items ?? []} error={!items} />;
}
