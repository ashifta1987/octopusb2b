'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth';
import { getPayment } from '@/lib/adapters';
import { mapDbError } from '@/lib/format';
import type { ActionResult } from '@/components/account/data';

const Topup = z.object({
  amountCents: z.number().int().min(100, 'Minimum top-up is 1.00 in the wallet currency').max(100_000_000),
  reference: z.string().trim().min(3, 'Enter the transfer reference').max(80),
});

/** Bank transfer top-up: stays pending until finance confirms the incoming transfer (SPEC §4.2). */
export async function requestBankTopup(input: { amountCents: number; reference: string }): Promise<ActionResult> {
  const p = Topup.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Invalid input' };
  const sb = await createClient();
  const { error } = await sb.rpc('request_topup', { p_amount: p.data.amountCents, p_method: 'bank_transfer', p_reference: p.data.reference });
  if (error) return { ok: false, error: mapDbError(error) };
  revalidatePath('/account/wallet');
  return { ok: true };
}

/** Card top-up through the payment adapter (test mode until a provider is configured). */
export async function startCardTopup(input: { amountCents: number }): Promise<ActionResult<{ checkoutUrl: string }>> {
  const p = Topup.shape.amountCents.safeParse(input.amountCents);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Invalid amount' };
  const s = await getSession();
  if (!s?.org) return { ok: false, error: mapDbError({ message: 'NO_ORG' }) };
  const sb = await createClient();
  const reference = `TOPUP-${s.org.id.slice(0, 8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
  const { data: cur } = await sb.rpc('current_platform_currency');
  let intent: { id: string; checkoutUrl: string };
  try {
    intent = await getPayment().createIntent({ amountCents: p.data, currency: (cur as string) ?? 'USD', reference, description: 'Octopus B2B wallet top-up' });
  } catch (e) {
    return { ok: false, error: (e as Error).message || 'Payment partner unavailable' };
  }
  const { error } = await sb.rpc('request_topup', { p_amount: p.data, p_method: 'card', p_reference: intent.id });
  if (error) return { ok: false, error: mapDbError(error) };
  revalidatePath('/account/wallet');
  return { ok: true, data: { checkoutUrl: intent.checkoutUrl } };
}
