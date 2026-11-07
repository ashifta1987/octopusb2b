'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth';
import { mapDbError } from '@/lib/format';
import type { ActionResult } from '@/components/account/data';

const Transfer = z.object({
  amountCents: z.number().int().min(100, 'The minimum is US$ 1.00').max(100_000_000, 'For transfers above US$ 1,000,000 please contact your account manager'),
  slipPath: z.string().min(10).max(300),
  bankRef: z.string().trim().max(80).optional(),
});

/** ADDON-41 rule 5: wallet top-ups are US dollar bank transfers only. The customer uploads the slip; finance confirms in Admin. */
export async function submitTransfer(input: { amountCents: number; slipPath: string; bankRef?: string }): Promise<ActionResult> {
  const p = Transfer.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Check the form' };
  const s = await getSession();
  if (!s?.org || s.isStaff) return { ok: false, error: mapDbError({ message: 'NO_ORG' }) };
  if (!p.data.slipPath.startsWith(`${s.org.id}/`)) return { ok: false, error: mapDbError({ message: 'SLIP_REQUIRED' }) };
  const sb = await createClient();
  const { error } = await sb.rpc('submit_bank_transfer', { p_amount_cents: p.data.amountCents, p_slip_path: p.data.slipPath, p_bank_ref: p.data.bankRef || null });
  if (error) return { ok: false, error: mapDbError(error) };
  revalidatePath('/account/wallet'); revalidatePath('/account');
  return { ok: true };
}
