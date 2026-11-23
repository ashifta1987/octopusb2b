'use server';

import { revalidatePath } from 'next/cache';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export async function runPaymentReconciliationAction(): Promise<{
  ok: boolean;
  checked?: number;
  alertsRaised?: number;
  error?: string;
}> {
  await requireStaff('finance', 'view', '/admin/finance/receivables');
  const sb = await createClient();
  const { data, error } = await sb.rpc('run_payment_reconciliation');
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/finance/receivables');
  const res = data as { checked?: number; alerts_raised?: number };
  return {
    ok: true,
    checked: Number(res?.checked ?? 0),
    alertsRaised: Number(res?.alerts_raised ?? 0),
  };
}

export async function runCreditAndSaasOverdueCheckAction(): Promise<{
  ok: boolean;
  remindersSent?: number;
  orgsBlocked?: number;
  saasSuspended?: number;
  expiredPledges?: number;
  error?: string;
}> {
  await requireStaff('finance', 'view', '/admin/finance/receivables');
  const sb = await createClient();
  const { data, error } = await sb.rpc('run_credit_and_saas_overdue_check');
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/finance/receivables');
  revalidatePath('/admin/finance/credit');
  const res = data as {
    reminders_sent?: number;
    orgs_overdue_blocked?: number;
    saas_suspended?: number;
    expired_pledges?: number;
  };
  return {
    ok: true,
    remindersSent: Number(res?.reminders_sent ?? 0),
    orgsBlocked: Number(res?.orgs_overdue_blocked ?? 0),
    saasSuspended: Number(res?.saas_suspended ?? 0),
    expiredPledges: Number(res?.expired_pledges ?? 0),
  };
}
