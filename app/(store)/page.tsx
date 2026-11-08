import { Suspense } from 'react';
import type { Metadata } from 'next';
import { HomeView, HomeSkeleton } from '@/components/store/home/home-view';
import { HomeHero } from '@/components/store/home/final';

export const metadata: Metadata = { alternates: { canonical: '/' } };

/** Main.png — storefront home (Nov 2026 redesign). All copy from content_blocks / site_settings / company_profile;
 *  sections live in components/store/home/** (Organization JSON-LD is rendered by HomeView). */
export default function HomePage() {
  return (
    <>
      {/* brand kit step 6: the hero is static (cached data only) so the H1 paints first; the rest streams */}
      <HomeHero />
      <Suspense fallback={<HomeSkeleton />}>
        <HomeView />
      </Suspense>
    </>
  );
}
