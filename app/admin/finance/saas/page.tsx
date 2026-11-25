import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { isDropshipV2UiEnabled } from '@/lib/dropship';
import { DsPageHeader, DsNotice } from '@/components/dropship-ui';

export const metadata = { title: 'SaaS billing · Finance · Admin' };

async function Guarded() {
  const [, v2On] = await Promise.all([requireStaff('finance', 'view', '/admin/finance/saas'), isDropshipV2UiEnabled()]);
  if (!v2On) redirect('/admin/finance');
  return (
    <div className="flex flex-col gap-5">
      <DsPageHeader
        title="SaaS billing"
        subtitle="Plan-fee switch, 30-day free trial and Shopify billing status."
        icon="card"
      />
      <DsNotice tone="info" title="Coming soon" testId="planned-notice">
        Plan fees are off and no SaaS billing is running. The screen for the plan-fee switch, trials and Shopify billing
        is coming soon.
      </DsNotice>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="ds-card">Loading…</div>}>
      <Guarded />
    </Suspense>
  );
}
