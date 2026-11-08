import Link from 'next/link';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, Stat, PageHeader, EmptyState, StatusBadge, Table, Notice } from '@/components/ui';
import { CountryTag, Field } from '@/components/admin/ui';
import { ActionForm, RunButton, ToggleSetting } from '@/components/admin/client';
import { money, humanize, fmtDate, CURRENCIES } from '@/lib/format';
import { getCurrencyContext, toPlatform } from '@/lib/currency';
import { CurrencyTotals, sumByCurrency, rateLabel } from '@/components/admin/currency';
import { setSetting, saveSettings } from '../actions';
import { confirmTopup } from '../finance/actions';
import { StepUpNote } from '@/components/admin/step-up';
import { saveCreditDefault, saveCustomerCredit } from './credit-actions';

export const metadata = { title: 'Wallets & payments' };

const PLATFORM_SETTINGS: { key: string; label: string; type: 'number'; hint: string }[] = [
  { key: 'finance_approval_limit_cents', label: 'Finance approval limit (cents)', type: 'number', hint: 'In USD cents. Approvals above this (converted to USD) need an Admin (e.g. 100000 = US$ 1,000.00)' },
  { key: 'deposit_pct', label: 'Deposit % on proforma invoices', type: 'number', hint: 'Applied to new proforma invoices' },
  { key: 'quote_validity_days', label: 'Quote validity (days)', type: 'number', hint: 'New quotes only' },
  { key: 'claim_visible_days', label: 'Claim window — visible defects (days)', type: 'number', hint: 'From delivery' },
  { key: 'claim_hidden_days', label: 'Claim window — hidden defects (days)', type: 'number', hint: 'From delivery' },
];

