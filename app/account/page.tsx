import { Suspense } from 'react';
import { PageSkeleton } from '@/components/shell/skeletons';
import Link from 'next/link';
import { requireCustomer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Notice } from '@/components/ui';
import { fmtDate, money } from '@/lib/format';
import { getAccountContext, SERVICES, serviceOn, nowIso, withinDays, type ServiceKey } from '@/lib/core/account';
import { getCompanyBankAccount } from '@/components/account/bank-data';

export const metadata = { title: 'My account' };

const NOTICES: Record<string, string> = { 'not-in-account': "That area isn't part of your account." };
const SVC_LABEL: Record<string, string> = { sourcing: 'Sourcing', dropship: 'Dropshipping', warehouse: '3PL warehouse', brand: 'Make My Brand', wallet: 'Wallet', account: 'Account' };
const ABOUT: Record<ServiceKey, string> = {
  sourcing: 'Send one request and get quotes from verified factories.',
  dropship: 'Sell from your own store; we pack and ship each order.',
  warehouse: 'Store stock in our warehouse; we ship it when you sell.',
  brand: 'Put your own brand on verified-supplier products.',
};
type Item = { key: string; service: string; title: string; body: string; href: string; cta: string; primary?: boolean; at: string };

/** ADDON-41 board 01 — My account home: waiting for you across services, account manager, wallet, your services, recent activity. */
async function AccountHomeContent({ searchParams }: { searchParams: Promise<{ notice?: string; w?: string }> }) {
  const s = await requireCustomer('/account');
  const sp = await searchParams;
  const notice = NOTICES[sp.notice ?? ''];
  const org = s.org!;
  const sb = await createClient();
  const now = nowIso();
  const [ctx, bank, rfqs, quotes, orders, transfers, kyc, docs, holds] = await Promise.all([
    getAccountContext(org.id),
    getCompanyBankAccount('USD'),
    sb.from('rfqs').select('id, code, title, status, created_at').eq('org_id', org.id).order('created_at', { ascending: false }).limit(200),
    sb.from('quotes').select('id, rfq_id, valid_until, rfqs!inner(code, title, quantity, unit, org_id)').in('status', ['sent', 'viewed']).eq('rfqs.org_id', org.id).gt('valid_until', now),
    sb.from('orders').select('id, code, title, status, total_cents, currency, updated_at').eq('org_id', org.id).order('updated_at', { ascending: false }).limit(50),
    sb.from('wallet_topups').select('id, amount_cents, amount_received_cents, status, reject_reason, created_at, confirmed_at').eq('org_id', org.id).order('created_at', { ascending: false }).limit(20),
    sb.from('kyc_submissions').select('id, status, review_note, reviewed_at').eq('org_id', org.id).order('submitted_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('documents').select('id, doc_type, number, created_at').eq('org_id', org.id).order('created_at', { ascending: false }).limit(10),
    sb.from('wallet_holds').select('id, amount_cents, service, ref_type, ref_id').eq('org_id', org.id).eq('status', 'open').order('created_at', { ascending: false }).limit(5),
  ]);

  // ── waiting for you: only real items that need this customer ──
  const items: Item[] = [];
  const byRfq = new Map<string, { code: string; title: string; qty: number; unit: string; n: number; until: string }>();
  (quotes.data ?? []).forEach((q) => {
    const r = q.rfqs as unknown as { code: string; title: string; quantity: number; unit: string };
    const cur = byRfq.get(q.rfq_id as string);
    const until = cur && cur.until < (q.valid_until as string) ? cur.until : (q.valid_until as string);
    byRfq.set(q.rfq_id as string, { code: r.code, title: r.title, qty: r.quantity, unit: r.unit, n: (cur?.n ?? 0) + 1, until });
  });
  byRfq.forEach((r, id) => items.push({
    key: `q-${id}`, service: 'sourcing', title: `${r.n === 1 ? 'A quote is' : `${r.n} quotes are`} ready for ${r.code}`,
    body: `${r.title} · ${Number(r.qty).toLocaleString('en-US')} ${r.unit} · valid until ${fmtDate(r.until)}`,
    href: `/account/sourcing/${r.code}`, cta: r.n > 1 ? 'Compare quotes' : 'Open quote', primary: true, at: r.until,
  }));
  (orders.data ?? []).filter((o) => ['pi_issued', 'deposit_pending', 'balance_pending'].includes(o.status as string)).forEach((o) => items.push({
    key: `o-${o.id}`, service: 'sourcing', title: `Order ${o.code} is waiting for payment`,
    body: `${o.title} · ${o.status === 'balance_pending' ? 'balance' : 'deposit'} due. It moves on as soon as it is paid.`,
    href: `/account/orders/${o.id}`, cta: 'Pay now', at: o.updated_at as string,
  }));
  (transfers.data ?? []).filter((t) => t.status === 'failed' && t.reject_reason && t.confirmed_at && withinDays(t.confirmed_at as string, 14)).forEach((t) => items.push({
    key: `t-${t.id}`, service: 'wallet', title: `Transfer of ${money(Number(t.amount_cents), 'USD')} was not confirmed`,
    body: `${t.reject_reason}. Check the slip and send it again.`, href: '/account/wallet#slip', cta: 'Upload slip', at: t.confirmed_at as string,
  }));
  if (kyc.data?.status === 'more_info') {
    items.push({ key: 'kyc', service: 'account', title: 'Company verification needs more information', body: kyc.data.review_note ?? 'Our team asked for another document.', href: '/account/kyc', cta: 'Open', at: kyc.data.reviewed_at ?? now });
  }
  items.sort((a, b) => a.at.localeCompare(b.at));
  const present = [...new Set(items.map((i) => i.service))];
  const filter = sp.w && present.includes(sp.w) ? sp.w : 'all';
  const shown = filter === 'all' ? items : items.filter((i) => i.service === filter);

  const openReq = (rfqs.data ?? []).filter((r) => ['submitted', 'assigned', 'quoting', 'quoted'].includes(r.status as string)).length;
  const w = ctx.wallet;
  const due = (orders.data ?? []).filter((o) => ['deposit_pending', 'balance_pending'].includes(o.status as string));

  // ── recent activity: real events from this company's records ──
  const docName = (t: string) => t.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  const act: { at: string; service: string; text: string; by: string }[] = [
    ...(rfqs.data ?? []).slice(0, 5).map((r) => ({ at: r.created_at as string, service: 'Sourcing', text: `Request ${r.code} sent: ${r.title}`, by: 'You' })),
    ...(orders.data ?? []).slice(0, 5).map((o) => ({ at: o.updated_at as string, service: 'Sourcing', text: `Order ${o.code} · ${String(o.status).replace(/_/g, ' ')}`, by: 'Octopus' })),
    ...(transfers.data ?? []).filter((t) => t.status === 'credited' && t.confirmed_at).map((t) => ({ at: t.confirmed_at as string, service: 'Wallet', text: `Bank transfer of ${money(Number(t.amount_received_cents ?? t.amount_cents), 'USD')} credited`, by: 'Finance' })),
    ...(docs.data ?? []).slice(0, 5).map((d) => ({ at: d.created_at as string, service: 'Wallet', text: `${docName(d.doc_type as string)} ${d.number} issued`, by: 'System' })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);

  return (
    <div className="max-w-[1160px]">
      {notice && <div className="mb-4"><Notice tone="blue">{notice}</Notice></div>}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mono text-[11.5px] font-semibold uppercase tracking-[.1em] text-blue">My account</div>
          <h1 className="text-[32px] sm:text-[36px] font-extrabold leading-tight">{org.name}</h1>
          <p className="text-[15px] text-[#5A6475] mt-1">Everything Octopus is doing for you, in one place. {ctx.onCount === 1 ? 'One service is' : `${ctx.onCount} services are`} switched on for your company.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/account/wallet#add-funds" className="btn btn-primary min-h-11">Add funds</Link>
          <Link href="/request/sourcing" className="btn btn-ghost min-h-11">New sourcing request</Link>
        </div>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_300px] items-start">
        <section id="waiting" aria-labelledby="waiting-h" className="card overflow-hidden scroll-mt-24" data-testid="waiting">
          <div className="px-5 pt-5 pb-4 border-b border-line">
            <div className="flex items-center justify-between gap-3">
              <h2 id="waiting-h" className="text-[20px] font-bold">Waiting for you</h2>
              {items.length > 0 && <span className="mono text-[11px] font-bold uppercase px-2.5 py-1 rounded-full bg-[#FDECD9] text-[#9A4A10]">{items.length} {items.length === 1 ? 'action' : 'actions'}</span>}
            </div>
            {present.length > 1 && (
              <nav aria-label="Filter by service" className="mt-3 flex flex-wrap gap-2">
                {['all', ...present].map((k) => (
                  <Link key={k} href={k === 'all' ? '/account#waiting' : `/account?w=${k}#waiting`} aria-current={filter === k ? 'true' : undefined} scroll={false}
                    className={`inline-flex items-center min-h-10 px-4 rounded-full border text-[14px] font-medium ${filter === k ? 'bg-navy text-white border-navy' : 'border-line-2 bg-white hover:border-navy'}`}>{k === 'all' ? 'All' : SVC_LABEL[k]}</Link>
                ))}
              </nav>
            )}
          </div>
          {shown.length === 0 ? (
            <p className="px-5 py-8 text-[15px] text-[#5A6475]">Nothing needs you right now. New quotes, payments due and questions from our team appear here.</p>
          ) : (
            <ul>
              {shown.map((i) => (
                <li key={i.key} className="flex flex-wrap sm:flex-nowrap items-center gap-4 px-5 py-4 border-b border-line last:border-0">
                  <div className="flex-1 min-w-0">
                    <div className="mono text-[11px] font-semibold uppercase tracking-[.08em] text-blue">{SVC_LABEL[i.service]}</div>
                    <div className="font-semibold text-[16px]">{i.title}</div>
                    <div className="text-[14px] text-[#5A6475]">{i.body}</div>
                  </div>
                  <Link href={i.href} className={`btn min-h-11 shrink-0 ${i.primary ? 'btn-dark' : 'btn-ghost'}`}>{i.cta}</Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-5">
          <section aria-labelledby="mgr-h" className="card p-5 border-2 !border-navy" data-testid="manager-card">
            <h2 id="mgr-h" className="mono text-[11px] font-semibold uppercase tracking-[.08em] text-[#5A6475]">Your account manager</h2>
            {ctx.manager ? (
              <>
                <div className="flex items-center gap-3 mt-3">
                  <span className="w-12 h-12 rounded-full bg-blue text-white font-bold flex items-center justify-center" aria-hidden>{ctx.manager.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase()}</span>
                  <div className="leading-tight">
                    <div className="font-bold text-[16px]">{ctx.manager.name}</div>
                    <div className="text-[13px] text-[#5A6475]">{['Octopus', ctx.manager.office].filter(Boolean).join(', ')}</div>
                  </div>
                </div>
                <p className="text-[14px] text-[#2B3445] mt-3">One person for all your services: sourcing, dropshipping, warehouse and Make My Brand. Checks quotes before you see them and approves within your limits.</p>
                <div className="mt-4 flex gap-2"><Link href="/account/support" className="btn btn-dark btn-sm min-h-11 flex-1">Message</Link></div>
              </>
            ) : (
              <p className="text-[14px] text-[#5A6475] mt-3">We are assigning your account manager. Until then, our team answers in <Link href="/account/support" className="text-blue font-semibold">Messages</Link>.</p>
            )}
          </section>

          <section aria-labelledby="wallet-h" className="card p-5" data-testid="wallet-card">
            <h2 id="wallet-h" className="text-[18px] font-bold">Wallet</h2>
            <div className="mono text-[11px] font-semibold uppercase tracking-[.08em] text-[#5A6475] mt-3">Available</div>
            <div className="text-[28px] font-extrabold">{money(Number(w?.available_cents ?? 0), 'USD')}</div>
            <dl className="mt-2 space-y-1.5 text-[14px]">
              {(holds.data ?? []).map((h) => (
                <div key={h.id} className="flex justify-between gap-3"><dt className="text-[#5A6475]">On hold · {SVC_LABEL[h.service as string]} {h.ref_id}</dt><dd className="font-semibold">{money(Number(h.amount_cents), 'USD')}</dd></div>
              ))}
              {due.map((o) => (
                <div key={o.id} className="flex justify-between gap-3"><dt className="text-[#5A6475]">Due · order {o.code}</dt><dd className="font-semibold">{o.status === 'deposit_pending' ? 'Deposit' : 'Balance'}</dd></div>
              ))}
              {Number(w?.pending_transfers_cents ?? 0) > 0 && <div className="flex justify-between gap-3"><dt className="text-[#5A6475]">Transfer being checked</dt><dd className="font-semibold">{money(Number(w!.pending_transfers_cents), 'USD')}</dd></div>}
            </dl>
            <p className="text-[13px] text-[#5A6475] mt-3">
              Top up by US dollar bank transfer (TT){bank ? <> to the {bank.account_holder} account{bank.bank_name ? ` at ${bank.bank_name}` : ''}</> : null}, quoting your reference <b className="mono text-navy">{w?.reference}</b>. The wallet is credited once Octopus finance confirms the money has arrived. No card payments.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Link href="/account/wallet#bank" className="btn btn-primary btn-sm min-h-11">Bank details</Link>
              <Link href="/account/wallet#slip" className="btn btn-ghost btn-sm min-h-11 !px-2">Upload slip</Link>
            </div>
          </section>
        </div>
      </div>

      <section id="services" aria-labelledby="services-h" className="mt-8 scroll-mt-24">
        <h2 id="services-h" className="text-[20px] font-bold mb-3">Your services</h2>
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {SERVICES.map((svc) => {
            const st = ctx.services[svc.key];
            const on = serviceOn(st);
            return (
              <li key={svc.key} className="card p-5 flex flex-col" data-testid={`service-${svc.key}`}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[17px] font-bold">{svc.label}</h3>
                  <span className={`mono text-[10.5px] font-bold uppercase px-2 py-0.5 rounded-full ${on ? 'bg-[#DCFCE7] text-[#166534]' : 'bg-surface text-[#5A6475]'}`}>{on ? `On${st.plan ? ` · ${st.plan}` : ''}` : st.status === 'paused' ? 'Paused' : 'Off'}</span>
                </div>
                {svc.key === 'sourcing' && on ? (
                  <dl className="grid grid-cols-2 gap-3 mt-3">
                    <div><dt className="mono text-[10.5px] uppercase tracking-[.06em] text-[#5A6475]">Open requests</dt><dd className="text-[24px] font-extrabold">{openReq}</dd></div>
                    <div><dt className="mono text-[10.5px] uppercase tracking-[.06em] text-[#5A6475]">Quotes ready</dt><dd className="text-[24px] font-extrabold">{byRfq.size}</dd></div>
                  </dl>
                ) : on ? (
                  <p className="text-[14px] text-[#5A6475] mt-3">Your account manager is setting this up. Figures appear here once it is running.</p>
                ) : (
                  <p className="text-[14px] text-[#5A6475] mt-3">{ABOUT[svc.key]}</p>
                )}
                <Link href={svc.href} className="mt-auto pt-4 text-blue font-semibold text-[15px]">{on ? `Open ${svc.label}` : 'Start'} →</Link>
              </li>
            );
          })}
        </ul>
        <p className="text-[13px] text-[#5A6475] mt-2">A service that is not switched on shows a short explanation and a Start button.</p>
      </section>

      <section aria-labelledby="activity-h" className="card mt-8 overflow-hidden">
        <h2 id="activity-h" className="text-[18px] font-bold px-5 pt-5 pb-3">Recent activity</h2>
        {act.length === 0 ? <p className="px-5 pb-6 text-[15px] text-[#5A6475]">No activity yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-[15px]">
              <thead><tr className="bg-surface text-left">{['When', 'Service', 'What happened', 'By'].map((h) => <th key={h} className="mono text-[11px] font-semibold uppercase tracking-[.08em] text-[#5A6475] px-5 py-2.5">{h}</th>)}</tr></thead>
              <tbody>{act.map((a, i) => (
                <tr key={i} className="border-t border-line"><td className="px-5 py-3 whitespace-nowrap">{fmtDate(a.at, true)}</td><td className="px-5 py-3">{a.service}</td><td className="px-5 py-3">{a.text}</td><td className="px-5 py-3">{a.by}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/** Request-time content streams inside Suspense (cacheComponents: instant navigation). */
export default function AccountHome({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AccountHomeContent searchParams={searchParams as never} />
    </Suspense>
  );
}
