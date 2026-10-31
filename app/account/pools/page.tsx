import Link from 'next/link';
import { requireCustomer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader, Card, Table, StatusBadge, EmptyState, Notice, Money, Stat } from '@/components/ui';
import { fmtDate, humanize } from '@/lib/format';
import { sumByCurrency, CurrencyTotalsInline } from '@/components/account/pool-utils';
import { Countdown } from '@/components/store/pools/countdown';
import { WithdrawButton } from '@/components/store/pools/pool-actions';

export const metadata = { title: 'Group buys' };

type Row = {
  id: string; pool_id: string; pool_code: string; pool_status: string; product_title: string; product_slug: string; qty: number; status: string;
  deposit_minor: number; balance_minor: number | null; currency: string; pay_source: string; joined_at: string; deadline_at: string;
  target_qty: number; filled_qty: number; balance_due_at: string | null; order_id: string | null; order_code: string | null;
  order_total_minor: number | null; order_paid_minor: number | null; order_status: string | null;
};

const PLEDGE_LABEL: Record<string, string> = { pending: 'Deposit pending', paid: 'Deposit paid', confirmed: 'Balance paid', withdrawn: 'Withdrawn / refunded', defaulted: 'Defaulted' };

/** Customer portal — My pledges (SPEC §18.4). Every amount in the pledge's own currency. */
export default async function MyPoolsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const s = await requireCustomer('/account/pools');
  if (!s.org) return <Notice tone="amber">Complete your company profile first.</Notice>;
  const { filter } = await searchParams;
  const sb = await createClient();
  const { data, error } = await sb.from('pool_pledge_mine_view')
    .select('id, pool_id, pool_code, pool_status, product_title, product_slug, qty, status, deposit_minor, balance_minor, currency, pay_source, joined_at, deadline_at, target_qty, filled_qty, balance_due_at, order_id, order_code, order_total_minor, order_paid_minor, order_status')
    .eq('org_id', s.org.id).order('joined_at', { ascending: false }).limit(500);
  const all = (data ?? []) as Row[];
  const unpaid = (r: Row) => (r.order_id && r.order_total_minor != null && r.order_paid_minor != null ? Math.max(0, Number(r.order_total_minor) - Number(r.order_paid_minor)) : 0);
  const isActive = (r: Row) => ['pending', 'paid', 'confirmed', 'shipped'].includes(r.status);
  const rows = filter === 'active' ? all.filter(isActive) : filter === 'closed' ? all.filter((r) => !isActive(r)) : all;
  const due = all.filter((r) => r.status === 'paid' && unpaid(r) > 0);
  const held = all.filter((r) => r.status === 'paid' && r.pool_status === 'open');

  return (
    <>
      <PageHeader title="Group buys" subtitle="Your pledges in MOQ pools: deposits held in escrow, balances due and pool status."
        actions={<Link href="/pools" className="btn btn-primary btn-sm">Browse open pools</Link>} />
      {error && <div className="mb-4"><Notice tone="red">Could not load your pledges: {error.message}</Notice></div>}
      {due.length > 0 && (
        <div className="mb-6">
          <Notice tone="amber">
            {due.length === 1 ? 'A pool you joined has filled' : `${due.length} pools you joined have filled`} — pay the balance before the deadline or the deposit is forfeited.{' '}
            {due.slice(0, 3).map((r) => <Link key={r.id} href={`/account/orders/${r.order_id}`} className="underline font-semibold mr-2">Pay {r.order_code ?? r.pool_code}</Link>)}
          </Notice>
        </div>
      )}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 mb-6">
        <Stat label="Active pledges" value={all.filter(isActive).length} />
        <Stat label="Deposits held in escrow" value={<CurrencyTotalsInline totals={sumByCurrency(held, (r) => r.deposit_minor, (r) => r.currency)} />} hint="refunded if the pool does not fill" />
        <Stat label="Balances due" value={<CurrencyTotalsInline totals={sumByCurrency(due, (r) => unpaid(r), (r) => r.currency)} />} hintTone={due.length ? 'warn' : undefined} hint={due.length ? `${due.length} to pay` : undefined} />
        <Stat label="Pools joined" value={new Set(all.map((r) => r.pool_id)).size} />
      </div>
      <nav aria-label="Filter pledges" className="flex gap-2 mb-4">
        {[{ k: undefined, l: 'All' }, { k: 'active', l: 'Active' }, { k: 'closed', l: 'Closed & refunded' }].map((t) => (
          <Link key={t.l} href={t.k ? `/account/pools?filter=${t.k}` : '/account/pools'} aria-current={filter === t.k ? 'page' : undefined}
            className={`px-4 py-2 rounded-full border text-sm font-semibold ${filter === t.k ? 'bg-navy text-white border-navy' : 'bg-white border-line-2'}`}>{t.l}</Link>
        ))}
      </nav>
      <Card>
        <Table head={['Pool', 'Pledge', 'Status', 'Deposit', 'Balance due', 'Pool', '']}
          empty={<EmptyState title="No group buys yet" body="Join an open pool to buy below the MOQ at the factory tier price." action={<Link href="/pools" className="btn btn-primary btn-sm">See open pools</Link>} />}>
          {rows.map((r) => {
            const bal = unpaid(r);
            return (
              <tr key={r.id}>
                <td className="td">
                  <Link href={`/pool/${r.pool_code}`} className="mono text-sm font-semibold hover:text-blue">{r.pool_code}</Link>
                  <div className="text-sm"><Link href={`/p/${r.product_slug}`} className="hover:text-blue">{r.product_title}</Link></div>
                  <div className="text-xs text-muted">Joined {fmtDate(r.joined_at)}</div>
                </td>
                <td className="td mono text-sm">{Number(r.qty).toLocaleString('en-US')}</td>
                <td className="td"><StatusBadge status={r.status} label={PLEDGE_LABEL[r.status]} /></td>
                <td className="td">
                  <Money cents={r.deposit_minor} currency={r.currency} className={r.status === 'paid' || r.status === 'confirmed' ? '' : 'text-muted'} />
                  <div className="text-xs text-muted">{r.pay_source === 'wallet' ? 'Wallet' : 'Card / bank'}{r.status === 'pending' && ' · awaiting payment'}</div>
                </td>
                <td className="td">
                  {r.order_id ? (
                    bal > 0 && r.status === 'paid' ? (
                      <>
                        <Money cents={bal} currency={r.currency} />
                        {r.balance_due_at && <div className="text-xs font-semibold text-[#B4540A]"><Countdown to={r.balance_due_at} withMinutes suffix=" left" /></div>}
                      </>
                    ) : <span className="text-sm text-ok font-semibold">{bal === 0 ? 'Paid' : '—'}</span>
                  ) : <span className="text-sm text-muted">{r.pool_status === 'open' ? 'When the pool fills' : '—'}</span>}
                </td>
                <td className="td">
                  <StatusBadge status={r.pool_status} />
                  <div className="text-xs text-muted mt-1">
                    {r.pool_status === 'open'
                      ? <>{Number(r.filled_qty).toLocaleString('en-US')} / {Number(r.target_qty).toLocaleString('en-US')} · <Countdown to={r.deadline_at} prefix="closes in " /></>
                      : r.order_status ? <>Order {humanize(r.order_status).toLowerCase()}</> : null}
                  </div>
                </td>
                <td className="td text-right">
                  <div className="flex flex-col items-end gap-1.5">
                    {r.order_id && bal > 0 && r.status === 'paid' && <Link href={`/account/orders/${r.order_id}`} className="btn btn-primary btn-sm">Pay balance</Link>}
                    {r.order_id && !(bal > 0 && r.status === 'paid') && <Link href={`/account/orders/${r.order_id}`} className="btn btn-ghost btn-sm">View order</Link>}
                    <Link href={`/pool/${r.pool_code}`} className="btn btn-ghost btn-sm">View pool</Link>
                    {r.pool_status === 'open' && ['pending', 'paid'].includes(r.status) && <WithdrawButton pledgeId={r.id} code={r.pool_code} className="btn btn-ghost btn-sm text-bad" />}
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}
