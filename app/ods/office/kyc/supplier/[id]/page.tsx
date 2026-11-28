// ODS T9 · Supplier application review (same record pattern as KYC). Replaces the T8 re-export of
// app/office/kyc/supplier/[id]/page.tsx. Same guard (requireStaff('suppliers','view')), same reads (application, 60-second
// signed product sheet via the service role after the guard, log_staff_view, ds_supplier_application_checks, first approver),
// same decisions: today's reviewSupplierApplication, unchanged (suppliers:approve + DS16 two different approvers in the DB).
import { notFound } from 'next/navigation';
import { requireStaff, can } from '@/lib/auth';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { fmtDate } from '@/lib/format';
import { reviewSupplierApplication } from '@/app/office/actions';
import { getApplicationChecks } from '@/lib/dropship-ds14';
import { supplierDecisionState } from '../../_lib/kyc-core';
import { SupplierReview } from '../../_components/supplier-review';

export const metadata = { title: 'Supplier application' };

export default async function SupplierApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireStaff('suppliers', 'view', `/office/kyc/supplier/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sb = await createClient();
  const { data: a } = await sb.from('supplier_applications').select('*').eq('id', id).maybeSingle();
  if (!a) notFound();
  let sheetUrl: string | null = null;
  if (a.product_sheet_path) {
    // bucket has no staff storage policy: the page itself is permission-checked, so sign with the service role (as today)
    const { data } = await createAdminClient().storage.from('supplier-applications').createSignedUrl(a.product_sheet_path as string, 60);
    sheetUrl = data?.signedUrl ?? null;
  }
  await sb.rpc('log_staff_view', { p_entity: 'supplier_applications', p_entity_id: id, p_details: { sheet: !!a.product_sheet_path } }).then(() => undefined, () => undefined);
  const checks = await getApplicationChecks(id).catch(() => []);
  const firstBy = (a.first_approved_by as string | null) ?? null;
  let firstName: string | null = null;
  if (firstBy) {
    const { data: fp } = await sb.from('profiles').select('full_name, email').eq('id', firstBy).maybeSingle();
    firstName = (fp?.full_name as string | null) || (fp?.email as string | null) || null;
  }
  const decision = supplierDecisionState({ status: a.status as string, canApprove: can(s, 'suppliers', 'approve'), firstBy, userId: s.userId, firstName });

  return (
    <SupplierReview
      reference={a.reference as string}
      company={a.company_name as string}
      subtitle={`${[a.city, a.province].filter(Boolean).join(', ')} · submitted ${fmtDate(a.created_at as string, true)}${a.first_approved_at && firstBy ? ` · first approval ${fmtDate(a.first_approved_at as string, true)}` : ''}${a.reviewed_at ? ` · reviewed ${fmtDate(a.reviewed_at as string, true)}` : ''}`}
      status={a.status as string}
      rows={[
        ['Reference', a.reference as string], ['USCC', a.uscc as string | null], ['City', a.city as string | null], ['Province', a.province as string | null],
        ['Categories', ((a.categories as string[] | null) ?? []).join(', ')], ['Contact', a.contact_name as string | null], ['Email', a.contact_email as string | null],
        ['Phone', a.contact_phone as string | null], ['WeChat', a.wechat as string | null], ['Applied from', a.ip_country as string | null],
      ]}
      links={[['Website', a.website as string | null], ['1688 / Alibaba store', a.store_url as string | null]]}
      notes={(a.notes as string | null) ?? null}
      sheet={a.product_sheet_path ? { name: String(a.product_sheet_path).split('/').pop() ?? 'file', url: sheetUrl } : null}
      checks={checks}
      decision={decision}
      lastNote={(a.review_note as string | null) ?? null}
      startReview={reviewSupplierApplication.bind(null, id, 'in_review', '')}
      decide={reviewSupplierApplication.bind(null, id)}
      queueHref="/office/kyc?f=suppliers"
    />
  );
}
