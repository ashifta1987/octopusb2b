// ODS T9 · Accounts › Bank transfers (reconciliation). Replaces the T8 re-export of app/admin/finance/transfers/page.tsx inside
// the ODS Back Office frame. Same guard (requireStaff('wallet','approve')), the same reads as today (session client, hidden
// received_note via withHiddenColumns, 10-minute signed slip links). Reject = today's rejectTransfer. Confirm and the
// proforma transfer = today's confirmTransfer / recordProformaTransfer behind the T8 two-person gate (skipped before 255).
import { Suspense } from 'react';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { withHiddenColumns } from '@/components/backoffice/hidden-columns';
import { rejectTransfer } from '@/app/admin/one-app-actions';
import { approvalReadiness } from '@/lib/office/approvals';
import { confirmTransferGated, recordProformaGated } from '../_accounts-b/gated-actions';
import { TransfersScreen, type DecidedTransfer, type PendingTransfer } from './_components/transfers-screen';

export const metadata = { title: 'Bank transfers' };

const ACTIONS = { confirm: confirmTransferGated, reject: rejectTransfer, proforma: recordProformaGated };
const name = (o: unknown) => ((Array.isArray(o) ? o[0] : o) as { name?: string } | null)?.name ?? '—';

async function TransfersContent() {
  const s = await requireStaff('wallet', 'approve', '/admin/finance/transfers');
  const sb = await createClient();
  const [pendingR, doneRaw, readiness] = await Promise.all([
    sb.from('wallet_topups').select('id, org_id, amount_cents, reference, bank_ref, slip_path, created_at, organizations(name)').eq('status', 'pending').eq('method', 'bank_transfer').order('created_at'),
    sb.from('wallet_topups').select('id, amount_cents, amount_received_cents, reference, bank_ref, status, reject_reason, received_reason, received_reason_text, confirmed_at, organizations(name)').eq('method', 'bank_transfer').in('status', ['credited', 'failed']).order('confirmed_at', { ascending: false }).limit(25),
    approvalReadiness(),
  ]);
  // received_note is hidden from session reads (migration 195): added with the service role after requireStaff — as today
  const done = doneRaw.error ? null : await withHiddenColumns<NonNullable<typeof doneRaw.data>[number], { received_note: string | null }>('wallet_topups', doneRaw.data, 'received_note');
  // slips: 10-minute signed links through finance's own session (storage policy: wallet:approve) — as today
  const slips = pendingR.error ? [] : await Promise.all((pendingR.data ?? []).map(async (t) => (t.slip_path ? ((await sb.storage.from('transfer-slips').createSignedUrl(t.slip_path as string, 600)).data?.signedUrl ?? null) : null)));
  const pending: PendingTransfer[] | null = pendingR.error
    ? null
    : (pendingR.data ?? []).map((t, i) => ({ id: t.id as string, org_name: name(t.organizations), amount_cents: Number(t.amount_cents), reference: (t.reference as string | null) ?? null, bank_ref: (t.bank_ref as string | null) ?? null, slip_url: slips[i] ?? null, created_at: t.created_at as string }));
  const decided: DecidedTransfer[] | null = done
    ? done.map((t) => ({
        id: t.id as string, org_name: name(t.organizations), amount_cents: Number(t.amount_cents), amount_received_cents: t.amount_received_cents == null ? null : Number(t.amount_received_cents),
        reference: (t.reference as string | null) ?? null, bank_ref: (t.bank_ref as string | null) ?? null, status: t.status as string, reject_reason: (t.reject_reason as string | null) ?? null,
        received_reason: (t.received_reason as string | null) ?? null, received_reason_text: (t.received_reason_text as string | null) ?? null, received_note: t.received_note ?? null, confirmed_at: (t.confirmed_at as string | null) ?? null,
      }))
    : null;
  return (
    <TransfersScreen
      state="ok"
      pending={pending}
      decided={decided}
      canRecordProforma={can(s, 'finance', 'approve')}
      approvalLimitMinor={readiness.ok ? readiness.data.limitMinor : null}
      actions={ACTIONS}
    />
  );
}

export default function TransfersPage() {
  return (
    <Suspense fallback={<TransfersScreen state="loading" pending={[]} decided={[]} canRecordProforma={false} approvalLimitMinor={null} actions={ACTIONS} />}>
      <TransfersContent />
    </Suspense>
  );
}
