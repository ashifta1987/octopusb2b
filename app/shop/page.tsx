import { Suspense } from 'react';
import {
  WelcomeStrip, ServicesStrip, CategoryTiles, RecommendedRail, PoolsRail, TurnkeyRail, DropshipRail, NewArrivalsRail, BrandBand,
  RecentlyViewedRail, RailSkeleton,
} from '@/components/shop/rails';

export const metadata = { title: { absolute: 'Shop · Octopus B2B' } };

/** CH-1 Shop home (Shop_Home.html / M_Shop_Home.html), top to bottom. Every rail loads on its own with its own empty state. */
export default function ShopHome() {
  return (
    <>
      <Suspense fallback={<div className="max-w-[1240px] mx-auto px-4 sm:px-6 pt-6"><div className="h-[88px] rounded-[16px] bg-white border border-line" aria-hidden /></div>}>
        <WelcomeStrip />
      </Suspense>
      <Suspense fallback={null}><ServicesStrip /></Suspense>
      <Suspense fallback={<RailSkeleton title="categories" n={4} />}><CategoryTiles /></Suspense>
      <Suspense fallback={<RailSkeleton title="recommended products" />}><RecommendedRail /></Suspense>
      <Suspense fallback={<RailSkeleton title="MOQ pools" n={3} />}><PoolsRail /></Suspense>
      <Suspense fallback={<RailSkeleton title="turnkey projects" n={3} />}><TurnkeyRail /></Suspense>
      <Suspense fallback={<RailSkeleton title="dropshipping products" />}><DropshipRail /></Suspense>
      <Suspense fallback={<RailSkeleton title="new arrivals" />}><NewArrivalsRail /></Suspense>
      <BrandBand />
      <Suspense fallback={<RailSkeleton title="recently viewed" />}><RecentlyViewedRail /></Suspense>
    </>
  );
}
