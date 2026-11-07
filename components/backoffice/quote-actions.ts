'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { toCents } from '@/lib/format';
import { actionSession, fail, ok, type Result } from './server-utils';

const QuoteInput = z.object({
  supplier_id: z.string().uuid('Choose a supplier'),
  unit_price: z.string().min(1, 'Unit price required'),
  quantity: z.coerce.number().int().positive('Quantity must be > 0'),
  incoterm: z.string().min(2).max(10),
  lead_days: z.coerce.number().int().nonnegative(),
  shipping: z.string().optional(),
  notes: z.string().max(2000).optional(),
  moq: z.union([z.literal(''), z.coerce.number().int().positive('MOQ must be > 0')]).optional(),
  sample_price: z.string().optional(),
});

/** Quote on an RFQ for a supplier (distributor: assigned suppliers only — enforced in send_quote). */
export async function sendQuote(rfqId: string, fd: FormData): Promise<Result> {
  const g = await actionSession('requests', 'create');
  if ('error' in g) return fail(g.error);
  const p = QuoteInput.safeParse(Object.fromEntries(fd));
  if (!p.success) return fail(p.error.issues[0]?.message ?? 'Check the form');
  const price = toCents(p.data.unit_price);
  const ship = p.data.shipping ? toCents(p.data.shipping) : 0;
  if (!Number.isFinite(price) || price <= 0) return fail('Unit price must be greater than 0.');
  if (!Number.isFinite(ship) || ship < 0) return fail('Shipping must be 0 or more.');
  const sample = p.data.sample_price ? toCents(p.data.sample_price) : null;
  if (sample != null && (!Number.isFinite(sample) || sample < 0)) return fail('Sample price must be 0 or more.');
  const sb = await createClient();
  const { error } = await sb.rpc('send_quote', {
    p_rfq: rfqId, p_supplier: p.data.supplier_id, p_unit_price_cents: price, p_quantity: p.data.quantity,
    p_incoterm: p.data.incoterm, p_lead_days: p.data.lead_days, p_shipping_cents: ship, p_notes: p.data.notes || null,
    p_moq: p.data.moq === '' || p.data.moq == null ? null : p.data.moq, p_sample_price_cents: sample,
  });
  if (error) return fail(error.message.startsWith('FORBIDDEN_SUPPLIER') ? 'This supplier is not assigned to you.' : error);
  revalidatePath('/distributor/rfqs');
  revalidatePath('/office/rfqs');
  revalidatePath(`/office/rfqs/${rfqId}`);
  return ok(undefined, 'Quote sent to the buyer');
}
