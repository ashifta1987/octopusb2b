'use server';

import { revalidatePath } from 'next/cache';
import { toCents } from '@/lib/format';
import { requireDropshipV2Staff } from '@/lib/dropship-staff';
import { createClient } from '@/lib/supabase/server';

export type RequestQuoteResult = { ok: boolean; code?: string; error?: string; message?: string };

/** Batch 3 (F-07): Dropship staff send a landed-cost quote on a merchant's product request (RFQ code stays real). */
export async function quoteDropshipRequestAction(formData: FormData): Promise<RequestQuoteResult> {
  await requireDropshipV2Staff(true, '/office/dropship/requests');
  const rfqId = String(formData.get('rfq_id') ?? '').trim();
  const amount = String(formData.get('landed') ?? '').trim();
  const country = String(formData.get('country') ?? '').trim().toUpperCase();
  if (!/^[0-9a-f-]{36}$/i.test(rfqId)) return { ok: false, error: 'Missing request.' };
  if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
    return { ok: false, code: 'INVALID_AMOUNT', error: 'Enter the landed price per unit in US$, e.g. 18.50.' };
  }
  if (!/^[A-Z]{2}$/.test(country)) return { ok: false, code: 'INVALID_COUNTRY', error: 'Choose the country this price is for.' };

  const sb = await createClient();
  const { data, error } = await sb.rpc('set_dropship_request_landed_quote', {
    p_rfq_id: rfqId,
    p_landed_cents: toCents(amount),
    p_country: country,
  });
  if (error) {
    const m = error.message.match(/^([A-Z0-9_]+):?\s*(.*)$/);
    return { ok: false, code: m?.[1], error: m?.[2] || error.message };
  }
  revalidatePath('/office/dropship/requests');
  return { ok: true, message: `Quote sent on ${(data as { rfq_code?: string })?.rfq_code ?? 'the request'}.` };
}

/** EA-1 (design v2 StaffRequests): decline an open request with a reason (DS edit or Sourcing requests:edit; never Support). */
export async function declineDropshipRequestAction(rfqId: string, reason: string): Promise<RequestQuoteResult> {
  await requireDropshipV2Staff(false, '/office/dropship/requests');
  if (!/^[0-9a-f-]{36}$/i.test(rfqId)) return { ok: false, error: 'Missing request.' };
  if (!reason.trim()) return { ok: false, code: 'REASON_REQUIRED', error: 'Enter why the request is declined.' };
  const sb = await createClient();
  const { data, error } = await sb.rpc('decline_dropship_product_request', { p_rfq_id: rfqId, p_reason: reason.trim() });
  if (error) {
    const m = error.message.match(/^([A-Z0-9_]+):?\s*(.*)$/);
    if (m?.[1] === 'FORBIDDEN') return { ok: false, code: 'FORBIDDEN', error: 'Only Dropshipping or Sourcing staff who can edit requests can decline them.' };
    return { ok: false, code: m?.[1], error: m?.[2] || error.message };
  }
  revalidatePath('/office/dropship/requests');
  return { ok: true, message: `${(data as { rfq_code?: string })?.rfq_code ?? 'The request'} declined.` };
}
