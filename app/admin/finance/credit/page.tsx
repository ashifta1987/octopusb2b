import { Suspense } from 'react';
import { requireStaff } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui';
import { CreditTermsClient, type StaffCreditTermRow, type StaffDropshipStatementRow } from './credit-client';

export const metadata = { title: 'Credit terms (Pay later)' };

async function CreditPageContent() {
  const s = await requireStaff('finance', 'view', '/admin/finance/credit');
  const sb = createAdminClient();

  const [{ data: terms }, { data: orgs }, { data: divisions }, { data: unpaidDocs }, { data: reservations }, { data: dsStatements }] =
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
      sb
        .from('documents')
        .select('id, org_id, number, amount_cents, paid_cents, currency, status, data, created_at, organizations(name), legal_entities(code, legal_name)')
        .eq('doc_type', 'statement')
        .like('number', 'STMT-DS-%')
        .order('created_at', { ascending: false })
        .limit(25),
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

  const statements: StaffDropshipStatementRow[] = (dsStatements ?? []).map((st) => {
    const d = (st.data ?? {}) as { invoice_count?: number; sample_count?: number; legal_entity_code?: string; issuer?: string };
    const ent = st.legal_entities as { code?: string; legal_name?: string } | null;
    return {
      id: st.id as string,
      number: st.number as string,
      org_name: ((st.organizations as { name?: string } | null)?.name ?? 'Merchant') as string,
      legal_entity_code: ent?.code ?? d.legal_entity_code ?? 'SZ-OCTOPUS',
      legal_entity_name: ent?.legal_name ?? d.issuer ?? 'Shenzhen Octopus Trading Co., Ltd.',
      invoice_count: Number(d.invoice_count ?? 0),
      sample_count: Number(d.sample_count ?? 0),
      amount_cents: Number(st.amount_cents ?? 0),
      paid_cents: Number(st.paid_cents ?? 0),
      currency: ((st.currency as string) ?? 'USD').trim() || 'USD',
      status: (st.status as string) ?? 'issued',
      created_at: st.created_at as string,
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
        statements={statements}
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
