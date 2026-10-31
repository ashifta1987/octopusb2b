import Link from 'next/link';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, Stat, PageHeader, EmptyState, StatusBadge, Table, Notice } from '@/components/ui';
import { Field } from '@/components/admin/ui';
import { ActionForm, RunButton, ToggleSetting } from '@/components/admin/client';
import { CurrencyTotals, sumByCurrency } from '@/components/admin/currency';
import { nowMs } from '@/components/admin/server';
import { getCurrencyContext } from '@/lib/currency';
import { money, fmtDate, humanize } from '@/lib/format';
import { poolSettings, pct } from '@/components/store/pools/shared';
import { cancelPool, confirmDeposit, defaultPledge, extendPool, forceSettlePool, savePoolRules, togglePools } from './actions';

export const metadata = { title: 'Group buying' };

type SP = Promise<{ status?: string; closing?: string; pool?: string }>;
const STATUSES = ['open', 'locked', 'confirmed', 'shipped', 'completed', 'expired', 'cancelled'];
type Pledge = {
  id: string; pool_id: string; qty: number; status: string; deposit_minor: number; balance_minor: number | null; currency: string; pay_source: string;
  joined_at: string; order_id: string | null; organizations: { name: string; buyer_code: string | null; country: string | null } | null;
};

/** Admin › Group buying (SPEC §18.4): ON/OFF switch, rules, all pools with filled % and deposits held, admin actions. */
export default async function AdminPoolsPage({ searchParams }: { searchParams: SP }) {
  const s = await requireStaff('orders', 'view', '/admin/pools');
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status ?? '') ? sp.status! : sp.status === 'all' ? 'all' : 'open';
  const closing = sp.closing === '1';
  const sb = await createClient();
  const now = nowMs();

  let q = sb.from('pools').select('id, code, status, currency, target_qty, filled_qty, min_pledge, max_buyers, deadline_at, created_at, pool_price_minor, final_price_minor, balance_due_at, po_document_id, product_id, supplier_id, products(title, slug, unit)')
    .order('deadline_at', { ascending: true }).limit(300);
  if (status !== 'all') q = q.eq('status', status);
  if (closing) q = q.eq('status', 'open').lte('deadline_at', new Date(now + 48 * 3600e3).toISOString());
  const [{ data: poolRows, error }, settingsRes, counts, ctx] = await Promise.all([
    q,
    sb.from('site_settings').select('key, value').like('key', 'pool_%'),
    sb.from('pools').select('status'),
    getCurrencyContext(),
  ]);
  const pools = (poolRows ?? []) as unknown as {
    id: string; code: string; status: string; currency: string; target_qty: number; filled_qty: number; min_pledge: number; max_buyers: number; deadline_at: string;
    created_at: string; pool_price_minor: number | null; final_price_minor: number | null; balance_due_at: string | null; po_document_id: string | null;
    supplier_id: string; products: { title: string; slug: string; unit: string } | null;
  }[];
  const ids = pools.map((p) => p.id);
  const [{ data: pledgeRows }, { data: sups }] = await Promise.all([
    ids.length ? sb.from('pool_pledges').select('id, pool_id, qty, status, deposit_minor, balance_minor, currency, pay_source, joined_at, order_id, organizations(name, buyer_code, country)').in('pool_id', ids).order('joined_at')
      : Promise.resolve({ data: [] }),
    sb.from('suppliers').select('id, code').in('id', [...new Set(pools.map((p) => p.supplier_id))]),
  ]);
  const pledges = (pledgeRows ?? []) as unknown as Pledge[];
  const byPool = new Map<string, Pledge[]>();
  pledges.forEach((p) => { const l = byPool.get(p.pool_id) ?? []; l.push(p); byPool.set(p.pool_id, l); });
  const supCode = new Map((sups ?? []).map((x) => [x.id as string, x.code as string]));
  const rules = poolSettings(Object.fromEntries((settingsRes.data ?? []).map((r) => [r.key as string, r.value])));
  const statusCount = (counts.data ?? []).reduce<Record<string, number>>((a, r) => { a[r.status as string] = (a[r.status as string] ?? 0) + 1; return a; }, {});
  const heldRows = pledges.filter((p) => p.status === 'paid' && pools.find((x) => x.id === p.pool_id)?.status === 'open');
  const held = sumByCurrency(heldRows, (p) => p.deposit_minor, (p) => p.currency);
  const soon = pools.filter((p) => p.status === 'open' && new Date(p.deadline_at).getTime() - now < 48 * 3600e3).length;
  const approve = s.isAdmin || can(s, 'orders', 'approve');
  const edit = can(s, 'orders', 'edit');
  const finance = can(s, 'wallet', 'approve');
  const href = (patch: Record<string, string | null>) => {
    const u = new URLSearchParams();
    const cur: Record<string, string | null> = { status: status === 'open' ? null : status, closing: closing ? '1' : null, pool: sp.pool ?? null, ...patch };
    Object.entries(cur).forEach(([k, v]) => v && u.set(k, v));
    const qs = u.toString();
    return qs ? `/admin/pools?${qs}` : '/admin/pools';
  };

  return (
    <>
      <PageHeader title="Group buying" subtitle="MOQ pools: buyers share a factory minimum, pay a deposit held in escrow and the balance only when the pool fills."
        actions={<span className="inline-flex items-center gap-2"><span className="font-semibold">Group buy</span><ToggleSetting checked={rules.enabled} label="Group buying" disabled={!s.isAdmin} showText onToggle={togglePools} /></span>} />
      {!rules.enabled && <div className="mb-6"><Notice tone="amber">Group buying is OFF — the storefront hides pools and no one can open or join a pool. Existing pools keep running (cron still settles / expires them).</Notice></div>}
      {error && <div className="mb-6"><Notice tone="red">{error.message}</Notice></div>}

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 mb-6">
        <Stat label="Open pools" value={statusCount.open ?? 0} hint={soon ? `${soon} closing within 48 h` : undefined} hintTone={soon ? 'warn' : undefined} />
        <Stat label="Deposits held in escrow" value={<CurrencyTotals totals={held} ctx={ctx} />} hint={status === 'open' && !closing ? 'paid pledges in open pools' : 'for the pools listed'} />
        <Stat label="Waiting for balances" value={statusCount.locked ?? 0} hint={`${rules.balanceHours} h window`} />
        <Stat label="Expired · cancelled" value={`${statusCount.expired ?? 0} · ${statusCount.cancelled ?? 0}`} />
      </div>

      <Card className="p-6 mb-6" title="Pool rules">
        <ActionForm action={savePoolRules} submitLabel="Save rules">
          <fieldset disabled={!s.isAdmin} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {([
              ['pool_deposit_pct', 'Deposit (%)', rules.depositPct, 'of the pledge value, held in escrow'],
              ['pool_min_pledge_default', 'Default minimum pledge', rules.minPledgeDefault, 'units · products can override'],
              ['pool_max_buyers', 'Max buyers per pool', rules.maxBuyers, 'keeps logistics simple'],
              ['pool_balance_hours', 'Balance window (hours)', rules.balanceHours, 'after the pool fills'],
              ['pool_min_days', 'Shortest deadline (days)', rules.minDays, ''],
              ['pool_max_days', 'Longest deadline (days)', rules.maxDays, ''],
              ['pool_default_days', 'Default deadline (days)', rules.defaultDays, ''],
            ] as const).map(([k, l, v, h]) => (
              <Field key={k} label={l} htmlFor={k} hint={h || undefined}><input id={k} name={k} type="number" min={1} defaultValue={v} className="input mono" required /></Field>
            ))}
          </fieldset>
          {!s.isAdmin && <p className="text-xs text-muted mt-2">Only an Admin can change the rules.</p>}
        </ActionForm>
      </Card>

      <nav aria-label="Filter pools" className="flex flex-wrap gap-2 mb-4">
        {['open', 'locked', 'confirmed', 'shipped', 'completed', 'expired', 'cancelled', 'all'].map((k) => (
          <Link key={k} href={href({ status: k === 'open' ? null : k, closing: null, pool: null })} aria-current={status === k && !closing ? 'page' : undefined}
            className={`px-3.5 py-1.5 rounded-full border text-sm font-semibold ${status === k && !closing ? 'bg-navy text-white border-navy' : 'bg-white border-line-2'}`}>
            {k === 'locked' ? 'Waiting for balances' : humanize(k)}{k !== 'all' && ` · ${statusCount[k] ?? 0}`}
          </Link>
        ))}
        <Link href={href({ closing: closing ? null : '1', status: null, pool: null })} aria-current={closing ? 'page' : undefined}
          className={`px-3.5 py-1.5 rounded-full border text-sm font-semibold ${closing ? 'bg-[#B4540A] text-white border-[#B4540A]' : 'bg-white border-line-2'}`}>Closing within 48 h</Link>
      </nav>

      <Card>
        <Table head={['Pool', 'Product · supplier', 'Filled', 'Buyers', 'Deposits held', 'Deadline', 'Status', 'Actions']}
          empty={<EmptyState title="No pools here" body="Pools appear when buyers start them from a product page." />}>
          {pools.flatMap((p) => {
            const list = byPool.get(p.id) ?? [];
            const active = list.filter((x) => ['pending', 'paid', 'confirmed', 'shipped', 'delivered'].includes(x.status));
            const dep = sumByCurrency(list.filter((x) => x.status === 'paid' || x.status === 'confirmed'), (x) => x.deposit_minor, (x) => x.currency);
            const open = sp.pool === p.id;
            const unit = p.products?.unit ?? 'units';
            const rows = [
              <tr key={p.id} className={open ? 'bg-surface' : undefined}>
                <td className="td"><Link href={`/pool/${p.code}`} className="mono text-sm font-semibold hover:text-blue">{p.code}</Link><div className="text-xs text-muted">opened {fmtDate(p.created_at)}</div></td>
                <td className="td text-sm">{p.products?.title ?? '—'}<div className="text-xs text-muted mono">{supCode.get(p.supplier_id) ?? ''}</div></td>
                <td className="td text-sm">
                  <div className="mono">{p.filled_qty.toLocaleString('en-US')} / {p.target_qty.toLocaleString('en-US')}</div>
                  <div className="w-28 h-1.5 bg-[#E9ECF1] rounded-full mt-1 overflow-hidden" aria-hidden><div className="h-full bg-blue" style={{ width: `${pct(p.filled_qty, p.target_qty)}%` }} /></div>
                  <div className="text-xs text-muted">{pct(p.filled_qty, p.target_qty)}% · {money(p.final_price_minor ?? p.pool_price_minor, p.currency)}/unit</div>
                </td>
                <td className="td text-sm">{active.length} / {p.max_buyers}</td>
                <td className="td text-sm"><CurrencyTotals totals={dep} ctx={ctx} /></td>
                <td className="td text-sm">{fmtDate(p.deadline_at, true)}{p.balance_due_at && <div className="text-xs text-muted">balance by {fmtDate(p.balance_due_at, true)}</div>}</td>
                <td className="td"><StatusBadge status={p.status} label={p.status === 'locked' ? 'Waiting for balances' : undefined} /></td>
                <td className="td">
                  <div className="flex flex-wrap gap-1.5 items-start">
                    <Link href={href({ pool: open ? null : p.id })} scroll={false} className="btn btn-ghost btn-sm">{open ? 'Hide pledges' : `Pledges (${list.length})`}</Link>
                    {p.po_document_id && <a href={`/api/documents/${p.po_document_id}/pdf`} className="btn btn-ghost btn-sm" target="_blank" rel="noreferrer">PO</a>}
                    {approve && p.status === 'open' && (
                      <ActionForm action={extendPool} inline submitLabel="Extend" submitClass="btn btn-ghost btn-sm" className="inline-flex items-center gap-1">
                        <input type="hidden" name="pool_id" value={p.id} />
                        <label className="sr-only" htmlFor={`days-${p.id}`}>Extend by days</label>
                        <input id={`days-${p.id}`} name="days" type="number" min={1} max={60} defaultValue={3} className="input !min-h-9 !w-16 mono text-sm" />
                      </ActionForm>
                    )}
                    {s.isAdmin && p.status === 'open' && (
                      <RunButton action={forceSettlePool.bind(null, p.id)} className="btn btn-ghost btn-sm"
                        confirm={`Force-settle ${p.code}? Unpaid card pledges lapse, the target drops to the paid quantity (${list.filter((x) => x.status === 'paid').reduce((a, x) => a + x.qty, 0).toLocaleString('en-US')} ${unit}) and every paid buyer gets a proforma invoice.`}>Force-settle</RunButton>
                    )}
                    {approve && ['open', 'locked', 'confirmed'].includes(p.status) && (
                      <RunButton action={cancelPool.bind(null, p.id)} className="btn btn-danger btn-sm" prompt={`Cancel ${p.code} and refund every buyer to their wallet. Reason (shown in the pool timeline):`}>Cancel &amp; refund</RunButton>
                    )}
                  </div>
                </td>
              </tr>,
            ];
            if (open) {
              rows.push(
                <tr key={`${p.id}-pledges`}>
                  <td colSpan={8} className="td bg-surface">
                    {list.length ? (
                      <table className="w-full border-collapse bg-white rounded-[10px]">
                        <thead><tr>{['Buyer', 'Company (staff only)', 'Qty', 'Deposit', 'Pay source', 'Status', 'Joined', ''].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
                        <tbody>
                          {list.map((x) => (
                            <tr key={x.id}>
                              <td className="td mono text-sm">{x.organizations?.buyer_code ?? '—'}</td>
                              <td className="td text-sm">{x.organizations?.name ?? '—'}{x.organizations?.country && <span className="text-muted"> · {x.organizations.country}</span>}</td>
                              <td className="td mono text-sm">{x.qty.toLocaleString('en-US')} {unit}</td>
                              <td className="td text-sm">{money(x.deposit_minor, x.currency)}{x.balance_minor != null && <div className="text-xs text-muted">balance {money(x.balance_minor, x.currency)}</div>}</td>
                              <td className="td text-sm">{x.pay_source === 'wallet' ? 'Wallet' : 'Card / bank'}</td>
                              <td className="td"><StatusBadge status={x.status} /></td>
                              <td className="td text-sm text-muted">{fmtDate(x.joined_at)}</td>
                              <td className="td">
                                <div className="flex flex-wrap gap-1.5 justify-end">
                                  {x.order_id && <Link href={`/office/orders/${x.order_id}`} className="btn btn-ghost btn-sm">Order</Link>}
                                  {finance && x.status === 'pending' && p.status === 'open' && (
                                    <RunButton action={confirmDeposit.bind(null, x.id)} confirm={`Confirm that the ${money(x.deposit_minor, x.currency)} deposit was received by card / bank transfer?`}>Confirm deposit</RunButton>
                                  )}
                                  {edit && x.status === 'paid' && x.order_id && p.status === 'locked' && (
                                    <RunButton action={defaultPledge.bind(null, x.id)} className="btn btn-danger btn-sm"
                                      confirm={`Mark this pledge defaulted? The unpaid balance is reversed and the ${money(x.deposit_minor, x.currency)} deposit is forfeited to cover the shortfall.`}>Mark defaulted</RunButton>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : <p className="text-sm text-muted">No pledges.</p>}
                  </td>
                </tr>,
              );
            }
            return rows;
          })}
        </Table>
      </Card>
    </>
  );
}
