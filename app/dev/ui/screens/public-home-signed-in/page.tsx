import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OdsThemeRoot } from '@octopus/ui';
import { isStaging } from '@/lib/core/account';
import { GoogleCta } from '@/app/ods/(site)/_components/google-cta';
import { SiteHeader } from '@/app/ods/(site)/_components/site-header';

export const metadata: Metadata = { title: 'Public home · signed in · ODS screens (staging)', robots: { index: false, follow: false } };

/**
 * Staging-only fixture (CONVENTIONS "Pages that need a session"): the introduction-site header in its signed-in state
 * with SAMPLE props (no real session), plus a Continue button that switches to "Go to my shop" → /shop.
 */
export default function PublicHomeSignedInFixture() {
  if (!isStaging()) notFound();
  return (
    <OdsThemeRoot density="comfortable" className="min-h-screen bg-ods-canvas">
      <SiteHeader user={{ name: 'Anna' }} report sticky={false} />
      <main id="main" className="mx-auto max-w-ods-content px-ods-pad-page py-12">
        <h1 className="text-ods-h1 font-bold text-ods-navy">Public home · signed in</h1>
        <p className="mt-2 text-ods-body text-ods-slate">Sample data: the visitor “Anna” is a fixture, not a real account. The header shows “Signed in as Anna · Go to my shop ↗”.</p>
        <div className="mt-6" data-testid="fixture-cta">
          <GoogleCta testId="hero-cta" />
        </div>
      </main>
    </OdsThemeRoot>
  );
}
