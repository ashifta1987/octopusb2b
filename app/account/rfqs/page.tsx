import Link from 'next/link';
import { requireCustomer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader, Card, Table, StatusBadge, EmptyState, Notice, Money } from '@/components/ui';
import { fmtDate } from '@/lib/format';

export const metadata = { title: 'RFQs' };

const OPEN = ['submitted', 'assigned', 'quoting', 'quoted'];

export default async function RfqsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const s = await requireCustomer('/account/rfqs');
  if (!s.org) return <Notice tone="amber">Complete your company profile first.</Notice>;
  const { status } = await searchParams;
  const sb = await createClient();
  let q = sb.from('rfqs').select('id, code, title, quantity, unit, status, destination_country, target_price_cents, fee_minor, currency, created_at, expires_at, quotes(id, status)').eq('org_id', s.org.id).order('created_at', { ascending: false });
  if (status === 'open') q = q.in('status', OPEN);
  else if (status === 'closed') q = q.not('status', 'in', `(${OPEN.join(',')})`);
  const { data: rfqs } = await q;
  const tabs = [{ k: undefined, l: 'All' }, { k: 'open', l: 'Open' }, { k: 'closed', l: 'Closed' }];
  return (
    <>
      <PageHeader title="RFQs" subtitle="Your requests for quotation and the quotes suppliers sent back."
        actions={<Link href="/request/sourcing" className="btn btn-primary">New RFQ</Link>} />
      <nav aria-label="Filter RFQs" className="flex gap-2 mb-4">
        {tabs.map((t) => (
          <Link key={t.l} href={t.k ? `/account/rfqs?status=${t.k}` : '/account/rfqs'} aria-current={status === t.k ? 'page' : undefined}
            className={`px-4 py-2 rounded-full border text-sm font-semibold ${status === t.k ? 'bg-navy text-white border-navy' : 'bg-white border-line-2'}`}>{t.l}</Link>
        ))}
      </nav>
      <Card>
        <Table head={['RFQ', 'Product', 'Quantity', 'Target', 'Quotes', 'Status', 'Created', '']}
          empty={<EmptyState title="No RFQs yet" body="Describe what you need and suppliers will quote in the platform currency with Incoterm and lead time." action={<Link href="/request/sourcing" className="btn btn-primary btn-sm">Create an RFQ</Link>} />}>
          {(rfqs ?? []).map((r) => {
            const quotes = (r.quotes as { id: string; status: string }[] | null) ?? [];
            const waiting = quotes.filter((x) => x.status === 'sent' || x.status === 'viewed').length;
            return (
              <tr key={r.id}>
                <td className="td mono text-sm">{r.code}</td>
                <td className="td font-semibold"><Link href={`/account/rfqs/${r.id}`} className="hover:text-blue">{r.title}</Link></td>
                <td className="td mono text-sm">{Number(r.quantity).toLocaleString('en-US')} {r.unit}</td>
                <td className="td">{r.target_price_cents ? <Money cents={Number(r.target_price_cents)} currency={r.currency as string} /> : '—'}</td>
                <td className="td">{quotes.length}{waiting ? <span className="ml-2 text-xs font-semibold text-blue">{waiting} to review</span> : null}</td>
                <td className="td"><StatusBadge status={r.status as string} /></td>
                <td className="td text-sm text-muted">{fmtDate(r.created_at as string)}</td>
                <td className="td text-right"><Link href={`/account/rfqs/${r.id}`} className="btn btn-ghost btn-sm">{waiting ? 'Compare' : 'Open'}</Link></td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}
