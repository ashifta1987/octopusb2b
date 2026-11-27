'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { isStaging } from '@/lib/core/account';
import { requireDropshipV2Staff } from '@/lib/dropship-staff';
import { createClient } from '@/lib/supabase/server';
import { rpcMessage } from '@/lib/dropship-ds6';
import { decimalToMinor } from '@/lib/connectors/formats';

/** STAGING ONLY — create a test store order through the real intake (ds_test_order_create checks staff + staging again). */
const Input = z.object({
  org_id: z.string().uuid(),
  external_order_id: z.string().trim().max(64).optional().or(z.literal('')),
  model_no: z.string().trim().regex(/^DS-\d{6}-\d{2}$/, 'Enter a DS variant model number, like DS-000001-01.'),
  qty: z.number().int().min(1).max(50),
  // C0: the customs value is what the buyer paid — a test order needs the buyer's price too (USD, e.g. 24.99)
  buyer_price: z.string().trim().regex(/^\d{1,6}(\.\d{1,2})?$/, 'Enter the price the buyer paid, like 24.99.'),
  other_items: z.number().int().min(0).max(20),
  risk: z.enum(['low', 'medium', 'high']),
  address_check: z.enum(['ok', 'failed']),
  address_issue: z.string().trim().max(300).optional().or(z.literal('')),
  buyer_name: z.string().trim().min(2).max(120),
  line1: z.string().trim().max(200),
  city: z.string().trim().max(120),
  postcode: z.string().trim().max(20).optional().or(z.literal('')),
  country: z.string().trim().regex(/^[A-Z]{2}$/),
});

export async function createTestOrderAction(input: z.input<typeof Input>): Promise<{ ok: boolean; message: string; order_number?: string }> {
  if (!isStaging()) return { ok: false, message: 'Test orders can only be created on staging.' };
  await requireDropshipV2Staff(true, '/office/dropship/test-order');
  const p = Input.safeParse(input);
  if (!p.success) return { ok: false, message: p.error.issues[0]?.message ?? 'Check the form.' };
  const v = p.data;
  const sb = await createClient();
  const { data, error } = await sb.rpc('ds_test_order_create', {
    p_org: v.org_id,
    p_order: {
      external_order_id: v.external_order_id || null,
      buyer_name: v.buyer_name,
      risk: v.risk,
      address_check: v.address_check,
      address_issue: v.address_issue || null,
      other_items: v.other_items,
      address: { name: v.buyer_name, line1: v.line1, city: v.city, postcode: v.postcode || null, country: v.country },
      lines: [{ model_no: v.model_no, qty: v.qty, buyer_unit_price_cents: decimalToMinor(v.buyer_price, 'USD') }],
    },
  });
  if (error) return { ok: false, message: rpcMessage(error) };
  const r = data as { ok: boolean; code?: string; message?: string; order_number?: string; duplicate?: boolean; ignored?: boolean; hold_code?: string | null; payment_state?: string };
  revalidatePath('/office/dropship/test-order');
  if (!r.ok) return { ok: false, message: r.message ?? r.code ?? 'Not created.' };
  if (r.ignored) return { ok: false, message: r.message ?? 'No Octopus items in this order.' };
  return {
    ok: true,
    order_number: r.order_number,
    message: r.duplicate ? `Already received as ${r.order_number} (duplicate ignored).`
      : `Created ${r.order_number}: ${r.hold_code ? `on hold (${r.hold_code.replace('_', ' ')})` : r.payment_state === 'unpaid' ? 'awaiting payment' : `payment ${r.payment_state}`}.`,
  };
}
