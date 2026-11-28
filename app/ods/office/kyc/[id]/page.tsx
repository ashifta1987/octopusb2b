// ODS T9 · KYC review record (Part 7.6 record pattern). Replaces the T8 re-export of app/office/kyc/[id]/page.tsx.
// Same guard (requireStaff('customers','view')), same reads (submission, internal note via the admin client after the
// guard, mfa_fresh() gate, 60-second signed URLs through the user client, log_staff_view audit, status history) and the
// same decisions: today's reviewKyc server action, unchanged (customers:approve checked in the action and in review_kyc()).
import { notFound } from 'next/navigation';
import { requireStaff, can } from '@/lib/auth';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { one } from '@/components/backoffice/server-utils';
import { fmtDate, humanize, COUNTRY_NAMES } from '@/lib/format';
import { stepUpRedirect } from '@/lib/staff/step-up';
import { reviewKyc } from '@/app/office/actions';
import { kycDecisionState, submissionCompanyStatus, type KycDecision, type KycDocVM } from '../_lib/kyc-core';
import { KycReview } from '../_components/kyc-review';

export const metadata = { title: 'KYC submission' };

type Org = { name: string; country: string | null; city: string | null; business_type: string | null; website: string | null; kyc_status: string; archived_at: string | null };

export default async function KycReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireStaff('customers', 'view', `/office/kyc/${id}`);
  const sb = await createClient();
  const { data: k } = await sb.from('kyc_submissions')
    .select('id, org_id, status, company_name, registration_no, address, contact_name, contact_phone, contact_email, customer_message, submitted_at, reviewed_at, organizations(name, country, city, business_type, website, kyc_status, archived_at), kyc_documents(id, doc_type, storage_path, file_name, created_at)')
    .eq('id', id).maybeSingle();
  if (!k) notFound();
  // internal_note is hidden from anon/authenticated (migration 195): read with the admin client only after the guard above
  // and only for the row RLS already let this staff member see (same as today).
  const { data: internal } = await createAdminClient().from('kyc_submissions').select('internal_note').eq('id', k.id).maybeSingle();
  const org = one(k.organizations as unknown as Org | null);
  const docs = (k.kyc_documents ?? []) as { id: string; doc_type: string; storage_path: string; file_name: string | null; created_at: string }[];
  // KYC documents are a sensitive action (SPEC §17.3): storage RLS needs a fresh 2FA code (mfa_fresh()).
  const { data: fresh } = await sb.rpc('mfa_fresh');
  const unlocked = fresh === true;
  const vms: KycDocVM[] = await Promise.all(docs.map(async (d) => {
    let url: string | null = null;
    if (unlocked) {
      const { data } = await sb.storage.from('kyc').createSignedUrl(d.storage_path, 60);
      url = data?.signedUrl ?? null;
    }
    return { id: d.id, type: d.doc_type, fileName: d.file_name ?? d.storage_path.split('/').pop() ?? 'file', uploadedAt: d.created_at, url };
  }));
  await sb.rpc('log_staff_view', { p_entity: 'kyc_submissions', p_entity_id: id, p_details: { documents: docs.length } });
  const { data: history, error: historyError } = await sb.from('status_history').select('from_status, to_status, reason, created_at').eq('entity', 'kyc').eq('entity_id', id).order('created_at');

  const title = (k.company_name as string | null) ?? org?.name ?? 'KYC submission';
  const place = [org?.city, org?.country ? COUNTRY_NAMES[org.country] ?? org.country : null].filter(Boolean).join(', ');
  const decide = reviewKyc.bind(null, k.id as string) as (to: KycDecision, input: { customerMessage: string; internalNote: string }) => ReturnType<typeof reviewKyc>;

  return (
    <KycReview
      title={title}
      account={org?.name ?? null}
      subtitle={`${humanize(org?.business_type) || 'Company'}${place ? ` · ${place}` : ''} · submitted ${fmtDate(k.submitted_at as string, true)}`}
      status={k.status as string}
      companyStatus={submissionCompanyStatus(k.status as string, org?.archived_at)}
      company={[
        ['Legal name', k.company_name as string | null], ['Registration no.', k.registration_no as string | null], ['Address', k.address as string | null], ['Website', org?.website ?? null],
        ['Contact', k.contact_name as string | null], ['Phone', k.contact_phone as string | null], ['Email', k.contact_email as string | null], ['Account name', org?.name ?? null],
      ]}
      docs={vms}
      docsState={unlocked ? 'unlocked' : 'locked'}
      stepUpHref={stepUpRedirect(`/office/kyc/${id}`)}
      decision={kycDecisionState(k.status as string, can(s, 'customers', 'approve'))}
      lastCustomerMessage={(k.customer_message as string | null) ?? null}
      lastInternalNote={(internal?.internal_note as string | null | undefined) ?? null}
      history={history ?? []}
      historyError={!!historyError}
      startReview={reviewKyc.bind(null, k.id as string, 'in_review', {})}
      decide={decide}
      queueHref="/office/kyc"
    />
  );
}
