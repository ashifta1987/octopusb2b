import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { isDropshipV2UiEnabled } from '@/lib/dropship';
import { DsLinkButton, DsNotice, DsSkeleton } from '@/components/dropship-ui';
import { rpcMessage } from '@/lib/dropship-ds6';
import { getSaasPage, type SaasPageData } from '@/lib/dropship-ds12';
import { SaasClient } from './saas-client';

export const metadata = { title: 'SaaS billing · Finance · Admin' };

/**
 * Release 5 · Step 12b — Finance › SaaS billing (staff/FinanceSaaS.html). Company-wide Finance and admins only. Data:
 * saas_billing_page() — the ONLY plan-fee switch (saas_billing_settings: enabled, scheduled start, trial 30 days, grace 7 days,
 * proposer / approver), counts per state, per-merchant overrides (free forever only for credit_eligible), plans + prices +
 * limits (two-person), and the history from the audit log.
 */
async function Guarded() {
  const [, v2On] = await Promise.all([requireStaff('finance', 'view', '/admin/finance/saas'), isDropshipV2UiEnabled()]);
  if (!v2On) redirect('/admin/finance');
  let data: SaasPageData | null = null;
  let error: string | null = null;
  try {
    data = await getSaasPage();
  } catch (e) {
    error = rpcMessage(e);
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-5" data-testid="finance-saas-page">
        <h1 className="m-0 text-[26px] font-bold text-[#1A174A]">SaaS billing</h1>
        <DsNotice tone="bad" title="SaaS billing could not be loaded" testId="saas-error"
          action={<DsLinkButton href="/admin/finance/saas" variant="secondary" icon="refresh">Try again</DsLinkButton>}>{error}</DsNotice>
      </div>
    );
  }
  return <SaasClient data={data} />;
}

export default function Page() {
  return (
    <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}>
      <Guarded />
    </Suspense>
  );
}
