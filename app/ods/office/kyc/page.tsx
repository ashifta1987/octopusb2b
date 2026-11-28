// ODS T9 · KYC review queue (Part 7.6 list pattern). Replaces the T8 re-export of app/office/kyc/page.tsx.
// Same guard (requireStaff('customers','view')), same kyc_submissions query and ?f= values (open · verified · rejected ·
// suppliers, + paused = archived organisations), same Supplier applications tab rule (suppliers:view). Switch off → today's page.
import { Suspense } from 'react';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { withHiddenColumns } from '@/components/backoffice/hidden-columns';
import { one } from '@/components/backoffice/server-utils';
import { COUNTRY_NAMES } from '@/lib/format';
import { KYC_TAB_STATUSES, kycRawFilter, kycTab, submissionCompanyStatus, type KycQueueRow, type SupplierQueueRow } from './_lib/kyc-core';
import { KycQueue } from './_components/kyc-queue';
import { SalesPageHead } from '../_components/sales-bits';

export const metadata = { title: 'KYC review' };

type SP = Promise<{ f?: string; raw?: string }>;
type Org = { name: string; country: string | null; city: string | null; archived_at: string | null };

export default function KycQueuePage({ searchParams }: { searchParams: SP }) {
  return (
    <div className="grid min-w-0 gap-3">
      <SalesPageHead
        crumbs={[{ label: 'Sales' }, { label: 'KYC review' }]}
        title="KYC review"
        subtitle="Customer company verification and supplier applications. Documents open only with a fresh 2-step code; every view is logged."
      />
      <Suspense fallback={<KycQueue tab="open" raw={null} rows={[]} supplierRows={[]} canViewSuppliers={false} base="/office/kyc" nowIso={new Date(0).toISOString()} loading sample />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  const s = await requireStaff('customers', 'view', '/office/kyc');
  const sp = await searchParams;
  const tab = kycTab(sp.f);
  const raw = kycRawFilter(sp.raw);
  const canViewSuppliers = can(s, 'suppliers', 'view');
  const sb = await createClient();
  const nowIso = new Date().toISOString();

  if (tab === 'suppliers') {
    const { data, error } = canViewSuppliers
      ? await sb.from('supplier_applications').select('id, reference, company_name, city, province, categories, contact_email, status, created_at, first_approved_by')
        .order('status', { ascending: true }).order('created_at', { ascending: false }).limit(200)
      : { data: [], error: null };
    const supplierRows: SupplierQueueRow[] = (data ?? []).map((a) => ({
      id: a.id as string,
      reference: a.reference as string,
      company: a.company_name as string,
      email: (a.contact_email as string | null) ?? null,
      place: [a.city, a.province].filter(Boolean).join(', '),
      categories: (a.categories as string[] | null) ?? [],
      status: a.status as string,
      createdAt: a.created_at as string,
      firstApproved: !!a.first_approved_by,
    }));
    return <KycQueue tab={tab} raw={null} rows={[]} supplierRows={supplierRows} canViewSuppliers={canViewSuppliers} base="/office/kyc" nowIso={nowIso} error={error?.message ?? null} />;
  }

  const paused = tab === 'paused';
  let q = sb.from('kyc_submissions')
    .select(`id, company_name, registration_no, status, submitted_at, reviewed_at, organizations${paused ? '!inner' : ''}(name, country, city, archived_at), kyc_documents(id)`)
    .in('status', [...KYC_TAB_STATUSES[tab]]);
  if (paused) q = q.not('organizations.archived_at', 'is', null);
  const { data, error } = await q.order('submitted_at', { ascending: true }).limit(200);
  // reviewer_id is hidden from session reads (migration 195): read with the service role after requireStaff, for the rows RLS returned
  const withReviewer = await withHiddenColumns<Record<string, unknown>, { reviewer_id: string | null }>('kyc_submissions', (data ?? []) as Record<string, unknown>[], 'reviewer_id').catch(() => null);
  const ids = [...new Set((withReviewer ?? []).map((r) => r.reviewer_id).filter(Boolean))] as string[];
  const { data: ppl } = ids.length ? await sb.from('profiles').select('id, full_name, email').in('id', ids) : { data: [] };
  const person = new Map((ppl ?? []).map((p) => [p.id as string, ((p.full_name as string | null) || (p.email as string | null) || 'Staff') as string]));
  const reviewerOf = new Map((withReviewer ?? []).map((r) => [r.id as string, r.reviewer_id]));

  const rows: KycQueueRow[] = (data ?? []).map((k) => {
    const o = one(k.organizations as unknown as Org | null);
    const rid = reviewerOf.get(k.id as string);
    return {
      id: k.id as string,
      company: (k.company_name as string | null) ?? o?.name ?? 'Company',
      account: o?.name ?? null,
      place: [o?.city, o?.country ? COUNTRY_NAMES[o.country] ?? o.country : null].filter(Boolean).join(', '),
      registrationNo: (k.registration_no as string | null) ?? null,
      status: k.status as string,
      companyStatus: submissionCompanyStatus(k.status as string, o?.archived_at),
      submittedAt: (k.submitted_at as string | null) ?? null,
      reviewedAt: (k.reviewed_at as string | null) ?? null,
      documents: (k.kyc_documents as unknown[] | null)?.length ?? 0,
      assignee: rid ? person.get(rid) ?? 'Staff' : null,
    };
  });
  return <KycQueue tab={tab} raw={raw} rows={rows} supplierRows={[]} canViewSuppliers={canViewSuppliers} base="/office/kyc" nowIso={nowIso} error={error?.message ?? null} />;
}
