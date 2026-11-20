'use server';
import { revalidatePath } from 'next/cache';
import { requireCustomer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export type PayResult = { ok: boolean; message: string };

/**
 * Pay a service proforma (Make My Brand, 3PL, …) from the wallet. The idempotency key comes from the form (one per
 * page view), so a double click or a retried request is never charged twice. When the proforma is fully paid the
 * database issues the OCT- tax invoice (pay_service_proforma, migration 201).
 */
export async function payProformaFromWallet(_prev: PayResult | null, fd: FormData): Promise<PayResult> {
  await requireCustomer('/account/invoices');
  const id = String(fd.get('document_id') ?? '');
  const key = String(fd.get('idempotency_key') ?? '');
  const amount = Math.round(Number(fd.get('amount_cents')));
  if (!/^[0-9a-f-]{36}$/i.test(id) || key.length < 16 || !(amount > 0)) return { ok: false, message: 'Something is missing. Reload the page and try again.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('pay_service_proforma', { p_document: id, p_amount: amount, p_method: 'wallet', p_reference: null, p_idempotency_key: key });
  if (error) {
    const m = error.message;
    return { ok: false, message: /WALLET_INSUFFICIENT/.test(m) ? 'Your wallet balance is not enough. Top up first, then pay.'
      : /ALREADY_PAID/.test(m) ? 'This proforma is already paid.' : /WALLET_DISABLED/.test(m) ? 'Wallet payments are switched off at the moment.'
      : /INVALID_AMOUNT/.test(m) ? 'The amount is more than what is left to pay.' : 'The payment could not be made. Please try again or contact us.' };
  }
  revalidatePath('/account/invoices');
  const r = data as { fully_paid?: boolean; repeated?: boolean };
  return { ok: true, message: r.fully_paid ? 'Paid. Your tax invoice has been issued.' : 'Payment received. It is held as a deposit until the proforma is fully paid.' };
}
