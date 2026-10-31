import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader, StatusBadge, Table, EmptyState } from '@/components/ui';
import { one } from '@/components/backoffice/server-utils';
import { fmtDate, COUNTRY_NAMES } from '@/lib/format';

export const metadata = { title: 'KYC review' };

const FILTERS = { open: ['submitted', 'in_review', 'more_info'], verified: ['verified'], rejected: ['rejected'] } as const;

export default async function KycList({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  await requireStaff('customers', 'view', '/office/kyc');
  const { f = 'open' } = await searchParams;
  const statuses = FILTERS[f as keyof typeof FILTERS] ?? FILTERS.open;
  const sb = await createClient();
  const { data } = await sb.from('kyc_submissions')
    .select('id, company_name, registration_no, status, submitted_at, reviewed_at, organizations(name, country, city), kyc_documents(id)')
    .in('status', [...statuses]).order('submitted_at', { ascending: true }).limit(200);
  return (
    <>
      <PageHeader title="KYC review" subtitle="Customer company verification. Open each submission to view documents (links expire after 60 seconds; every view is logged)." />
      <nav className="flex gap-2 mb-4" aria-label="Filter">
        {Object.keys(FILTERS).map((k) => <Link key={k} href={`/office/kyc?f=${k}`} aria-current={f === k ? 'page' : undefined} className={`btn btn-sm ${f === k ? 'btn-dark' : 'btn-ghost'}`}>{k === 'open' ? 'To review' : k[0].toUpperCase() + k.slice(1)}</Link>)}
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
