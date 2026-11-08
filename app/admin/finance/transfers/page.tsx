import { Suspense } from 'react';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader, Table, EmptyState, StatusBadge } from '@/components/ui';
import { ActionForm, ReasonButton } from '@/components/backoffice/action-form';
import { money, fmtDate } from '@/lib/format';
import { confirmTransfer, rejectTransfer } from '../../one-app-actions';

export const metadata = { title: 'Bank transfers' };

/**
 * ADDON-41 41-G(1) / 41-B — finance confirms customer bank transfers (USD TT to the Hong Kong account).
 * The wallet is credited with the amount that actually arrived, never the amount claimed. No automatic matching.
 */
async function TransfersPageContent() {
  await requireStaff('wallet', 'approve', '/admin/finance/transfers');
  const sb = await createClient();
  const [pending, done] = await Promise.all([
    sb.from('wallet_topups').select('id, org_id, amount_cents, reference, bank_ref, slip_path, created_at, organizations(name)').eq('status', 'pending').eq('method', 'bank_transfer').order('created_at'),
    sb.from('wallet_topups').select('id, amount_cents, amount_received_cents, received_note, reference, bank_ref, status, reject_reason, confirmed_at, organizations(name)').eq('method', 'bank_transfer').in('status', ['credited', 'failed']).order('confirmed_at', { ascending: false }).limit(25),
  ]);
  // slips: 10-minute signed links through finance's own session (storage policy: wallet:approve)
  const slips = await Promise.all((pending.data ?? []).map(async (t) => (t.slip_path ? (await sb.storage.from('transfer-slips').createSignedUrl(t.slip_path as string, 600)).data?.signedUrl ?? null : null)));
  const name = (o: unknown) => ((Array.isArray(o) ? o[0] : o) as { name?: string } | null)?.name ?? '—';

  return (
    <>
      <PageHeader title="Bank transfers" subtitle="Check each transfer on the bank statement. Enter the amount that actually arrived and the bank reference, then confirm; or reject it with a reason the customer sees." />
      <Card title="To confirm">
        {(pending.data ?? []).length === 0 ? <div className="p-6"><EmptyState title="Nothing to confirm" body="Transfers customers report appear here." /></div> : (
          <ul className="divide-y divide-line">
            {(pending.data ?? []).map((t, i) => (
              <li key={t.id} className="p-5 grid gap-4 lg:grid-cols-[1fr_420px]" data-testid="transfer-row">
                <div>
                  <div className="font-semibold text-[16px]">{name(t.organizations)} <span className="mono text-sm text-muted">· {t.reference}</span></div>
                  <div className="text-[14px] text-muted">Claimed {money(Number(t.amount_cents), 'USD')} · sent {fmtDate(t.created_at as string, true)}{t.bank_ref ? ` · customer reference ${t.bank_ref}` : ''}</div>
                  {slips[i] ? <a href={slips[i]!} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm mt-3 min-h-11">Open transfer slip</a> : <div className="text-sm text-bad mt-2">Slip not found</div>}
                </div>
                <div>
                  <ActionForm action={confirmTransfer.bind(null, t.id as string)} submitLabel="Confirm and credit" submitClass="btn btn-primary min-h-11" className="grid gap-3 sm:grid-cols-2"
                    confirm="Credit this customer's wallet with the amount received? This cannot be undone (a correction needs a separate adjustment).">
                    <div><label className="label" htmlFor={`rcv-${t.id}`}>Amount received (US$)</label><input id={`rcv-${t.id}`} name="received" inputMode="decimal" className="input" defaultValue={(Number(t.amount_cents) / 100).toFixed(2)} required /></div>
                    <div><label className="label" htmlFor={`ref-${t.id}`}>Bank statement reference</label><input id={`ref-${t.id}`} name="bank_ref" className="input" required /></div>
                    <input type="hidden" name="claimed" value={Number(t.amount_cents)} />
                    <div className="sm:col-span-2"><label className="label" htmlFor={`note-${t.id}`}>Reason if the amount differs (customer sees it)</label><input id={`note-${t.id}`} name="note" className="input" placeholder="e.g. bank charges" /></div>
                  </ActionForm>
                  <div className="mt-2"><ReasonButton action={rejectTransfer.bind(null, t.id as string)} label="Reject" title="Reject transfer" placeholder="Reason the customer sees (e.g. not on the statement)" className="btn btn-ghost btn-sm text-bad min-h-11" danger confirmLabel="Reject" /></div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Recently decided" className="mt-6">
        <Table head={['Customer', 'Reference', 'Claimed', 'Received', 'Bank reference', 'Result', 'When']} empty={<EmptyState title="No decisions yet" body="Confirmed and rejected transfers appear here." />}>
          {(done.data ?? []).map((t) => (
            <tr key={t.id}>
              <td className="td">{name(t.organizations)}</td><td className="td mono text-sm">{t.reference}</td>
              <td className="td mono">{money(Number(t.amount_cents), 'USD')}</td>
              <td className="td mono">{t.amount_received_cents != null ? money(Number(t.amount_received_cents), 'USD') : '—'}{t.received_note && <div className="text-xs text-muted font-sans">{t.received_note}</div>}</td>
              <td className="td mono text-sm">{t.bank_ref ?? '—'}</td>
              <td className="td"><StatusBadge status={t.status as string} label={t.status === 'credited' ? 'Credited' : 'Rejected'} tone={t.status === 'credited' ? 'green' : 'red'} />{t.reject_reason && <div className="text-xs text-muted mt-1">{t.reject_reason}</div>}</td>
              <td className="td text-sm">{t.confirmed_at ? fmtDate(t.confirmed_at as string, true) : '—'}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}

/** Request-time content streams inside Suspense (cacheComponents: instant navigation). */
export default function TransfersPage() {
  return (
    <Suspense fallback={<div className="min-h-[60vh]" aria-busy="true" aria-label="Loading" />}>
      <TransfersPageContent />
    </Suspense>
  );
}
