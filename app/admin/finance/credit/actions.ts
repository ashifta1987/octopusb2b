'use server';

import { revalidatePath } from 'next/cache';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export async function proposeCreditTermsAction(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  await requireStaff('finance', 'view', '/admin/finance/credit');
  const orgId = String(formData.get('org_id') ?? '').trim();
  const divisionIdRaw = String(formData.get('division_id') ?? '').trim();
  const divisionId = divisionIdRaw && divisionIdRaw !== 'all' ? divisionIdRaw : null;
  const limitUsd = Number(formData.get('credit_limit_usd') ?? 0);
  const limitCents = Math.max(0, Math.round(limitUsd * 100));
  const netDays = Number(formData.get('net_days') ?? 30);
  const note = String(formData.get('note') ?? '').trim() || null;

  if (!orgId) return { ok: false, error: 'Please select a customer company.' };

  const sb = await createClient();
  const { error } = await sb.rpc('propose_customer_credit_terms', {
    p_org: orgId,
    p_credit_limit_cents: limitCents,
    p_net_days: netDays,
    p_division: divisionId,
    p_currency: 'USD',
    p_note: note,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/finance/credit');
  return { ok: true };
}

export async function decideCreditTermsAction(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  await requireStaff('finance', 'view', '/admin/finance/credit');
  const termsId = String(formData.get('terms_id') ?? '').trim();
  const approve = formData.get('approve') === 'true';
  const note = String(formData.get('note') ?? '').trim() || null;

  if (!termsId) return { ok: false, error: 'Missing credit terms ID.' };

  const sb = await createClient();
  const { error } = await sb.rpc('decide_customer_credit_terms', {
    p_terms_id: termsId,
    p_approve: approve,
    p_note: note,
  });

  if (error) {
    return {
      ok: false,
      error: /MAKER_CANNOT_APPROVE/.test(error.message)
        ? 'Two-person rule: credit limits ALWAYS require a second Finance approver (proposer cannot approve their own proposal).'
        : error.message,
    };
  }

  revalidatePath('/admin/finance/credit');
  return { ok: true };
}

export async function generateDropshipStatementAction(formData: FormData): Promise<{
  ok: boolean;
  statementNumber?: string;
  invoiceCount?: number;
  error?: string;
}> {
  await requireStaff('finance', 'view', '/admin/finance/credit');
  const orgId = String(formData.get('org_id') ?? '').trim();
  if (!orgId) return { ok: false, error: 'Select a customer company.' };

  const sb = await createClient();
  const { data, error } = await sb.rpc('generate_dropship_weekly_statement', {
    p_org: orgId,
  });

  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/finance/credit');
  const res = data as { number?: string; invoice_count?: number };
  return {
    ok: true,
    statementNumber: res?.number,
    invoiceCount: Number(res?.invoice_count ?? 0),
  };
}
