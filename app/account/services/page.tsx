import Link from 'next/link';
import { requireCustomer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader, Card, Table, StatusBadge, EmptyState, Notice, Money } from '@/components/ui';
import { fmtDate, humanize } from '@/lib/format';
import { OrdersTabs } from '@/components/account/order-list';

export const metadata = { title: 'Service requests' };

/** Request Center types by service code (SPEC §4.1 step 4). */
const REQUEST_TYPE: Record<string, string> = { rfq: 'sourcing', sample: 'sample', qc: 'qc', certification: 'certification', '3pl': '3pl', dropship: 'dropship' };

export default async function ServicesPage() {
  const s = await requireCustomer('/account/services');
  if (!s.org) return <Notice tone="amber">Complete your company profile first.</Notice>;
  const sb = await createClient();
  const [{ data: reqs }, { data: services }, { count: rfqCount }, { count: orderCount }] = await Promise.all([
    sb.from('service_requests').select('id, code, service_code, status, fee_minor, currency, paid_via, details, created_at, updated_at, products(title), services(name)').eq('org_id', s.org.id).order('created_at', { ascending: false }),
    sb.from('services').select('code, name, description').eq('active', true).order('sort'),
    sb.from('rfqs').select('id', { count: 'exact', head: true }).eq('org_id', s.org.id),
    sb.from('orders').select('id', { count: 'exact', head: true }).eq('org_id', s.org.id),
  ]);
  return (
    <>
      <PageHeader title="Service requests" subtitle="Samples, QC inspections, certification checks, 3PL and dropshipping requests."
        actions={<Link href="/request/sourcing" className="btn btn-primary">New service request</Link>} />
      <OrdersTabs active="services" counts={{ orders: orderCount ?? 0, rfqs: rfqCount ?? 0, services: reqs?.length ?? 0 }} />
      <Card className="mb-6" title="Start a new request">
        <div className="px-6 pb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(services ?? []).map((sv) => (
            <Link key={sv.code} href={`/request/${REQUEST_TYPE[sv.code] ?? sv.code}`} className="rounded-[10px] border border-line p-4 hover:border-blue">
              <div className="font-semibold">{sv.name}</div>
              {sv.description && <div className="text-sm text-muted mt-1">{sv.description}</div>}
            </Link>
          ))}
        </div>
      </Card>
      <Card title="My requests">
        <Table head={['Request', 'Service', 'Details', 'Fee', 'Paid via', 'Status', 'Created']}
          empty={<EmptyState title="No service requests yet" body="Request samples, inspections or fulfilment quotes from the Request Center." action={<Link href="/request/sample" className="btn btn-primary btn-sm">New service request</Link>} />}>
          {(reqs ?? []).map((r) => {
            const d = (r.details ?? {}) as Record<string, unknown>;
            const summary = (d.title ?? d.summary ?? d.notes ?? (r.products as { title?: string } | null)?.title ?? '') as string;
            return (
              <tr key={r.id}>
                <td className="td mono text-sm">{r.code}</td>
                <td className="td font-semibold">{(r.services as { name?: string } | null)?.name ?? humanize(r.service_code)}</td>
                <td className="td text-sm text-muted max-w-[280px] truncate">{String(summary || '—')}</td>
                <td className="td">{Number(r.fee_minor) ? <Money cents={Number(r.fee_minor)} currency={r.currency as string} /> : <span className="text-sm">Free</span>}</td>
                <td className="td text-sm">{humanize(r.paid_via ?? '—')}</td>
                <td className="td"><StatusBadge status={r.status as string} /></td>
                <td className="td text-sm text-muted">{fmtDate(r.created_at as string)}</td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}
