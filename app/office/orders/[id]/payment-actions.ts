'use server';
import { createClient } from '@/lib/supabase/server';
import { isStepUpError, stepUpRedirect } from '@/lib/staff/step-up';
import { recordPayment } from '../../actions';

type R = { ok: true; message?: string } | { ok: false; error: string; redirect?: string };

/**
 * Record payment with SPEC §17.3 step-up: record_payment raises STEP_UP_REQUIRED for staff whose 2FA code is older
 * than staff_security.step_up_minutes → return a redirect to /staff/verify (the admin ActionForm navigates there).
 */
export async function recordPaymentStepUp(orderId: string, _prev: R | null, fd: FormData): Promise<R> {
  const back = `/office/orders/${orderId}`;
  const stepUp: R = { ok: false, error: 'STEP_UP_REQUIRED', redirect: stepUpRedirect(back) };
  const sb = await createClient();
  const { data: fresh } = await sb.rpc('mfa_fresh');
  if (fresh === false) return stepUp;
  const r = await recordPayment(orderId, fd);
  if (r.ok) return { ok: true, message: r.message };
  return isStepUpError(r.error) ? stepUp : { ok: false, error: r.error };
}
