// ODS T9 · Accounts › Credit terms (Pay later). Replaces the T8 re-export of app/admin/finance/credit/page.tsx inside the ODS
// Back Office frame. Same guard (requireStaff('finance','view')) and the same reads with the same client as today (service
// role after the guard), today's actions unchanged (propose / decide — always two-person in the database — and the
// Dropshipping weekly statement).
import { Suspense } from 'react';
import { requireStaff } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { proposeCreditTermsAction, decideCreditTermsAction, generateDropshipStatementAction } from '@/app/admin/finance/credit/actions';
import { creditUsage } from '../_accounts-b/core';
import { CreditScreen, type CreditRow, type OrgOption, type StatementRow } from './_components/credit-screen';

export const metadata = { title: 'Credit terms (Pay later)' };

const ACTIONS = { propose: proposeCreditTermsAction, decide: decideCreditTermsAction, statement: generateDropshipStatementAction };
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

async function CreditContent() {
  const s = await requireStaff('finance', 'view', '/admin/finance/credit');
  const sb = createAdminClient();
  const [terms, orgs, divisions, unpaidDocs, reservations, dsStatements] = await Promise.all([
    sb.from('customer_credit_terms').select('id, org_id, division_id, credit_limit_cents, currency, net_days, status, overdue_blocked, proposed_by, approved_by, note, updated_at, organizations(name, kyc_status), divisions(code)').order('updated_at', { ascending: false }),
    sb.from('organizations').select('id, name, kyc_status, credit_eligible').order('name', { ascending: true }).limit(200),
    sb.from('divisions').select('id, code, name').order('sort_order', { ascending: true }),
    sb.from('documents').select('org_id, division_id, amount_cents, paid_cents, status').eq('doc_type', 'commercial_invoice').not('status', 'in', '("paid","void","cancelled")'),
    sb.from('credit_reservations').select('org_id, division_id, amount_cents').eq('status', 'reserved'),
    sb.from('documents').select('id, org_id, number, amount_cents, paid_cents, currency, status, data, created_at, organizations(name), legal_entities(code, legal_name)').eq('doc_type', 'statement').like('number', 'STMT-DS-%').order('created_at', { ascending: false }).limit(25),
  ]);
  const unpaid = (unpaidDocs.data ?? []) as { org_id: string; division_id: string | null; amount_cents: number | null; paid_cents: number | null }[];
  const reserved = (reservations.data ?? []) as { org_id: string; division_id: string | null; amount_cents: number | null }[];
  const rows: CreditRow[] | null = terms.error
    ? null
    : (terms.data ?? []).map((t) => {
        const divId = (t.division_id as string | null) ?? null;
        const u = creditUsage(t.org_id as string, divId, unpaid, reserved);
        const org = one(t.organizations as { name?: string; kyc_status?: string } | null);
        return {
          id: t.id as string,
          org_id: t.org_id as string,
          org_name: org?.name ?? 'Customer',
          kyc_status: org?.kyc_status ?? 'not_started',
          division_id: divId,
          division_code: one(t.divisions as { code?: string } | null)?.code ?? 'ALL',
          credit_limit_cents: Number(t.credit_limit_cents),
          currency: (t.currency as string)?.trim() || 'USD',
          net_days: Number(t.net_days),
          status: t.status as string,
          overdue_blocked: Boolean(t.overdue_blocked),
          proposed_by: t.proposed_by as string,
          approved_by: (t.approved_by as string | null) ?? null,
          note: (t.note as string | null) ?? null,
          unpaid_invoices_cents: u.unpaid,
          reserved_cents: u.reserved,
          updated_at: t.updated_at as string,
        };
      });
  const statements: StatementRow[] = (dsStatements.data ?? []).map((st) => {
    const d = (st.data ?? {}) as { invoice_count?: number; sample_count?: number; legal_entity_code?: string; issuer?: string };
    const ent = one(st.legal_entities as { code?: string; legal_name?: string } | null);
    return {
      id: st.id as string,
      number: st.number as string,
      org_name: one(st.organizations as { name?: string } | null)?.name ?? 'Merchant',
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
    <CreditScreen
      state="ok"
      rows={rows}
      statements={statements}
      orgs={(orgs.data ?? []) as unknown as OrgOption[]}
      divisions={(divisions.data ?? []) as unknown as { id: string; code: string; name: string }[]}
      meId={s.userId}
      actions={ACTIONS}
    />
  );
}

export default function FinanceCreditPage() {
  return (
    <Suspense fallback={<CreditScreen state="loading" rows={[]} statements={[]} orgs={[]} divisions={[]} meId="" actions={ACTIONS} />}>
      <CreditContent />
    </Suspense>
  );
}
