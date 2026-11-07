import Link from 'next/link';
import { requireStaffOrManager, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Notice } from '@/components/ui';
import { money } from '@/lib/format';
import { getWorkQueue, type QueueItem } from '@/lib/core/work-queue';
import { MailDeliverabilityAlert } from '@/components/admin/mail-deliverability';

export const metadata = { title: 'Work queue' };

const SVC: Record<QueueItem['service'], [string, string]> = {
  sourcing: ['Sourcing', 'bg-[#E8F0FC] text-[#1E4F9C]'], dropship: ['Dropshipping', 'bg-surface text-[#3B4556]'], warehouse: ['3PL warehouse', 'bg-[#DCFCE7] text-[#166534]'],
  brand: ['Make My Brand', 'bg-[#FDECD9] text-[#9A4A10]'], wallet: ['Wallet', 'bg-[#EDE9FE] text-[#5B21B6]'],
};
const NOTICES: Record<string, string> = { 'staff-not-customer': 'Staff accounts cannot use My account. Customers sign in with their own accounts.' };

/** ADDON-41 board 06 — work queue: everything customers need from this staff member, late and blocked items first. */
export default async function WorkQueue({ searchParams }: { searchParams: Promise<{ s?: string; owner?: string; notice?: string }> }) {
  const s = await requireStaffOrManager('/admin', ['dashboard', 'view'], ['approvals', 'view'], ['wallet', 'approve']);
  const sp = await searchParams;
  const sb = await createClient();
  const isManager = s.roles.includes('account_manager');
  const [q, myCustomers, limits, integrations] = await Promise.all([
    getWorkQueue(s),
    isManager ? sb.from('account_managers').select('org_id, organizations(name), is_primary').eq('staff_user_id', s.userId).eq('is_primary', true) : Promise.resolve({ data: null }),
    sb.from('manager_limits').select('max_amount_cents, min_margin_pct, set_at').eq('manager_user_id', s.userId).maybeSingle(),
    can(s, 'integrations', 'view') ? sb.from('integrations').select('code, name, status, last_tested_at').in('kind', ['dropship', 'carrier']) : Promise.resolve({ data: null }),
  ]);
  const services = [...new Set(q.items.map((i) => i.service))];
  const svc = sp.s && services.includes(sp.s as QueueItem['service']) ? sp.s : 'all';
  const onlyOwner = sp.owner === '1';
  const shown = q.items.filter((i) => (svc === 'all' || i.service === svc) && (!onlyOwner || i.owner));
  const href = (patch: Record<string, string | null>) => {
    const u = new URLSearchParams(); if (svc !== 'all') u.set('s', svc); if (onlyOwner) u.set('owner', '1');
    Object.entries(patch).forEach(([k, v]) => (v ? u.set(k, v) : u.delete(k)));
    return `/admin${u.size ? `?${u}` : ''}`;
  };
  const transfers = q.items.filter((i) => i.key.startsWith('tt-')).length;

  return (
    <>
      {sp.notice && NOTICES[sp.notice] && <div className="mb-4"><Notice tone="blue">{NOTICES[sp.notice]}</Notice></div>}
      {s.isAdmin && <MailDeliverabilityAlert />}
      <div className="mono text-[11.5px] font-semibold uppercase tracking-[.1em] text-blue">Admin · me</div>
      <h1 className="text-[32px] font-extrabold leading-tight">Work queue</h1>
      <p className="text-[15px] text-[#5A6475] mt-1">Everything your customers need from you, across Sourcing, Dropshipping, 3PL warehouse and Make My Brand. Late and blocked items first.</p>
      <div className="mt-4 flex flex-wrap gap-3">
        {can(s, 'support', 'view') && <Link href="/office/support" className="btn btn-ghost min-h-11">Messages</Link>}
        {can(s, 'requests', 'view') && <Link href="/office/rfqs" className="btn btn-dark min-h-11">Sourcing requests</Link>}
      </div>

      <section className="card p-5 mt-6" aria-labelledby="today-h">
        <h2 id="today-h" className="text-[18px] font-bold">Today</h2>
        <dl className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-3">
          {([['Open items', q.stats.open, false], ['Need owner approval', q.stats.needOwner, false], ['Waiting for customer', q.stats.waitingCustomer, false], ['Due today or late', q.stats.dueOrLate, q.stats.dueOrLate > 0]] as const).map(([l, v, red]) => (
            <div key={l}><dt className="mono text-[11px] font-semibold uppercase tracking-[.08em] text-[#5A6475]">{l}</dt><dd className={`text-[26px] font-extrabold ${red ? 'text-[#C2410C]' : ''}`}>{v}</dd></div>
          ))}
        </dl>
      </section>

      <section className="card mt-6 overflow-hidden" aria-labelledby="queue-h" data-testid="work-queue">
        <div className="px-5 pt-5 pb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 id="queue-h" className="text-[18px] font-bold">My queue</h2>
          <span className="mono text-[11px] uppercase tracking-[.08em] text-[#5A6475]">{shown.length} of {q.items.length} items</span>
        </div>
        <div className="px-5 pb-4 flex flex-wrap items-center gap-2">
          <Link href={href({ s: null })} aria-current={svc === 'all' ? 'true' : undefined} className={`inline-flex items-center min-h-10 px-4 rounded-full border text-[14px] font-medium ${svc === 'all' ? 'bg-navy text-white border-navy' : 'border-line-2 bg-white'}`}>All · {q.items.length}</Link>
          {services.map((k) => (
            <Link key={k} href={href({ s: k })} aria-current={svc === k ? 'true' : undefined} className={`inline-flex items-center min-h-10 px-4 rounded-full border text-[14px] font-medium ${svc === k ? 'bg-navy text-white border-navy' : 'border-line-2 bg-white'}`}>{SVC[k][0]} · {q.items.filter((i) => i.service === k).length}</Link>
          ))}
          {q.stats.needOwner > 0 && (
            <Link href={href({ owner: onlyOwner ? null : '1' })} aria-pressed={onlyOwner} className="ml-auto inline-flex items-center gap-2 min-h-10 px-4 rounded-full border border-line-2 bg-white text-[14px] font-medium">
              <span className={`w-9 h-5 rounded-full relative ${onlyOwner ? 'bg-blue' : 'bg-[#CBD2DC]'}`} aria-hidden><span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white ${onlyOwner ? 'left-[18px]' : 'left-0.5'}`} /></span>
              Needs owner approval <span className="mono text-[11px] font-bold px-1.5 rounded-full bg-[#FDECD9] text-[#9A4A10]">{q.stats.needOwner}</span>
            </Link>
          )}
        </div>
        {shown.length === 0 ? (
          <p className="px-5 pb-8 text-[15px] text-[#5A6475]">Nothing waiting. New requests, approvals and transfers to confirm appear here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[15px]">
              <thead><tr className="bg-surface text-left">{['Customer', 'Service', 'Item', 'What is needed', 'Due · age', ''].map((h) => <th key={h} className="mono text-[11px] font-semibold uppercase tracking-[.08em] text-[#5A6475] px-4 py-2.5">{h}</th>)}</tr></thead>
              <tbody>
                {shown.map((i) => (
                  <tr key={i.key} className="border-t border-line align-top">
                    <td className="px-4 py-4 font-medium">{i.customer}</td>
                    <td className="px-4 py-4"><span className={`mono text-[10.5px] font-bold uppercase px-2 py-1 rounded-full whitespace-nowrap ${SVC[i.service][1]}`}>{SVC[i.service][0]}</span></td>
                    <td className="px-4 py-4"><div className="mono text-[13px] font-semibold">{i.ref}</div><div className="text-[14px] text-[#5A6475]">{i.item}</div></td>
                    <td className="px-4 py-4 text-[14px] max-w-[300px]">{i.needed}</td>
                    <td className="px-4 py-4 whitespace-nowrap"><div className={`font-semibold ${i.late ? 'text-[#C2410C]' : ''}`}>{i.dueLabel}</div><div className="text-[13px] text-[#5A6475]">{i.age}</div></td>
                    <td className="px-4 py-4 text-right"><Link href={i.href} className={`btn min-h-11 whitespace-nowrap ${i.primary ? 'btn-primary' : 'btn-ghost'}`}>{i.cta}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="px-5 py-3 border-t border-line text-[13px] text-[#5A6475]">Items above your amount limit or below the minimum margin go to the owner. The customer sees a price only after it is approved.</p>
      </section>

      <div className="grid gap-5 lg:grid-cols-3 mt-6 items-start">
        {myCustomers.data && (
          <section className="card p-5" aria-labelledby="mc-h">
            <div className="flex justify-between items-baseline"><h2 id="mc-h" className="text-[17px] font-bold">My customers</h2><span className="mono text-[11px] uppercase text-[#5A6475]">{myCustomers.data.length} companies</span></div>
            {myCustomers.data.length === 0 ? <p className="text-[14px] text-[#5A6475] mt-3">No customers are assigned to you yet.</p> : (
              <ul className="mt-3 divide-y divide-line">
                {myCustomers.data.map((c) => (
                  <li key={c.org_id as string} className="py-2.5 flex justify-between gap-3">
                    <Link href={`/admin/customers/${c.org_id}`} className="font-semibold hover:text-blue">{(c.organizations as unknown as { name: string } | null)?.name ?? 'Customer'}</Link>
                    <span className="text-[13px] text-[#5A6475]">{q.items.filter((i) => i.customer === (c.organizations as unknown as { name: string } | null)?.name).length} open</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {(isManager || s.isAdmin) && (
          <section className="card p-5 border-2 !border-navy" aria-labelledby="lim-h">
            <h2 id="lim-h" className="text-[17px] font-bold">My approval limits</h2>
            {s.isAdmin ? (
              <p className="text-[14px] text-[#5A6475] mt-3">You are the owner: you approve everything above each manager&apos;s own limit, and you set those limits.</p>
            ) : limits.data ? (
              <dl className="mt-3 space-y-1.5 text-[15px]">
                <div className="flex justify-between"><dt className="text-[#5A6475]">Amount limit</dt><dd className="font-bold">{money(Number(limits.data.max_amount_cents), 'USD')}</dd></div>
                <div className="flex justify-between"><dt className="text-[#5A6475]">Minimum margin</dt><dd className="font-bold">{limits.data.min_margin_pct}%</dd></div>
                <div className="flex justify-between"><dt className="text-[#5A6475]">Approver above limit</dt><dd className="font-bold">Owner</dd></div>
              </dl>
            ) : (
              <p className="text-[14px] text-[#5A6475] mt-3">The owner has not set your limits yet, so everything you prepare goes to the owner.</p>
            )}
            <Link href="/admin/approvals#limits" className="inline-block mt-4 text-blue font-semibold text-[15px]">See approval limits →</Link>
          </section>
        )}
        <section className="card p-5" aria-labelledby="ih-h">
          <h2 id="ih-h" className="text-[17px] font-bold">Integrations health</h2>
          <dl className="mt-3 divide-y divide-line text-[15px]">
            {(integrations.data ?? []).map((i) => (
              <div key={i.code as string} className="py-2.5 flex justify-between gap-3"><dt>{i.name as string}</dt><dd className="mono text-[11px] font-bold uppercase px-2 py-0.5 rounded-full bg-surface">{String(i.status).replace(/_/g, ' ')}</dd></div>
            ))}
            {can(s, 'wallet', 'approve') && <div className="py-2.5 flex justify-between gap-3"><dt>Bank transfers to confirm</dt><dd className="mono font-bold">{transfers}</dd></div>}
          </dl>
          {can(s, 'integrations', 'view') && <Link href="/admin/integrations" className="inline-block mt-3 text-blue font-semibold text-[15px]">Open integrations →</Link>}
        </section>
      </div>
    </>
  );
}