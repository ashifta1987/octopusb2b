import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader, StatusBadge, Notice, Timeline } from '@/components/ui';
import { ReasonButton, RunButton } from '@/components/backoffice/action-form';
import { one } from '@/components/backoffice/server-utils';
import { fmtDate, humanize, COUNTRY_NAMES } from '@/lib/format';
import { reviewKyc } from '../../actions';
import { StepUpCallout } from '@/components/admin/step-up';

export const metadata = { title: 'KYC submission' };

export default async function KycDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireStaff('customers', 'view', `/office/kyc/${id}`);
  const sb = await createClient();
  const { data: k } = await sb.from('kyc_submissions')
    .select('id, org_id, status, company_name, registration_no, address, contact_name, contact_phone, contact_email, review_note, submitted_at, reviewed_at, organizations(name, country, city, business_type, website, kyc_status), kyc_documents(id, doc_type, storage_path, file_name, created_at)')
    .eq('id', id).maybeSingle();
  if (!k) notFound();
  const org = one(k.organizations as unknown as { name: string; country: string | null; city: string | null; business_type: string | null; website: string | null; kyc_status: string } | null);
  const docs = (k.kyc_documents ?? []) as { id: string; doc_type: string; storage_path: string; file_name: string | null; created_at: string }[];
  // KYC document downloads are a sensitive action (SPEC §17.3): storage RLS needs a fresh 2FA code (mfa_fresh()).
  const { data: fresh } = await sb.rpc('mfa_fresh');
  const docsUnlocked = fresh === true;
  // 60-second signed URLs through the user client (storage RLS allows customers:view) + view audit
  const signed = docsUnlocked
    ? await Promise.all(docs.map(async (d) => {
      const { data } = await sb.storage.from('kyc').createSignedUrl(d.storage_path, 60);
      return { ...d, url: data?.signedUrl ?? null };
    }))
    : docs.map((d) => ({ ...d, url: null as string | null }));
  await sb.rpc('log_staff_view', { p_entity: 'kyc_submissions', p_entity_id: id, p_details: { documents: docs.length } });
  const { data: history } = await sb.from('status_history').select('from_status, to_status, reason, created_at').eq('entity', 'kyc').eq('entity_id', id).order('created_at');
  const canApprove = can(s, 'customers', 'approve');
  const closed = ['verified', 'rejected'].includes(k.status);

  return (
    <>
      <PageHeader
        eyebrow={<nav aria-label="Breadcrumb" className="text-sm text-muted"><Link href="/office/kyc">KYC review</Link> / {k.company_name ?? org?.name}</nav>}
        title={k.company_name ?? org?.name ?? 'KYC submission'}
        subtitle={`${humanize(org?.business_type) || 'Company'} · ${[org?.city, org?.country ? COUNTRY_NAMES[org.country] ?? org.country : null].filter(Boolean).join(', ')} · submitted ${fmtDate(k.submitted_at, true)}`}
        actions={<StatusBadge status={k.status} />}
      />
      <div className="grid lg:grid-cols-[1fr_360px] gap-6 items-start">
        <div className="space-y-6">
          <Card title="Company details">
            <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3 px-6 pb-6 text-[15px]">
              {[
                ['Legal name', k.company_name], ['Registration no.', k.registration_no], ['Address', k.address], ['Website', org?.website],
                ['Contact', k.contact_name], ['Phone', k.contact_phone], ['Email', k.contact_email], ['Account name', org?.name],
              ].map(([l, v]) => <div key={l as string}><dt className="text-sm text-muted">{l}</dt><dd className="font-medium break-words">{v || '—'}</dd></div>)}
            </dl>
          </Card>
          <Card title="Documents" action={<span className="text-xs text-muted">Links expire in 60 s · reload to refresh</span>}>
            {signed.length === 0 ? <div className="px-6 pb-6"><Notice tone="amber">No documents uploaded with this submission.</Notice></div> : (
              <ul className="px-6 pb-6 space-y-3">
                {!docsUnlocked && <li><StepUpCallout path={`/office/kyc/${id}`} text="KYC documents need a fresh 2FA code (yours is older than 10 minutes)." label="Re-enter your code to view documents" /></li>}
                {signed.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 rounded-[10px] border border-line px-4 py-3">
                    <span className="w-2 h-2 rounded-full bg-ok" aria-hidden />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold">{humanize(d.doc_type)}</div>
                      <div className="text-sm text-muted truncate">{d.file_name ?? d.storage_path} · {fmtDate(d.created_at)}</div>
                    </div>
                    {d.url ? <a className="btn btn-ghost btn-sm" href={d.url} target="_blank" rel="noopener noreferrer">Open</a> : !docsUnlocked ? <span className="text-sm text-muted">🔒 Locked</span> : <span className="text-sm text-bad">Unavailable</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Decision">
            <div className="px-6 pb-6 space-y-3">
              {k.review_note && <Notice tone="blue">Last note: {k.review_note}</Notice>}
              {!canApprove ? <p className="text-sm text-muted">You can view this submission but not approve it.</p>
                : closed ? <p className="text-sm text-muted">This submission is {k.status}. The customer can submit again if needed.</p>
                  : (
                    <div className="flex flex-wrap gap-2">
                      {k.status === 'submitted' && <RunButton action={reviewKyc.bind(null, k.id, 'in_review', '')}>Start review</RunButton>}
                      <ReasonButton action={reviewKyc.bind(null, k.id, 'more_info')} label="Request more info" title="Request more information" placeholder="What does the customer need to provide?" />
                      <ReasonButton action={reviewKyc.bind(null, k.id, 'rejected')} label="Reject" title="Reject KYC" placeholder="Reason (shown to the customer)" className="btn btn-ghost btn-sm text-bad" danger confirmLabel="Reject" />
                      <ReasonButton action={reviewKyc.bind(null, k.id, 'verified')} label="Approve" title="Approve KYC" placeholder="Internal note (optional)" required={false} className="btn btn-sm bg-ok text-white" confirmLabel="Approve & verify" />
                    </div>
                  )}
              <p className="text-xs text-muted">Approval unlocks live API keys and wallet withdrawals for this customer. Every decision is written to the audit log.</p>
            </div>
          </Card>
          <Card title="History">
            <div className="px-6 pb-6">
              <Timeline items={(history ?? []).map((h) => ({ title: `${humanize(h.from_status) || 'New'} → ${humanize(h.to_status)}`, body: h.reason, at: h.created_at }))} />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
