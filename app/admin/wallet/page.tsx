import Link from 'next/link';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, Stat, PageHeader, EmptyState, StatusBadge, Table, Notice } from '@/components/ui';
import { CountryTag, Field } from '@/components/admin/ui';
import { ActionForm, RunButton, ToggleSetting } from '@/components/admin/client';
import { usd, humanize, fmtDate } from '@/lib/format';
import { setSetting, saveSettings } from '../actions';
import { confirmTopup } from '../finance/actions';

export const metadata = { title: 'Wallets & payments' };

const PLATFORM_SETTINGS: { key: string; label: string; type: 'number'; hint: string }[] = [
  { key: 'finance_approval_limit_cents', label: 'Finance approval limit (cents)', type: 'number', hint: 'Approvals above this need an Admin (e.g. 100000 = $1,000.00)' },
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

  const [settings, wallets, topups, services, prices, rev] = await Promise.all([
    sb.from('site_settings').select('key, value').in('key', ['wallet_enabled', ...PLATFORM_SETTINGS.map((p) => p.key)]),
    sb.rpc('admin_wallet_balances'),
    sb.from('wallet_topups').select('id, org_id, amount_cents, method, reference, status, created_at, organizations(name, country)').order('created_at', { ascending: false }).limit(40),
    sb.from('services').select('code, name, unit, active, sort').order('sort'),
    sb.from('service_prices').select('service_code, amount_usd_cents, effective_from').order('effective_from', { ascending: false }),
    can(s, 'finance', 'view') || can(s, 'dashboard', 'view') ? sb.rpc('admin_revenue_by_stream', { p_from: monthStart.toISOString() }) : Promise.resolve({ data: [] }),
  ]);

  const set = new Map((settings.data ?? []).map((r) => [r.key, r.value]));
  const walletOn = set.get('wallet_enabled') === true || set.get('wallet_enabled') === 'true';
  const ws = (wallets.data ?? []) as { org_id: string; org_name: string; country: string | null; kyc_status: string; balance_cents: number; last_activity: string | null }[];
  const total = ws.reduce((a, w) => a + Number(w.balance_cents), 0);
  const tps = topups.data ?? [];
  const creditedThisMonth = tps.filter((t) => t.status === 'credited' && t.created_at >= monthStart.toISOString());
  const pending = tps.filter((t) => t.status === 'pending');
  const spent = ((rev.data ?? []) as { stream: string; net_cents: number }[]).filter((r) => ['service_fees', 'rfq_fees', 'ads'].includes(r.stream)).reduce((a, r) => a + Number(r.net_cents), 0);
  const now = new Date().toISOString();
  const current = new Map<string, number>();
  const scheduled = new Map<string, { amount: number; from: string }>();
  (prices.data ?? []).forEach((p) => {
    if (p.effective_from <= now) { if (!current.has(p.service_code)) current.set(p.service_code, Number(p.amount_usd_cents)); }
    else scheduled.set(p.service_code, { amount: Number(p.amount_usd_cents), from: p.effective_from });
  });

  return (
    <>
      <PageHeader title="Wallets & payments" subtitle="Turn the wallet on or off, see customer balances, confirm top-ups and review the service price list." />

      <section className="rounded-[12px] bg-navy text-white px-7 py-6 mb-6 flex flex-wrap items-center justify-between gap-4">
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
        <Stat label="Total in customer wallets" value={usd(total)} hint={`${ws.length} wallets`} />
        <Stat label="Top-ups this month" value={usd(creditedThisMonth.reduce((a, t) => a + Number(t.amount_cents), 0))} hint={`${creditedThisMonth.length} top-ups`} />
        <Stat label="Spent on services" value={usd(spent)} hint="this month (services, RFQ fees, ads)" />
        <Stat label="Transfers to match" value={pending.length} hint={`${pending.filter((t) => !t.reference).length} without reference`} hintTone={pending.length ? 'warn' : undefined} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr] mb-6">
        <Card title="Customer wallets" action={<span className="text-xs text-muted">Balance = ledger credits − debits</span>}>
          <Table head={['Customer', 'KYC', 'Balance', 'Last activity']} empty={<EmptyState title="No wallets yet" />}>
            {ws.map((w) => (
              <tr key={w.org_id}>
                <td className="td font-semibold">{w.org_name} <CountryTag code={w.country} /></td>
                <td className="td"><StatusBadge status={w.kyc_status} /></td>
                <td className="td mono font-semibold">{usd(Number(w.balance_cents))}</td>
                <td className="td text-sm text-muted">{fmtDate(w.last_activity, true)}</td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="Service price list" action={<Link href="/admin/services" className="btn btn-ghost btn-sm">Open Services & charges</Link>}>
          <p className="px-6 -mt-1 mb-2 text-sm text-muted">The same prices as Services & charges. This is what the wallet deducts.</p>
          <Table head={['Service', 'Unit', 'Price']} empty={<EmptyState title="No services" />}>
            {(services.data ?? []).map((sv) => (
              <tr key={sv.code}>
                <td className="td font-semibold">{sv.name}{!sv.active && <> <StatusBadge status="off" label="Inactive" /></>}<div className="mono text-xs text-muted">{sv.code}</div></td>
                <td className="td text-sm">{sv.unit}</td>
                <td className="td mono font-semibold">{current.has(sv.code) ? usd(current.get(sv.code)!) : <span className="text-warn">not set</span>}
                  {scheduled.has(sv.code) && <div className="text-xs text-muted font-normal">→ {usd(scheduled.get(sv.code)!.amount)} from {fmtDate(scheduled.get(sv.code)!.from)}</div>}
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
                <td className="td mono font-semibold text-ok">+{usd(Number(t.amount_cents))}</td>
                <td className="td"><StatusBadge status={t.status} /></td>
                <td className="td text-right">{t.status === 'pending' && can(s, 'wallet', 'approve') && <RunButton className="btn btn-primary btn-sm" confirm={`Confirm ${usd(Number(t.amount_cents))} received and credit ${org?.name ?? 'the wallet'}?`} action={confirmTopup.bind(null, t.id)}>Confirm match</RunButton>}</td>
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
