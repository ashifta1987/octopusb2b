import { requireCustomer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { COUNTRY_NAMES, fmtDate, humanize } from '@/lib/format';
import { Card, Notice, PageHeader, StatusBadge, EmptyState } from '@/components/ui';
import { cn } from '@/lib/cn';
import { KycForm, type KycExistingDoc, type KycFormValues } from '@/components/account/kyc-form';
import { KYC_DOCS } from '@/components/account/kyc-docs';

export const metadata = { title: 'Company profile & KYC' };

type Submission = {
  id: string; status: string; company_name: string | null; registration_no: string | null; address: string | null;
  contact_name: string | null; contact_phone: string | null; contact_email: string | null; review_note: string | null;
  submitted_at: string | null; reviewed_at: string | null; created_at: string;
};

const NAME_TO_CODE = Object.fromEntries(Object.entries(COUNTRY_NAMES).map(([c, n]) => [n.toLowerCase(), c]));

/** Best-effort parse of the address lines written by submitKyc (line1 / line2 / "city, region, postal" / country). */
function parseAddress(a: string | null) {
  const out = { line1: '', line2: '', city: '', region: '', postal: '', country: '' };
  if (!a) return out;
  const lines = a.split('\n');
  if (lines.length === 4) {
    out.line1 = lines[0]; out.line2 = lines[1];
    const parts = lines[2].split(', ');
    if (parts.length === 3) { out.city = parts[0]; out.region = parts[1]; out.postal = parts[2]; }
    out.country = NAME_TO_CODE[lines[3].trim().toLowerCase()] ?? '';
  } else {
    out.line1 = a.replace(/\n/g, ', ');
  }
  return out;
}

const STEP_LABELS = ['Email verified', 'Company details and documents', 'Review by our team (1–2 business days)', 'Verified'];

/** Index of the current step (0-based); everything before it is done. 4 = all done. */
function currentStep(status: string) {
  switch (status) {
    case 'verified': return 4;
    case 'submitted':
    case 'in_review': return 2;
    default: return 1; // not_started, more_info, rejected
  }
}

export default async function KycPage() {
  const s = await requireCustomer('/account/kyc');
  if (!s.org) {
    return (
      <>
        <PageHeader title="Company profile & KYC" />
        <Notice tone="amber">Your account is not linked to a buyer company, so there is no KYC to complete here.</Notice>
      </>
    );
  }

  const sb = await createClient();
  const [{ data: org }, { data: subsRaw }] = await Promise.all([
    sb.from('organizations').select('id, name, country, city, business_type, registration_no, website, kyc_status').eq('id', s.org.id).maybeSingle(),
    sb.from('kyc_submissions')
      .select('id, status, company_name, registration_no, address, contact_name, contact_phone, contact_email, review_note, submitted_at, reviewed_at, created_at')
      .eq('org_id', s.org.id).order('created_at', { ascending: false }),
  ]);
  const subs = (subsRaw ?? []) as Submission[];
  const latest = subs[0] ?? null;
  const { data: docsRaw } = latest
    ? await sb.from('kyc_documents').select('doc_type, file_name, storage_path, created_at').eq('submission_id', latest.id).order('created_at', { ascending: false })
    : { data: [] as KycExistingDoc[] };
  const docs = (docsRaw ?? []) as KycExistingDoc[];

  const status = (org?.kyc_status as string) ?? s.org.kyc_status;
  const step = currentStep(status);
  const haveTypes = new Set(docs.map((d) => d.doc_type));
  const missingRequired = KYC_DOCS.filter((d) => d.required && !haveTypes.has(d.type));
  const mode: 'edit' | 'docs' | 'locked' =
    status === 'verified' || status === 'in_review' ? 'locked'
      : status === 'submitted' ? (latest && missingRequired.length ? 'docs' : 'locked')
        : 'edit';

  const addr = parseAddress(latest?.address ?? null);
  const initial: KycFormValues = {
    company: latest?.company_name ?? org?.name ?? s.org.name ?? '',
    regNo: latest?.registration_no ?? (org?.registration_no as string | null) ?? '',
    businessType: (org?.business_type as string | null) ?? '',
    website: (org?.website as string | null) ?? '',
    country: addr.country || ((org?.country as string | null) ?? '') || '',
    region: addr.region,
    city: addr.city || ((org?.city as string | null) ?? ''),
    postal: addr.postal,
    line1: addr.line1,
    line2: addr.line2,
    contactName: latest?.contact_name ?? s.profile?.full_name ?? '',
    contactEmail: latest?.contact_email ?? s.email ?? '',
    contactPhone: latest?.contact_phone ?? s.profile?.phone ?? '',
  };
  if (initial.country && !COUNTRY_NAMES[initial.country]) initial.country = '';

  const doneCount = Math.min(step, 4);
  const pct = Math.round((doneCount / 4) * 100);
  const reviewNote = latest && (latest.status === 'more_info' || latest.status === 'rejected') ? latest.review_note : null;

  return (
    <>
      <PageHeader
        title="Company profile & KYC"
        subtitle={<>We verify every buyer&apos;s business before live orders and live API access. Fields marked <span className="text-bad">*</span> are required.</>}
        actions={<StatusBadge status={status} label={`KYC: ${humanize(status)}`} />}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] items-start">
        <div className="space-y-5 min-w-0">
          {status === 'verified' && <Notice tone="green">Your business is verified. Live orders, live API keys and wallet withdrawals are unlocked. Contact support if your company details change.</Notice>}
          {(status === 'in_review' || (status === 'submitted' && mode === 'locked')) && (
            <Notice>Your details were submitted{latest?.submitted_at ? ` on ${fmtDate(latest.submitted_at)}` : ''} and are {status === 'in_review' ? 'being reviewed' : 'waiting for review'}. The form is locked until our team responds.</Notice>
          )}
          {status === 'more_info' && (
            <Notice tone="amber"><strong>We need more information.</strong>{reviewNote ? <> {reviewNote}</> : null} Update the form below and submit again.</Notice>
          )}
          {status === 'rejected' && (
            <Notice tone="red"><strong>Verification was not approved.</strong>{reviewNote ? <> Reason: {reviewNote}</> : null} You can correct the details and submit again.</Notice>
          )}

          <KycForm mode={mode} initial={initial} existingDocs={docs} latestSubmissionId={latest?.id ?? null} orgId={s.org.id} />
        </div>

        <aside className="space-y-5 lg:sticky lg:top-6">
          <Card>
            <div className="p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Verification status</h2>
                <StatusBadge status={status} label={status === 'verified' ? 'Verified' : status === 'not_started' ? 'Not started' : humanize(status)} />
              </div>
              <div className="mt-4 flex items-center justify-between text-sm">
                <span>Progress</span><span className="mono font-semibold">{pct}%</span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-line" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Verification progress">
                <div className="h-1.5 rounded-full bg-coral" style={{ width: `${pct}%` }} />
              </div>
              <ol className="mt-4 space-y-3">
                {STEP_LABELS.map((label, i) => {
                  const done = i < step;
                  const current = i === step;
                  return (
                    <li key={label} className="flex items-center gap-2.5 text-[15px]">
                      {done ? (
                        <span className="w-5 h-5 rounded-full bg-ok text-white grid place-items-center text-[11px] font-bold" aria-hidden>✓</span>
                      ) : (
                        <span className={cn('w-5 h-5 rounded-full grid place-items-center text-[11px] font-bold border', current ? 'bg-coral border-coral-text text-white' : 'border-line-strong text-muted')} aria-hidden>{i + 1}</span>
                      )}
                      <span className={cn(current ? 'font-semibold' : done ? '' : 'text-muted')}>{label}</span>
                      <span className="sr-only">{done ? ' — done' : current ? ' — current step' : ' — to do'}</span>
                    </li>
                  );
                })}
              </ol>
            </div>
          </Card>

          <Card>
            <div className="p-5">
              <h2 className="font-semibold">Unlocked after verification</h2>
              <ul className="mt-3 space-y-2 text-[15px] text-muted">
                <li>Placing live orders &amp; verified buyer badge on your RFQs</li>
                <li>Live API credentials (<span className="mono">oct_live_…</span>)</li>
                <li>Wallet withdrawals to your bank</li>
              </ul>
              <p className="mt-3 text-sm text-muted">Browsing, RFQs and sandbox API keys work before verification.</p>
            </div>
          </Card>

          <Card title="Submission history">
            <div className="px-5 pb-5">
              {subs.length === 0 ? (
                <EmptyState title="No submissions yet" body="Your KYC submissions and our review notes will appear here." />
              ) : (
                <ol className="relative ml-2">
                  {subs.map((sub, i) => (
                    <li key={sub.id} className="relative pl-6 pb-5 last:pb-0">
                      {i < subs.length - 1 && <span className="absolute left-[5px] top-3 bottom-0 w-px bg-line" aria-hidden />}
                      <span className={cn('absolute left-0 top-1.5 w-[11px] h-[11px] rounded-full border-2', i === 0 ? 'bg-coral border-coral-text' : 'bg-white border-line-strong')} aria-hidden />
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={sub.status} />
                        <span className="text-xs text-muted mono">{fmtDate(sub.submitted_at ?? sub.created_at, true)}</span>
                      </div>
                      {sub.company_name && <div className="mt-1 text-sm">{sub.company_name}</div>}
                      {(sub.status === 'more_info' || sub.status === 'rejected') && sub.review_note && (
                        <p className="mt-1 text-sm text-muted"><span className="font-semibold text-ink">Review note:</span> {sub.review_note}</p>
                      )}
                      {sub.reviewed_at && <div className="text-xs text-muted mt-0.5">Reviewed {fmtDate(sub.reviewed_at)}</div>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </Card>
        </aside>
      </div>
    </>
  );
}
