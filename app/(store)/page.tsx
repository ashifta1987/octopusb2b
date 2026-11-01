import { Suspense } from 'react';
import type { Metadata } from 'next';
import { HomeView, HomeSkeleton } from '@/components/store/home/home-view';

export const metadata: Metadata = { alternates: { canonical: '/' } };

/** Main.png — storefront home (Nov 2026 redesign). All copy from content_blocks / site_settings / company_profile;
 *  sections live in components/store/home/** (Organization JSON-LD is rendered by HomeView). */
export default function HomePage() {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <HomeView />
    </Suspense>
  );
}
