// ODS T9
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { saveCompany, saveInvoicingRule } from '@/app/admin/company/actions';
import { loadCompany } from '@/app/ods/office/_lib/admin-c-data';
import { settle } from '@/app/ods/office/_lib/dashboard-data';
import { CompanyAdmin } from '@/app/ods/office/_components/admin-c-company';
import { PanelSkeleton } from '@/app/ods/office/_components/dashboard';
import { ErrorPage } from '@/app/ods/office/_components/accounts-a-shared';

/** ODS T9 · /admin/company. Guard as today: requireStaff('staff','view') + company-wide Admin only; saveCompany / saveInvoicingRule unchanged. */
export const metadata: Metadata = { title: 'Company' };

export default function OdsCompanyPage() {
  return (
    <Suspense fallback={<PanelSkeleton title="Company" testId="company-page" lines={8} />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const s = await requireStaff('staff', 'view', '/admin/company');
  if (!s.isAdmin) redirect('/forbidden');
  const r = await settle(() => loadCompany());
  if (!r.ok) return <ErrorPage title="Company" />;
  return <CompanyAdmin data={r.data} saveCompany={saveCompany} saveRule={saveInvoicingRule} />;
}
