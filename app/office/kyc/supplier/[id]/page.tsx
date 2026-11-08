import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireStaff, can } from '@/lib/auth';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { Card, PageHeader, StatusBadge, Notice } from '@/components/ui';
import { ReasonButton, RunButton } from '@/components/backoffice/action-form';
import { fmtDate } from '@/lib/format';
import { reviewSupplierApplication } from '../../../actions';

export const metadata = { title: 'Supplier application' };

/** ADDON-36 C5 — one application from /suppliers. Product sheet via a 60-second signed URL (view is logged). */
export default async function SupplierApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireStaff('suppliers', 'view', `/office/kyc/supplier/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sb = await createClient();
  const { data: a } = await sb.from('supplier_applications').select('*').eq('id', id).maybeSingle();
  if (!a) notFound();
  let sheetUrl: string | null = null;
  if (a.product_sheet_path) {
    // bucket has no staff storage policy: the page itself is permission-checked, so sign with the service role
    const { data } = await createAdminClient().storage.from('supplier-applications').createSignedUrl(a.product_sheet_path as string, 60);
    sheetUrl = data?.signedUrl ?? null;
  }
  await sb.rpc('log_staff_view', { p_entity: 'supplier_applications', p_entity_id: id, p_details: { sheet: !!a.product_sheet_path } }).then(() => undefined, () => undefined);
  const canApprove = can(s, 'suppliers', 'approve');
  const closed = ['approved', 'rejected'].includes(a.status as string);
  const link = (u: string | null) => (u ? <a href={/^https?:/.test(u) ? u : `https://${u}`} target="_blank" rel="noopener noreferrer" className="text-coral-text break-all">{u}</a> : null);

  return (
    <>
      <PageHeader
        eyebrow={<nav aria-label="Breadcrumb" className="text-sm text-muted"><Link href="/office/kyc?f=suppliers">Supplier applications</Link> / {a.reference}</nav>}
        title={a.company_name as string}
        subtitle={`${[a.city, a.province].filter(Boolean).join(', ')} · submitted ${fmtDate(a.created_at as string, true)}`}
        actions={<StatusBadge status={a.status as string} />}
      />
      <div className="grid lg:grid-cols-[1fr_360px] gap-6 items-start">
        <div className="space-y-6">
          <Card title="Company">
            <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3 px-6 pb-6 text-[15px]">
              {([
                ['Reference', a.reference], ['USCC', a.uscc], ['City', a.city], ['Province', a.province],
                ['Categories', (a.categories as string[]).join(', ')], ['Contact', a.contact_name], ['Email', a.contact_email], ['Phone', a.contact_phone],
                ['WeChat', a.wechat], ['Website', link(a.website as string | null)], ['1688 / Alibaba store', link(a.store_url as string | null)], ['Applied from', a.ip_country],
              ] as [string, React.ReactNode][]).map(([l, v]) => <div key={l}><dt className="text-sm text-muted">{l}</dt><dd className="font-medium break-words">{v || '—'}</dd></div>)}
            </dl>
            {a.notes && <div className="px-6 pb-6"><div className="text-sm text-muted">Notes</div><p className="whitespace-pre-wrap text-[15px]">{a.notes as string}</p></div>}
          </Card>
          <Card title="Product sheet" action={<span className="text-xs text-muted">Link expires in 60 s · reload to refresh</span>}>
            <div className="px-6 pb-6">
              {!a.product_sheet_path ? <Notice tone="amber">No product sheet was attached.</Notice>
                : sheetUrl ? <a className="btn btn-ghost btn-sm" href={sheetUrl} target="_blank" rel="noopener noreferrer">Open {String(a.product_sheet_path).split('/').pop()}</a>
                  : <p className="text-sm text-bad" role="alert">The file could not be found in storage.</p>}
            </div>
          </Card>
        </div>
        <Card title="Decision">
          <div className="px-6 pb-6 space-y-3">
            {a.review_note && <Notice tone="blue">Last note: {a.review_note as string}</Notice>}
            {!canApprove ? <p className="text-sm text-muted">You can view this application but not approve it.</p>
              : closed ? <p className="text-sm text-muted">This application is {a.status as string}{a.reviewed_at ? ` (${fmtDate(a.reviewed_at as string, true)})` : ''}.</p>
                : (
                  <div className="flex flex-wrap gap-2">
                    {a.status === 'submitted' && <RunButton action={reviewSupplierApplication.bind(null, id, 'in_review', '')}>Start review</RunButton>}
                    <ReasonButton action={reviewSupplierApplication.bind(null, id, 'rejected')} label="Reject" title="Reject application" placeholder="Reason (internal)" className="btn btn-ghost btn-sm text-bad" danger confirmLabel="Reject" />
                    <ReasonButton action={reviewSupplierApplication.bind(null, id, 'approved')} label="Approve" title="Approve application" placeholder="Internal note (optional)" required={false} className="btn btn-sm bg-ok text-white" confirmLabel="Approve" />
                  </div>
                )}
            <p className="text-xs text-muted">Approving does not create the supplier. Add it in <Link href="/admin/suppliers" className="text-coral-text">Admin → Suppliers</Link> after the factory audit. Every decision is written to the audit log.</p>
          </div>
        </Card>
      </div>
    </>
  );
}

