import Link from 'next/link';
import { requireCustomer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getSiteContent } from '@/lib/content';
import { ManualBankAdapter } from '@/lib/adapters';
import { PageHeader, Card, Table, StatusBadge, EmptyState, Notice, Money } from '@/components/ui';
import { fmtDate, usd } from '@/lib/format';
import { getSettings, getWalletBalance } from '@/components/account/data';
import { getOrgLedger } from '@/components/account/ledger-data';
import { TopupForm } from '@/components/account/topup-form';
import { requestBankTopup, startCardTopup } from './actions';

export const metadata = { title: 'Wallet' };

const REQUEST_TYPE: Record<string, string> = { rfq: 'sourcing', sample: 'sample', qc: 'qc', certification: 'certification', '3pl': '3pl', dropship: 'dropship' };

export default async function WalletPage({ searchParams }: { searchParams: Promise<{ test_checkout?: string; amount?: string }> }) {
  const s = await requireCustomer('/account/wallet');
  if (!s.org) return <Notice tone="amber">Complete your company profile first.</Notice>;
  const sp = await searchParams;
  const sb = await createClient();
  const [settings, balance, content, { data: topups }, { data: services }, { data: prices }, ledger] = await Promise.all([
    getSettings(),
    getWalletBalance(),
    getSiteContent(),
    sb.from('wallet_topups').select('id, amount_cents, method, reference, status, created_at').eq('org_id', s.org.id).order('created_at', { ascending: false }).limit(20),
    sb.from('services').select('code, name, description, unit').eq('active', true).order('sort'),
    sb.from('service_prices').select('service_code, amount_usd_cents, effective_from').lte('effective_from', new Date().toISOString()).order('effective_from', { ascending: false }),
    getOrgLedger(s.org.id, { account: 'wallet' }),
  ]);
  const priceOf = new Map<string, number>();
  (prices ?? []).forEach((p) => { if (!priceOf.has(p.service_code as string)) priceOf.set(p.service_code as string, Number(p.amount_usd_cents)); });
  const pending = (topups ?? []).filter((t) => t.status === 'pending' || t.status === 'initiated');
  const pendingSum = pending.reduce((a, t) => a + Number(t.amount_cents), 0);
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const spentMonth = ledger.rows.filter((r) => new Date(r.at) >= monthStart).reduce((a, r) => a + r.debit, 0);
  const walletId = 'OCT-W-' + s.org.id.replace(/-/g, '').slice(0, 6).toUpperCase();
  const va = await new ManualBankAdapter().createVirtualAccount(s.org.id);
  const bankDetails = content.blocks['payment.bank_details'] ?? content.blocks['bank.details'] ?? '[Bank / payment partner — set in Admin › Site content]';
  const virtualAccount = content.blocks['payment.virtual_account'] ?? va.iban;
  const tx = [...ledger.rows].reverse().slice(0, 25);

  return (
    <>
      <PageHeader title="Wallet" subtitle="Top up once, then buy services in one click. The price is deducted from your balance straight away." />
      {!settings.wallet_enabled && <div className="mb-6"><Notice tone="amber">The wallet is currently switched off by Octopus B2B. Services are invoiced or paid by card instead, and top-ups are disabled.</Notice></div>}
      {sp.test_checkout && <div className="mb-6"><Notice tone="blue">Test-mode card checkout <span className="mono">{sp.test_checkout}</span> created{sp.amount ? ` for ${usd(Number(sp.amount))}` : ''}. No real charge was made — the top-up stays pending until the payment partner confirms it.</Notice></div>}

      <section className="rounded-[14px] bg-navy text-white p-6 sm:p-8 mb-6" aria-label="Wallet balance">
        <div className="flex flex-wrap justify-between gap-6">
          <div>
            <div className="text-sm text-white/70">Available balance</div>
            <div className="font-display text-[44px] font-bold leading-tight mono">{usd(balance)}</div>
            <div className="text-xs text-white/70">USD · Wallet ID <span className="mono">{walletId}</span></div>
          </div>
          <dl className="flex gap-10">
            <div><dt className="text-xs text-white/70">Pending top-up</dt><dd className="text-xl font-bold mono">{usd(pendingSum)}</dd><dd className="text-xs text-white/60">{pending.length ? `${pending.length} on the way` : 'none'}</dd></div>
            <div><dt className="text-xs text-white/70">Spent this month</dt><dd className="text-xl font-bold mono">{usd(spentMonth)}</dd><dd className="text-xs text-white/60">services &amp; orders</dd></div>
          </dl>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          {settings.wallet_enabled && <a href="#topup" className="btn btn-light">Top up</a>}
          <Link href="/account/support" className="btn border border-white/40 text-white hover:bg-white/10" title={s.org.kyc_status === 'verified' ? undefined : 'Withdrawals need a verified KYC'}>Withdraw to bank</Link>
          <a href="/account/ledger/statement?account=wallet" className="btn border border-white/40 text-white hover:bg-white/10">Download statement</a>
        </div>
        {s.org.kyc_status !== 'verified' && <p className="text-xs text-white/70 mt-3">Withdrawals to your bank unlock after <Link href="/account/kyc" className="underline">KYC verification</Link>.</p>}
      </section>

      <Card className="mb-6" title="Service price list" action={<span className="text-sm text-muted">Prices in USD, set by Octopus B2B</span>}>
        <p className="px-6 -mt-2 mb-2 text-sm text-muted">Pay from your wallet; nothing is charged until you confirm in the request form.</p>
        <Table head={['Service', 'Description', 'Unit', 'Price', '']} empty={<EmptyState title="No services listed" />}>
          {(services ?? []).map((sv) => {
            const p = priceOf.get(sv.code as string) ?? 0;
            return (
              <tr key={sv.code}>
                <td className="td font-semibold">{sv.name}</td>
                <td className="td text-sm text-muted">{sv.description ?? '—'}</td>
                <td className="td text-sm">{sv.unit}</td>
                <td className="td">{p ? <Money cents={p} /> : <span className="mono font-semibold">Free</span>}</td>
                <td className="td text-right"><Link href={`/request/${REQUEST_TYPE[sv.code as string] ?? sv.code}`} className="btn btn-ghost btn-sm">{p ? (settings.wallet_enabled ? 'Pay from wallet' : 'Request') : 'Request'}</Link></td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] mb-6">
        <Card className="p-6" >
          <h2 id="topup" className="text-lg font-semibold mb-4 scroll-mt-6">Top up your wallet</h2>
          <TopupForm disabled={!settings.wallet_enabled}
            bank={{ accountName: content.company?.legal_name ?? 'Octopus B2B', bankDetails, virtualAccount, reference: va.reference }}
            defaultReference={va.reference} bankAction={requestBankTopup} cardAction={startCardTopup} />
        </Card>
        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="text-lg font-semibold">Pending top-ups</h2>
            {pending.length === 0 ? <p className="text-sm text-muted mt-2">No pending top-ups.</p> : (
              <ul className="mt-3 divide-y divide-line">
                {pending.map((t) => (
                  <li key={t.id} className="py-2 flex justify-between gap-3 text-sm">
                    <div><div className="mono">{t.reference ?? '—'}</div><div className="text-xs text-muted">{t.method === 'card' ? 'Card' : 'Bank transfer'} · {fmtDate(t.created_at as string)}</div></div>
                    <div className="text-right"><Money cents={Number(t.amount_cents)} /><div><StatusBadge status={t.status as string} /></div></div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="p-6">
            <h2 className="text-base font-semibold">Refunds</h2>
            <p className="text-sm text-muted mt-1">Refunds for RFQs with no quotes, cancelled samples or rejected services go back to your wallet automatically.</p>
          </Card>
        </div>
      </div>

      <Card title="Transactions" action={<Link href="/account/ledger?account=wallet" className="text-sm font-semibold text-blue">Full ledger →</Link>}>
        <Table head={['Date', 'Description', 'Reference', 'Amount', 'Balance after', 'Status']}
          empty={<EmptyState title="No wallet transactions yet" body="Top up your wallet to pay for services in one click." />}>
          {[
            ...pending.map((t) => (
              <tr key={`p-${t.id}`}>
                <td className="td text-sm">{fmtDate(t.created_at as string)}</td>
                <td className="td font-semibold">{t.method === 'card' ? 'Card top-up' : 'Bank transfer top-up'}</td>
                <td className="td mono text-xs">{t.reference ?? '—'}</td>
                <td className="td mono font-semibold text-ok">+{usd(Number(t.amount_cents))}</td>
                <td className="td text-muted">—</td>
                <td className="td"><StatusBadge status="pending" /></td>
              </tr>
            )),
            ...tx.map((r) => (
              <tr key={r.id}>
                <td className="td text-sm">{fmtDate(r.at)}</td>
                <td className="td font-semibold">{r.memo}</td>
                <td className="td mono text-xs">{r.journal}</td>
                <td className={`td mono font-semibold ${r.credit ? 'text-ok' : ''}`}>{r.credit ? `+${usd(r.credit)}` : `−${usd(r.debit)}`}</td>
                <td className="td mono text-sm">{usd(r.balance)}</td>
                <td className="td"><StatusBadge status="completed" /></td>
              </tr>
            )),
          ]}
        </Table>
      </Card>
    </>
  );
}
