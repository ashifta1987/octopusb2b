import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getSiteContent } from '@/lib/content';
import { getShopViewer } from '@/lib/shop/data';
import { ShopHeader, ShopHeaderSkeleton } from '@/components/shop/shop-header';
import { ShopFooter } from '@/components/shop/shop-footer';
import { ShopTabs } from '@/components/shop/shop-tabs';

/**
 * CH-1 Shop (tab 1, main page after a customer logs in): shop header + section bar, no sidebar. Hidden from search engines
 * (the public /products and /p/… pages are the indexed ones). The session is read only inside <Suspense> boundaries
 * (Cache Components): the header, the phone tabs and each rail stream in on their own.
 */
export const metadata: Metadata = {
  title: { default: 'Shop', template: '%s · Octopus B2B Shop' },
  robots: { index: false, follow: false, nocache: true },
};

async function Tabs() {
  const [v, { settings }] = await Promise.all([getShopViewer(), getSiteContent()]);
  return <ShopTabs quoteCount={v.quoteCount} poolsOn={settings.pool_enabled !== false} />;
}

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-pearl">
      <a href="#main" className="skip-link">Skip to content</a>
      <Suspense fallback={<ShopHeaderSkeleton />}>
        <ShopHeader />
      </Suspense>
      <main id="main" tabIndex={-1} className="flex-1 pb-6 focus:outline-none">{children}</main>
      <ShopFooter />
      <Suspense fallback={null}>
        <Tabs />
      </Suspense>
    </div>
  );
}
