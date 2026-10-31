import Link from 'next/link';
import { requireCustomer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getSiteContent } from '@/lib/content';
import { ManualBankAdapter } from '@/lib/adapters';
import { PageHeader, Card, Table, StatusBadge, EmptyState, Notice, Money } from '@/components/ui';
import { fmtDate, money, asCurrency, CURRENCIES, CURRENCY_PREFIX, type Currency } from '@/lib/format';
import { getCurrencyContext } from '@/lib/currency';
import { getSettings } from '@/components/account/data';
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
  const [settings, ctx, content, { data: topups }, { data: services }, { data: walletRows }, ledger] = await Promise.all([
    getSettings(),
    getCurrencyContext(),
    getSiteContent(),
    sb.from('wallet_topups').select('id, amount_cents, currency, method, reference, status, created_at').eq('org_id', s.org.id).order('created_at', { ascending: false }).limit(20),
    sb.from('services').select('code, name, description, unit').eq('active', true).order('sort'),
    // One wallet per currency (SPEC §15.1) — `wallets` view, RLS: own org.
    sb.from('wallets').select('currency, balance_minor').eq('org_id', s.org.id),
    getOrgLedger(s.org.id, { account: 'wallet' }),
  ]);
  const active = ctx.currency;
  // Service prices in the platform currency (native price or converted from USD).
  const priceRows = await Promise.all((services ?? []).map((sv) =>
    sb.rpc('service_price_info', { p_code: sv.code as string, p_currency: active }).maybeSingle<{ amount_minor: number | null; currency: string; converted: boolean }>()));
  const priceOf = new Map<string, number>();
  (services ?? []).forEach((sv, i) => priceOf.set(sv.code as string, Number(priceRows[i].data?.amount_minor ?? 0)));
  const balances: Partial<Record<Currency, number>> = {};
  (walletRows ?? []).forEach((w) => { const c = asCurrency(w.currency as string); balances[c] = (balances[c] ?? 0) + Number(w.balance_minor); });
  const balance = balances[active] ?? 0;
  // Active wallet first, then other currencies that have an account ("kept" balances after a switch).
  const walletCurrencies = [active, ...CURRENCIES.filter((c) => c !== active && balances[c] != null)];
  const pending = (topups ?? []).filter((t) => t.status === 'pending' || t.status === 'initiated');
  const pendingOf = (c: Currency) => pending.filter((t) => asCurrency(t.currency as string) === c).reduce((a, t) => a + Number(t.amount_cents), 0);
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const spentOf = (c: Currency) => ledger.rows.filter((r) => r.currency === c && new Date(r.at) >= monthStart).reduce((a, r) => a + r.debit, 0);
  const walletId = 'OCT-W-' + s.org.id.replace(/-/g, '').slice(0, 6).toUpperCase();
  const va = await new ManualBankAdapter().createVirtualAccount(s.org.id);
  const bankDetails = content.blocks['payment.bank_details'] ?? content.blocks['bank.details'] ?? '[Bank / payment partner — set in Admin › Site content]';
  const virtualAccount = content.blocks['payment.virtual_account'] ?? va.iban;
  const tx = [...ledger.rows].reverse().slice(0, 25);

  return (
    <>
      <PageHeader title="Wallet" subtitle="Top up once, then buy services in one click. The price is deducted from your balance straight away." />
      {!settings.wallet_enabled && <div className="mb-6"><Notice tone="amber">The wallet is currently switched off by Octopus B2B. Services are invoiced or paid by card instead, and top-ups are disabled.</Notice></div>}
      {sp.test_checkout && <div className="mb-6"><Notice tone="blue">Test-mode card checkout <span className="mono">{sp.test_checkout}</span> created{sp.amount ? ` for ${money(Number(sp.amount), active)}` : ''}. No real charge was made — the top-up stays pending until the payment partner confirms it.</Notice></div>}

      <section className="rounded-[14px] bg-navy text-white p-6 sm:p-8 mb-6" aria-label="Wallet balance">
        <div className="flex flex-wrap justify-between gap-6">
          <div>
            <div className="text-sm text-white/70">Available balance · active wallet</div>
            <div className="font-display text-[44px] font-bold leading-tight mono">{money(balance, active)}</div>
            <div className="text-xs text-white/70">{active} ({CURRENCY_PREFIX[active]}) · Wallet ID <span className="mono">{walletId}</span></div>
          </div>
          <dl className="flex gap-10">
            <div><dt className="text-xs text-white/70">Pending top-up</dt><dd className="text-xl font-bold mono">{money(pendingOf(active), active)}</dd><dd className="text-xs text-white/60">{pending.length ? `${pending.length} on the way` : 'none'}</dd></div>
            <div><dt className="text-xs text-white/70">Spent this month</dt><dd className="text-xl font-bold mono">{money(spentOf(active), active)}</dd><dd className="text-xs text-white/60">services &amp; orders</dd></div>
          </dl>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          {settings.wallet_enabled && <a href="#topup" className="btn btn-light">Top up</a>}
          <Link href="/account/support" className="btn border border-white/40 text-white hover:bg-white/10" title={s.org.kyc_status === 'verified' ? undefined : 'Withdrawals need a verified KYC'}>Withdraw to bank</Link>
          <a href="/account/ledger/statement?account=wallet" className="btn border border-white/40 text-white hover:bg-white/10">Download statement</a>
        </div>
        {s.org.kyc_status !== 'verified' && <p className="text-xs text-white/70 mt-3">Withdrawals to your bank unlock after <Link href="/account/kyc" className="underline">KYC verification</Link>.</p>}
      </section>

      <section aria-label="Wallets by currency" className="grid gap-4 sm:grid-cols-2 mb-6">
        {walletCurrencies.map((c) => (
          <div key={c} className={`card p-5 ${c === active ? 'border-blue border-2' : ''}`}>
            <div className="flex justify-between items-start gap-3">
              <div>
                <div className="text-sm text-muted">{c} wallet ({CURRENCY_PREFIX[c]})</div>
                <div className="mt-1 font-display text-[28px] font-bold mono text-navy">{money(balances[c] ?? 0, c)}</div>
              </div>
              <StatusBadge status={c === active ? 'active' : 'kept'} tone={c === active ? 'green' : 'gray'} label={c === active ? 'Active' : 'Kept balance'} />
            </div>
            <p className="text-[13px] text-muted mt-2">
              {c === active
                ? 'Platform currency: service fees, RFQ fees, ad clicks and top-ups use this wallet.'
                : `Kept balance — spendable on orders in ${c}. New charges use your ${active} wallet.`}
            </p>
            <div className="text-[12px] text-muted mt-1">Spent this month {money(spentOf(c), c)}{pendingOf(c) ? ` · pending top-up ${money(pendingOf(c), c)}` : ''}</div>
          </div>
        ))}
      </section>

      <Card className="mb-6" title="Service price list" action={<span className="text-sm text-muted">Prices in {active}, set by Octopus B2B</span>}>
        <p className="px-6 -mt-2 mb-2 text-sm text-muted">Pay from your wallet; nothing is charged until you confirm in the request form.</p>
        <Table head={['Service', 'Description', 'Unit', 'Price', '']} empty={<EmptyState title="No services listed" />}>
          {(services ?? []).map((sv) => {
            const p = priceOf.get(sv.code as string) ?? 0;
            return (
              <tr key={sv.code}>
                <td className="td font-semibold">{sv.name}</td>
                <td className="td text-sm text-muted">{sv.description ?? '—'}</td>
                <td className="td text-sm">{sv.unit}</td>
                <td className="td">{p ? <Money cents={p} currency={active} /> : <span className="mono font-semibold">Free</span>}</td>
                <td className="td text-right"><Link href={`/request/${REQUEST_TYPE[sv.code as string] ?? sv.code}`} className="btn btn-ghost btn-sm">{p ? (settings.wallet_enabled ? 'Pay from wallet' : 'Request') : 'Request'}</Link></td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] mb-6">
        <Card className="p-6" >
          <h2 id="topup" className="text-lg font-semibold mb-4 scroll-mt-6">Top up your {active} wallet</h2>
          <TopupForm disabled={!settings.wallet_enabled} currency={active}
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
                    <div className="text-right"><Money cents={Number(t.amount_cents)} currency={t.currency as string} /><div><StatusBadge status={t.status as string} /></div></div>
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
                <td className="td mono font-semibold text-ok">+{money(Number(t.amount_cents), t.currency as string)}</td>
                <td className="td text-muted">—</td>
                <td className="td"><StatusBadge status="pending" /></td>
              </tr>
            )),
            ...tx.map((r) => (
              <tr key={r.id}>
                <td className="td text-sm">{fmtDate(r.at)}</td>
                <td className="td font-semibold">{r.memo}</td>
                <td className="td mono text-xs">{r.journal}</td>
                <td className={`td mono font-semibold ${r.credit ? 'text-ok' : ''}`}>{r.credit ? `+${money(r.credit, r.currency)}` : `−${money(r.debit, r.currency)}`}</td>
                <td className="td mono text-sm">{money(r.balance, r.currency)}</td>
                <td className="td"><StatusBadge status="completed" /></td>
              </tr>
            )),
          ]}
        </Table>
      </Card>
    </>
  );
}
