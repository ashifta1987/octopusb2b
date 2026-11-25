import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { isDropshipV2UiEnabled } from '@/lib/dropship';
import { DsPageHeader, DsNotice, DsLinkButton } from '@/components/dropship-ui';
import { dsInter } from '@/components/dropship-ui/font';

export const metadata = {
  title: 'Octopus Dropship · Shopify App',
  robots: { index: false, follow: false },
};

async function Guarded() {
  if (!(await isDropshipV2UiEnabled())) {
    redirect('/request/dropship#notify');
  }
  return (
    <div className={`${dsInter.variable} ds-v2 min-h-screen p-6`}>
      <div className="max-w-[1240px] mx-auto">
        <div className="flex flex-col gap-5">
          <DsPageHeader
            title="Octopus Dropship for Shopify"
            subtitle="Embedded Shopify app view for connecting and syncing your store."
            icon="store"
          />
          <DsNotice
            tone="info"
            title="Coming soon"
            testId="planned-notice"
            action={
              <DsLinkButton href="/account/dropship" variant="secondary">
                Open Octopus Dropship
              </DsLinkButton>
            }
          >
            The embedded Shopify app is coming soon (Step 5). Until it launches, manage Octopus Dropship from your
            Octopus account.
          </DsNotice>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className={`${dsInter.variable} ds-v2 min-h-screen p-6`}>Loading…</div>}>
      <Guarded />
    </Suspense>
  );
}
