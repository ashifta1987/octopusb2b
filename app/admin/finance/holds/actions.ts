'use server';

import { revalidatePath } from 'next/cache';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export async function financeActOnHoldAction(formData: FormData): Promise<{
  ok: boolean;
  requiresSecondApprover?: boolean;
  error?: string;
}> {
  await requireStaff('finance', 'view', '/admin/finance/holds');
  const holdId = String(formData.get('hold_id') ?? '').trim();
  const action = String(formData.get('action') ?? 'release').trim();
  const amountRaw = String(formData.get('amount_cents') ?? '').trim();
  const amountCents = amountRaw ? Math.round(Number(amountRaw)) : null;
  const reason = String(formData.get('reason') ?? '').trim() || 'Milestone confirmed by Finance';
  const refundDestination = String(formData.get('refund_destination') ?? 'wallet').trim();

  if (!holdId) return { ok: false, error: 'Missing hold ID.' };

  const sb = await createClient();
  const { data, error } = await sb.rpc('finance_act_on_escrow_hold', {
    p_hold_id: holdId,
    p_action: action,
    p_amount_cents: amountCents,
    p_reason: reason,
    p_refund_destination: refundDestination,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/finance/holds');
  revalidatePath('/admin/reports/divisions');
  const res = data as { requires_second_approver?: boolean };
  return {
    ok: true,
    requiresSecondApprover: Boolean(res?.requires_second_approver),
  };
}

export async function decideHoldApprovalAction(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  await requireStaff('finance', 'view', '/admin/finance/holds');
  const approvalId = String(formData.get('approval_id') ?? '').trim();
  const approve = formData.get('approve') === 'true';
  const note = String(formData.get('note') ?? '').trim() || null;

  if (!approvalId) return { ok: false, error: 'Missing approval ID.' };

  const sb = await createClient();
  const { error } = await sb.rpc('decide_escrow_hold_approval', {
    p_approval_id: approvalId,
    p_approve: approve,
    p_note: note,
  });

  if (error) {
    return {
      ok: false,
      error: /MAKER_CANNOT_APPROVE/.test(error.message)
        ? 'Two-person rule: the person who proposed this release or refund cannot approve it. Ask a second Finance officer.'
        : error.message,
    };
  }

  revalidatePath('/admin/finance/holds');
  revalidatePath('/admin/reports/divisions');
  return { ok: true };
}
