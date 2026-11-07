import Link from 'next/link';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader, StatusBadge, Table, EmptyState } from '@/components/ui';
import { one } from '@/components/backoffice/server-utils';
import { fmtDate, COUNTRY_NAMES } from '@/lib/format';

export const metadata = { title: 'KYC review' };

const FILTERS = { open: ['submitted', 'in_review', 'more_info'], verified: ['verified'], rejected: ['rejected'] } as const;
const TABS: [string, string][] = [['open', 'To review'], ['verified', 'Verified'], ['rejected', 'Rejected'], ['suppliers', 'Supplier applications']];

export default async function KycList({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const s = await requireStaff('customers', 'view', '/office/kyc');
  const { f = 'open' } = await searchParams;
  if (f === 'suppliers') return <SupplierApplications canView={can(s, 'suppliers', 'view')} />;
  const statuses = FILTERS[f as keyof typeof FILTERS] ?? FILTERS.open;
  const sb = await createClient();
  const { data } = await sb.from('kyc_submissions')
    .select('id, company_name, registration_no, status, submitted_at, reviewed_at, organizations(name, country, city), kyc_documents(id)')
    .in('status', [...statuses]).order('submitted_at', { ascending: true }).limit(200);
  return (
    <>
      <PageHeader title="KYC review" subtitle="Customer company verification. Open each submission to view documents (links expire after 60 seconds; every view is logged)." />
      <nav className="flex gap-2 mb-4" aria-label="Filter">
        <Tabs f={f} />
      </nav>
      <Card>
        <Table head={['Company', 'Country', 'Registration', 'Documents', 'Submitted', 'Status', '']} empty={<EmptyState title="Nothing to review" body="New KYC submissions appear here." />}>
          {(data ?? []).map((k) => {
            const o = one(k.organizations as unknown as { name: string; country: string | null; city: string | null } | null);
            return (
              <tr key={k.id}>
                <td className="td"><div className="font-semibold">{k.company_name ?? o?.name}</div><div className="text-xs text-muted">{o?.name}</div></td>
                <td className="td text-sm">{[o?.city, o?.country ? COUNTRY_NAMES[o.country] ?? o.country : null].filter(Boolean).join(', ')}</td>
                <td className="td mono text-sm">{k.registration_no ?? '—'}</td>
                <td className="td text-sm">{(k.kyc_documents as unknown[] | null)?.length ?? 0}</td>
                <td className="td text-sm">{fmtDate(k.submitted_at, true)}</td>
                <td className="td"><StatusBadge status={k.status} /></td>
                <td className="td text-right"><Link className="btn btn-ghost btn-sm" href={`/office/kyc/${k.id}`}>Review</Link></td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}

function Tabs({ f }: { f: string }) {
  return <>{TABS.map(([k, l]) => <Link key={k} href={`/office/kyc?f=${k}`} aria-current={f === k ? 'page' : undefined} className={`btn btn-sm ${f === k ? 'btn-dark' : 'btn-ghost'}`}>{l}</Link>)}</>;
}

/** ADDON-36 C5 — applications from the public /suppliers page. */
async function SupplierApplications({ canView }: { canView: boolean }) {
  const sb = await createClient();
  const { data, error } = canView
    ? await sb.from('supplier_applications').select('id, reference, company_name, city, province, categories, contact_email, status, created_at')
      .order('status', { ascending: true }).order('created_at', { ascending: false }).limit(200)
    : { data: [], error: null };
  return (
    <>
      <PageHeader title="KYC review" subtitle="Supplier applications from the public “Sell on Octopus B2B” page. Approve, then create the supplier in Admin → Suppliers." />
      <nav className="flex gap-2 mb-4 flex-wrap" aria-label="Filter"><Tabs f="suppliers" /></nav>
      <Card>
        {!canView ? <div className="p-6 text-sm text-muted">You need the Suppliers · view permission to see applications.</div>
          : error ? <div className="p-6 text-sm text-bad" role="alert">Could not load applications: {error.message}</div>
          : (
            <Table head={['Reference', 'Company', 'City', 'Categories', 'Submitted', 'Status', '']} empty={<EmptyState title="No applications yet" body="Applications from /suppliers appear here." />}>
              {(data ?? []).map((a) => (
                <tr key={a.id}>
                  <td className="td mono text-sm">{a.reference}</td>
                  <td className="td"><div className="font-semibold">{a.company_name}</div><div className="text-xs text-muted">{a.contact_email}</div></td>
                  <td className="td text-sm">{[a.city, a.province].filter(Boolean).join(', ')}</td>
                  <td className="td text-sm">{(a.categories as string[]).join(', ')}</td>
                  <td className="td text-sm">{fmtDate(a.created_at, true)}</td>
                  <td className="td"><StatusBadge status={a.status} /></td>
                  <td className="td text-right"><Link className="btn btn-ghost btn-sm" href={`/office/kyc/supplier/${a.id}`}>Review</Link></td>
                </tr>
              ))}
            </Table>
          )}
      </Card>
    </>
  );
}
