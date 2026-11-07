import Link from 'next/link';
import { requireCustomer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getCompanyBankAccount } from '@/components/account/bank-data';
import { bankLines } from '@/lib/bank-accounts';
import { PageHeader, Card, Table, StatusBadge, EmptyState, Notice } from '@/components/ui';
import { fmtDate, money } from '@/lib/format';
import { getSettings } from '@/components/account/data';
import { getOrgLedger } from '@/components/account/ledger-data';
import { TransferForm } from '@/components/account/transfer-form';

export const metadata = { title: 'Wallet' };

const SVC: Record<string, string> = { sourcing: 'Sourcing', dropship: 'Dropshipping', warehouse: '3PL warehouse', brand: 'Make My Brand' };
const TRANSFER_STATUS: Record<string, [string, 'amber' | 'green' | 'red' | 'gray']> = {
  pending: ['Being checked', 'amber'], initiated: ['Being checked', 'amber'], credited: ['Credited', 'green'], failed: ['Not confirmed', 'red'],
};

/** ADDON-41 — US dollar wallet: bank details + wallet reference, transfer slip upload, holds, transfers and ledger. No card payments. */
export default async function WalletPage() {
  const s = await requireCustomer('/account/wallet');
  const org = s.org!;
  const sb = await createClient();
  const [settings, bank, summary, { data: transfers }, { data: holds }, ledger] = await Promise.all([
    getSettings(),
    getCompanyBankAccount('USD'),
    sb.rpc('my_wallet_summary'),
    sb.from('wallet_topups').select('id, amount_cents, amount_received_cents, currency, method, reference, bank_ref, status, reject_reason, created_at, confirmed_at').eq('org_id', org.id).order('created_at', { ascending: false }).limit(25),
    sb.from('wallet_holds').select('id, amount_cents, service, ref_type, ref_id, status, captured_cents, created_at, closed_at').eq('org_id', org.id).order('created_at', { ascending: false }).limit(25),
    getOrgLedger(org.id, { account: 'wallet', currency: 'USD' }),
  ]);
  const w = summary.data as { reference: string; available_cents: number; on_hold_cents: number; pending_transfers_cents: number } | null;
  const tx = [...ledger.rows].reverse().slice(0, 25);

  return (
    <div className="max-w-[1160px]">
      <PageHeader title="Wallet" subtitle="One US dollar wallet for every service. Top up by bank transfer; money for work in progress is held, then charged or released." />
      {!settings.wallet_enabled && <div className="mb-6"><Notice tone="amber">The wallet is switched off at the moment. Top-ups are paused.</Notice></div>}

      <section className="rounded-[14px] bg-navy text-white p-6 sm:p-8 mb-6" aria-label="Wallet balance" data-testid="wallet-balance">
        <div className="flex flex-wrap justify-between gap-6">
          <div>
            <div className="text-sm text-white/70">Available</div>
            <div className="font-display text-[44px] font-bold leading-tight mono">{money(Number(w?.available_cents ?? 0), 'USD')}</div>
            <div className="text-xs text-white/70">US dollars · wallet reference <span className="mono font-semibold text-white">{w?.reference}</span></div>
          </div>
          <dl className="flex flex-wrap gap-x-10 gap-y-4">
            <div><dt className="text-xs text-white/70">On hold</dt><dd className="text-xl font-bold mono">{money(Number(w?.on_hold_cents ?? 0), 'USD')}</dd><dd className="text-xs text-white/60">for work in progress</dd></div>
            <div><dt className="text-xs text-white/70">Transfers being checked</dt><dd className="text-xl font-bold mono">{money(Number(w?.pending_transfers_cents ?? 0), 'USD')}</dd><dd className="text-xs text-white/60">credited after finance confirms</dd></div>
          </dl>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <a href="#add-funds" className="btn btn-light min-h-11">Add funds</a>
          <a href="/account/ledger/statement?account=wallet" className="btn border border-white/40 text-white hover:bg-white/10 min-h-11">Download statement</a>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2 items-start">
        <Card title="Bank details" className="scroll-mt-24" >
          <div id="bank" className="px-6 pb-6 scroll-mt-24" data-testid="bank-details">
            {bank ? (
              <>
                <dl className="grid grid-cols-[150px_1fr] gap-y-2 text-[15px]">
                  {bankLines(bank).map(([k, v]) => <div key={k} className="contents"><dt className="text-[#5A6475]">{k}</dt><dd className="font-medium mono break-all">{v}</dd></div>)}
                  <dt className="text-[#5A6475]">Your reference</dt><dd className="font-bold mono text-navy">{w?.reference}</dd>
                </dl>
                {bank.notes && <p className="text-[13px] text-[#5A6475] mt-3">{bank.notes}</p>}
                <p className="text-[13px] text-[#5A6475] mt-3">Send US dollars only and quote your reference. No card payments.</p>
              </>
            ) : (
              <Notice tone="amber">Bank details are not published yet. Ask your account manager in <Link href="/account/support" className="underline">Messages</Link>.</Notice>
            )}
          </div>
        </Card>
        <Card title="I have sent a transfer">
          <div id="add-funds" className="px-6 pb-6 scroll-mt-24">
            <div id="slip" className="scroll-mt-24" />
            {settings.wallet_enabled && bank ? <TransferForm orgId={org.id} reference={w?.reference ?? ''} /> : <p className="text-[14px] text-[#5A6475]">Top-ups are not available right now.</p>}
          </div>
        </Card>
      </div>

      <Card title="Transfers" className="mt-6">
        <Table head={['Sent', 'Amount claimed', 'Amount received', 'Bank reference', 'Status']} empty={<EmptyState title="No transfers yet" body="Send a US dollar transfer and upload the slip above." />}>
          {(transfers ?? []).map((t) => {
            const [label, tone] = TRANSFER_STATUS[t.status as string] ?? [t.status as string, 'gray'];
            return (
              <tr key={t.id}>
                <td className="td text-sm">{fmtDate(t.created_at as string, true)}</td>
                <td className="td mono">{money(Number(t.amount_cents), 'USD')}</td>
                <td className="td mono">{t.amount_received_cents != null ? money(Number(t.amount_received_cents), 'USD') : '—'}</td>
                <td className="td mono text-xs">{(t.bank_ref as string) ?? '—'}</td>
                <td className="td"><StatusBadge status={t.status as string} tone={tone} label={label} />{t.reject_reason && <div className="text-xs text-bad mt-1">{t.reject_reason as string}</div>}</td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <Card title="Holds" className="mt-6">
        <Table head={['Placed', 'Service', 'For', 'Amount', 'Status']} empty={<EmptyState title="No holds" body="When a service starts work for you, the amount is held here first." />}>
          {(holds ?? []).map((h) => (
            <tr key={h.id}>
              <td className="td text-sm">{fmtDate(h.created_at as string, true)}</td>
              <td className="td">{SVC[h.service as string] ?? h.service}</td>
              <td className="td mono text-sm">{h.ref_id as string}</td>
              <td className="td mono">{money(Number(h.amount_cents), 'USD')}</td>
              <td className="td"><StatusBadge status={h.status as string} label={h.status === 'open' ? 'On hold' : h.status === 'captured' ? `Charged ${money(Number(h.captured_cents), 'USD')}` : h.status === 'expired' ? 'Released (expired)' : 'Released'} /></td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Transactions" className="mt-6" action={<Link href="/account/ledger?account=wallet" className="text-sm font-semibold text-blue">Full ledger →</Link>}>
        <Table head={['Date', 'Description', 'Reference', 'Amount', 'Balance after']} empty={<EmptyState title="No wallet transactions yet" body="Credited transfers, charges and refunds appear here." />}>
          {tx.map((r) => (
            <tr key={r.id}>
              <td className="td text-sm">{fmtDate(r.at)}</td>
              <td className="td font-semibold">{r.memo}</td>
              <td className="td mono text-xs">{r.journal}</td>
              <td className={`td mono font-semibold ${r.credit ? 'text-ok' : ''}`}>{r.credit ? `+${money(r.credit, r.currency)}` : `−${money(r.debit, r.currency)}`}</td>
              <td className="td mono text-sm">{money(r.balance, r.currency)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
