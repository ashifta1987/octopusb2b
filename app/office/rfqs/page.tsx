import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader, StatusBadge, Table, EmptyState, Money } from '@/components/ui';
import { one } from '@/components/backoffice/server-utils';
import { fmtDate, COUNTRY_NAMES } from '@/lib/format';

/** Request time (server components render per request after the session read). */
const nowMs = () => Date.now();

export const metadata = { title: 'RFQs & quotes' };

const FILTERS: Record<string, string[]> = {
  open: ['submitted', 'assigned', 'quoting', 'quoted'], to_quote: ['submitted', 'assigned', 'quoting'], accepted: ['accepted'], closed: ['expired', 'cancelled'],
};

export default async function OfficeRfqs({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  await requireStaff('requests', 'view', '/office/rfqs');
  const { f = 'open' } = await searchParams;
  const sb = await createClient();
  const { data } = await sb.from('rfqs')
    .select('id, code, title, quantity, unit, target_price_cents, currency, destination_country, destination_city, status, created_at, expires_at, organizations(city, country), quotes(id)')
    .in('status', FILTERS[f] ?? FILTERS.open).order('created_at', { ascending: f !== 'closed' && f !== 'accepted' }).limit(200);
  return (
    <>
      <PageHeader title="RFQs & quotes" subtitle="Buyer requests. Open one to see the requested specs and add quotes for any supplier." />
      <nav className="flex flex-wrap gap-2 mb-4" aria-label="Filter">
        {Object.keys(FILTERS).map((k) => <Link key={k} href={`/office/rfqs?f=${k}`} aria-current={f === k ? 'page' : undefined} className={`btn btn-sm ${f === k ? 'btn-dark' : 'btn-ghost'}`}>{k.replace('_', ' ')}</Link>)}
      </nav>
      <Card>
        <Table head={['RFQ', 'Request', 'Customer location', 'Target', 'Quotes', 'Age', 'Status', '']} empty={<EmptyState title="No RFQs here" />}>
          {(data ?? []).map((r) => {
            const o = one(r.organizations as unknown as { city: string | null; country: string | null } | null);
            const ageH = Math.round((nowMs() - new Date(r.created_at).getTime()) / 36e5);
            const nq = (r.quotes as unknown[] | null)?.length ?? 0;
            return (
              <tr key={r.id}>
                <td className="td mono text-sm">{r.code}</td>
                <td className="td"><div className="font-semibold">{r.title}</div><div className="text-xs text-muted">{r.quantity.toLocaleString()} {r.unit} → {[r.destination_city, r.destination_country].filter(Boolean).join(', ') || '—'}</div></td>
                <td className="td text-sm">{[o?.city, o?.country ? COUNTRY_NAMES[o.country] ?? o.country : null].filter(Boolean).join(', ') || '—'}</td>
                <td className="td">{r.target_price_cents ? <Money cents={r.target_price_cents} currency={r.currency} /> : '—'}</td>
                <td className="td text-sm">{nq}</td>
                <td className={`td text-sm ${ageH > 48 && nq === 0 && r.status !== 'accepted' ? 'text-bad font-semibold' : ''}`}>{ageH < 48 ? `${ageH} h` : `${Math.round(ageH / 24)} d`}<div className="text-xs text-muted font-normal">{fmtDate(r.created_at)}</div></td>
                <td className="td"><StatusBadge status={r.status} /></td>
                <td className="td text-right"><Link href={`/office/rfqs/${r.id}`} className="btn btn-ghost btn-sm">Open</Link></td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}
