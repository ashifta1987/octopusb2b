import { Suspense } from 'react';
import { requireStaff } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui';
import { CreditTermsClient, type StaffCreditTermRow } from './credit-client';

export const metadata = { title: 'Credit terms (Pay later)' };

async function CreditPageContent() {
  const s = await requireStaff('finance', 'view', '/admin/finance/credit');
  const sb = createAdminClient();

  const [{ data: terms }, { data: orgs }, { data: divisions }, { data: unpaidDocs }, { data: reservations }] =
    await Promise.all([
      sb
        .from('customer_credit_terms')
        .select(
          'id, org_id, division_id, credit_limit_cents, currency, net_days, status, overdue_blocked, proposed_by, approved_by, note, updated_at, organizations(name, kyc_status), divisions(code)',
        )
        .order('updated_at', { ascending: false }),
      sb.from('organizations').select('id, name, kyc_status, credit_eligible').order('name', { ascending: true }).limit(200),
      sb.from('divisions').select('id, code, name').order('sort_order', { ascending: true }),
      sb
        .from('documents')
        .select('org_id, division_id, amount_cents, paid_cents, status')
        .eq('doc_type', 'commercial_invoice')
        .not('status', 'in', '("paid","void","cancelled")'),
      sb.from('credit_reservations').select('org_id, division_id, amount_cents').eq('status', 'reserved'),
    ]);

  const rows: StaffCreditTermRow[] = (terms ?? []).map((t) => {
    const orgId = t.org_id as string;
    const divId = (t.division_id as string | null) ?? null;

    const unpaid = (unpaidDocs ?? [])
      .filter((d) => d.org_id === orgId && (!divId || d.division_id === divId))
      .reduce((acc, d) => acc + Math.max(0, Number(d.amount_cents ?? 0) - Number(d.paid_cents ?? 0)), 0);

    const reserved = (reservations ?? [])
      .filter((r) => r.org_id === orgId && (!divId || r.division_id === divId))
      .reduce((acc, r) => acc + Number(r.amount_cents ?? 0), 0);

    return {
      id: t.id as string,
      org_id: orgId,
      org_name: ((t.organizations as { name?: string } | null)?.name ?? 'Customer') as string,
      kyc_status: ((t.organizations as { kyc_status?: string } | null)?.kyc_status ?? 'not_started') as string,
      division_id: divId,
      division_code: ((t.divisions as { code?: string } | null)?.code ?? 'ALL') as string,
      credit_limit_cents: Number(t.credit_limit_cents),
      currency: (t.currency as string)?.trim() || 'USD',
      net_days: Number(t.net_days),
      status: t.status as string,
      overdue_blocked: Boolean(t.overdue_blocked),
      proposed_by: t.proposed_by as string,
      approved_by: (t.approved_by as string | null) ?? null,
      note: (t.note as string | null) ?? null,
      unpaid_invoices_cents: unpaid,
      reserved_cents: reserved,
      updated_at: t.updated_at as string,
    };
  });

  return (
    <>
      <PageHeader
        title="Credit terms (Pay later)"
        subtitle="Manage customer credit limits per division, Net payment terms (7, 15, 30, 45, 60 days), and two-person approval requests. Wallet balance is strictly separate from Pay-later credit."
      />
      <CreditTermsClient
        terms={rows}
        orgs={((orgs ?? []) as unknown) as { id: string; name: string; kyc_status: string; credit_eligible: boolean }[]}
        divisions={((divisions ?? []) as unknown) as { id: string; code: string; name: string }[]}
        currentUserId={s.userId}
      />
    </>
  );
}

export default function FinanceCreditPage() {
  return (
    <Suspense fallback={<div className="min-h-[60vh]" aria-busy="true" />}>
      <CreditPageContent />
    </Suspense>
  );
}
