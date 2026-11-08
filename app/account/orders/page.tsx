import Link from 'next/link';
import { requireCustomer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader, Card, Table, StatusBadge, EmptyState, Notice, Money, OrderProgress } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { OrdersTabs } from '@/components/account/order-list';
import { RealtimeRefresh } from '@/components/account/realtime-refresh';
import { ACTIVE_ORDER } from '@/components/account/order-utils';

export const metadata = { title: 'Orders & tracking' };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const s = await requireCustomer('/account/orders');
  if (!s.org) return <Notice tone="amber">Complete your company profile first.</Notice>;
  const { filter } = await searchParams;
  const sb = await createClient();
  let q = sb.from('orders').select('id, code, title, quantity, status, total_cents, paid_cents, deposit_cents, currency, created_at, updated_at').eq('org_id', s.org.id).order('updated_at', { ascending: false });
  if (filter === 'active') q = q.in('status', ACTIVE_ORDER);
  if (filter === 'done') q = q.in('status', ['delivered', 'closed', 'cancelled', 'disputed']);
  const [{ data: orders }, { count: rfqCount }, { count: srCount }, { count: orderCount }] = await Promise.all([
    q,
    sb.from('rfqs').select('id', { count: 'exact', head: true }).eq('org_id', s.org.id),
    sb.from('service_requests').select('id', { count: 'exact', head: true }).eq('org_id', s.org.id),
    sb.from('orders').select('id', { count: 'exact', head: true }).eq('org_id', s.org.id),
  ]);
  const featured = (orders ?? []).find((o) => ACTIVE_ORDER.includes(o.status as string));
  return (
    <>
      <PageHeader title="Orders & tracking" subtitle="Every update on your orders, RFQs and services, as it happens."
        actions={<RealtimeRefresh channel="orders-list" subs={[{ table: 'order_events', filter: `org_id=eq.${s.org.id}` }, { table: 'tracking_events', filter: `org_id=eq.${s.org.id}` }]} />} />
      <OrdersTabs active="orders" counts={{ orders: orderCount ?? 0, rfqs: rfqCount ?? 0, services: srCount ?? 0 }} />
      {featured && (
        <Card className="p-6 mb-6">
          <div className="flex flex-wrap justify-between gap-3">
            <div>
              <div className="mono text-xs text-muted">{featured.code}</div>
              <Link href={`/account/orders/${featured.id}`} className="text-xl font-semibold hover:text-coral-text">{featured.title}</Link>
            </div>
            <StatusBadge status={featured.status as string} />
          </div>
          <div className="mt-5"><OrderProgress status={featured.status as string} /></div>
        </Card>
      )}
      <nav aria-label="Filter orders" className="flex gap-2 mb-4">
        {[{ k: undefined, l: 'All' }, { k: 'active', l: 'Active' }, { k: 'done', l: 'Completed & cancelled' }].map((t) => (
          <Link key={t.l} href={t.k ? `/account/orders?filter=${t.k}` : '/account/orders'} aria-current={filter === t.k ? 'page' : undefined}
            className={`px-4 py-2 rounded-full border text-sm font-semibold ${filter === t.k ? 'bg-ink text-white border-ink' : 'bg-white border-line-strong'}`}>{t.l}</Link>
        ))}
      </nav>
      <Card>
        <Table head={['Order', 'Product', 'Total', 'Paid', 'Status', 'Created', '']}
          empty={<EmptyState title="No orders here" body="Approve a quote on one of your RFQs to create an order." action={<Link href="/account/sourcing" className="btn btn-primary btn-sm">View RFQs</Link>} />}>
          {(orders ?? []).map((o) => (
            <tr key={o.id}>
              <td className="td mono text-sm">{o.code}</td>
              <td className="td font-semibold"><Link href={`/account/orders/${o.id}`} className="hover:text-coral-text">{o.title}</Link><div className="text-xs text-muted font-normal">{Number(o.quantity).toLocaleString('en-US')} units</div></td>
              <td className="td"><Money cents={Number(o.total_cents)} currency={o.currency as string} /></td>
              <td className="td"><Money cents={Number(o.paid_cents)} currency={o.currency as string} className="text-muted" /></td>
              <td className="td"><StatusBadge status={o.status as string} /></td>
              <td className="td text-sm text-muted">{fmtDate(o.created_at as string)}</td>
              <td className="td text-right"><Link href={`/account/orders/${o.id}`} className="btn btn-ghost btn-sm">Open</Link></td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
