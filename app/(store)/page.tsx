import { Suspense } from 'react';
import type { Metadata, ResolvingMetadata } from 'next';
import { shareImage } from '@/lib/site-images';
import { WebsiteHome, HomeHero, HomeSkeleton } from '@/components/site/home';

/** Title and description come from the root layout (CMS); the homepage adds its share image (owner slot share-home). */
export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  const p = await parent;
  const og = shareImage('share-home');
  return {
    alternates: { canonical: '/' },
    openGraph: { type: 'website', siteName: p.openGraph?.siteName ?? undefined, title: p.openGraph?.title?.absolute, description: p.openGraph?.description ?? undefined, images: [og] },
    twitter: { card: 'summary_large_image', title: p.twitter?.title?.absolute, description: p.twitter?.description ?? undefined, images: [og.url] },
  };
}

/** Homepage — design page 01 (octopus-design-handoff). Sections live in components/site/home.tsx;
 *  the announcement bar is rendered above the header by the store layout (homepage only). */
export default function HomePage() {
  return (
    <>
      <HomeHero />
      <Suspense fallback={<HomeSkeleton />}>
        <WebsiteHome />
      </Suspense>
    </>
  );
}
