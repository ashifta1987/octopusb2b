import { Suspense } from 'react';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui';
import { HoldsClient, type StaffHoldApprovalRow, type StaffHoldRow } from './holds-client';

export const metadata = { title: 'Held payments (Payment protection)' };

async function HoldsPageContent() {
  const s = await requireStaff('finance', 'view', '/admin/finance/holds');
  const sb = await createClient();

  const [{ data: holds }, { data: approvals }, { data: thresholdRow }] = await Promise.all([
    sb
      .from('escrow_holds')
      .select(
        'id, org_id, division_id, service, target_type, target_id, order_id, store_order_id, funding_method, amount_cents, released_cents, refunded_cents, currency, release_rule, milestone_label, status, dispute_reason, invoice_id, created_at, organizations(name), divisions(code), orders(code), store_orders!escrow_holds_store_order_id_fkey(order_number), documents!escrow_holds_invoice_id_fkey(number)',
      )
      .order('created_at', { ascending: false })
      .limit(200),
    sb
      .from('escrow_hold_approvals')
      .select('id, hold_id, action, amount_cents, refund_destination, reason, status, proposed_by, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true }),
    sb.from('site_settings').select('value').eq('key', 'payments.approval_threshold_cents').maybeSingle(),
  ]);

  const thresholdCents = Number(thresholdRow?.value ?? 100000) || 100000;

  const rows: StaffHoldRow[] = (holds ?? []).map((h) => ({
    id: h.id as string,
    org_id: h.org_id as string,
    org_name: ((h.organizations as { name?: string } | null)?.name ?? 'Customer') as string,
    division_code: ((h.divisions as { code?: string } | null)?.code ?? 'SRC') as string,
    service: h.service as string,
    target_type: h.target_type as string,
    target_id: h.target_id as string,
    order_code: (
      ((h.orders as { code?: string } | null)?.code ??
        (h.store_orders as { order_number?: string } | null)?.order_number ??
        null) as string | null
    ),
    funding_method: h.funding_method as string,
    amount_cents: Number(h.amount_cents),
    released_cents: Number(h.released_cents),
    refunded_cents: Number(h.refunded_cents),
    currency: (h.currency as string)?.trim() || 'USD',
    release_rule: h.release_rule as string,
    milestone_label: h.milestone_label as string,
    status: h.status as string,
    dispute_reason: (h.dispute_reason as string | null) ?? null,
    invoice_number: ((h.documents as { number?: string } | null)?.number ?? null) as string | null,
    created_at: h.created_at as string,
  }));

  return (
    <>
      <PageHeader
        title="Held payments (Payment protection)"
        subtitle="Customer funds held under Payment protection until milestone completion. Releasing funds issues the OCT- tax invoice once and recognizes revenue. Releases or refunds above US$ 1,000 require two-person Finance approval."
      />
      <HoldsClient
        holds={rows}
        approvals={((approvals ?? []) as unknown) as StaffHoldApprovalRow[]}
        currentUserId={s.userId}
        thresholdCents={thresholdCents}
      />
    </>
  );
}

export default function FinanceHoldsPage() {
  return (
    <Suspense fallback={<div className="min-h-[60vh]" aria-busy="true" />}>
      <HoldsPageContent />
    </Suspense>
  );
}
