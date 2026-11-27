import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isStaging } from '@/lib/core/account';
import { AuthBroadcastListener, OdsThemeRoot, SignOutButton } from '@octopus/ui';

export const metadata: Metadata = { title: 'Sign-out across tabs (staging)', robots: { index: false, follow: false } };

/**
 * STAGING ONLY fixture for Part 4.6: a Shop / My account style tab (overlay mode). Open it in two tabs and press
 * "Sign out" in one: the other shows "You signed out". Used by tests/e2e/ods-t3.spec.ts.
 */
export default function SignedOutOverlayFixture() {
  if (!isStaging()) notFound();
  return (
    <OdsThemeRoot density="comfortable" className="min-h-screen">
      <main id="main" className="mx-auto max-w-ods-content px-ods-pad-page py-10">
        <h1>Sign-out across tabs</h1>
        <p className="mt-2 max-w-[640px] text-ods-slate">
          Fixture for the BroadcastChannel(&apos;octopus-auth&apos;) sign-out. Open this page in a second tab and sign out there.
        </p>
        <div className="mt-6">
          <SignOutButton />
        </div>
      </main>
      <AuthBroadcastListener mode="overlay" />
    </OdsThemeRoot>
  );
}
