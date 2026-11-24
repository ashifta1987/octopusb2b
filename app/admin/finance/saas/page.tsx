import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { isDropshipV2UiEnabled } from '@/lib/dropship';
import { DsPageHeader } from '@/components/dropship-ui';

export const metadata = { title: 'SaaS billing · Finance · Admin' };

async function Guarded() {
  const [, v2On] = await Promise.all([
    requireStaff('finance', 'view', '/admin/finance/saas'),
    isDropshipV2UiEnabled(),
  ]);
  if (!v2On) redirect('/admin/finance');
  return (
    <DsPageHeader
      title="SaaS billing"
      subtitle="/admin/finance/saas · plan-fee switch, 30-day free trial and Shopify billing status."
      icon="card"
    />
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="ds-card">Loading…</div>}>
      <Guarded />
    </Suspense>
  );
}
