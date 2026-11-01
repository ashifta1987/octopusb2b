import { Suspense } from 'react';
import type { Metadata } from 'next';
import { AboutView, AboutSkeleton } from '@/components/store/about/about-view';

export const metadata: Metadata = {
  title: 'About us',
  description: 'Shenzhen Octopus Trading Co. Ltd.: who we are, our sourcing offices in China and how we work.',
  alternates: { canonical: '/about' },
};

/** docs/design/About.png — company profile, China sourcing offices, promises, company details (all from the CMS). */
export default function Page() {
  return (
    <Suspense fallback={<AboutSkeleton />}>
      <AboutView />
    </Suspense>
  );
}
