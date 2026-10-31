import Link from 'next/link';
import { StatusBadge, EmptyState } from '@/components/ui';
import { cn } from '@/lib/cn';
import { relTime } from './order-utils';

export type OrderListItem = { id: string; code: string; title: string; quantity: number; status: string; updated_at: string };

/** Left-column order list (CustomerOrders.png). */
export function OrderList({ orders, activeId }: { orders: OrderListItem[]; activeId?: string }) {
  if (!orders.length) return <div className="card"><EmptyState title="No orders yet" body="Approve a quote on one of your RFQs to create your first order." action={<Link href="/account/rfqs" className="btn btn-primary btn-sm">View RFQs</Link>} /></div>;
  return (
    <ul className="card overflow-hidden divide-y divide-line">
      {orders.map((o) => (
        <li key={o.id}>
          <Link href={`/account/orders/${o.id}`} aria-current={o.id === activeId ? 'page' : undefined}
            className={cn('block px-5 py-4 hover:bg-surface', o.id === activeId && 'bg-blue-soft border-l-4 border-blue')}>
            <div className="flex justify-between gap-3 text-xs text-muted"><span className="mono">{o.code}</span><span>{relTime(o.updated_at)}</span></div>
            <div className="font-semibold mt-1">{o.title}</div>
            <div className="mt-2"><StatusBadge status={o.status} /></div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function OrdersTabs({ active, counts }: { active: 'orders' | 'rfqs' | 'services'; counts: { orders: number; rfqs: number; services: number } }) {
  const tabs = [
    { k: 'orders', href: '/account/orders', l: 'Orders', n: counts.orders },
    { k: 'rfqs', href: '/account/rfqs', l: 'RFQs', n: counts.rfqs },
    { k: 'services', href: '/account/services', l: 'Samples & services', n: counts.services },
  ] as const;
  return (
    <nav aria-label="Orders, RFQs and services" className="flex flex-wrap gap-2 mb-6">
      {tabs.map((t) => (
        <Link key={t.k} href={t.href} aria-current={active === t.k ? 'page' : undefined}
          className={cn('inline-flex items-center gap-2 px-5 py-2.5 rounded-full border font-semibold text-[15px]', active === t.k ? 'bg-navy text-white border-navy' : 'bg-white border-line-2 text-navy')}>
          {t.l}<span className="text-xs opacity-80">{t.n}</span>
        </Link>
      ))}
    </nav>
  );
}
