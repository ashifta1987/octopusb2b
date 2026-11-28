// ODS T9 · Accounts › Held payments (Payment protection). Replaces the T8 re-export of app/admin/finance/holds/page.tsx
// inside the ODS Back Office frame. Same guard (requireStaff('finance','view')), the same three reads as today (session
// client), today's actions unchanged (financeActOnHoldAction / decideHoldApprovalAction — two-person in the database).
import { Suspense } from 'react';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { financeActOnHoldAction, decideHoldApprovalAction } from '@/app/admin/finance/holds/actions';
import { holdThreshold } from '../_accounts-b/core';
import { HoldsScreen, type HoldApproval, type HoldRow } from './_components/holds-screen';

export const metadata = { title: 'Held payments (Payment protection)' };

const ACTIONS = { act: financeActOnHoldAction, decide: decideHoldApprovalAction };
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

async function HoldsContent() {
  const s = await requireStaff('finance', 'view', '/admin/finance/holds');
  const sb = await createClient();
  const [holds, approvals, thresholdRow] = await Promise.all([
    sb
      .from('escrow_holds')
      .select(
        'id, org_id, division_id, service, target_type, target_id, order_id, store_order_id, funding_method, amount_cents, released_cents, refunded_cents, currency, release_rule, milestone_label, status, dispute_reason, invoice_id, created_at, organizations(name), divisions(code), orders(code), store_orders!escrow_holds_store_order_id_fkey(order_number), documents!escrow_holds_invoice_id_fkey(number)',
      )
      .order('created_at', { ascending: false })
      .limit(200),
    sb.from('escrow_hold_approvals').select('id, hold_id, action, amount_cents, refund_destination, reason, status, proposed_by, created_at').eq('status', 'pending').order('created_at', { ascending: true }),
    sb.from('site_settings').select('value').eq('key', 'payments.approval_threshold_cents').maybeSingle(),
  ]);
  const rows: HoldRow[] | null = holds.error
    ? null
    : (holds.data ?? []).map((h) => ({
        id: h.id as string,
        org_id: h.org_id as string,
        org_name: one(h.organizations as { name?: string } | null)?.name ?? 'Customer',
        division_code: one(h.divisions as { code?: string } | null)?.code ?? 'SRC',
        service: h.service as string,
        target_type: h.target_type as string,
        target_id: h.target_id as string,
        order_code: one(h.orders as { code?: string } | null)?.code ?? one(h.store_orders as { order_number?: string } | null)?.order_number ?? null,
        funding_method: h.funding_method as string,
        amount_cents: Number(h.amount_cents),
        released_cents: Number(h.released_cents),
        refunded_cents: Number(h.refunded_cents),
        currency: (h.currency as string)?.trim() || 'USD',
        release_rule: h.release_rule as string,
        milestone_label: h.milestone_label as string,
        status: h.status as string,
        dispute_reason: (h.dispute_reason as string | null) ?? null,
        invoice_number: one(h.documents as { number?: string } | null)?.number ?? null,
        created_at: h.created_at as string,
      }));
  return (
    <HoldsScreen
      state="ok"
      rows={rows}
      approvals={((approvals.data ?? []) as unknown as HoldApproval[]).map((a) => ({ ...a, amount_cents: Number(a.amount_cents) }))}
      meId={s.userId}
      thresholdCents={holdThreshold(thresholdRow.data?.value)}
      actions={ACTIONS}
    />
  );
}

export default function FinanceHoldsPage() {
  return (
    <Suspense fallback={<HoldsScreen state="loading" rows={[]} approvals={[]} meId="" thresholdCents={100000} actions={ACTIONS} />}>
      <HoldsContent />
    </Suspense>
  );
}
