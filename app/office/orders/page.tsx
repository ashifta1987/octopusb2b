import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader, StatusBadge, Table, EmptyState, Money } from '@/components/ui';
import { one } from '@/components/backoffice/server-utils';
import { fmtDate, humanize } from '@/lib/format';

export const metadata = { title: 'Orders' };

const FILTERS: Record<string, string[] | null> = {
  active: ['pi_issued', 'deposit_pending', 'deposit_paid', 'confirmed', 'in_production', 'qc', 'balance_pending', 'balance_paid', 'ready_to_ship', 'shipped'],
  awaiting_payment: ['deposit_pending', 'balance_pending'], ready_to_ship: ['ready_to_ship'], delivered: ['delivered', 'closed'], problems: ['disputed', 'cancelled'], all: null,
};

export default async function OfficeOrders({ searchParams }: { searchParams: Promise<{ f?: string; q?: string }> }) {
  await requireStaff('orders', 'view', '/office/orders');
  const { f = 'active', q } = await searchParams;
  const sb = await createClient();
  let query = sb.from('orders')
    .select('id, code, title, status, total_cents, paid_cents, deposit_cents, created_at, updated_at, organizations(name, country), suppliers(code)')
    .order('updated_at', { ascending: false }).limit(200);
  const st = FILTERS[f] ?? FILTERS.active;
  if (st) query = query.in('status', st);
  if (q) query = query.or(`code.ilike.%${q.replace(/[,()]/g, '')}%,title.ilike.%${q.replace(/[,()]/g, '')}%`);
  const { data } = await query;
  return (
    <>
      <PageHeader title="Orders" subtitle="All orders. Open one to move it through its workflow, record bank payments and see its events." />
      <form className="flex flex-wrap gap-2 mb-4 items-center" role="search">
        {Object.keys(FILTERS).map((k) => <Link key={k} href={`/office/orders?f=${k}`} aria-current={f === k ? 'page' : undefined} className={`btn btn-sm ${f === k ? 'btn-dark' : 'btn-ghost'}`}>{humanize(k)}</Link>)}
        <input type="hidden" name="f" value={f} />
        <label htmlFor="o-q" className="sr-only">Search orders</label>
        <input id="o-q" name="q" defaultValue={q} placeholder="ORD-… or title" className="input w-56 min-h-9 text-sm ml-auto" />
        <button className="btn btn-ghost btn-sm">Search</button>
      </form>
      <Card>
        <Table head={['Order', 'Customer', 'Supplier', 'Total', 'Paid', 'Updated', 'Status', '']} empty={<EmptyState title="No orders here" />}>
          {(data ?? []).map((o) => {
            const org = one(o.organizations as unknown as { name: string; country: string | null } | null);
            return (
              <tr key={o.id}>
                <td className="td"><div className="mono text-sm font-semibold">{o.code}</div><div className="text-xs text-muted line-clamp-1">{o.title}</div></td>
                <td className="td text-sm">{org?.name ?? '—'} <span className="text-muted">{org?.country}</span></td>
                <td className="td mono text-sm">{one(o.suppliers as unknown as { code: string } | null)?.code ?? '—'}</td>
                <td className="td"><Money cents={o.total_cents} /></td>
                <td className="td"><Money cents={o.paid_cents} /><div className="text-xs text-muted">{Math.round((o.paid_cents / Math.max(1, o.total_cents)) * 100)}%</div></td>
                <td className="td text-sm">{fmtDate(o.updated_at)}</td>
                <td className="td"><StatusBadge status={o.status} /></td>
                <td className="td text-right"><Link href={`/office/orders/${o.id}`} className="btn btn-ghost btn-sm">Open</Link></td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}
