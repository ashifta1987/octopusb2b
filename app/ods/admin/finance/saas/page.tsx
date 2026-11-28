// ODS T9 · Accounts › SaaS billing. Replaces the T8 re-export of app/admin/finance/saas/page.tsx inside the ODS Back Office
// frame. Same guard (requireStaff('finance','view') + the Dropship v2 switch → /admin/finance, as today), same data
// (getSaasPage = saas_billing_page()), today's actions unchanged (every change is two-person in the database).
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { isDropshipV2UiEnabled } from '@/lib/dropship';
import { rpcMessage } from '@/lib/dropship-ds6';
import { getSaasPage, type SaasPageData } from '@/lib/dropship-ds12';
import { decidePlanAction, decideSwitchAction, proposePlanAction, proposeSwitchAction, removeOverrideAction, setOverrideAction, withdrawSwitchAction } from '@/app/admin/finance/saas/actions';
import { SaasScreen } from './_components/saas-screen';

export const metadata = { title: 'SaaS billing · Finance · Admin' };

const ACTIONS = {
  proposeSwitch: proposeSwitchAction, decideSwitch: decideSwitchAction, withdrawSwitch: withdrawSwitchAction,
  setOverride: setOverrideAction, removeOverride: removeOverrideAction, proposePlan: proposePlanAction, decidePlan: decidePlanAction,
};

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
  return <SaasScreen state={data ? 'ok' : 'error'} data={data} error={error} actions={ACTIONS} />;
}

export default function Page() {
  return (
    <Suspense fallback={<SaasScreen state="loading" data={null} actions={ACTIONS} />}>
      <Guarded />
    </Suspense>
  );
}