/** Admin → Wallets & payments (WalletAdmin.png). */
export default async function WalletAdminPage() {
  const s = await requireStaff('wallet', 'view', '/admin/wallet');
  const sb = await createClient();
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);

  const [settings, wallets, topups, services, prices, rev, ctx, credit] = await Promise.all([
    sb.from('site_settings').select('key, value').in('key', ['wallet_enabled', 'wallet_credit_default', ...PLATFORM_SETTINGS.map((p) => p.key)]),
    sb.rpc('admin_wallet_balances'),
    sb.from('wallet_topups').select('id, org_id, amount_cents, currency, method, reference, status, created_at, organizations(name, country)').eq('is_seed', false).order('created_at', { ascending: false }).limit(40),
    sb.from('services').select('code, name, unit, active, sort').order('sort'),
    sb.from('service_prices').select('service_code, amount_minor, currency, effective_from').order('effective_from', { ascending: false }),
    can(s, 'finance', 'view') || can(s, 'dashboard', 'view') ? sb.rpc('admin_revenue_by_stream', { p_from: monthStart.toISOString() }) : Promise.resolve({ data: [] }),
    getCurrencyContext(),
    sb.rpc('admin_wallet_credit_overview'),
  ]);

  const set = new Map((settings.data ?? []).map((r) => [r.key, r.value]));
  const walletOn = set.get('wallet_enabled') === true || set.get('wallet_enabled') === 'true';
  const ws = (wallets.data ?? []) as { org_id: string; org_name: string; country: string | null; kyc_status: string; balance_cents: number; last_activity: string | null; currency: string }[];
  const walletsBy = sumByCurrency(ws, (w) => w.balance_cents, (w) => w.currency);
  const walletCurrencies = CURRENCIES.filter((c) => ws.some((w) => w.currency === c));
  const tps = topups.data ?? [];
  const creditedThisMonth = tps.filter((t) => t.status === 'credited' && t.created_at >= monthStart.toISOString());
  const pending = tps.filter((t) => t.status === 'pending');
  const spentBy = sumByCurrency(((rev.data ?? []) as { stream: string; net_cents: number; currency: string }[]).filter((r) => ['service_fees', 'rfq_fees', 'ads'].includes(r.stream)), (r) => r.net_cents, (r) => r.currency);
  const topupsBy = sumByCurrency(creditedThisMonth, (t) => t.amount_cents, (t) => t.currency);
  const now = new Date().toISOString();
  // service price list in the platform currency (what the wallet deducts); key = code|currency
  const current = new Map<string, number>();
  const scheduled = new Map<string, { amount: number; from: string }>();
  (prices.data ?? []).forEach((p) => {
    const k = `${p.service_code}|${p.currency}`;
    if (p.effective_from <= now) { if (!current.has(k)) current.set(k, Number(p.amount_minor)); }
    else scheduled.set(k, { amount: Number(p.amount_minor), from: p.effective_from });
  });
  const cur = ctx.currency;
  // Wallet credit facility (migration 143)
  const creditDefault = (set.get('wallet_credit_default') ?? {}) as { amount_minor?: number; currency?: string; verified_only?: boolean };
  type CreditRow = { org_id: string; org_name: string; country: string | null; kyc_status: string; currency: string; balance_minor: number; credit_limit_minor: number; available_minor: number; override_minor: number | null; override_currency: string | null; note: string | null };
  const creditRows = (credit.data ?? []) as CreditRow[];
  const creditUsedBy = creditRows.reduce((a, r) => a + Math.max(-Number(r.balance_minor), 0), 0);
  const major = (m: number | null | undefined) => (m == null ? '' : (Number(m) / 100).toFixed(2));
  const priceIn = (code: string) => {
    const own = current.get(`${code}|${cur}`);
    if (own != null) return { amount: own, converted: false };
    const usdP = current.get(`${code}|USD`);
    if (usdP == null) return null;
    return { amount: toPlatform(ctx, usdP, 'USD') ?? usdP, converted: cur !== 'USD' };
  };

  return (
    <>
      <PageHeader title="Wallets & payments" subtitle="Turn the wallet on or off, see customer balances, confirm top-ups and review the service price list." />
      <StepUpNote className="-mt-3 mb-4" />

      <section className="rounded-[12px] bg-ink text-white px-7 py-6 mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Wallet system</h2>
          <p className="text-white/80 text-[15px] mt-1">
            {walletOn ? 'Customers can top up, pay for services from their wallet, get refunds to it and withdraw.' : 'Wallet is OFF — services are paid by card / invoice and the customer Wallet page shows a notice.'}
          </p>
        </div>
        <ToggleSetting checked={walletOn} label="Wallet system" disabled={!s.isAdmin} showText onToggle={setSetting.bind(null, 'wallet_enabled')} />
      </section>
      {!s.isAdmin && <div className="mb-6"><Notice tone="blue">Only an Admin can switch the wallet on or off.</Notice></div>}

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 mb-6">
        <Stat label="Total in customer wallets" value={<CurrencyTotals totals={walletsBy} ctx={ctx} />} hint={`${ws.length} wallets`} />
        <Stat label="Top-ups this month" value={<CurrencyTotals totals={topupsBy} ctx={ctx} />} hint={`${creditedThisMonth.length} top-ups`} />
        <Stat label="Spent on services" value={<CurrencyTotals totals={spentBy} ctx={ctx} />} hint="this month (services, RFQ fees, ads)" />
        <Stat label="Transfers to match" value={pending.length} hint={`${pending.filter((t) => !t.reference).length} without reference`} hintTone={pending.length ? 'warn' : undefined} />
      </div>

      <div id="credit" className="scroll-mt-6">
      <Card className="mb-6" title="Credit facility" action={<span className="text-xs text-muted">Wallets may go below zero down to the credit limit · {s.isAdmin ? 'Admin can edit' : 'Admin only'}</span>}>
        <div className="px-6 pb-2 grid gap-6 lg:grid-cols-[1fr_1.6fr]">
          <div>
            <h3 className="font-semibold mb-1">Default limit</h3>
            <p className="text-sm text-muted mb-3">Applies to every customer without their own limit. Set 0 to give no credit by default. Credit used now: <b className="mono text-ink">{money(creditUsedBy, cur)}</b>.</p>
            <ActionForm action={saveCreditDefault} className="grid gap-3" submitLabel="Save default" hideSubmit={!s.isAdmin} confirm="Change the default wallet credit limit for all customers without their own limit?">
              <div className="grid grid-cols-[1fr_110px] gap-3">
                <Field label="Credit limit" htmlFor="cd-amount" hint="e.g. 1000.00"><input id="cd-amount" name="amount" inputMode="decimal" className="input mono" defaultValue={major(creditDefault.amount_minor ?? 0)} disabled={!s.isAdmin} required /></Field>
                <Field label="Currency" htmlFor="cd-cur">
                  <select id="cd-cur" name="currency" className="input" defaultValue={creditDefault.currency ?? cur} disabled={!s.isAdmin}>{CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="verified_only" defaultChecked={creditDefault.verified_only !== false} disabled={!s.isAdmin} /> Only KYC-verified customers get the default</label>
              {creditDefault.currency && creditDefault.currency !== cur && <Notice tone="amber">The default is in {creditDefault.currency} but the platform bills in {cur}, so it does not apply. Save it in {cur}.</Notice>}
            </ActionForm>
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold mb-1">Customer limit</h3>
            <p className="text-sm text-muted mb-3">Give one customer a higher or lower limit (0 = no credit). Tick “Use default” to remove their own limit.</p>
            <ActionForm action={saveCustomerCredit} className="grid gap-3 sm:grid-cols-[1.4fr_1fr_100px]" submitLabel="Save customer limit" hideSubmit={!s.isAdmin} confirm="Change this customer's wallet credit limit?">
              <Field label="Customer" htmlFor="cc-org">
                <select id="cc-org" name="org_id" className="input" required disabled={!s.isAdmin} defaultValue="">
                  <option value="" disabled>Choose…</option>
                  {creditRows.map((r) => <option key={r.org_id} value={r.org_id}>{r.org_name}</option>)}
                </select>
              </Field>
              <Field label="Credit limit" htmlFor="cc-amount" hint="e.g. 2500"><input id="cc-amount" name="amount" inputMode="decimal" className="input mono" disabled={!s.isAdmin} /></Field>
              <Field label="Currency" htmlFor="cc-cur">
                <select id="cc-cur" name="currency" className="input" defaultValue={cur} disabled={!s.isAdmin}>{CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
              </Field>
              <Field label="Note (optional)" htmlFor="cc-note" className="sm:col-span-2"><input id="cc-note" name="note" className="input" maxLength={200} placeholder="e.g. approved by director, 60-day terms" disabled={!s.isAdmin} /></Field>
              <label className="flex items-center gap-2 text-sm sm:pt-7"><input type="checkbox" name="use_default" disabled={!s.isAdmin} /> Use default</label>
            </ActionForm>
          </div>
        </div>
        <Table head={['Customer', 'KYC', 'Balance', 'Credit limit', 'Available', 'Source']} empty={<EmptyState title="No customers yet" />}>
          {creditRows.map((r) => (
            <tr key={r.org_id}>
              <td className="td font-semibold">{r.org_name} <CountryTag code={r.country} /></td>
              <td className="td"><StatusBadge status={r.kyc_status} /></td>
              <td className={`td mono font-semibold ${Number(r.balance_minor) < 0 ? 'text-warn' : ''}`}>{money(Number(r.balance_minor), r.currency)}</td>
              <td className="td mono">{money(Number(r.credit_limit_minor), r.currency)}</td>
              <td className="td mono">{money(Number(r.available_minor), r.currency)}</td>
              <td className="td text-sm">{r.override_minor != null
                ? <span title={r.note ?? undefined}>Own limit {money(Number(r.override_minor), r.override_currency ?? r.currency)}{r.override_currency && r.override_currency !== r.currency ? ' (other currency — not applied)' : ''}{r.note ? ` · ${r.note}` : ''}</span>
                : <span className="text-muted">Default{creditDefault.verified_only !== false && r.kyc_status !== 'verified' ? ' · not verified → no credit' : ''}</span>}</td>
            </tr>
          ))}
        </Table>
      </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr] mb-6">
        <Card title="Customer wallets" action={<span className="text-xs text-muted">One wallet per customer per currency · balance = ledger credits − debits</span>}>
          <Table head={['Customer', 'KYC', 'Currency', 'Balance', 'Last activity']} empty={<EmptyState title="No wallets yet" />}>
            {walletCurrencies.flatMap((c) => ws.filter((w) => w.currency === c)).map((w) => (
              <tr key={`${w.org_id}-${w.currency}`}>
                <td className="td font-semibold">{w.org_name} <CountryTag code={w.country} /></td>
                <td className="td"><StatusBadge status={w.kyc_status} /></td>
                <td className="td mono text-sm">{w.currency}</td>
                <td className="td mono font-semibold">{money(Number(w.balance_cents), w.currency)}</td>
                <td className="td text-sm text-muted">{fmtDate(w.last_activity, true)}</td>
              </tr>
            ))}
          </Table>
          {walletCurrencies.length > 0 && (
            <div className="px-6 py-3 border-t border-line text-sm grid gap-1">
              {walletCurrencies.map((c) => (
                <div key={c} className="flex justify-between"><span>Total {c} wallets ({ws.filter((w) => w.currency === c).length})</span><b className="mono">{money(walletsBy.get(c) ?? 0, c)}</b></div>
              ))}
              {(walletCurrencies.length > 1 || walletCurrencies[0] !== cur) && (
                <div className="flex justify-between text-muted"><span>All wallets · converted at {rateLabel(ctx)}</span><b className="mono">{money([...walletsBy].reduce((a, [c, v]) => a + (toPlatform(ctx, v, c) ?? 0), 0), cur)}</b></div>
              )}
            </div>
          )}
        </Card>
        <Card title="Service price list" action={<Link href="/admin/services" className="btn btn-ghost btn-sm">Open Services & charges</Link>}>
          <p className="px-6 -mt-1 mb-2 text-sm text-muted">The same prices as Services & charges, in the platform currency ({cur}). This is what the wallet deducts.</p>
          <Table head={['Service', 'Unit', `Price (${cur})`]} empty={<EmptyState title="No services" />}>
            {(services.data ?? []).map((sv) => (
              <tr key={sv.code}>
                <td className="td font-semibold">{sv.name}{!sv.active && <> <StatusBadge status="off" label="Inactive" /></>}<div className="mono text-xs text-muted">{sv.code}</div></td>
                <td className="td text-sm">{sv.unit}</td>
                <td className="td mono font-semibold">{(() => { const p = priceIn(sv.code); return p ? <>{money(p.amount, cur)}{p.converted && <span className="ml-1.5 text-[10px] uppercase text-muted font-normal">converted</span>}</> : <span className="text-warn">not set</span>; })()}
                  {scheduled.has(`${sv.code}|${cur}`) && <div className="text-xs text-muted font-normal">→ {money(scheduled.get(`${sv.code}|${cur}`)!.amount, cur)} from {fmtDate(scheduled.get(`${sv.code}|${cur}`)!.from)}</div>}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      <Card title="Latest wallet top-ups" className="mb-6">
        <Table head={['Time', 'Customer', 'Method', 'Reference', 'Amount', 'Status', '']} empty={<EmptyState title="No top-ups yet" />}>
          {tps.map((t) => {
            const org = t.organizations as unknown as { name: string; country: string | null } | null;
            return (
              <tr key={t.id}>
                <td className="td text-sm">{fmtDate(t.created_at, true)}</td>
                <td className="td font-semibold">{org?.name ?? '—'} <CountryTag code={org?.country} /></td>
                <td className="td text-sm">{humanize(t.method)}</td>
                <td className="td mono text-sm">{t.reference ?? <span className="text-warn">none</span>}</td>
                <td className="td mono font-semibold text-ok">+{money(Number(t.amount_cents), t.currency)}</td>
                <td className="td"><StatusBadge status={t.status} /></td>
                <td className="td text-right">{t.status === 'pending' && can(s, 'wallet', 'approve') && <RunButton className="btn btn-primary btn-sm" confirm={`Confirm ${money(Number(t.amount_cents), t.currency)} received and credit the ${t.currency} wallet of ${org?.name ?? 'the customer'}?`} action={confirmTopup.bind(null, t.id)}>Confirm match</RunButton>}</td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <div id="settings">
        <Card title="Platform settings" action={!s.isAdmin && <span className="text-xs text-muted">Admin only</span>}>
          <ActionForm action={saveSettings} className="px-6 pb-6" submitLabel="Save settings" confirm="Save platform settings? Changes apply to new documents and requests.">
            <input type="hidden" name="_keys" value={PLATFORM_SETTINGS.map((p) => p.key).join(',')} />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {PLATFORM_SETTINGS.map((p) => (
                <Field key={p.key} label={p.label} htmlFor={`set-${p.key}`} hint={p.hint}>
                  <input type="hidden" name={`_type_${p.key}`} value={p.type} />
                  <input id={`set-${p.key}`} name={p.key} type="number" min={0} className="input mono" defaultValue={String(set.get(p.key) ?? '')} disabled={!s.isAdmin} required />
                </Field>
              ))}
            </div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
